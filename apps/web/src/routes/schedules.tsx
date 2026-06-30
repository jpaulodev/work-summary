import { useEffect, useState } from 'react';
import { CalendarClock, Loader2, Plus, Trash2 } from 'lucide-react';
import {
  useSchedules,
  useCreateSchedule,
  useUpdateSchedule,
  useDeleteSchedule,
} from '../lib/resources';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Dialog } from '../components/ui/dialog';
import { cn, relativeTime } from '../lib/utils';
import type { Schedule } from '../lib/types';

const PRESETS = [
  { label: 'Every weekday at 9 AM', cron: '0 9 * * 1-5' },
  { label: '3x daily (9, 13, 17)', cron: '0 9,13,17 * * *' },
  { label: 'Every Monday at 8 AM', cron: '0 8 * * 1' },
  { label: 'Every hour', cron: '0 * * * *' },
];

export default function Schedules(): JSX.Element {
  const schedules = useSchedules();
  const update = useUpdateSchedule();
  const remove = useDeleteSchedule();
  const [open, setOpen] = useState(false);

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedules</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Run scans automatically on a cron schedule, in-process. No OS cron needed.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> New schedule
        </Button>
      </header>

      {schedules.isLoading ? (
        <div className="py-20 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : (schedules.data?.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-20 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <CalendarClock className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium">No schedules yet</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Create one to run scans automatically.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {schedules.data?.map((s) => (
            <ScheduleCard
              key={s.id}
              schedule={s}
              onToggle={(enabled) => update.mutate({ id: s.id, enabled })}
              onDelete={() => remove.mutate(s.id)}
            />
          ))}
        </div>
      )}

      <CreateScheduleDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function ScheduleCard({
  schedule,
  onToggle,
  onDelete,
}: {
  schedule: Schedule;
  onToggle: (enabled: boolean) => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <p className="text-sm font-semibold">{schedule.name}</p>
        <code className="mt-0.5 block font-mono text-xs text-muted-foreground">
          {schedule.cronExpression} · {schedule.timezone}
        </code>
        <p className="mt-1 text-xs text-muted-foreground">
          Next: {schedule.nextRunAt ? relativeTime(schedule.nextRunAt) : 'when enabled'}
          {schedule.lastRunAt ? ` · Last run ${relativeTime(schedule.lastRunAt)}` : ''}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          role="switch"
          aria-checked={schedule.enabled}
          aria-label={`Toggle ${schedule.name}`}
          onClick={() => onToggle(!schedule.enabled)}
          className={cn(
            'relative h-6 w-11 shrink-0 rounded-full transition-colors',
            schedule.enabled ? 'bg-primary' : 'bg-input',
          )}
        >
          <span
            className={cn(
              'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
              schedule.enabled ? 'left-[1.375rem]' : 'left-0.5',
            )}
          />
        </button>
        <Button size="icon" variant="ghost" aria-label="Delete" onClick={onDelete}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

function CreateScheduleDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}): JSX.Element {
  const create = useCreateSchedule();
  const [name, setName] = useState('');
  const [cron, setCron] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Reset the form each time the dialog is opened.
  useEffect(() => {
    if (open) {
      setName('');
      setCron('');
      setError(null);
    }
  }, [open]);

  const submit = (): void => {
    setError(null);
    create.mutate(
      { name, cronExpression: cron },
      {
        onSuccess: () => {
          setName('');
          setCron('');
          onClose();
        },
        onError: () => setError('Could not create schedule. Check the cron expression.'),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="New schedule"
      description="Pick a preset or write a 5-field cron expression."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!name || !cron || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create
          </Button>
        </>
      }
    >
      <div>
        <Label htmlFor="sched-name">Name</Label>
        <Input id="sched-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        {PRESETS.map((p) => (
          <Button
            key={p.cron}
            type="button"
            variant={cron === p.cron ? 'secondary' : 'outline'}
            size="sm"
            onClick={() => setCron(p.cron)}
          >
            {p.label}
          </Button>
        ))}
      </div>
      <div>
        <Label htmlFor="sched-cron">Cron expression</Label>
        <Input
          id="sched-cron"
          value={cron}
          onChange={(e) => setCron(e.target.value)}
          placeholder="0 9 * * 1-5"
          className="font-mono"
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Dialog>
  );
}
