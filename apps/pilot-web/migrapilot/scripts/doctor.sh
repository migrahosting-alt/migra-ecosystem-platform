#!/usr/bin/env bash
set -e

echo "=== MigraPilot Doctor ==="
echo

risk=0

check_pass() {
  echo "PASS: $1"
}

check_warn() {
  echo "WARN: $1"
  risk=1
}

check_fail() {
  echo "FAIL: $1"
  risk=2
}

echo "Project:"
pwd
echo

echo "Git branch:"
git branch --show-current || true
echo

echo "Node:"
if command -v node >/dev/null 2>&1; then
  node -v
  check_pass "Node is available"
else
  check_fail "Node is not available"
fi
echo

echo "NPM:"
if command -v npm >/dev/null 2>&1; then
  npm -v
  check_pass "NPM is available"
else
  check_fail "NPM is not available"
fi
echo

echo "Package:"
if [[ -f package.json ]]; then
  check_pass "package.json found"
  node -e "const p=require('./package.json'); console.log('name:', p.name); console.log('scripts:', Object.keys(p.scripts || {}).join(', ')); console.log('next:', (p.dependencies||{}).next || (p.devDependencies||{}).next || 'not found')" || true
else
  check_fail "package.json missing"
fi
echo

echo "Port 3399:"
if lsof -i :3399 >/dev/null 2>&1; then
  check_warn "Port 3399 is in use"
  lsof -i :3399 || true
else
  check_pass "Port 3399 is free"
fi
echo

echo "Ollama:"
if command -v ollama >/dev/null 2>&1; then
  check_pass "Ollama command available"
  ollama list || true
else
  check_warn "Ollama command not found in this shell"
fi
echo

echo "Lockfiles:"
repo_root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
lock_count="$(find "$repo_root" -name package-lock.json -not -path '*/node_modules/*' | wc -l | tr -d ' ')"
echo "package-lock.json count: $lock_count"
if [[ "$lock_count" -gt 1 ]]; then
  check_warn "Multiple package-lock.json files detected"
  find "$repo_root" -name package-lock.json -not -path '*/node_modules/*'
else
  check_pass "Single package-lock.json detected"
fi
echo

echo "Lighthouse temp pollution:"
if git status --short | grep -i 'lighthouse' >/dev/null 2>&1; then
  check_warn "Lighthouse temp files appear in git status"
else
  check_pass "No Lighthouse temp files in git status"
fi
echo

echo "MigraPilot tracked status:"
git status --short apps/pilot-web/migrapilot 2>/dev/null || git status --short migrapilot || true
echo

echo "Summary:"
if [[ "$risk" -eq 0 ]]; then
  echo "PASS: No major issues detected"
elif [[ "$risk" -eq 1 ]]; then
  echo "WARN: Some issues need attention"
else
  echo "FAIL: Blocking issues detected"
fi
