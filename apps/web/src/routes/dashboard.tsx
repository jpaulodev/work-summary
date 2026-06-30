import { useEffect, useMemo, useState } from 'react';
import { Inbox, Loader2, Search } from 'lucide-react';
import { useComments, useUpdateStatus } from '../lib/comments';
import { StatusFilter, type StatusFilterValue } from '../components/status-filter';
import { CommentCard } from '../components/comment-card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import type { CommentRow } from '../lib/types';

export default function Dashboard(): JSX.Element {
  const [status, setStatus] = useState<StatusFilterValue>('pending');
  const [repoInput, setRepoInput] = useState('');
  const [repo, setRepo] = useState('');
  // Debounce the repo filter so typing does not fire a request per keystroke.
  useEffect(() => {
    const t = setTimeout(() => setRepo(repoInput.trim()), 300);
    return () => clearTimeout(t);
  }, [repoInput]);
  const filters = useMemo(() => ({ status, ...(repo ? { repo } : {}) }), [status, repo]);
  const query = useComments(filters);
  const updateStatus = useUpdateStatus();

  const items: CommentRow[] = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Comments awaiting your response, collected by the scanner.
        </p>
      </header>

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <StatusFilter value={status} onChange={setStatus} />
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Filter by repo (org/name)"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            className="w-64 pl-9"
          />
        </div>
      </div>

      {query.isLoading ? (
        <SkeletonList />
      ) : items.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {items.map((c) => (
            <CommentCard
              key={c.id}
              comment={c}
              onStatusChange={(newStatus) => updateStatus.mutate({ id: c.id, status: newStatus })}
            />
          ))}
          {query.hasNextPage && (
            <div className="flex justify-center pt-2">
              <Button
                variant="outline"
                onClick={() => void query.fetchNextPage()}
                disabled={query.isFetchingNextPage}
              >
                {query.isFetchingNextPage && <Loader2 className="h-4 w-4 animate-spin" />}
                Load more
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState(): JSX.Element {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Inbox className="h-6 w-6" />
      </div>
      <p className="text-sm font-medium">You are all caught up</p>
      <p className="mt-1 text-sm text-muted-foreground">No comments match this filter.</p>
    </div>
  );
}

function SkeletonList(): JSX.Element {
  return (
    <div className="flex flex-col gap-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-32 animate-pulse rounded-lg border border-border bg-muted/40" />
      ))}
    </div>
  );
}
