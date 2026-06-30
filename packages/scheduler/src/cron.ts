import parser from 'cron-parser';

/** Returns true if the expression is a valid 5-field cron expression. */
export function isValidCron(expression: string): boolean {
  try {
    parser.parseExpression(expression);
    return true;
  } catch {
    return false;
  }
}

/** Milliseconds from `from` until the next occurrence of `expression`. */
export function nextDelayMs(expression: string, timezone: string, from: Date): number {
  const it = parser.parseExpression(expression, { tz: timezone, currentDate: from });
  return Math.max(0, it.next().getTime() - from.getTime());
}

/** The next N occurrences of `expression` as ISO strings, starting after `from`. */
export function nextOccurrences(
  expression: string,
  timezone: string,
  count: number,
  from: Date,
): string[] {
  const it = parser.parseExpression(expression, { tz: timezone, currentDate: from });
  return Array.from({ length: count }, () => it.next().toISOString());
}
