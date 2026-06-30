import type { SqliteDatabase } from './db.js';

export interface CommentReplyRow {
  id: number;
  commentId: string;
  body: string;
  sentAt: string;
  source: string;
  sourceResponseId: string | null;
  sourceUrl: string | null;
}

interface RawReply {
  id: number;
  comment_id: string;
  body: string;
  sent_at: string;
  source: string;
  source_response_id: string | null;
  source_url: string | null;
}

export class CommentReplyRepository {
  constructor(
    private readonly db: SqliteDatabase,
    private readonly userId: number,
  ) {}

  insert(row: Omit<CommentReplyRow, 'id'>): CommentReplyRow {
    const info = this.db
      .prepare(
        `INSERT INTO comment_reply (user_id, comment_id, body, sent_at, source, source_response_id, source_url)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        this.userId,
        row.commentId,
        row.body,
        row.sentAt,
        row.source,
        row.sourceResponseId,
        row.sourceUrl,
      );
    return { id: Number(info.lastInsertRowid), ...row };
  }

  listByComment(commentId: string): CommentReplyRow[] {
    return (
      this.db
        .prepare(
          'SELECT * FROM comment_reply WHERE user_id = ? AND comment_id = ? ORDER BY sent_at ASC, id ASC',
        )
        .all(this.userId, commentId) as RawReply[]
    ).map((r) => ({
      id: r.id,
      commentId: r.comment_id,
      body: r.body,
      sentAt: r.sent_at,
      source: r.source,
      sourceResponseId: r.source_response_id,
      sourceUrl: r.source_url,
    }));
  }
}
