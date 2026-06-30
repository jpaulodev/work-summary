import type { ScheduleRepository, ScheduleRow } from '@work-summary/storage';
import { isValidCron, nextDelayMs, nextOccurrences } from './cron.js';

export interface ScheduleEngineDeps {
  scheduleRepo: ScheduleRepository;
  runScan: (opts: {
    triggeredBy: string;
    reposFilter?: string[] | null;
  }) => Promise<{ runId: number }>;
  now?: () => Date;
  logger?: { error: (msg: string, err: unknown) => void };
}

/**
 * In-process cron scheduler. Each enabled schedule self-reschedules with a
 * setTimeout computed from cron-parser, so it works under fake timers and has
 * no background polling. Timers are disposed on stop().
 */
export class ScheduleEngine {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly now: () => Date;

  constructor(private readonly deps: ScheduleEngineDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  start(): void {
    for (const s of this.deps.scheduleRepo.list()) {
      if (s.enabled) this.register(s);
    }
  }

  stop(): void {
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
  }

  has(id: string): boolean {
    return this.timers.has(id);
  }

  upsert(id: string): void {
    this.remove(id);
    const s = this.deps.scheduleRepo.get(id);
    if (s && s.enabled) this.register(s);
  }

  remove(id: string): void {
    const t = this.timers.get(id);
    if (t) {
      clearTimeout(t);
      this.timers.delete(id);
    }
  }

  private register(s: ScheduleRow): void {
    if (!isValidCron(s.cronExpression)) {
      throw new Error(`Invalid cron expression: ${s.cronExpression}`);
    }
    const scheduleNext = (): void => {
      const delay = nextDelayMs(s.cronExpression, s.timezone, this.now());
      const timer = setTimeout(() => {
        void this.fire(s).finally(() => {
          // Reschedule only if this schedule is still the active one.
          if (this.timers.get(s.id) === timer) scheduleNext();
        });
      }, delay);
      this.timers.set(s.id, timer);
    };
    scheduleNext();
  }

  private async fire(s: ScheduleRow): Promise<void> {
    try {
      const result = await this.deps.runScan({
        triggeredBy: `schedule:${s.id}`,
        reposFilter: s.reposFilter,
      });
      const ranAt = this.now().toISOString();
      const nextRun = nextOccurrences(s.cronExpression, s.timezone, 1, this.now())[0] ?? ranAt;
      this.deps.scheduleRepo.markRun(s.id, result.runId, ranAt, nextRun);
    } catch (err) {
      this.deps.logger?.error(`[scheduler] tick ${s.id} failed`, err);
    }
  }
}
