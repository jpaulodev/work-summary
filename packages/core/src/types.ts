export type MatchRule =
  | 'author_of_pr_unanswered'
  | 'mentioned'
  | 'replied_before_then_followup'
  | 'assignee'
  | 'changes_requested';

export interface MatchRulesConfig {
  authorOfPrUnanswered: boolean;
  mentioned: boolean;
  repliedBeforeThenFollowup: boolean;
  assignee: boolean;
  changesRequested: boolean;
}

export interface BotFilterConfig {
  excludeBots: boolean;
  botWhitelist: string[];
}

export interface PendingComment {
  id: string;
  source: 'github';
  repo: string;
  containerType: 'pr' | 'issue';
  containerNumber: number;
  containerTitle: string;
  containerUrl: string;
  commentId: string;
  commentUrl: string;
  author: { login: string; isBot: boolean };
  body: string;
  createdAt: string;
  matchedRules: MatchRule[];
}

export interface RawComment {
  nativeId: string;
  url: string;
  author: { login: string; isBot: boolean };
  body: string;
  createdAt: string;
}

export interface RawReview {
  state: 'CHANGES_REQUESTED' | 'APPROVED' | 'COMMENTED' | 'DISMISSED' | 'PENDING';
  author: { login: string; isBot: boolean };
  submittedAt: string;
}

export interface RawContainer {
  type: 'pr' | 'issue';
  number: number;
  title: string;
  url: string;
  authorLogin: string;
  assigneeLogins: string[];
  comments: RawComment[];
  reviews: RawReview[];
  lastUserCommitAt: string | null;
}

export interface ScanContext {
  source: 'github';
  repo: string;
  userLogin: string;
  containers: RawContainer[];
}
