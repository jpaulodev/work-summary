import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authed } from '../plugins/auth-guard.js';

const QuerySchema = z.object({
  status: z.enum(['pending', 'addressed', 'resolved', 'snoozed', 'all']).default('all'),
  repo: z.string().optional(),
  rule: z.string().optional(),
  author: z.string().optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

const StatusSchema = z.object({
  status: z.enum(['pending', 'addressed', 'resolved', 'snoozed']),
  snoozedUntil: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
});

export default function commentsRoutes(
  app: FastifyInstance,
  _opts: unknown,
  done: () => void,
): void {
  app.get(
    '/comments',
    authed((req) => {
      const q = QuerySchema.parse(req.query);
      const wheres: string[] = [];
      const params: unknown[] = [];
      if (q.repo) {
        wheres.push('nc.repo = ?');
        params.push(q.repo);
      }
      if (q.author) {
        wheres.push('nc.author_login = ?');
        params.push(q.author);
      }
      if (q.rule) {
        // matched_rules is a JSON array string e.g. ["mentioned","assignee"]; match
        // the exact quoted token so rule=mention does not match "mentioned", and
        // escape LIKE metacharacters in the user value.
        wheres.push("nc.matched_rules LIKE ? ESCAPE '\\'");
        params.push(`%"${escapeLike(q.rule)}"%`);
      }
      if (q.status !== 'all') {
        wheres.push("COALESCE(cs.status,'pending') = ?");
        params.push(q.status);
      }
      // Cursor is "<notified_at>|<id>": a composite keyset over the (notified_at, id)
      // unique ordering, so rows sharing a notified_at (same scan batch) are not
      // skipped across pages.
      if (q.cursor) {
        const [cursorAt, cursorId] = splitCursor(q.cursor);
        wheres.push('(nc.notified_at < ? OR (nc.notified_at = ? AND nc.id < ?))');
        params.push(cursorAt, cursorAt, cursorId);
      }
      const sql = `SELECT nc.id, nc.source, nc.repo, nc.container_type AS containerType,
        nc.container_number AS containerNumber, nc.comment_native_id AS commentId,
        nc.author_login AS author, nc.matched_rules AS matchedRules, nc.notified_at AS notifiedAt,
        nc.issue_key AS issueKey,
        COALESCE(cs.status,'pending') AS status, cs.note, cs.snoozed_until AS snoozedUntil
      FROM notified_comments nc LEFT JOIN comment_status cs ON cs.comment_id = nc.id
      ${wheres.length ? 'WHERE ' + wheres.join(' AND ') : ''}
      ORDER BY nc.notified_at DESC, nc.id DESC LIMIT ?`;
      params.push(q.limit + 1);
      const rows = app.db.prepare(sql).all(...params) as Array<Record<string, unknown>>;
      const hasMore = rows.length > q.limit;
      const items = rows.slice(0, q.limit).map((r) => ({
        ...r,
        matchedRules: parseRules(r.matchedRules),
      }));
      const last = items.at(-1) as Record<string, unknown> | undefined;
      const nextCursor = hasMore && last ? `${String(last.notifiedAt)}|${String(last.id)}` : null;
      return { items, nextCursor };
    }),
  );

  app.post(
    '/comments/:id/status',
    authed((req) => {
      const { id } = z.object({ id: z.string() }).parse(req.params);
      const body = StatusSchema.parse(req.body);
      app.db
        .prepare(
          `INSERT INTO comment_status (comment_id, status, snoozed_until, note, updated_at)
           VALUES (?, ?, ?, ?, ?) ON CONFLICT(comment_id) DO UPDATE SET status=excluded.status,
             snoozed_until=excluded.snoozed_until, note=excluded.note, updated_at=excluded.updated_at`,
        )
        .run(
          id,
          body.status,
          body.snoozedUntil ?? null,
          body.note ?? null,
          app.now().toISOString(),
        );
      return { ok: true };
    }),
  );
  done();
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

function splitCursor(cursor: string): [string, string] {
  const idx = cursor.lastIndexOf('|');
  if (idx === -1) return [cursor, ''];
  return [cursor.slice(0, idx), cursor.slice(idx + 1)];
}

function parseRules(raw: unknown): string[] {
  if (typeof raw !== 'string') return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as string[]) : [];
  } catch {
    return [];
  }
}
