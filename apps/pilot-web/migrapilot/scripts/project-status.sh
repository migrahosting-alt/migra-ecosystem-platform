#!/usr/bin/env bash
set -e

echo "=== MigraPilot Project Status ==="
echo
echo "Directory:"
pwd
echo

echo "Git status:"
git status --short || true
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
ollama list || true
echo

echo "Port 3399:"
lsof -i :3399 || echo "Port 3399 appears free"
echo