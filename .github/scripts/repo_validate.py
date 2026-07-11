#!/usr/bin/env python3
"""Universal repository-hygiene validation for the pull-request change set.

This is a fast, always-runnable BASELINE gate. It deliberately does NOT build or
test applications — app-specific validation stays owned by its own workflows
(nginx-gate, extension CI, platform CI, Pale CI, …). The purpose here is to give
branch protection a required context that always reports, and to catch the
handful of repo-wide hygiene problems that no app-specific job would see.

Checks:
  1. every GitHub Actions workflow file parses as YAML and is well-formed
  2. changed JSON files parse
  3. no private keys / forbidden .env files added
  4. no tracked build artifacts or dependency directories added
  5. no unexpectedly oversized new binaries
  6. changed paths stay inside the repository (defensive)

Exit 0 = clean, 1 = violations, 2 = internal error.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]

MAX_NEW_BINARY_BYTES = 5 * 1024 * 1024  # 5 MB

FORBIDDEN_DIR_PARTS = (
    "node_modules",
    "dist",
    "build",
    ".next",
    "out",
    "coverage",
    ".venv",
    "__pycache__",
    "vendor",
)
# Paths where a directory name above is legitimate and NOT a build artifact.
FORBIDDEN_DIR_EXEMPT = (
    "infra/nginx/",  # nginx config trees may legitimately contain a 'build' dir name
)

TEXT_SUFFIXES = {
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".yml", ".yaml",
    ".css", ".scss", ".html", ".txt", ".sh", ".py", ".sql", ".conf", ".toml", ".ini",
    ".svg", ".env.example", ".gitignore", ".lock",
}

violations: list[str] = []


def fail(path: str, rule: str, detail: str) -> None:
    violations.append(f"{path}  rule={rule}  {detail}")
    print(f"::error file={path}::validate rule '{rule}': {detail}")


def run(args: list[str]) -> str:
    return subprocess.run(args, cwd=REPO_ROOT, check=True, capture_output=True, text=True).stdout


def base_ref() -> str:
    ref = os.environ.get("BASE_REF") or "main"
    for cand in (f"origin/{ref}", ref):
        try:
            run(["git", "rev-parse", "--verify", cand])
            return cand
        except subprocess.CalledProcessError:
            continue
    return "HEAD~1"


def changed_files(base: str) -> list[str]:
    out = run(["git", "diff", "--name-only", "--diff-filter=ACMR", f"{base}...HEAD"])
    return [p for p in out.splitlines() if p.strip()]


def added_files(base: str) -> list[str]:
    out = run(["git", "diff", "--name-only", "--diff-filter=A", f"{base}...HEAD"])
    return [p for p in out.splitlines() if p.strip()]


# ── 1. All workflows parse and are well-formed (repo-wide, not just changed) ──
def check_workflows() -> None:
    wf_dir = REPO_ROOT / ".github" / "workflows"
    if not wf_dir.is_dir():
        return
    for wf in sorted(wf_dir.iterdir()):
        if wf.suffix not in {".yml", ".yaml"}:
            continue
        rel = wf.relative_to(REPO_ROOT).as_posix()
        try:
            doc = yaml.safe_load(wf.read_text())
        except yaml.YAMLError as exc:
            fail(rel, "workflow-yaml-parse", f"invalid YAML: {str(exc).splitlines()[0]}")
            continue
        if not isinstance(doc, dict):
            fail(rel, "workflow-malformed", "workflow is not a mapping")
            continue
        # PyYAML parses the bare key `on:` as boolean True — accept either form.
        if "on" not in doc and True not in doc:
            fail(rel, "workflow-malformed", "missing trigger ('on')")
        jobs = doc.get("jobs")
        if not isinstance(jobs, dict) or not jobs:
            fail(rel, "workflow-malformed", "missing or empty 'jobs'")


# ── 2. Changed JSON parses ──
def check_json(changed: list[str]) -> None:
    for path in changed:
        if not path.endswith(".json"):
            continue
        abs_path = REPO_ROOT / path
        if not abs_path.exists():
            continue
        try:
            json.loads(abs_path.read_text())
        except json.JSONDecodeError as exc:
            fail(path, "invalid-json", f"does not parse: {exc}")


# ── 3. No private keys / forbidden .env added ──
def check_secret_material(added: list[str]) -> None:
    for path in added:
        name = Path(path).name
        if re.fullmatch(r"\.env(\..+)?", name) and not re.search(
            r"\.(example|sample|template|dist)$", name
        ):
            fail(path, "committed-env-file", "environment file must not be committed")
        if name in {"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"} or Path(path).suffix.lower() in {
            ".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".ppk",
        }:
            fail(path, "private-key-or-cert-file", "key/certificate material must not be committed")


# ── 4. No build artifacts / dependency dirs added ──
def check_artifacts(added: list[str]) -> None:
    for path in added:
        posix = Path(path).as_posix()
        if any(posix.startswith(ex) for ex in FORBIDDEN_DIR_EXEMPT):
            continue
        parts = set(Path(path).parts)
        hit = parts.intersection(FORBIDDEN_DIR_PARTS)
        if hit:
            fail(path, "tracked-build-artifact", f"inside forbidden directory: {sorted(hit)[0]}/")


# ── 5. No oversized new binaries ──
def check_sizes(added: list[str]) -> None:
    for path in added:
        abs_path = REPO_ROOT / path
        if not abs_path.exists() or abs_path.is_symlink():
            continue
        size = abs_path.stat().st_size
        if size > MAX_NEW_BINARY_BYTES:
            fail(
                path,
                "oversized-new-file",
                f"{size / 1_048_576:.1f} MB exceeds the {MAX_NEW_BINARY_BYTES // 1_048_576} MB limit for new files",
            )


# ── 6. Paths stay inside the repository (defensive) ──
def check_paths(changed: list[str]) -> None:
    for path in changed:
        if path.startswith("/") or ".." in Path(path).parts:
            fail(path, "path-escape", "changed path must stay inside the repository")


def main() -> int:
    base = base_ref()
    changed = changed_files(base)
    added = added_files(base)

    print(f"validate: repository hygiene (change set vs {base}; {len(changed)} changed file(s))\n")
    check_workflows()
    check_json(changed)
    check_secret_material(added)
    check_artifacts(added)
    check_sizes(added)
    check_paths(changed)

    if violations:
        print("\nvalidate: FAILED\n")
        for v in violations:
            print(f"  {v}")
        return 1
    print("validate: clean — workflows parse, no secret material, no build artifacts, sizes OK")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        print(f"::error::validate failed to run git: {exc.stderr or exc}")
        sys.exit(2)
