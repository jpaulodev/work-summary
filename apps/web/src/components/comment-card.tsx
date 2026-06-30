import {
  Check,
  CircleDot,
  Clock,
  ExternalLink,
  GitPullRequest,
  RotateCcw,
  SquareKanban,
} from 'lucide-react';
import type { CommentRow, CommentStatus } from '../lib/types';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn, relativeTime } from '../lib/utils';

const RULE_LABELS: Record<string, string> = {
  author_of_pr_unanswered: 'PR author',
  mentioned: 'Mentioned',
  replied_before_then_followup: 'Follow-up',
  assignee: 'Assignee',
  changes_requested: 'Changes requested',
};

const STATUS_TONE: Record<CommentStatus, 'neutral' | 'primary' | 'success' | 'warning'> = {
  pending: 'primary',
  addressed: 'success',
  resolved: 'neutral',
  snoozed: 'warning',
};

/** JIRA `repo` is stored as "<baseUrl> :: <PROJECT>"; build a browse link. */
function jiraBrowseUrl(repo: string, issueKey: string | null): string {
  const base = repo.split(' :: ')[0] ?? '';
  return issueKey ? `${base}/browse/${issueKey}` : base;
}

export function CommentCard({
  comment,
  onStatusChange,
}: {
  comment: CommentRow;
  onStatusChange: (status: CommentStatus) => void;
}): JSX.Element {
  const isJira = comment.source === 'jira';
  const containerUrl = isJira
    ? jiraBrowseUrl(comment.repo, comment.issueKey)
    : `https://github.com/${comment.repo}/${
        comment.containerType === 'pr' ? 'pull' : 'issues'
      }/${comment.containerNumber}`;
  const containerLabel = isJira ? (comment.issueKey ?? 'issue') : `#${comment.containerNumber}`;

  return (
    <div className="group animate-fade-in rounded-lg border border-border bg-card p-4 shadow-soft transition-all hover:border-primary/40 hover:shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {isJira ? (
              <SquareKanban className="h-3.5 w-3.5 text-primary" />
            ) : (
              <GitPullRequest className="h-3.5 w-3.5 text-primary" />
            )}
            <span className="font-medium text-foreground">{comment.repo}</span>
            <span aria-hidden>·</span>
            <a
              href={containerUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-0.5 hover:text-primary"
            >
              {containerLabel}
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
          <p className="mt-1.5 truncate text-sm font-medium">
            <span className="text-muted-foreground">@{comment.author}</span>
          </p>
        </div>
        <Badge tone={STATUS_TONE[comment.status]} className="shrink-0 capitalize">
          {comment.status}
        </Badge>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {comment.matchedRules.map((r) => (
          <Badge key={r} tone="neutral">
            {RULE_LABELS[r] ?? r}
          </Badge>
        ))}
        <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <Clock className="h-3 w-3" />
          {relativeTime(comment.notifiedAt)}
        </span>
      </div>

      <div
        className={cn(
          'mt-4 flex items-center gap-2 border-t border-border/70 pt-3',
          'opacity-80 transition-opacity group-hover:opacity-100',
        )}
      >
        <Button
          size="sm"
          variant={comment.status === 'addressed' ? 'secondary' : 'outline'}
          onClick={() => onStatusChange('addressed')}
        >
          <Check className="h-3.5 w-3.5" /> Addressed
        </Button>
        <Button
          size="sm"
          variant={comment.status === 'resolved' ? 'secondary' : 'outline'}
          onClick={() => onStatusChange('resolved')}
        >
          <CircleDot className="h-3.5 w-3.5" /> Resolve
        </Button>
        <Button size="sm" variant="ghost" onClick={() => onStatusChange('snoozed')}>
          <Clock className="h-3.5 w-3.5" /> Snooze
        </Button>
        {comment.status !== 'pending' && (
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto"
            onClick={() => onStatusChange('pending')}
          >
            <RotateCcw className="h-3.5 w-3.5" /> Reopen
          </Button>
        )}
      </div>
    </div>
  );
}
