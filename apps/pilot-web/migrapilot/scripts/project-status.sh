#!/usr/bin/env bash
set -e

echo "=== MigraPilot Project Status ==="
echo
echo "Directory:"
pwd
echo

echo "Git branch:"
git branch --show-current || true
echo

echo "MigraPilot git status only:"
git status --short apps/pilot-web/migrapilot 2>/dev/null || git status --short migrapilot || true
echo

echo "Node version:"
node -v || true
echo

echo "NPM version:"
npm -v || true
echo

echo "Package scripts:"
node -e "const p=require('./package.json'); console.log(p.scripts || {})" || true
echo

echo "Ollama models:"
if command -v ollama >/dev/null 2>&1; then
  ollama list || true
else
  echo "Ollama command not found in this shell. If using WSL, Ollama may be installed on Windows only."
fi
echo

echo "Port 3399:"
lsof -i :3399 || echo "Port 3399 appears free"
echo
