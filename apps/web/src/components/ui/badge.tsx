import type { HTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

const tones: Record<Tone, string> = {
  neutral: 'bg-muted text-muted-foreground border-border',
  primary: 'bg-accent text-accent-foreground border-transparent',
  success: 'bg-success/12 text-success border-transparent',
  warning: 'bg-warning/15 text-warning border-transparent',
  danger: 'bg-danger/12 text-danger border-transparent',
};

export function Badge({
  className,
  tone = 'neutral',
  ...props
}: HTMLAttributes<HTMLSpanElement> & { tone?: Tone }): JSX.Element {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none',
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
