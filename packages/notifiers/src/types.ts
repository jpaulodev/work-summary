import type { PendingComment } from '@work-summary/core';

export interface NotificationPayload {
  subject: string;
  comments: PendingComment[];
  generatedAt: string;
}

export interface Notifier {
  readonly id: string;
  send(payload: NotificationPayload): Promise<void>;
}

export interface SmtpOptions {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  to: string;
}
