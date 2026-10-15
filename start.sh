#!/usr/bin/env sh
# Start trdr on macOS or Linux.
set -e
cd "$(dirname "$0")"
[ -x .venv/bin/python ] || python3 -m venv .venv
exec .venv/bin/python scripts/launch.py "$@"
