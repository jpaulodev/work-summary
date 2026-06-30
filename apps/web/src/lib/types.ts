export type CommentStatus = 'pending' | 'addressed' | 'resolved' | 'snoozed';

export interface CommentRow {
  id: string;
  source: string;
  repo: string;
  containerType: 'pr' | 'issue';
  containerNumber: number;
  commentId: string;
  author: string;
  matchedRules: string[];
  notifiedAt: string;
  status: CommentStatus;
  note: string | null;
  snoozedUntil: string | null;
}

export interface CommentsPage {
  items: CommentRow[];
  nextCursor: string | null;
}

export interface MatchRules {
  authorOfPrUnanswered: boolean;
  mentioned: boolean;
  repliedBeforeThenFollowup: boolean;
  assignee: boolean;
  changesRequested: boolean;
}

export interface BotFilter {
  excludeBots: boolean;
  botWhitelist: string[];
}

export interface GithubSource {
  enabled: boolean;
  repos: string[];
  rules: MatchRules;
  filters: BotFilter;
  hasToken: boolean;
}

export interface NotifierItem {
  id: string;
  type: 'smtp';
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  from: string;
  to: string;
  subjectTemplate: string;
  hasSecret: boolean;
}

export interface RunRow {
  id: number;
  startedAt: string;
  finishedAt: string | null;
  status: string;
  commentsFound: number;
  commentsNotified: number;
  errorMessage: string | null;
  sourceStats: string | null;
}

export interface ScanStatus {
  running: boolean;
  runId?: number;
}

export interface Schedule {
  id: string;
  name: string;
  enabled: boolean;
  cronExpression: string;
  timezone: string;
  reposFilter: string[] | null;
  createdAt: string;
  updatedAt: string;
  lastRunAt: string | null;
  lastRunId: number | null;
  nextRunAt: string | null;
}
