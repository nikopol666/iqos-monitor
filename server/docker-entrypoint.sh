#!/bin/sh
# Runs as root only long enough to make the data directory writable for the
# unprivileged "node" user (a named volume or bind mount created by root would
# otherwise give SQLITE_CANTOPEN), then drops privileges.
set -e
DATA_DIR="$(dirname "${DATABASE_PATH:-/data/iqos.sqlite3}")"
if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_DIR"
  chown -R node:node "$DATA_DIR" || true
  if command -v setpriv >/dev/null 2>&1; then
    exec setpriv --reuid=node --regid=node --init-groups "$@"
  fi
  exec su -s /bin/sh node -c 'exec "$@"' -- sh "$@"
fi
exec "$@"
