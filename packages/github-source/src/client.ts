import { Octokit } from '@octokit/rest';
import { throttling } from '@octokit/plugin-throttling';

const ThrottledOctokit = Octokit.plugin(throttling);

export interface OctokitOptions {
  token: string;
  userAgent?: string;
}

// The throttling plugin only changes request behavior, not the public API we
// consume (.rest, .paginate, .request), so we expose the base Octokit type.
// Naming the plugin-augmented instance type is not portable across pnpm's
// nested node_modules during declaration emit (TS2742).
export type GithubClient = Octokit;

export function createOctokit(opts: OctokitOptions): GithubClient {
  return new ThrottledOctokit({
    auth: opts.token,
    userAgent: opts.userAgent ?? 'work-summary/0.1.0',
    request: { timeout: 30000 },
    throttle: {
      onRateLimit: (_retryAfter, _options, _octokit, retryCount) => {
        return retryCount < 3;
      },
      onSecondaryRateLimit: (_retryAfter, _options, _octokit, retryCount) => {
        return retryCount < 3;
      },
    },
  });
}
