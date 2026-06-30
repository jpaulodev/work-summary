import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Send } from 'lucide-react';
import { useSendReply, type ReplyError } from '../lib/replies';
import { Button } from './ui/button';
import { Textarea } from './ui/input';

const MAX = 10000;

export function ReplyComposer({
  commentId,
  onClose,
}: {
  commentId: string;
  onClose: () => void;
}): JSX.Element {
  const [body, setBody] = useState('');
  const [error, setError] = useState<ReplyError | null>(null);
  const send = useSendReply(commentId);

  const submit = (): void => {
    setError(null);
    send.mutate(body, {
      onSuccess: () => onClose(),
      onError: (err) => setError(err),
    });
  };

  return (
    <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3 animate-fade-in">
      <Textarea
        aria-label="Reply"
        rows={3}
        placeholder="Type your reply..."
        value={body}
        maxLength={MAX}
        onChange={(e) => setBody(e.target.value)}
      />
      <div className="flex items-center justify-between">
        <span className="text-[11px] text-muted-foreground">
          {body.length}/{MAX}
        </span>
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={submit} disabled={!body.trim() || send.isPending}>
            {send.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
            Send
          </Button>
        </div>
      </div>
      {error && (
        <div className="rounded-md border border-danger/30 bg-danger/10 p-2 text-xs text-danger">
          {error.code === 'token-write-scope' ? (
            <>
              Your token may lack write scope.{' '}
              <Link to="/sources" className="underline">
                Update token
              </Link>
              .
            </>
          ) : (
            error.message
          )}
        </div>
      )}
    </div>
  );
}
