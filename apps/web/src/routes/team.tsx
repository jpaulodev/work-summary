import { useState } from 'react';
import { Check, Copy, Loader2, Trash2, UserPlus } from 'lucide-react';
import { useMe, useInvites, useCreateInvite, useDeleteInvite, type InviteItem } from '../lib/auth';
import { Button } from '../components/ui/button';
import { Card } from '../components/ui/card';
import { Badge } from '../components/ui/badge';

function inviteLink(token: string): string {
  return `${window.location.origin}/register?invite=${token}`;
}

export default function Team(): JSX.Element {
  const me = useMe();
  const isAdmin = me.data?.role === 'admin';
  const invites = useInvites(isAdmin);
  const create = useCreateInvite();
  const [role, setRole] = useState<'admin' | 'member'>('member');

  if (me.data && !isAdmin) {
    return <p className="text-sm text-muted-foreground">Admins only.</p>;
  }

  return (
    <div>
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Team</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite people to their own workspace. Each member connects their own GitHub/JIRA and
            sees only their own comments.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Invite role"
            value={role}
            onChange={(e) => setRole(e.target.value as 'admin' | 'member')}
            className="h-10 rounded-md border border-input bg-background/60 px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <Button onClick={() => create.mutate({ role })} disabled={create.isPending}>
            {create.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <UserPlus className="h-4 w-4" />
            )}
            Create invite
          </Button>
        </div>
      </header>

      {invites.isLoading ? (
        <div className="py-16 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      ) : (invites.data?.items.length ?? 0) === 0 ? (
        <p className="rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          No invites yet. Create one to add a teammate.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {invites.data?.items.map((inv) => (
            <InviteRow key={inv.id} invite={inv} />
          ))}
        </div>
      )}
    </div>
  );
}

function InviteRow({ invite }: { invite: InviteItem }): JSX.Element {
  const remove = useDeleteInvite();
  const [copied, setCopied] = useState(false);
  const consumed = invite.consumedBy !== null;

  const copy = (): void => {
    void navigator.clipboard.writeText(inviteLink(invite.token)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Card className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <Badge tone={invite.role === 'admin' ? 'primary' : 'neutral'} className="capitalize">
            {invite.role}
          </Badge>
          {consumed ? (
            <Badge tone="success">Accepted</Badge>
          ) : (
            <Badge tone="warning">Pending</Badge>
          )}
        </div>
        <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
          {inviteLink(invite.token)}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!consumed && (
          <Button size="sm" variant="outline" onClick={copy}>
            {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        )}
        {!consumed && (
          <Button
            size="icon"
            variant="ghost"
            aria-label="Revoke invite"
            onClick={() => remove.mutate(invite.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}
