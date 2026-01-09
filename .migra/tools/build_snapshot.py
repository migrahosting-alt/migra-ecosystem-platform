#!/usr/bin/env python3
import json, re, argparse
from pathlib import Path
from datetime import datetime, timezone

SECRET_RE = re.compile(r'(?i)(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*([^\s\'"]+|\'[^\']+\'|"[^"]+")')

def redact(text: str) -> str:
    if not isinstance(text, str):
        return text
    return SECRET_RE.sub(lambda m: f"{m.group(1)}=<REDACTED>", text)

def read_text(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except FileNotFoundError:
        return ""

def parse_qm_list(txt: str):
    vms = []
    for line in txt.splitlines():
        line = line.rstrip()
        if not line or line.strip().startswith("VMID") or not re.match(r"^\s*\d+\s+", line):
            continue
        parts = re.split(r"\s{2,}", line.strip())
        if len(parts) >= 3:
            vmid = parts[0]
            name = parts[1]
            status = parts[2]
            vms.append({"vmid": vmid, "name": name, "status": status, "raw": redact(line)})
    return vms

def parse_pct_list(txt: str):
    lxcs = []
    for line in txt.splitlines():
        line = line.rstrip()
        if not line or line.strip().startswith("VMID") or line.strip().startswith("CTID") or not re.match(r"^\s*\d+\s+", line):
            continue
        parts = re.split(r"\s{2,}", line.strip())
        if len(parts) >= 3:
            ctid = parts[0]
            name = parts[1]
            status = parts[2]
            lxcs.append({"ctid": ctid, "name": name, "status": status, "raw": redact(line)})
    return lxcs

def parse_lxc_iphost(txt: str):
    # Format from script:
    # --- CT 139 ---
    # hostname
    # ip -br a output lines...
    out = []
    current = None
    for line in txt.splitlines():
        m = re.match(r"^---\s*CT\s+(\d+)\s*---", line.strip())
        if m:
            if current:
                out.append(current)
            current = {"ctid": m.group(1), "hostname": None, "ip_br": []}
            continue
        if current is None:
            continue
        if current["hostname"] is None and line.strip():
            current["hostname"] = line.strip()
            continue
        if line.strip():
            current["ip_br"].append(line.strip())
    if current:
        out.append(current)
    return out

def parse_ss_listeners(txt: str):
    listeners = []
    for line in txt.splitlines():
        if line.startswith("Netid") or not line.strip():
            continue
        # crude parse; keep raw but redact
        listeners.append(redact(line.strip()))
    return listeners

def parse_nginx_hints(txt: str):
    server_names = set()
    proxy_pass = set()
    upstreams = set()

    for line in txt.splitlines():
        if "server_name" in line:
            # grab after 'server_name'
            m = re.search(r"\bserver_name\s+([^;#]+)", line)
            if m:
                for host in m.group(1).split():
                    host = host.strip()
                    if host and host != "_":
                        server_names.add(host)
        if "proxy_pass" in line:
            m = re.search(r"\bproxy_pass\s+([^;#]+)", line)
            if m:
                proxy_pass.add(m.group(1).strip())
        if re.search(r"\bupstream\s+\S+", line):
            m = re.search(r"\bupstream\s+([^{\s]+)", line)
            if m:
                upstreams.add(m.group(1).strip())

    return {
        "server_names": sorted(server_names),
        "proxy_pass_targets": sorted(proxy_pass),
        "upstreams": sorted(upstreams),
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--raw", required=True)
    ap.add_argument("--out", default=".migra")
    args = ap.parse_args()

    raw = Path(args.raw)
    out = Path(args.out)
    stamp = raw.name

    files = {
        "pve_version": raw / "pve.pve.version.txt",
        "pve_vms": raw / "pve.pve.vms.txt",
        "pve_lxcs": raw / "pve.pve.lxcs.txt",
        "pve_lxc_iphost": raw / "pve.pve.lxc.iphost.txt",
        "srv1_nginx_test": raw / "srv1-web.nginx.test.txt",
        "srv1_nginx_hints": raw / "srv1-web.nginx.hints.txt",
        "srv1_nginx_dump": raw / "srv1-web.nginx.dump.txt",
        "mpanel_listeners": raw / "mpanel-core.mpanel.listeners.txt",
        "mpanel_services": raw / "mpanel-core.mpanel.services.txt",
        "mpanel_pm2": raw / "mpanel-core.mpanel.pm2.status.txt",
    }

    snapshot = {
        "scanned_at_utc": stamp,
        "generated_at_utc": datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ"),
        "sources": {k: str(v) for k, v in files.items()},
        "proxmox": {
            "version": redact(read_text(files["pve_version"]).strip()),
            "vms": parse_qm_list(read_text(files["pve_vms"])),
            "lxcs": parse_pct_list(read_text(files["pve_lxcs"])),
            "lxc_iphost": parse_lxc_iphost(read_text(files["pve_lxc_iphost"])),
        },
        "nginx": {
            "nginx_test": redact(read_text(files["srv1_nginx_test"]).strip()),
            "routing_hints": parse_nginx_hints(read_text(files["srv1_nginx_hints"])),
            "notes": "Full nginx -T captured in raw; snapshot only stores extracted hints to avoid secrets/noise.",
        },
        "mpanel": {
            "listeners": parse_ss_listeners(read_text(files["mpanel_listeners"])),
            "services": redact(read_text(files["mpanel_services"])).splitlines()[:300],
            "pm2_status": redact(read_text(files["mpanel_pm2"])).splitlines()[:200],
        },
    }

    out.mkdir(parents=True, exist_ok=True)
    (out / "infra.snapshot.json").write_text(json.dumps(snapshot, indent=2) + "\n")

    md = []
    md.append(f"# Migra Infra Snapshot ({stamp})")
    md.append("")
    md.append("## Proxmox")
    md.append("```")
    md.append(snapshot["proxmox"]["version"])
    md.append("```")
    md.append("")
    md.append(f"- VMs: {len(snapshot['proxmox']['vms'])}")
    md.append(f"- LXCs: {len(snapshot['proxmox']['lxcs'])}")
    md.append("")
    md.append("## NGINX Routing (Hints)")
    md.append(f"- server_name entries: {len(snapshot['nginx']['routing_hints']['server_names'])}")
    if snapshot["nginx"]["routing_hints"]["server_names"]:
        md.append("  - " + "\n  - ".join(snapshot["nginx"]["routing_hints"]["server_names"][:50]))
    md.append("")
    md.append("## mPanel")
    md.append(f"- listeners captured: {len(snapshot['mpanel']['listeners'])}")
    md.append("")
    (out / "infra.snapshot.md").write_text("\n".join(md) + "\n")

    # Runbooks (minimal enterprise scaffolding)
    runbooks = out / "runbooks"
    runbooks.mkdir(exist_ok=True)

    (runbooks / "ssh-access.md").write_text(
        "# SSH Access Runbook\n\n"
        "- Use host aliases: `pve`, `srv1-web`, `mpanel-core`, `db-core`, `dns-core`, `mail-core`, `cloud-core`, `voip-core`\n"
        "- Validate: `ssh pve 'hostname; pveversion'`\n"
    )
    (runbooks / "nginx-routing.md").write_text(
        "# NGINX Routing Runbook\n\n"
        "- Verify config: `ssh srv1-web 'nginx -t'`\n"
        "- Inspect routing: `ssh srv1-web \"grep -R --line-number -E 'server_name|proxy_pass|upstream' /etc/nginx | head\"`\n"
        "- No reloads/restarts without explicit approval.\n"
    )
    (runbooks / "mpanel-ops.md").write_text(
        "# mPanel Ops Runbook\n\n"
        "- Check PM2: `ssh mpanel-core '/usr/local/bin/pm2 status'`\n"
        "- Tail logs (if needed): `ssh mpanel-core '/usr/local/bin/pm2 logs --lines 200'`\n"
        "- No restarts without explicit approval.\n"
    )

    print("Wrote:")
    print(f" - {out / 'infra.snapshot.json'}")
    print(f" - {out / 'infra.snapshot.md'}")
    print(f" - {runbooks}")

if __name__ == "__main__":
    main()
