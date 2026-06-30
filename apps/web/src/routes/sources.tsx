import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  Github,
  Loader2,
  Lock,
  Plug,
  RefreshCw,
  Save,
  Search,
  Unplug,
  AlertTriangle,
} from 'lucide-react';
import { useSources, useUpdateSources, useDisconnectOAuth, useGithubRepos } from '../lib/resources';
import { Button } from '../components/ui/button';
import { Label } from '../components/ui/input';
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

/** Read ?connected / ?oauth_error from the OAuth redirect, then clean the URL. */
function useOAuthRedirectResult(): { connected: string | null; error: string | null } {
  const [result] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { connected: params.get('connected'), error: params.get('oauth_error') };
  });
  useEffect(() => {
    if (result.connected || result.error) {
      const url = new URL(window.location.href);
      url.searchParams.delete('connected');
      url.searchParams.delete('oauth_error');
      window.history.replaceState({}, '', url.toString());
    }
  }, [result]);
  return result;
}

export default function Sources(): JSX.Element {
  const sources = useSources();
  const update = useUpdateSources();
  const disconnect = useDisconnectOAuth();
  const oauthResult = useOAuthRedirectResult();
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [rules, setRules] = useState<MatchRules>(DEFAULT_RULES);
  const [excludeBots, setExcludeBots] = useState(true);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<'github' | 'jira'>('github');

  const connection = sources.data?.github.connection ?? null;

  useEffect(() => {
    const g = sources.data?.github;
    if (g) {
      setSelectedRepos(g.repos);
      if (g.rules) setRules(g.rules);
      if (g.filters) setExcludeBots(g.filters.excludeBots);
    }
  }, [sources.data]);

  const onSave = (): void => {
    setSaved(false);
    update.mutate(
      {
        enabled: true,
        repos: selectedRepos,
        rules,
        filters: {
          excludeBots,
          botWhitelist: sources.data?.github.filters?.botWhitelist ?? [],
        },
      },
      { onSuccess: () => setSaved(true) },
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

      {oauthResult.connected && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-success/30 bg-success/10 p-3 text-sm text-success">
          <Check className="h-4 w-4" />{' '}
          {oauthResult.connected === 'jira' ? 'JIRA connected.' : 'GitHub connected.'}
        </div>
      )}
      {oauthResult.error && (
        <div className="mb-4 flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="h-4 w-4" />
          {oauthResult.error === 'oauth-not-configured' || oauthResult.error === 'config'
            ? 'OAuth is not configured on the server. Ask your operator to set the GitHub OAuth env vars.'
            : `Could not connect (${oauthResult.error}). Please try again.`}
        </div>
      )}

      {tab === 'jira' ? (
        <JiraPanel />
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <CardHeader>
              <CardTitle>GitHub</CardTitle>
              <CardDescription>
                Connect your GitHub account with OAuth. We never store a password — only an
                encrypted access token.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {connection ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/40 p-3">
                  <span className="inline-flex items-center gap-2 text-sm">
                    <Github className="h-4 w-4" />
                    Connected as{' '}
                    <span className="font-semibold">@{connection.accountLogin ?? 'unknown'}</span>
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={disconnect.isPending}
                    onClick={() => disconnect.mutate('github')}
                  >
                    {disconnect.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Unplug className="h-3.5 w-3.5" />
                    )}
                    Disconnect
                  </Button>
                </div>
              ) : (
                <a
                  href="/api/oauth/github/start"
                  className={cn(
                    'inline-flex h-10 items-center justify-center gap-2 self-start rounded-md px-4 text-sm font-medium transition-all',
                    'bg-primary text-primary-foreground shadow-soft hover:brightness-110',
                  )}
                >
                  <Plug className="h-4 w-4" /> Connect GitHub
                </a>
              )}
              <div>
                <Label>Repositories to scan</Label>
                <RepoPicker
                  connected={Boolean(connection)}
                  selected={selectedRepos}
                  onChange={setSelectedRepos}
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

/** Searchable picker over the repos the connected GitHub account can access. */
function RepoPicker({
  connected,
  selected,
  onChange,
}: {
  connected: boolean;
  selected: string[];
  onChange: (next: string[]) => void;
}): JSX.Element {
  const repos = useGithubRepos(connected);
  const [query, setQuery] = useState('');
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const toggle = (fullName: string): void =>
    onChange(
      selectedSet.has(fullName) ? selected.filter((r) => r !== fullName) : [...selected, fullName],
    );

  if (!connected) {
    return (
      <p className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
        Connect GitHub above to choose repositories.
      </p>
    );
  }

  const all = repos.data?.repos ?? [];
  // Keep any selected repo that isn't in the fetched list (e.g. access changed)
  // visible so it can still be unchecked.
  const known = new Set(all.map((r) => r.fullName));
  const extras = selected
    .filter((r) => !known.has(r))
    .map((fullName) => ({ fullName, private: false }));
  const q = query.trim().toLowerCase();
  const visible = [...extras, ...all].filter((r) => r.fullName.toLowerCase().includes(q));

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center gap-2 border-b border-border p-2">
        <Search className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
        <input
          aria-label="Search repositories"
          placeholder="Search your repositories…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-8 w-full bg-transparent text-sm focus-visible:outline-none"
        />
        <span className="shrink-0 px-1 text-xs text-muted-foreground">
          {selected.length} selected
        </span>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Refresh repositories"
          disabled={repos.isFetching}
          onClick={() => void repos.refetch()}
        >
          <RefreshCw className={cn('h-4 w-4', repos.isFetching && 'animate-spin')} />
        </Button>
      </div>

      {repos.isLoading ? (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : repos.isError ? (
        <p className="p-4 text-sm text-danger">
          Could not load your repositories. Try Refresh, or check the GitHub connection.
        </p>
      ) : visible.length === 0 ? (
        <p className="p-4 text-sm text-muted-foreground">
          {q ? 'No repositories match your search.' : 'No accessible repositories found.'}
        </p>
      ) : (
        <div className="max-h-72 overflow-y-auto">
          {visible.map((r) => {
            const checked = selectedSet.has(r.fullName);
            return (
              <label
                key={r.fullName}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggle(r.fullName)}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                <span className="truncate">{r.fullName}</span>
                {r.private && <Lock className="h-3 w-3 shrink-0 text-muted-foreground" />}
              </label>
            );
          })}
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
