import { useEffect, useState } from 'react';
import { Bell, Check, Hash, Loader2, Mail, Plus, Send, Trash2, X } from 'lucide-react';
import {
  useNotifiers,
  useCreateNotifier,
  useDeleteNotifier,
  useTestNotifier,
  type CreateNotifierInput,
} from '../lib/resources';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Dialog } from '../components/ui/dialog';
import type { NotifierItem, NotifierType } from '../lib/types';

const TYPE_META: Record<NotifierType, { label: string; icon: typeof Mail }> = {
  smtp: { label: 'Email (SMTP)', icon: Mail },
  slack: { label: 'Slack', icon: Hash },
  teams: { label: 'Microsoft Teams', icon: Bell },
};

export default function Notifications(): JSX.Element {
  const notifiers = useNotifiers();
  const [open, setOpen] = useState(false);

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Deliver your digest to email, Slack, or Teams. Every enabled channel receives it.
          </p>
        </div>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add notifier
        </Button>
      </header>

      {notifiers.isLoading ? (
        <div className="py-16 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : (notifiers.data?.items.length ?? 0) === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-16 text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Bell className="h-6 w-6" />
          </div>
          <p className="text-sm font-medium">No notifiers yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Add one to receive your digests.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {notifiers.data?.items.map((n) => (
            <NotifierRow key={n.id} notifier={n} />
          ))}
        </div>
      )}

      <AddNotifierDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function NotifierRow({ notifier }: { notifier: NotifierItem }): JSX.Element {
  const test = useTestNotifier();
  const remove = useDeleteNotifier();
  const [result, setResult] = useState<'ok' | 'fail' | null>(null);
  const meta = TYPE_META[notifier.type];
  const Icon = meta.icon;

  const detail =
    notifier.type === 'smtp'
      ? `${notifier.host || 'SMTP'} -> ${notifier.to || '...'}`
      : 'Incoming webhook';

  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-accent text-accent-foreground">
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{notifier.name}</p>
          <p className="truncate text-xs text-muted-foreground">{detail}</p>
        </div>
        <Badge tone="neutral">{meta.label}</Badge>
      </div>
      <div className="flex items-center gap-2">
        {result === 'ok' && (
          <span className="inline-flex items-center gap-1 text-xs text-success">
            <Check className="h-3.5 w-3.5" /> Test sent
          </span>
        )}
        {result === 'fail' && (
          <span className="inline-flex items-center gap-1 text-xs text-danger">
            <X className="h-3.5 w-3.5" /> Failed
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          disabled={test.isPending}
          onClick={() => {
            setResult(null);
            test.mutate(notifier.id, {
              onSuccess: (r) => setResult(r.ok ? 'ok' : 'fail'),
              onError: () => setResult('fail'),
            });
          }}
        >
          {test.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Send test
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Delete"
          onClick={() => remove.mutate(notifier.id)}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </Card>
  );
}

const EMPTY_SMTP = { host: '', port: 587, secure: false, from: '', to: '', user: '', pass: '' };

function AddNotifierDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const create = useCreateNotifier();
  const [type, setType] = useState<NotifierType>('smtp');
  const [name, setName] = useState('');
  const [webhookUrl, setWebhookUrl] = useState('');
  const [smtp, setSmtp] = useState(EMPTY_SMTP);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setType('smtp');
      setName('');
      setWebhookUrl('');
      setSmtp(EMPTY_SMTP);
      setError(null);
    }
  }, [open]);

  const submit = (): void => {
    setError(null);
    const input: CreateNotifierInput =
      type === 'smtp'
        ? {
            type,
            name,
            host: smtp.host,
            port: smtp.port,
            secure: smtp.secure,
            from: smtp.from,
            to: smtp.to,
            secret: { user: smtp.user, pass: smtp.pass },
          }
        : { type, name, webhookUrl };
    create.mutate(input, {
      onSuccess: () => onClose(),
      onError: () =>
        setError('Could not save. Check the fields (Slack needs a hooks.slack.com URL).'),
    });
  };

  const valid = name && (type === 'smtp' ? smtp.host && smtp.from && smtp.to : webhookUrl);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add notifier"
      description="Choose a channel type and fill in its details."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!valid || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </>
      }
    >
      <div>
        <Label htmlFor="notif-type">Type</Label>
        <select
          id="notif-type"
          aria-label="Type"
          value={type}
          onChange={(e) => setType(e.target.value as NotifierType)}
          className="flex h-10 w-full rounded-md border border-input bg-background/60 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="smtp">Email (SMTP)</option>
          <option value="slack">Slack</option>
          <option value="teams">Microsoft Teams</option>
        </select>
      </div>
      <div>
        <Label htmlFor="notif-name">Name</Label>
        <Input id="notif-name" value={name} onChange={(e) => setName(e.target.value)} />
      </div>

      {type === 'smtp' ? (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <Label htmlFor="s-host">Host</Label>
            <Input
              id="s-host"
              value={smtp.host}
              onChange={(e) => setSmtp({ ...smtp, host: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="s-port">Port</Label>
            <Input
              id="s-port"
              type="number"
              value={smtp.port}
              onChange={(e) => {
                const n = Number(e.target.value);
                setSmtp({ ...smtp, port: Number.isNaN(n) ? 0 : n });
              }}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={smtp.secure}
                onChange={(e) => setSmtp({ ...smtp, secure: e.target.checked })}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              TLS
            </label>
          </div>
          <div>
            <Label htmlFor="s-from">From</Label>
            <Input
              id="s-from"
              value={smtp.from}
              onChange={(e) => setSmtp({ ...smtp, from: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="s-to">To</Label>
            <Input
              id="s-to"
              value={smtp.to}
              onChange={(e) => setSmtp({ ...smtp, to: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="s-user">User</Label>
            <Input
              id="s-user"
              value={smtp.user}
              onChange={(e) => setSmtp({ ...smtp, user: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="s-pass">Password</Label>
            <Input
              id="s-pass"
              type="password"
              value={smtp.pass}
              onChange={(e) => setSmtp({ ...smtp, pass: e.target.value })}
            />
          </div>
        </div>
      ) : (
        <div>
          <Label htmlFor="notif-webhook">Webhook URL</Label>
          <Input
            id="notif-webhook"
            placeholder={type === 'slack' ? 'https://hooks.slack.com/services/...' : 'https://...'}
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
          />
        </div>
      )}
      {error && <p className="text-sm text-danger">{error}</p>}
    </Dialog>
  );
}
