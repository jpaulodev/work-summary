import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Link, useNavigate } from 'react-router-dom';
import { Inbox, Loader2 } from 'lucide-react';
import { useRegister } from '../lib/auth';
import { ApiError } from '../lib/api';
import { Button } from '../components/ui/button';
import { Input, Label } from '../components/ui/input';

const schema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(8, 'Password must be at least 8 characters'),
});
type FormValues = z.infer<typeof schema>;

export default function Register(): JSX.Element {
  const registerMut = useRegister();
  const navigate = useNavigate();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  const onSubmit = handleSubmit((values) => {
    setServerError(null);
    registerMut.mutate(values, {
      onSuccess: () => navigate('/'),
      onError: (err) => {
        const code = err instanceof ApiError ? (err.body as { error?: string })?.error : undefined;
        setServerError(
          code === 'username-taken'
            ? 'That username is taken'
            : code === 'registration-disabled'
              ? 'Signups are disabled on this server'
              : 'Could not create your account',
        );
      },
    });
  });

  return (
    <div className="grid-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm animate-fade-in">
        <div className="mb-6 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-glow">
            <Inbox className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold tracking-tight">Create your account</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your own dashboard — connect your GitHub & JIRA
          </p>
        </div>

        <form
          onSubmit={(e) => void onSubmit(e)}
          className="rounded-lg border border-border bg-card p-6 shadow-card"
        >
          <div className="mb-4">
            <Label htmlFor="username">Username</Label>
            <Input id="username" autoComplete="username" {...register('username')} />
            {errors.username && (
              <p className="mt-1 text-xs text-danger">{errors.username.message}</p>
            )}
          </div>
          <div className="mb-5">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              autoComplete="new-password"
              {...register('password')}
            />
            {errors.password && (
              <p className="mt-1 text-xs text-danger">{errors.password.message}</p>
            )}
          </div>
          {serverError && <p className="mb-4 text-sm text-danger">{serverError}</p>}
          <Button type="submit" size="lg" className="w-full" disabled={registerMut.isPending}>
            {registerMut.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Create account
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Already have an account?{' '}
          <Link to="/login" className="font-medium text-primary hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </div>
  );
}
