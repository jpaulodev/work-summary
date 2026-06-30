import type { PendingComment } from '@work-summary/core';
import type { SqliteDatabase } from './db.js';

export interface CommentsRepo {
  filterUnnotified(comments: PendingComment[]): PendingComment[];
  markAsNotified(comments: PendingComment[], notifiedAt: string): void;
}

export function createCommentsRepo(db: SqliteDatabase, userId: number): CommentsRepo {
  const hasStmt = db.prepare('SELECT 1 FROM notified_comments WHERE user_id = ? AND id = ?');
  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO notified_comments
     (user_id, id, source, repo, container_type, container_number, comment_native_id, author_login, matched_rules, notified_at, issue_key, comment_url)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  return {
    filterUnnotified(comments) {
      if (comments.length === 0) return [];
      return comments.filter((c) => hasStmt.get(userId, c.id) === undefined);
    },
    markAsNotified(comments, notifiedAt) {
      if (comments.length === 0) return;
      const tx = db.transaction((items: PendingComment[]) => {
        for (const c of items) {
          insertStmt.run(
            userId,
            c.id,
            c.source,
            c.repo,
            c.containerType,
            c.containerNumber,
            c.commentId,
            c.author.login,
            JSON.stringify(c.matchedRules),
            notifiedAt,
            c.issueKey ?? null,
            c.commentUrl,
          );
        }
      });
      tx(comments);
    },
  };
}
