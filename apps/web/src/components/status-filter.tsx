import { cn } from '../lib/utils';
import type { CommentStatus } from '../lib/types';

export type StatusFilterValue = CommentStatus | 'all';

const OPTIONS: { value: StatusFilterValue; label: string }[] = [
  { value: 'pending', label: 'Pending' },
  { value: 'addressed', label: 'Addressed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'snoozed', label: 'Snoozed' },
  { value: 'all', label: 'All' },
];

export function StatusFilter({
  value,
  onChange,
}: {
  value: StatusFilterValue;
  onChange: (v: StatusFilterValue) => void;
}): JSX.Element {
  return (
    <div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-soft">
      {OPTIONS.map((opt) => (
        <button
          key={opt.value}
          onClick={() => onChange(opt.value)}
          className={cn(
            'rounded-md px-3 py-1.5 text-sm font-medium transition-all',
            value === opt.value
              ? 'bg-primary text-primary-foreground shadow-soft'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
