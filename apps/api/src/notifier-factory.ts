import { SmtpNotifier, type Notifier, type NotificationPayload } from '@work-summary/notifiers';
import { SlackNotifier } from '@work-summary/notifier-slack';
import { TeamsNotifier } from '@work-summary/notifier-teams';
import type { NotifierWithSecret } from '@work-summary/config-db';

/** Build a concrete Notifier from a decrypted DB config. */
export function buildNotifier(config: NotifierWithSecret): Notifier {
  switch (config.type) {
    case 'smtp':
      return new SmtpNotifier({
        host: config.host,
        port: config.port,
        secure: config.secure,
        user: config.user,
        pass: config.pass,
        from: config.from,
        to: config.to,
      });
    case 'slack':
      return new SlackNotifier({ webhookUrl: config.webhookUrl });
    case 'teams':
      return new TeamsNotifier({ webhookUrl: config.webhookUrl });
    default: {
      const exhaustive: never = config.type;
      throw new Error(`unknown notifier type: ${String(exhaustive)}`);
    }
  }
}

export interface NotifierResult {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * A Notifier that fans out to several notifiers best-effort: one failing channel
 * does not abort the others. If EVERY channel fails, it throws so the caller
 * (runScan) treats the digest as undelivered and does NOT mark the comments
 * notified - otherwise they would be permanently lost.
 */
export function buildCompositeNotifier(
  entries: { id: string; notifier: Notifier }[],
  logger: { error: (obj: unknown, msg: string) => void },
): Notifier {
  return {
    id: 'composite',
    send: async (payload: NotificationPayload): Promise<void> => {
      if (entries.length === 0) return;
      let delivered = 0;
      const failures: string[] = [];
      for (const { id, notifier } of entries) {
        try {
          await notifier.send(payload);
          delivered++;
        } catch (err) {
          failures.push(`${id}: ${err instanceof Error ? err.message : String(err)}`);
          logger.error({ err, notifier: id }, 'notifier failed');
        }
      }
      if (delivered === 0) {
        throw new Error(`all notifiers failed: ${failures.join('; ')}`);
      }
    },
  };
}
