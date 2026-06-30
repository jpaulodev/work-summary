import { useEffect, useState } from 'react';
import { Check, Loader2, Save } from 'lucide-react';
import { useSources, useUpdateSources } from '../lib/resources';
import { Button } from '../components/ui/button';
import { Input, Label, Textarea } from '../components/ui/input';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { JiraPanel } from '../components/jira-panel';
import type { MatchRules } from '../lib/types';
import { cn } from '../lib/utils';

const RULE_FIELDS: { key: keyof MatchRules; label: string; desc: string }[] = [
  {
    key: 'authorOfPrUnanswered',
    label: 'PR author unanswered',
    desc: 'Comments on my PRs with no reply since',
  },
  { key: 'mentioned', label: 'Mentioned', desc: 'Any comment that @-mentions me' },
  {
    key: 'repliedBeforeThenFollowup',
    label: 'Follow-up',
    desc: 'Someone replied after my last comment',
  },
  { key: 'assignee', label: 'Assignee', desc: 'Unanswered comments where I am assigned' },
  {
    key: 'changesRequested',
    label: 'Changes requested',
    desc: 'CHANGES_REQUESTED reviews on my PRs',
  },
];

const DEFAULT_RULES: MatchRules = {
  authorOfPrUnanswered: true,
  mentioned: true,
  repliedBeforeThenFollowup: true,
  assignee: true,
  changesRequested: true,
};

export default function Sources(): JSX.Element {
  const sources = useSources();
  const update = useUpdateSources();
  const [reposText, setReposText] = useState('');
  const [token, setToken] = useState('');
  const [rules, setRules] = useState<MatchRules>(DEFAULT_RULES);
  const [excludeBots, setExcludeBots] = useState(true);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'github' | 'jira'>('github');

  useEffect(() => {
    const g = sources.data?.github;
    if (g) {
      setReposText(g.repos.join('\n'));
      setRules(g.rules);
      setExcludeBots(g.filters.excludeBots);
    }
  }, [sources.data]);

  const onSave = (): void => {
    setSaved(false);
    const repos = reposText
      .split('\n')
      .map((r) => r.trim())
      .filter(Boolean);
    update.mutate(
      {
        enabled: true,
        repos,
        rules,
        filters: { excludeBots, botWhitelist: sources.data?.github?.filters.botWhitelist ?? [] },
        ...(token.trim() ? { token: token.trim() } : {}),
      },
      {
        onSuccess: () => {
          setSaved(true);
          setToken('');
        },
      },
    );
  };

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Sources</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Configure which GitHub repositories and JIRA projects to scan.
        </p>
      </header>

      <div
        role="tablist"
        aria-label="Source type"
        className="mb-5 inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 shadow-soft"
      >
        {(['github', 'jira'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
            className={cn(
              'rounded-md px-4 py-1.5 text-sm font-medium capitalize transition-all',
              tab === t
                ? 'bg-primary text-primary-foreground shadow-soft'
                : 'text-muted-foreground hover:bg-muted hover:text-foreground',
            )}
          >
            {t === 'jira' ? 'JIRA' : 'GitHub'}
          </button>
        ))}
      </div>

      {tab === 'jira' ? (
        <JiraPanel />
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>GitHub</CardTitle>
              <CardDescription>
                Token is write-only. Leave blank to keep the current token.
                {sources.data?.github?.hasToken && ' A token is currently set.'}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div>
                <Label htmlFor="token">Personal access token</Label>
                <Input
                  id="token"
                  type="password"
                  placeholder={
                    sources.data?.github?.hasToken ? '•••••••••• (unchanged)' : 'ghp_...'
                  }
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="repos">Repositories (one per line)</Label>
                <Textarea
                  id="repos"
                  placeholder={'org/repo-foo\norg/repo-bar'}
                  value={reposText}
                  onChange={(e) => setReposText(e.target.value)}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Matching rules</CardTitle>
              <CardDescription>Toggle which signals create a pending comment.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {RULE_FIELDS.map(({ key, label, desc }) => (
                <Toggle
                  key={key}
                  label={label}
                  desc={desc}
                  checked={rules[key]}
                  onChange={(v) => setRules((prev) => ({ ...prev, [key]: v }))}
                />
              ))}
              <div className="mt-2 border-t border-border pt-2">
                <Toggle
                  label="Exclude bots"
                  desc="Drop comments authored by bot accounts"
                  checked={excludeBots}
                  onChange={setExcludeBots}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex items-center gap-3">
            <Button onClick={onSave} disabled={update.isPending}>
              {update.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              Save changes
            </Button>
            {saved && (
              <span className="inline-flex items-center gap-1 text-sm text-success">
                <Check className="h-4 w-4" /> Saved
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function Toggle({
  label,
  desc,
  checked,
  onChange,
}: {
  label: string;
  desc: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}): JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className="flex items-center justify-between rounded-md px-2 py-2 text-left transition-colors hover:bg-muted"
    >
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{desc}</span>
      </span>
      <span
        className={cn(
          'relative h-6 w-11 shrink-0 rounded-full transition-colors',
          checked ? 'bg-primary' : 'bg-input',
        )}
      >
        <span
          className={cn(
            'absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all',
            checked ? 'left-[1.375rem]' : 'left-0.5',
          )}
        />
      </span>
    </button>
  );
}
