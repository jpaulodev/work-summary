#!/usr/bin/env bash
#
# One command to update + run the API on a deploy machine. Pulls the latest
# code, installs, builds, and starts the API. Database migrations run
# automatically on API startup, so an upgrade is just: re-run this script.
#
#   bin/deploy.sh            # pull, build, and start (foreground)
#   bin/deploy.sh --no-pull  # skip git pull (build + start only)
#
# Configuration comes from .env in the repo root (the API auto-loads it).

set -euo pipefail
cd "$(dirname "$0")/.."

PULL=1
for arg in "$@"; do
  case "$arg" in
    --no-pull) PULL=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

# Use Node 20 via nvm when available (better-sqlite3/argon2 need it).
if [ -s "$HOME/.nvm/nvm.sh" ]; then
  # shellcheck disable=SC1091
  . "$HOME/.nvm/nvm.sh"
  nvm use 20 >/dev/null 2>&1 || nvm install 20
fi

node_major="$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)"
if [ "$node_major" != "20" ] && [ "$node_major" != "22" ]; then
  echo "warning: Node $node_major detected; this project is verified on Node 20/22." >&2
fi

if [ "$PULL" = "1" ] && [ -d .git ]; then
  echo "==> git pull"
  git pull --ff-only
fi

if [ ! -f .env ]; then
  echo "==> no .env found — copying .env.example (edit it before relying on OAuth)"
  cp .env.example .env
fi

echo "==> pnpm install"
pnpm install --frozen-lockfile || pnpm install

echo "==> pnpm build"
pnpm build

echo "==> starting API (migrations apply automatically on startup)"
export NODE_ENV="${NODE_ENV:-production}"
exec node apps/api/dist/bin.js
