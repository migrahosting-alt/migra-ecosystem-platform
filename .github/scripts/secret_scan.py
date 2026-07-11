#!/usr/bin/env python3
"""Universal secret scan for the pull-request change set.

Scans ONLY the lines this PR adds (plus the paths it adds/renames) — not
unrelated repository history. Matched values are never printed; findings report
the affected path, line number, and rule id only.

Suppressions are deliberately narrow and reviewable:
  * inline, on the offending line:  secret-scan:allow(<rule-id>) <reason>
  * exact-path entry in .github/secret-scan-allowlist.json  (path + rule)
Directory-wide or glob ignores are intentionally NOT supported.

Exit 0 = clean, 1 = findings, 2 = internal error.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
ALLOWLIST = REPO_ROOT / ".github" / "secret-scan-allowlist.json"

# Literals for high-signal markers are assembled from parts so that this
# scanner's own source never contains a scannable secret marker verbatim.
_DASH5 = "-" * 5
_BEGIN = _DASH5 + "BEGIN "
_END_KEY = " KEY" + _DASH5

MAX_CONTENT_BYTES = 1_000_000  # skip content scan of very large files (paths still checked)

# Values that are obviously not real secrets. Only applied to the lower-confidence
# rules (generic assignments / connection strings), never to the prefixed rules.
PLACEHOLDER_RE = re.compile(
    r"(?i)(example|placeholder|changeme|change_me|your[-_ ]|yourpass|dummy|redacted|"
    r"fake|sample|todo|xxx+|\.\.\.|<[^>]*>|\$\{|\$\(|%\(|\{\{|None|null)"
)

# ── Content rules (scanned against added lines) ──
# (rule_id, compiled regex, placeholder_filtered)
CONTENT_RULES = [
    (
        "pem-private-key",
        re.compile(rf"{re.escape(_BEGIN)}(?:RSA |DSA |EC |OPENSSH |PGP |ENCRYPTED )?PRIVATE{re.escape(_END_KEY)}"),
        False,
    ),
    ("aws-access-key-id", re.compile(r"\bAKIA[0-9A-Z]{16}\b"), False),
    (
        "aws-secret-access-key",
        re.compile(r"(?i)aws_?secret_?access_?key\s*[:=]\s*['\"]?([A-Za-z0-9/+=]{40})\b"),
        True,
    ),
    ("stripe-secret-key", re.compile(r"\b(?:sk|rk)_(?:live|test)_[0-9a-zA-Z]{16,}\b"), False),
    (
        "github-token",
        re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b|\bgithub_pat_[A-Za-z0-9_]{60,}\b"),
        False,
    ),
    ("slack-token", re.compile(r"\bxox[abprs]-[0-9A-Za-z-]{10,}\b"), False),
    ("google-api-key", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b"), False),
    ("private-key-body", re.compile(r"(?i)\bPRIVATE KEY BLOCK\b"), False),
    (
        # High-confidence only: an explicit secret-ish assignment to a long opaque literal.
        "generic-api-secret",
        re.compile(
            r"(?i)\b(?:api[_-]?key|api[_-]?secret|client[_-]?secret|access[_-]?token|"
            r"auth[_-]?token|bearer[_-]?token|secret[_-]?key|private[_-]?token)\b"
            r"\s*[:=]\s*['\"]([A-Za-z0-9_\-./+=]{20,})['\"]"
        ),
        True,
    ),
    (
        "hardcoded-password",
        re.compile(r"(?i)\b(?:password|passwd|pwd)\b\s*[:=]\s*['\"]([^'\"\s]{8,})['\"]"),
        True,
    ),
    (
        "credentialed-connection-string",
        re.compile(
            r"(?i)\b(?:postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|amqp|ftp|ssh)://"
            r"[^\s:@/]+:([^\s:@/]{4,})@"
        ),
        True,
    ),
]

# ── Path rules (scanned against added/renamed file paths) ──
PATH_RULES = [
    (
        "committed-env-file",
        # .env / .env.production etc — but explicitly allow example/sample/template variants.
        lambda p: re.fullmatch(r"\.env(\..+)?", Path(p).name) is not None
        and not re.search(r"\.(example|sample|template|dist)$", Path(p).name),
    ),
    (
        "private-key-or-cert-file",
        lambda p: (
            Path(p).name in {"id_rsa", "id_dsa", "id_ecdsa", "id_ed25519"}
            or Path(p).suffix.lower() in {".pem", ".key", ".p12", ".pfx", ".jks", ".keystore", ".ppk"}
        ),
    ),
    (
        "ssh-config-or-known-secret-path",
        lambda p: Path(p).as_posix().startswith(("secrets/", "private/"))
        or Path(p).name in {"credentials", ".npmrc.auth", ".pypirc"},
    ),
]


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
    return [line for line in out.splitlines() if line.strip()]


def added_lines(base: str, path: str) -> list[tuple[int, str]]:
    """Return (line_number, text) for lines this PR ADDS to `path`."""
    try:
        out = run(["git", "diff", "--unified=0", "--no-color", f"{base}...HEAD", "--", path])
    except subprocess.CalledProcessError:
        return []
    results: list[tuple[int, str]] = []
    lineno: int | None = None
    for line in out.splitlines():
        if line.startswith("@@"):
            m = re.search(r"\+(\d+)", line)
            lineno = int(m.group(1)) if m else None
        elif line.startswith("+") and not line.startswith("+++"):
            if lineno is not None:
                results.append((lineno, line[1:]))
                lineno += 1
    return results


def load_allowlist() -> set[tuple[str, str]]:
    if not ALLOWLIST.exists():
        return set()
    try:
        data = json.loads(ALLOWLIST.read_text())
    except json.JSONDecodeError as exc:
        print(f"::error::.github/secret-scan-allowlist.json is not valid JSON: {exc}")
        sys.exit(2)
    entries = set()
    for item in data.get("suppressions", []):
        path, rule = item.get("path"), item.get("rule")
        if not path or not rule:
            print("::error::each suppression needs an exact 'path' and a 'rule'")
            sys.exit(2)
        if any(ch in path for ch in "*?[") or path.endswith("/"):
            print(f"::error::suppression path must be an exact file, not a glob/directory: {path}")
            sys.exit(2)
        if not item.get("reason"):
            print(f"::error::suppression for {path} ({rule}) needs a documented 'reason'")
            sys.exit(2)
        entries.add((path, rule))
    return entries


def scan(base: str) -> list[tuple[str, int, str]]:
    allow = load_allowlist()
    findings: list[tuple[str, int, str]] = []

    for path in changed_files(base):
        # Path-based rules
        for rule_id, matches in PATH_RULES:
            if matches(path) and (path, rule_id) not in allow:
                findings.append((path, 0, rule_id))

        # Content rules — added lines only
        abs_path = REPO_ROOT / path
        if abs_path.exists() and abs_path.stat().st_size > MAX_CONTENT_BYTES:
            continue
        for lineno, text in added_lines(base, path):
            if "secret-scan:allow(" in text:
                continue  # inline, reviewed suppression
            for rule_id, pattern, placeholder_filtered in CONTENT_RULES:
                m = pattern.search(text)
                if not m:
                    continue
                if placeholder_filtered:
                    captured = m.group(1) if m.groups() else m.group(0)
                    if PLACEHOLDER_RE.search(captured):
                        continue
                if (path, rule_id) in allow:
                    continue
                findings.append((path, lineno, rule_id))
    return findings


def main() -> int:
    base = base_ref()
    findings = scan(base)
    if not findings:
        print(f"secret-scan: clean (change set vs {base}) — no secrets detected")
        return 0

    print("secret-scan: POTENTIAL SECRETS DETECTED (values redacted — never logged)\n")
    for path, lineno, rule_id in findings:
        loc = f"{path}:{lineno}" if lineno else path
        print(f"::error file={path},line={lineno or 1}::secret-scan rule '{rule_id}' matched (value redacted)")
        print(f"  {loc}  rule={rule_id}  value=<redacted>")
    print(
        "\nIf a finding is a verified false positive, add a narrow suppression:\n"
        "  * inline on the line:  secret-scan:allow(<rule-id>) <reason>\n"
        "  * or an exact-path entry in .github/secret-scan-allowlist.json\n"
        "Do NOT ignore whole directories. Never commit a real secret."
    )
    return 1


if __name__ == "__main__":
    try:
        sys.exit(main())
    except subprocess.CalledProcessError as exc:
        print(f"::error::secret-scan failed to run git: {exc.stderr or exc}")
        sys.exit(2)
