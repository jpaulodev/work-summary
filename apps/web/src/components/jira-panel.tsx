import { useEffect, useState } from 'react';
import { Check, Loader2, Plug, RefreshCw, Search, Unplug } from 'lucide-react';
import {
  useJiraSite,
  useDisconnectJira,
  useJiraProjects,
  useDiscoverableProjects,
  useSaveProjects,
  useDiscoverFields,
  useUpdateJiraSite,
} from '../lib/jira';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { cn } from '../lib/utils';
import type { JiraSite } from '../lib/types';

export function JiraPanel(): JSX.Element {
  const status = useJiraSite();

  if (status.isLoading) {
    return (
      <div className="py-10 text-center text-muted-foreground">
        <Loader2 className="mx-auto h-5 w-5 animate-spin" />
      </div>
    );
  }

  if (!status.data?.connected || !status.data.site) {
    return (
      <Card className="flex flex-col items-center gap-3 p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Connect a JIRA Cloud site with OAuth to scan its projects for pending comments.
        </p>
        <a
          href="/api/oauth/jira/start"
          className={cn(
            'inline-flex h-10 items-center justify-center gap-2 rounded-md px-4 text-sm font-medium transition-all',
            'bg-primary text-primary-foreground shadow-soft hover:brightness-110',
          )}
        >
          <Plug className="h-4 w-4" /> Connect JIRA
        </a>
      </Card>
    );
  }

  return <SiteCard site={status.data.site} />;
}

function SiteCard({ site }: { site: JiraSite }): JSX.Element {
  const disconnect = useDisconnectJira();
  const host = (() => {
    try {
      return new URL(site.baseUrl).hostname;
    } catch {
      return site.baseUrl;
    }
  })();

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">{host}</p>
          <p className="text-xs text-muted-foreground">Connected via OAuth</p>
        </div>
        <Button
          size="sm"
          variant="ghost"
          aria-label="Disconnect JIRA"
          disabled={disconnect.isPending}
          onClick={() => disconnect.mutate()}
        >
          {disconnect.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Unplug className="h-4 w-4" />
          )}
          Disconnect
        </Button>
      </div>

      <JiraProjectPicker />
      <DeveloperFieldSetting site={site} />
    </Card>
  );
}

/** Searchable checkbox list of the connected site's projects to scan. */
function JiraProjectPicker(): JSX.Element {
  const available = useDiscoverableProjects(true);
  const saved = useJiraProjects(true);
  const save = useSaveProjects();
  const [selected, setSelected] = useState<Map<string, string>>(new Map());
  const [query, setQuery] = useState('');
  const [savedOk, setSavedOk] = useState(false);

  // Initialize the checked set from the saved selection once it loads.
  useEffect(() => {
    if (saved.data) setSelected(new Map(saved.data.map((p) => [p.projectKey, p.projectName])));
  }, [saved.data]);

  const toggle = (key: string, name: string): void => {
    setSavedOk(false);
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(key)) next.delete(key);
      else next.set(key, name);
      return next;
    });
  };

  const all = available.data ?? [];
  const known = new Set(all.map((p) => p.key));
  // Keep selected projects that aren't in the discoverable list visible.
  const extras = [...selected].filter(([k]) => !known.has(k)).map(([key, name]) => ({ key, name }));
  const q = query.trim().toLowerCase();
  const visible = [...extras, ...all].filter(
    (p) => p.key.toLowerCase().includes(q) || p.name.toLowerCase().includes(q),
  );

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-medium">Projects to scan</p>
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() =>
            save.mutate(
              [...selected].map(([projectKey, projectName]) => ({ projectKey, projectName })),
              { onSuccess: () => setSavedOk(true) },
            )
          }
        >
          {save.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : savedOk ? (
            <Check className="h-4 w-4" />
          ) : null}
          Save selection
        </Button>
      </div>

      <div className="rounded-md border border-border">
        <div className="flex items-center gap-2 border-b border-border p-2">
          <Search className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            aria-label="Search projects"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full bg-transparent text-sm focus-visible:outline-none"
          />
          <span className="shrink-0 px-1 text-xs text-muted-foreground">
            {selected.size} selected
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label="Refresh projects"
            disabled={available.isFetching}
            onClick={() => void available.refetch()}
          >
            <RefreshCw className={cn('h-4 w-4', available.isFetching && 'animate-spin')} />
          </Button>
        </div>

        {available.isLoading ? (
          <div className="py-10 text-center text-muted-foreground">
            <Loader2 className="mx-auto h-5 w-5 animate-spin" />
          </div>
        ) : available.isError ? (
          <p className="p-4 text-sm text-danger">Could not load projects. Try Refresh.</p>
        ) : visible.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            {q ? 'No projects match your search.' : 'No projects found on this site.'}
          </p>
        ) : (
          <div className="max-h-72 overflow-y-auto">
            {visible.map((p) => (
              <label
                key={p.key}
                className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted"
              >
                <input
                  type="checkbox"
                  checked={selected.has(p.key)}
                  onChange={() => toggle(p.key, p.name)}
                  className="h-4 w-4 accent-[hsl(var(--primary))]"
                />
                <span className="truncate">
                  {p.name} <span className="text-muted-foreground">({p.key})</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Pick the custom field that marks you as the developer on a ticket. When set,
 * the scanner also surfaces issues where that field equals your JIRA user
 * (JQL: `"<fieldId>" = currentUser()`), on top of assignee/reporter.
 */
function DeveloperFieldSetting({ site }: { site: JiraSite }): JSX.Element {
  const discover = useDiscoverFields();
  const update = useUpdateJiraSite();
  const fields = discover.data ?? [];
  const currentName = fields.find((f) => f.id === site.developerFieldId)?.name;

  return (
    <div className="mt-4 border-t border-border pt-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium">Developer field</p>
          <p className="text-xs text-muted-foreground">
            Also scan tickets where a custom user field (e.g. “Developer”) is set to you.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={discover.isPending}
          onClick={() => discover.mutate()}
        >
          {discover.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          Detect fields
        </Button>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <select
          aria-label="Developer field"
          value={site.developerFieldId ?? ''}
          onChange={(e) => update.mutate({ developerFieldId: e.target.value || null })}
          className="h-9 w-full rounded-md border border-input bg-background/60 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <option value="">— none —</option>
          {site.developerFieldId && !fields.some((f) => f.id === site.developerFieldId) && (
            <option value={site.developerFieldId}>{site.developerFieldId}</option>
          )}
          {fields.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name} ({f.id})
            </option>
          ))}
        </select>
        {update.isPending && <Loader2 className="h-4 w-4 shrink-0 animate-spin" />}
        {update.isSuccess && !update.isPending && (
          <Check className="h-4 w-4 shrink-0 text-success" />
        )}
      </div>

      {discover.isError && (
        <p className="mt-1 text-xs text-danger">Could not load fields. Try again.</p>
      )}
      {discover.isSuccess && fields.length === 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          No “developer” custom field found on this site.
        </p>
      )}
      {currentName && <p className="mt-1 text-xs text-muted-foreground">Selected: {currentName}</p>}
    </div>
  );
}
