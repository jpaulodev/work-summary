# Phase 3 - Built-in Configurable Scheduler - Design

**Status:** Draft for review
**Date:** 2026-06-29
**Scope:** Phase 3 of 6

---

## Assumptions

1. Scheduler runs **inside the API process** (`apps/api`), not as a separate daemon. Single SQLite means single source of truth.
2. Scheduling library: **node-cron** (5-field cron expressions, in-process timers).
3. Presets and cron expressions both supported. Presets translate to cron under the hood.
4. Multiple named schedules supported. Each has its own enabled flag and last-run record.
5. Manual override: existing `POST /api/scan` keeps working - it bypasses the scheduler queue but uses the same `runScan` function.
6. OS cron continues to work (CLI scan still callable manually).

---

## 1. Goals
- UI lets the user define one or more named schedules (e.g., "weekday-mornings", "after-lunch").
- Each schedule: enabled toggle, preset OR cron expression, timezone (defaults to system TZ), optional repo filter (subset of configured repos).
- Persistent schedule state survives restarts.
- Schedule history visible in Runs screen (run rows carry `triggered_by` = `schedule:<id>` | `manual` | `cron-external`).
- Hot-reload: changing a schedule via API immediately registers/unregisters the timer.

## 2. Non-Goals
- Distributed scheduling (single-process only).
- One-off scheduled tasks (only recurring).
- Schedule-level notifier override (uses global notifier config).

## 3. Stack
- `node-cron` ^3 for cron timer management.
- `cron-parser` for "next 5 occurrences" preview in UI.
- All else from Phase 2.

## 4. Data Model (migration 0003)

```sql
CREATE TABLE schedules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  cron_expression TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  repos_filter TEXT,                            -- JSON array, NULL = all
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_run_at TEXT,
  last_run_id INTEGER,
  next_run_at TEXT
);
CREATE INDEX idx_schedules_enabled ON schedules(enabled);

ALTER TABLE runs ADD COLUMN triggered_by TEXT NOT NULL DEFAULT 'manual';
```

## 5. Presets

The UI offers presets that map to cron:
- "Every weekday at 9 AM" -> `0 9 * * 1-5`
- "3x daily (9, 13, 17)" -> `0 9,13,17 * * *`
- "Every Monday 8 AM" -> `0 8 * * 1`
- "Every hour" -> `0 * * * *`
- "Custom..." -> user types raw cron expression.

The API only stores cron expressions; presets are a frontend concept.

## 6. API Surface (additions)

| Method | Path | Notes |
|---|---|---|
| GET | /api/schedules | list all |
| POST | /api/schedules | create `{ name, cronExpression, timezone?, reposFilter? }` |
| PUT | /api/schedules/:id | update; setting enabled flips timer |
| DELETE | /api/schedules/:id | remove and unregister |
| GET | /api/schedules/:id/preview | returns `{ next: string[] }` (next 5 occurrences) |

## 7. Scheduler Engine

`packages/scheduler/src/engine.ts`:

```ts
export class ScheduleEngine {
  start(): void;                       // load from DB and register all enabled
  stop(): void;                        // dispose all timers
  upsert(schedule: ScheduleRow): void; // (re-)register one
  remove(id: string): void;
  list(): ScheduleStatus[];
}
```

Hooks into `runScan` via dependency injection. On each tick:
1. Update `schedules.last_run_at`, set `runs.triggered_by = 'schedule:<id>'`.
2. Call `runScan` with config (repos overridden if `repos_filter` present).
3. Update `schedules.next_run_at` via `cron-parser`.

Concurrent safety: same single-flight lock as manual scan. If a scan is already running when a tick fires, the tick is logged and skipped (no queueing).

## 8. UI

Schedules screen:
- List card per schedule: name, enabled toggle, cron expression, "Next: 2026-06-30 09:00:00 -03:00", repos filter, last-run badge.
- "+ New schedule" opens dialog with preset dropdown + custom cron field + repos filter multi-select + timezone select.
- Inline "Run now" per schedule (same as global Run now but tagged with schedule id).

## 9. Testing

- `packages/scheduler`: unit tests with fake timers (vitest's `vi.useFakeTimers()`) verifying registration/unregistration and that `runScan` is invoked on tick.
- API route tests for CRUD.
- One E2E: create schedule, fake clock advance, verify run created.

## 10. Migration Path

If user already runs OS cron from Phase 1, no automated migration. README documents how to disable the cron line and create a schedule via UI. Both can coexist without conflict (the dedup table prevents double-emails).
