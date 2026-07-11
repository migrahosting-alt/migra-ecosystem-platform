#!/usr/bin/env python3
"""Self-test for the universal secret scanner.

Proves the scanner is not a no-op WITHOUT ever committing a real (or literal
dummy) secret: every fixture value is assembled from fragments at runtime, so no
scannable pattern appears verbatim in this file.

Also asserts the scanner does not flag its own source or this file — otherwise
the gate would block every PR that touches it.

Exit 0 = all assertions pass.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import secret_scan as ss  # noqa: E402

FAIL = 0


def check(name: str, ok: bool) -> None:
    global FAIL
    print(f"  {'PASS' if ok else 'FAIL'} — {name}")
    if not ok:
        FAIL += 1


def content_hits(line: str) -> set[str]:
    """Rule ids that fire on a line, honouring the placeholder filter."""
    hits = set()
    for rule_id, pattern, placeholder_filtered in ss.CONTENT_RULES:
        m = pattern.search(line)
        if not m:
            continue
        if placeholder_filtered:
            captured = m.group(1) if m.groups() else m.group(0)
            if ss.PLACEHOLDER_RE.search(captured):
                continue
        hits.add(rule_id)
    return hits


def path_hits(path: str) -> set[str]:
    return {rule_id for rule_id, matches in ss.PATH_RULES if matches(path)}


# ── Fixtures assembled at runtime (never literal in source) ──
D5 = "-" * 5
PEM_LINE = D5 + "BEGIN RSA PRIVATE" + " KEY" + D5
AWS_ID = "AKIA" + ("Q7" * 8)                       # AKIA + 16 upper/num
AWS_SECRET = 'aws_secret_access_key = "' + ("a1B2" * 10) + '"'   # 40 chars
STRIPE = "sk_" + "live_" + ("9zQ" * 8)
GH_TOKEN = "ghp_" + ("aB3" * 12)
SLACK = "xox" + "b-" + ("12345678" * 2)
GOOGLE = "AIza" + ("aB3-_" * 7)
API_SECRET = 'client_secret: "' + ("kQ7x" * 6) + '"'
PASSWORD = 'password = "' + "Hunter2Hunter2" + '"'
CONNSTR = "postgresql://appuser:" + "S3cretPassw0rd" + "@db.internal:5432/prod"

print("secret-scan self-test (all fixtures generated at runtime; no literals committed)\n")
print("positive detection:")
check("pem-private-key", "pem-private-key" in content_hits(PEM_LINE))
check("aws-access-key-id", "aws-access-key-id" in content_hits(AWS_ID))
check("aws-secret-access-key", "aws-secret-access-key" in content_hits(AWS_SECRET))
check("stripe-secret-key", "stripe-secret-key" in content_hits(STRIPE))
check("github-token", "github-token" in content_hits(GH_TOKEN))
check("slack-token", "slack-token" in content_hits(SLACK))
check("google-api-key", "google-api-key" in content_hits(GOOGLE))
check("generic-api-secret", "generic-api-secret" in content_hits(API_SECRET))
check("hardcoded-password", "hardcoded-password" in content_hits(PASSWORD))
check("credentialed-connection-string", "credentialed-connection-string" in content_hits(CONNSTR))

print("\npath rules:")
check("committed-env-file (.env)", "committed-env-file" in path_hits("apps/x/.env"))
check("committed-env-file (.env.production)", "committed-env-file" in path_hits("svc/.env.production"))
check("allows .env.example", "committed-env-file" not in path_hits("apps/x/.env.example"))
check("allows .env.template", "committed-env-file" not in path_hits("apps/x/.env.template"))
check("private key file (id_rsa)", "private-key-or-cert-file" in path_hits("infra/id_rsa"))
check("cert material (.pem)", "private-key-or-cert-file" in path_hits("infra/tls/server.pem"))
check("secrets/ directory file", "ssh-config-or-known-secret-path" in path_hits("secrets/prod.json"))

print("\nplaceholder / false-positive suppression:")
check("ignores placeholder password", content_hits('password = "changeme"') == set())
check("ignores templated secret", content_hits('client_secret: "${MY_SECRET}"') == set())
check("ignores example connstr", content_hits("postgresql://user:your-password@localhost/db") == set())
check("ignores <angle> placeholder", content_hits('api_key: "<your-api-key-here>"') == set())

print("\nno self-flagging (gate must not block PRs that touch it):")
for src in (Path(ss.__file__), Path(__file__)):
    hits: set[str] = set()
    for line in src.read_text().splitlines():
        if "secret-scan:allow(" in line:
            continue
        hits |= content_hits(line)
    check(f"{src.name} produces no findings", hits == set())

print()
if FAIL:
    print(f"secret-scan self-test FAILED ({FAIL} assertion(s))")
    sys.exit(1)
print("secret-scan self-test: all assertions passed")
