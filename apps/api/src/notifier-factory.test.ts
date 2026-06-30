import { describe, it, expect, vi } from 'vitest';
import { buildNotifier, buildCompositeNotifier } from './notifier-factory.js';
import type { Notifier, NotificationPayload } from '@work-summary/notifiers';
import type { NotifierWithSecret } from '@work-summary/config-db';

const payload: NotificationPayload = { subject: 's', comments: [], generatedAt: '' };

function full(over: Partial<NotifierWithSecret>): NotifierWithSecret {
  return {
    id: 'n',
    type: 'slack',
    name: 'n',
    enabled: true,
    host: '',
    port: 587,
    secure: false,
    from: '',
    to: '',
    subjectTemplate: '',
    user: '',
    pass: '',
    webhookUrl: 'https://hooks.slack.com/X',
    ...over,
  };
}

describe('buildNotifier', () => {
  it('builds a slack notifier from a slack config', () => {
    expect(buildNotifier(full({ type: 'slack' })).id).toBe('slack');
  });
  it('builds a teams notifier from a teams config', () => {
    expect(buildNotifier(full({ type: 'teams' })).id).toBe('teams');
  });
  it('builds an smtp notifier from an smtp config', () => {
    expect(buildNotifier(full({ type: 'smtp', host: 'h' })).id).toBe('smtp');
  });
});

describe('buildCompositeNotifier', () => {
  it('one failing notifier does not abort the others', async () => {
    const send1 = vi.fn().mockResolvedValue(undefined);
    const sendBad = vi.fn().mockRejectedValue(new Error('boom'));
    const send2 = vi.fn().mockResolvedValue(undefined);
    const ok1: Notifier = { id: 'a', send: send1 };
    const bad: Notifier = { id: 'b', send: sendBad };
    const ok2: Notifier = { id: 'c', send: send2 };
    const logger = { error: vi.fn() };
    const composite = buildCompositeNotifier(
      [
        { id: 'a', notifier: ok1 },
        { id: 'b', notifier: bad },
        { id: 'c', notifier: ok2 },
      ],
      logger,
    );
    await expect(composite.send(payload)).resolves.toBeUndefined();
    expect(send1).toHaveBeenCalled();
    expect(send2).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledTimes(1);
  });

  it('throws when every notifier fails so the digest is not marked delivered', async () => {
    const bad: Notifier = { id: 'b', send: vi.fn().mockRejectedValue(new Error('boom')) };
    const composite = buildCompositeNotifier([{ id: 'b', notifier: bad }], { error: vi.fn() });
    await expect(composite.send(payload)).rejects.toThrow(/all notifiers failed/);
  });
});
