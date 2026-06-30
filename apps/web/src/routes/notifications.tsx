import { useEffect, useState } from 'react';
import { Check, Loader2, Save, Send, X } from 'lucide-react';
import { useNotifiers, useUpdateNotifier, useTestNotifier } from '../lib/resources';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';

const NOTIFIER_ID = 'primary-email';

interface FormState {
  host: string;
  port: number;
  secure: boolean;
  from: string;
  to: string;
  subjectTemplate: string;
  user: string;
  pass: string;
}

const EMPTY: FormState = {
  host: '',
  port: 587,
  secure: false,
  from: '',
  to: '',
  subjectTemplate: '[work-summary] {{count}} new comments - {{date}}',
  user: '',
  pass: '',
};

export default function Notifications(): JSX.Element {
  const notifiers = useNotifiers();
  const update = useUpdateNotifier();
  const test = useTestNotifier();
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);

  const existing =
    notifiers.data?.items.find((n) => n.id === NOTIFIER_ID) ?? notifiers.data?.items[0];

  useEffect(() => {
    if (existing) {
      setForm((prev) => ({
        ...prev,
        host: existing.host,
        port: existing.port,
        secure: existing.secure,
        from: existing.from,
        to: existing.to,
        subjectTemplate: existing.subjectTemplate,
      }));
    }
  }, [existing]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const onSave = (): void => {
    setSaved(false);
    update.mutate(
      {
        id: existing?.id ?? NOTIFIER_ID,
        host: form.host,
        port: form.port,
        secure: form.secure,
        from: form.from,
        to: form.to,
        subjectTemplate: form.subjectTemplate,
        enabled: true,
        ...(form.user || form.pass ? { secret: { user: form.user, pass: form.pass } } : {}),
      },
      {
        onSuccess: () => {
          setSaved(true);
          setForm((prev) => ({ ...prev, user: '', pass: '' }));
        },
      },
    );
  };

  const onTest = (): void => {
    setTestResult(null);
    test.mutate(existing?.id ?? NOTIFIER_ID, {
      onSuccess: () => setTestResult('ok'),
      onError: () => setTestResult('fail'),
    });
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure the SMTP server used to send your digest emails.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>SMTP</CardTitle>
          <CardDescription>
            Credentials are encrypted at rest. Leave user/password blank to keep the current secret.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="host">Host</Label>
            <Input id="host" value={form.host} onChange={(e) => set('host', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="port">Port</Label>
            <Input
              id="port"
              type="number"
              value={form.port}
              onChange={(e) => {
                const n = Number(e.target.value);
                set('port', Number.isNaN(n) ? 0 : n);
              }}
            />
          </div>
          <div className="flex items-end pb-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.secure}
                onChange={(e) => set('secure', e.target.checked)}
                className="h-4 w-4 accent-[hsl(var(--primary))]"
              />
              Use TLS (secure)
            </label>
          </div>
          <div>
            <Label htmlFor="from">From</Label>
            <Input id="from" value={form.from} onChange={(e) => set('from', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="to">To</Label>
            <Input id="to" value={form.to} onChange={(e) => set('to', e.target.value)} />
          </div>
          <div>
            <Label htmlFor="user">SMTP user</Label>
            <Input
              id="user"
              autoComplete="off"
              placeholder={existing?.hasSecret ? '•••••• (unchanged)' : ''}
              value={form.user}
              onChange={(e) => set('user', e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="pass">SMTP password</Label>
            <Input
              id="pass"
              type="password"
              autoComplete="new-password"
              placeholder={existing?.hasSecret ? '•••••• (unchanged)' : ''}
              value={form.pass}
              onChange={(e) => set('pass', e.target.value)}
            />
          </div>
          <div className="sm:col-span-2">
            <Label htmlFor="subject">Subject template</Label>
            <Input
              id="subject"
              value={form.subjectTemplate}
              onChange={(e) => set('subjectTemplate', e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button onClick={onSave} disabled={update.isPending}>
          {update.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Save className="h-4 w-4" />
          )}
          Save changes
        </Button>
        <Button variant="outline" onClick={onTest} disabled={test.isPending}>
          {test.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Send className="h-4 w-4" />
          )}
          Send test
        </Button>
        {saved && (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <Check className="h-4 w-4" /> Saved
          </span>
        )}
        {testResult === 'ok' && (
          <span className="inline-flex items-center gap-1 text-sm text-success">
            <Check className="h-4 w-4" /> Connection verified
          </span>
        )}
        {testResult === 'fail' && (
          <span className="inline-flex items-center gap-1 text-sm text-danger">
            <X className="h-4 w-4" /> Verification failed
          </span>
        )}
      </div>
    </div>
  );
}
