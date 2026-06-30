import { Loader2, Play, Zap } from 'lucide-react';
import { useRuns, useScanStatus, useTriggerScan } from '../lib/resources';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Card } from '../components/ui/card';
import { relativeTime } from '../lib/utils';
import type { RunRow } from '../lib/types';

function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' {
  if (status === 'success') return 'success';
  if (status === 'partial') return 'warning';
  if (status === 'failed') return 'danger';
  return 'neutral';
}

function duration(run: RunRow): string {
  if (!run.finishedAt) return '-';
  const ms = new Date(run.finishedAt).getTime() - new Date(run.startedAt).getTime();
  if (Number.isNaN(ms) || ms < 0) return '-';
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export default function Runs(): JSX.Element {
  const runs = useRuns();
  const trigger = useTriggerScan();
  const status = useScanStatus(trigger.isSuccess || trigger.isPending);
  const running = status.data?.running ?? trigger.isPending;

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Runs</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            History of scan runs. Schedules are managed via OS cron until Phase 3.
          </p>
        </div>
        <Button onClick={() => trigger.mutate()} disabled={running}>
          {running ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" /> Scanning
            </>
          ) : (
            <>
              <Play className="h-4 w-4" /> Run now
            </>
          )}
        </Button>
      </header>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="px-4 py-3 font-medium">Started</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Found</th>
              <th className="px-4 py-3 text-right font-medium">Notified</th>
              <th className="px-4 py-3 text-right font-medium">Duration</th>
            </tr>
          </thead>
          <tbody>
            {runs.isLoading && (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">
                  <Loader2 className="mx-auto h-5 w-5 animate-spin" />
                </td>
              </tr>
            )}
            {runs.data?.items.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center text-muted-foreground">
                  <Zap className="mx-auto mb-2 h-6 w-6" />
                  No runs yet. Trigger one with &ldquo;Run now&rdquo;.
                </td>
              </tr>
            )}
            {runs.data?.items.map((run) => (
              <tr
                key={run.id}
                className="border-b border-border/60 last:border-0 hover:bg-muted/40"
              >
                <td className="px-4 py-3">{relativeTime(run.startedAt)}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(run.status)} className="capitalize">
                    {run.status}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{run.commentsFound}</td>
                <td className="px-4 py-3 text-right tabular-nums">{run.commentsNotified}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {duration(run)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
