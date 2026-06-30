import { NavLink, Navigate, Outlet } from 'react-router-dom';
import {
  Bell,
  CalendarClock,
  Github,
  Inbox,
  LayoutGrid,
  ListChecks,
  LogOut,
  Settings,
  Users,
} from 'lucide-react';
import { useMe, useLogout } from '../lib/auth';
import { Button } from '../components/ui/button';
import { cn } from '../lib/utils';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutGrid, end: true, adminOnly: false },
  { to: '/sources', label: 'Sources', icon: Github, end: false, adminOnly: false },
  { to: '/notifications', label: 'Notifications', icon: Bell, end: false, adminOnly: false },
  { to: '/runs', label: 'Runs', icon: ListChecks, end: false, adminOnly: false },
  { to: '/schedules', label: 'Schedules', icon: CalendarClock, end: false, adminOnly: false },
  { to: '/team', label: 'Team', icon: Users, end: false, adminOnly: true },
  { to: '/settings', label: 'Settings', icon: Settings, end: false, adminOnly: false },
];

export default function Layout(): JSX.Element {
  const me = useMe();
  const logout = useLogout();

  if (me.isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-muted-foreground">
        <Inbox className="mr-2 h-5 w-5 animate-pulse" /> Loading...
      </div>
    );
  }
  if (me.error) return <Navigate to="/login" replace />;

  return (
    <div className="flex h-screen overflow-hidden bg-background">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border bg-card/50 p-4 md:flex">
        <div className="flex items-center gap-2.5 px-2 py-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-glow">
            <Inbox className="h-5 w-5" />
          </div>
          <div className="leading-tight">
            <p className="text-sm font-semibold">work-summary</p>
            <p className="text-xs text-muted-foreground">triage console</p>
          </div>
        </div>

        <nav className="mt-6 flex flex-1 flex-col gap-1">
          {NAV.filter((n) => !n.adminOnly || me.data?.role === 'admin').map(
            ({ to, label, icon: Icon, end }) => (
              <NavLink
                key={to}
                to={to}
                end={end}
                className={({ isActive }) =>
                  cn(
                    'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all',
                    isActive
                      ? 'bg-accent text-accent-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground',
                  )
                }
              >
                <Icon className="h-4 w-4" />
                {label}
              </NavLink>
            ),
          )}
        </nav>

        <div className="mt-auto border-t border-border pt-3">
          <div className="flex items-center justify-between px-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{me.data?.username}</p>
              <p className="text-xs text-muted-foreground">Signed in</p>
            </div>
            <Button size="icon" variant="ghost" title="Log out" onClick={() => logout.mutate()}>
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-5xl px-6 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
