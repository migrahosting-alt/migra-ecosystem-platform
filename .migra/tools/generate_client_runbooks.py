#!/usr/bin/env python3
import json
from pathlib import Path
from collections import defaultdict

INTERNAL_LIST = Path(".migra/internal_domains.txt")
ROUTING = Path(".migra/nginx.routing.map.json")
OUT = Path(".migra/runbooks")
OUT.mkdir(parents=True, exist_ok=True)

internal = set()
if INTERNAL_LIST.exists():
    for line in INTERNAL_LIST.read_text(errors="replace").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):
            internal.add(line)

routing = json.loads(ROUTING.read_text())
domains = routing["domains"]

def is_internal(domain: str) -> bool:
    return domain in internal

# Group client domains by proxy target
target_to_client_domains = defaultdict(list)
client_domains = []
internal_domains = []

for d, info in domains.items():
    if is_internal(d):
        internal_domains.append(d)
        continue
    client_domains.append(d)
    for p in info.get("proxy_pass", []):
        target_to_client_domains[p].append(d)

# Write client routing runbook
lines = []
lines.append("# Client Domain Routing Map")
lines.append("")
lines.append("Only client-facing domains are included here (internal/platform domains excluded).")
lines.append("")
lines.append("## Targets → Client Domains")
for target in sorted(target_to_client_domains.keys()):
    lines.append("")
    lines.append(f"### {target}")
    for d in sorted(target_to_client_domains[target]):
        lines.append(f"- {d}")
Path(".migra/runbooks/client-routing-map.md").write_text("\n".join(lines) + "\n")

# Write internal routing list (infra visibility, no pod mapping)
lines = []
lines.append("# Internal / Platform Domains (No Tenant Mapping)")
lines.append("")
for d in sorted(internal_domains):
    lines.append(f"- {d}")
Path(".migra/runbooks/internal-domains.md").write_text("\n".join(lines) + "\n")

print("Wrote:")
print(" - .migra/runbooks/client-routing-map.md")
print(" - .migra/runbooks/internal-domains.md")
print(f"Client domains: {len(client_domains)} / Internal domains: {len(internal_domains)}")
