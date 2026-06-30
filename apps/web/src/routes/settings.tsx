import { CalendarClock, KeyRound, LogOut } from 'lucide-react';
import { useLogout, useMe } from '../lib/auth';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';

export default function Settings(): JSX.Element {
  const me = useMe();
  const logout = useLogout();

  return (
    <div>
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Account and scheduling.</p>
      </header>

      <div className="flex flex-col gap-5">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-primary" /> Account
            </CardTitle>
            <CardDescription>You are signed in as {me.data?.username}.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => logout.mutate()}>
              <LogOut className="h-4 w-4" /> Log out
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-primary" /> Scheduling
            </CardTitle>
            <CardDescription>
              Scans run via OS cron in Phase 2. A built-in scheduler arrives in Phase 3.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-md border border-border bg-muted/50 p-3 text-xs">
              0 8,12,17 * * 1-5 work-summary scan --json
            </pre>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
