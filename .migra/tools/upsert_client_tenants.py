#!/usr/bin/env python3
import json, re
from pathlib import Path
from datetime import datetime, timezone
from collections import defaultdict

RAW = Path(".migra/raw/20260106T080328Z")
ROUTING = Path(".migra/nginx.routing.map.json")
SNAP = Path(".migra/infra.snapshot.json")
INTERNAL = Path(".migra/internal_domains.txt")

PRIORITY = {
    "operator-confirmed (Proxmox UI)": 100,
    "auto-upsert (nginx.routing.map.json + pve.lxc.iphost)": 10,
    "unknown": 0,
}

def load_internal():
    internal = set()
    if INTERNAL.exists():
        for line in INTERNAL.read_text(errors="replace").splitlines():
            line = line.strip()
            if line and not line.startswith("#"):
                internal.add(line)
    return internal

def parse_lxc_iphost(txt: str):
    out = []
    cur = None
    for line in txt.splitlines():
        m = re.match(r"^---\s*CT\s+(\d+)\s*---", line.strip())
        if m:
            if cur: out.append(cur)
            cur = {"ctid": int(m.group(1)), "hostname": None, "ip_lines": []}
            continue
        if not cur:
            continue
        if cur["hostname"] is None and line.strip():
            cur["hostname"] = line.strip()
            continue
        if line.strip():
            cur["ip_lines"].append(line.strip())
    if cur:
        out.append(cur)
    return out

def find_ct_owner(ip: str, lxcs):
    for ct in lxcs:
        blob = "\n".join(ct["ip_lines"])
        if ip in blob:
            return ct
    return None

def extract_ip(proxy_pass: str):
    m = re.search(r"://([^/:]+)", proxy_pass or "")
    return m.group(1) if m else ""

def canonical_base_domain(domain: str) -> str:
    # Strip leading www.
    d = domain.lower().strip()
    if d.startswith("www."):
        d = d[4:]
    return d

def tenant_id_from_domain(domain: str) -> str:
    # Prefer first label for pretty IDs (e.g., lituationdjs.com -> lituationdjs)
    base = canonical_base_domain(domain)
    first = base.split(".", 1)[0]
    first = re.sub(r"[^a-z0-9]+", "-", first).strip("-")
    return first or re.sub(r"[^a-z0-9]+", "-", base).strip("-")

def priority_of(source: str) -> int:
    return PRIORITY.get(source, 1)

def main():
    internal = load_internal()

    routing = json.loads(ROUTING.read_text())
    domains = routing["domains"]

    iphost_path = RAW / "pve.pve.lxc.iphost.txt"
    lxcs = parse_lxc_iphost(iphost_path.read_text(errors="replace")) if iphost_path.exists() else []

    snap = json.loads(SNAP.read_text())
    snap.setdefault("tenants", [])

    # Keep any existing tenants (we'll merge/upsert into them)
    existing = snap["tenants"]

    # Index existing tenants by backend key (ctid/ip), and by known domain
    by_backend = {}
    by_domain = {}
    for t in existing:
        doms = t.get("domains") or []
        for d in doms:
            by_domain[canonical_base_domain(d)] = t
        b = t.get("backend") or {}
        key = None
        if b.get("type") == "lxc" and b.get("ctid"):
            key = ("lxc", int(b["ctid"]))
        elif b.get("ip"):
            key = ("ip", b["ip"])
        if key:
            # If conflicts, keep higher priority source
            if key in by_backend:
                if priority_of(t.get("source","")) > priority_of(by_backend[key].get("source","")):
                    by_backend[key] = t
            else:
                by_backend[key] = t

    # Build candidate records from routing map, grouped by backend key
    grouped = defaultdict(lambda: {"domains": set(), "proxy_pass": set(), "backend": None})
    for d, info in domains.items():
        if d in internal:
            continue

        base = canonical_base_domain(d)
        proxy_list = info.get("proxy_pass", []) or []
        proxy = proxy_list[0] if proxy_list else ""
        ip = extract_ip(proxy)

        owner = find_ct_owner(ip, lxcs) if ip else None
        if owner:
            backend_key = ("lxc", int(owner["ctid"]))
            backend = {
                "type": "lxc",
                "pve_node": "pve",
                "ctid": int(owner["ctid"]),
                "name": owner["hostname"] or "",
                "ip": ip,
            }
        else:
            backend_key = ("ip", ip) if ip else ("unknown", base)
            backend = {
                "type": "unknown",
                "pve_node": "",
                "ctid": None,
                "name": "",
                "ip": ip,
            }

        grouped[backend_key]["domains"].add(d)
        if proxy:
            grouped[backend_key]["proxy_pass"].add(proxy)
        grouped[backend_key]["backend"] = backend

    updated = []
    now = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")

    for backend_key, g in grouped.items():
        doms = sorted(g["domains"])
        backend = g["backend"]
        proxy_pass = sorted(g["proxy_pass"])
        chosen_proxy = proxy_pass[0] if proxy_pass else ""

        # Find existing record to update:
        target = by_backend.get(backend_key)
        if not target:
            # fallback: match by any domain already present
            for d in doms:
                if canonical_base_domain(d) in by_domain:
                    target = by_domain[canonical_base_domain(d)]
                    break

        source = "auto-upsert (nginx.routing.map.json + pve.lxc.iphost)"
        # If we have an operator-confirmed mapping, keep it and only merge domains
        if target and priority_of(target.get("source","")) >= priority_of(source):
            # Preserve operator-confirmed backend + proxy_pass, just merge domains
            target.setdefault("domains", [])
            merged = sorted(set(target["domains"] + doms))
            target["domains"] = merged
            target["verified_at_utc"] = target.get("verified_at_utc") or now
            updated.append(target)
            continue

        tenant_id = tenant_id_from_domain(doms[0])
        rec = target if target else {}
        rec.update({
            "tenant": tenant_id,
            "domains": doms,
            "nginx_proxy_pass": chosen_proxy,
            "backend": backend,
            "verified_at_utc": now,
            "source": source,
        })
        updated.append(rec)

    # Remove duplicates (same object may have been updated twice)
    # Key by primary domain
    dedup = {}
    for t in updated:
        primary = canonical_base_domain((t.get("domains") or [""])[0])
        if not primary:
            continue
        if primary not in dedup or priority_of(t.get("source","")) > priority_of(dedup[primary].get("source","")):
            dedup[primary] = t

    snap["tenants"] = sorted(dedup.values(), key=lambda t: (t.get("tenant",""), (t.get("domains") or [""])[0]))

    SNAP.write_text(json.dumps(snap, indent=2) + "\n")
    print("Updated .migra/infra.snapshot.json")
    print(f"- Tenants now: {len(snap['tenants'])}")

if __name__ == "__main__":
    main()