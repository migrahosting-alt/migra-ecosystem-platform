#!/usr/bin/env bash
set -e

PORT="${1:-3399}"

echo "=== MigraPilot Dev Server ==="
echo

echo "Project:"
pwd
echo

echo "Checking port $PORT..."

busy=0

if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  busy=1
fi

if command -v ss >/dev/null 2>&1 && ss -ltnp 2>/dev/null | grep -qE "[:.]${PORT}[[:space:]]"; then
  busy=1
fi

if command -v fuser >/dev/null 2>&1 && fuser "${PORT}/tcp" >/dev/null 2>&1; then
  busy=1
fi

if [[ "$busy" -eq 1 ]]; then
  echo "ERROR: Port $PORT is already in use."
  echo

  echo "lsof:"
  lsof -nP -iTCP:"$PORT" -sTCP:LISTEN || true
  echo

  echo "ss:"
  ss -ltnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" || true
  echo

  echo "fuser:"
  fuser -v "${PORT}/tcp" || true
  echo

  echo "Stop the process with:"
  echo "fuser -k ${PORT}/tcp"
  exit 1
fi

echo "Port $PORT appears free."
echo

echo "Starting dev server..."
npm run dev
