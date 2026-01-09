#!/usr/bin/env python3
import json, re
from pathlib import Path
from collections import defaultdict

RAW = Path(".migra/raw/20260106T080328Z")
ROUTING = Path(".migra/nginx.routing.map.json")
OUT = Path(".migra/runbooks")
OUT.mkdir(parents=True, exist_ok=True)

def parse_lxc_iphost(txt: str):
    out = []
    cur = None
    for line in txt.splitlines():
        m = re.match(r"^---\s*CT\s+(\d+)\s*---", line.strip())
        if m:
            if cur: out.append(cur)
            cur = {"ctid": m.group(1), "hostname": None, "ip_lines": []}
            continue
        if not cur: continue
        if cur["hostname"] is None and line.strip():
            cur["hostname"] = line.strip()
            continue
        if line.strip():
            cur["ip_lines"].append(line.strip())
    if cur: out.append(cur)
    return out

routing = json.loads(ROUTING.read_text())
domains = routing["domains"]

# Build target -> domains index
target_to_domains = defaultdict(list)
for d, info in domains.items():
    for p in info.get("proxy_pass", []):
        target_to_domains[p].append(d)

# Load LXC IP map
iphost_path = RAW / "pve.pve.lxc.iphost.txt"
iphost_txt = iphost_path.read_text(errors="replace") if iphost_path.exists() else ""
lxcs = parse_lxc_iphost(iphost_txt)

# Find which CT likely owns an IP
def find_owner(ip: str):
    hits = []
    for ct in lxcs:
        blob = "\n".join(ct["ip_lines"])
        if ip in blob:
            hits.append(ct)
    return hits

# Write routing map runbook
lines = []
lines.append("# NGINX Routing Map")
lines.append("")
lines.append("Generated from `.migra/nginx.routing.map.json` (parsed from `nginx -T` + hints).")
lines.append("")
lines.append("## Targets → Domains")
for target in sorted(target_to_domains.keys()):
    lines.append("")
    lines.append(f"### {target}")
    # correlate IP owner if possible
    m = re.search(r"//([^:/]+)", target)
    ip = m.group(1) if m else ""
    owners = find_owner(ip) if ip else []
    if owners:
        for o in owners:
            lines.append(f"- Owner: CT {o['ctid']} ({o['hostname']})")
    else:
        if ip:
            lines.append(f"- Owner: (not found in LXC iphost scan; likely VM or external) ip={ip}")
    for d in sorted(target_to_domains[target]):
        lines.append(f"- {d}")
Path(".migra/runbooks/nginx-routing-map.md").write_text("\n".join(lines) + "\n")

# Write tenant/pod index
tp = []
tp.append("# Tenant / Pod Index (Best-Effort)")
tp.append("")
tp.append("This maps internal target IPs observed in NGINX proxy_pass to Proxmox CTs when possible.")
tp.append("")
seen_ips = set()
for target in sorted(target_to_domains.keys()):
    m = re.search(r"//([^:/]+)", target)
    ip = m.group(1) if m else ""
    if not ip or ip in seen_ips:
        continue
    seen_ips.add(ip)
    owners = find_owner(ip)
    tp.append(f"## {ip}")
    tp.append(f"- Seen in proxy_pass: {target}")
    if owners:
        for o in owners:
            tp.append(f"- CT: {o['ctid']} hostname={o['hostname']}")
            for l in o["ip_lines"]:
                tp.append(f"  - {l}")
    else:
        tp.append("- CT: (not found in LXC scan; likely VM or external)")
    tp.append("")
Path(".migra/runbooks/tenant-pod-index.md").write_text("\n".join(tp) + "\n")

print("Wrote:")
print(" - .migra/runbooks/nginx-routing-map.md")
print(" - .migra/runbooks/tenant-pod-index.md")
