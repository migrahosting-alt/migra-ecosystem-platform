#!/usr/bin/env python3
import json
from pathlib import Path
from datetime import datetime, timezone

SNAP = Path(".migra/infra.snapshot.json")
OUT_MD = Path(".migra/infra.snapshot.md")
TENANT_INDEX = Path(".migra/runbooks/tenant-pod-index.md")

tenant = {
  "tenant": "lituationdjs",
  "domains": ["lituationdjs.com", "lituationdjs.migrahosting.com"],
  "nginx_proxy_pass": "http://10.1.10.53:80",
  "backend": {
    "type": "lxc",
    "pve_node": "pve",
    "ctid": 139,
    "name": "pod-lituationdjs",
    "ip": "10.1.10.53"
  },
  "verified_at_utc": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
  "source": "operator-confirmed (Proxmox UI)"
}

data = json.loads(SNAP.read_text())
data.setdefault("tenants", [])
# upsert by ctid
data["tenants"] = [t for t in data["tenants"] if not (t.get("backend", {}).get("ctid") == 139)]
data["tenants"].append(tenant)
SNAP.write_text(json.dumps(data, indent=2) + "\n")

# Append to snapshot markdown (idempotent-ish)
md = OUT_MD.read_text().splitlines()
marker = "## Tenant Routing"
if marker not in md:
  md += ["", marker, ""]
md += [
  "### lituationdjs.com",
  "- proxy_pass: http://10.1.10.53:80",
  "- backend: pve CT 139 (pod-lituationdjs)",
  ""
]
OUT_MD.write_text("\n".join(md).rstrip() + "\n")

# Ensure tenant index exists and gets an explicit entry
TENANT_INDEX.parent.mkdir(parents=True, exist_ok=True)
existing = TENANT_INDEX.read_text(errors="replace")
block = "\n".join([
  "## lituationdjs.com",
  "- Domain: lituationdjs.com",
  "- proxy_pass: http://10.1.10.53:80",
  "- Owner: pve CT 139 (pod-lituationdjs)",
  ""
])
if "## lituationdjs.com" not in existing:
  TENANT_INDEX.write_text((existing.rstrip() + "\n\n" + block).lstrip())

print("Updated:")
print(" - .migra/infra.snapshot.json (added tenants[] entry)")
print(" - .migra/infra.snapshot.md (added Tenant Routing section)")
print(" - .migra/runbooks/tenant-pod-index.md (added explicit tenant block)")
