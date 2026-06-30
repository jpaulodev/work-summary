import { useState } from 'react';
import { Loader2, Plug, Search, Unplug } from 'lucide-react';
import {
  useJiraSite,
  useDisconnectJira,
  useJiraProjects,
  useDiscoverProjects,
  useSaveProjects,
} from '../lib/jira';
import { Button } from './ui/button';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { cn } from '../lib/utils';
import type { JiraDiscoveredProject, JiraSite } from '../lib/types';

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
  const projects = useJiraProjects(true);
  const discover = useDiscoverProjects();
  const save = useSaveProjects();
  const disconnect = useDisconnectJira();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const host = (() => {
    try {
      return new URL(site.baseUrl).hostname;
    } catch {
      return site.baseUrl;
    }
  })();

  const toggle = (key: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold">{host}</p>
          <p className="text-xs text-muted-foreground">Connected via OAuth</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => discover.mutate()}
            disabled={discover.isPending}
          >
            {discover.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Search className="h-4 w-4" />
            )}
            Discover projects
          </Button>
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
      </div>

      {(projects.data?.length ?? 0) > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {projects.data?.map((p) => (
            <Badge key={p.id} tone="primary">
              {p.projectName} ({p.projectKey})
            </Badge>
          ))}
        </div>
      )}

      {discover.data && (
        <ProjectPicker
          discovered={discover.data}
          selected={selected}
          onToggle={toggle}
          saving={save.isPending}
          onSave={() =>
            save.mutate(
              discover.data
                .filter((p) => selected.has(p.key))
                .map((p) => ({ projectKey: p.key, projectName: p.name })),
            )
          }
        />
      )}
    </Card>
  );
}

function ProjectPicker({
  discovered,
  selected,
  onToggle,
  saving,
  onSave,
}: {
  discovered: JiraDiscoveredProject[];
  selected: Set<string>;
  onToggle: (key: string) => void;
  saving: boolean;
  onSave: () => void;
}): JSX.Element {
  return (
    <div className="mt-4 border-t border-border pt-3">
      <p className="mb-2 text-sm font-medium">Select projects to scan</p>
      <div className="flex max-h-40 flex-col gap-1 overflow-y-auto">
        {discovered.map((p) => (
          <label key={p.key} className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={selected.has(p.key)}
              onChange={() => onToggle(p.key)}
              className="h-4 w-4 accent-[hsl(var(--primary))]"
            />
            {p.name} ({p.key})
          </label>
        ))}
      </div>
      <Button className="mt-3" size="sm" onClick={onSave} disabled={saving}>
        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
        Save selection
      </Button>
    </div>
  );
}
