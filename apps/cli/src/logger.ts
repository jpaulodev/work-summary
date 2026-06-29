import { homedir } from 'node:os';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pino, { type Logger } from 'pino';

function expandHome(p: string): string {
  return p.startsWith('~') ? p.replace(/^~/, homedir()) : p;
}

export interface LoggerOptions {
  level: 'debug' | 'info' | 'warn' | 'error';
  file: string;
  runId?: number;
  jsonOnly?: boolean;
}

export function createLogger(opts: LoggerOptions): Logger {
  const file = expandHome(opts.file);
  mkdirSync(dirname(file), { recursive: true });

  const fileStream = pino.destination({ dest: file, append: true, sync: false });
  const streams: pino.StreamEntry[] = [{ stream: fileStream }];

  const wantPretty = !opts.jsonOnly && process.stderr.isTTY;
  if (wantPretty) {
    const pretty = pino.transport({
      target: 'pino-pretty',
      options: { destination: 2, colorize: true },
    }) as pino.DestinationStream;
    streams.push({ stream: pretty });
  } else if (!opts.jsonOnly) {
    streams.push({ stream: process.stderr });
  }

  const base = opts.runId !== undefined ? { runId: opts.runId } : {};
  return pino({ level: opts.level, base }, pino.multistream(streams));
}
