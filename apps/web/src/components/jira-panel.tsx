import { useState } from 'react';
import { Loader2, Plus, Search, Trash2 } from 'lucide-react';
import {
  useJiraSites,
  useCreateJiraSite,
  useDeleteJiraSite,
  useJiraProjects,
  useDiscoverProjects,
  useSaveProjects,
} from '../lib/jira';
import { Button } from './ui/button';
import { Input, Label } from './ui/input';
import { Card } from './ui/card';
import { Badge } from './ui/badge';
import { Dialog } from './ui/dialog';
import type { JiraDiscoveredProject, JiraSite } from '../lib/types';

export function JiraPanel(): JSX.Element {
  const sites = useJiraSites();
  const [open, setOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Connect JIRA Cloud sites and choose projects to scan for pending comments.
        </p>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" /> Add JIRA site
        </Button>
      </div>

      {sites.isLoading ? (
        <div className="py-10 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : (sites.data?.length ?? 0) === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-10 text-center text-sm text-muted-foreground">
          No JIRA sites connected yet.
        </p>
      ) : (
        sites.data?.map((s) => <SiteCard key={s.id} site={s} />)
      )}

      <AddSiteDialog open={open} onClose={() => setOpen(false)} />
    </div>
  );
}

function SiteCard({ site }: { site: JiraSite }): JSX.Element {
  const projects = useJiraProjects(site.id);
  const discover = useDiscoverProjects(site.id);
  const save = useSaveProjects(site.id);
  const remove = useDeleteJiraSite();
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
          <p className="text-xs text-muted-foreground">{site.email}</p>
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
            size="icon"
            variant="ghost"
            aria-label="Delete site"
            onClick={() => remove.mutate(site.id)}
          >
            <Trash2 className="h-4 w-4" />
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
                .map((p) => ({
                  projectKey: p.key,
                  projectName: p.name,
                })),
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

function AddSiteDialog({ open, onClose }: { open: boolean; onClose: () => void }): JSX.Element {
  const create = useCreateJiraSite();
  const [baseUrl, setBaseUrl] = useState('');
  const [email, setEmail] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = (): void => {
    setError(null);
    create.mutate(
      { baseUrl, email, token },
      {
        onSuccess: () => {
          setBaseUrl('');
          setEmail('');
          setToken('');
          onClose();
        },
        onError: () => setError('Connection failed. Check the base URL, email, and API token.'),
      },
    );
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Add JIRA site"
      description="We verify the API token against JIRA before saving."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!baseUrl || !email || !token || create.isPending}>
            {create.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Save
          </Button>
        </>
      }
    >
      <div>
        <Label htmlFor="jira-url">Base URL</Label>
        <Input
          id="jira-url"
          placeholder="https://your-org.atlassian.net"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
        />
      </div>
      <div>
        <Label htmlFor="jira-email">Email</Label>
        <Input id="jira-email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="jira-token">API token</Label>
        <Input
          id="jira-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
        />
      </div>
      {error && <p className="text-sm text-danger">{error}</p>}
    </Dialog>
  );
}
