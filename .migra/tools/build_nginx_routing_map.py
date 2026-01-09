#!/usr/bin/env python3
import re, json, argparse
from pathlib import Path
from collections import defaultdict

RE_SERVER_START = re.compile(r"^\s*server\s*\{")
RE_UPSTREAM_START = re.compile(r"^\s*upstream\s+([^{\s]+)\s*\{")
RE_SERVER_NAME = re.compile(r"^\s*server_name\s+([^;#]+)")
RE_LISTEN = re.compile(r"^\s*listen\s+([^;#]+)")
RE_PROXY_PASS = re.compile(r"^\s*proxy_pass\s+([^;#]+)")
RE_RETURN = re.compile(r"^\s*return\s+([^;#]+)")

def read_text(path: Path) -> str:
    try:
        return path.read_text(errors="replace")
    except FileNotFoundError:
        return ""

def split_hosts(server_name_value: str):
    out = []
    for h in server_name_value.split():
        h = h.strip()
        if not h or h == "_":
            continue
        out.append(h)
    return out

def parse_hints(hints_text: str):
    domains = set()
    proxy_targets = set()
    for line in hints_text.splitlines():
        m = re.search(r"\bserver_name\s+([^;#]+)", line)
        if m:
            for h in split_hosts(m.group(1)):
                domains.add(h)
        m = re.search(r"\bproxy_pass\s+([^;#]+)", line)
        if m:
            proxy_targets.add(m.group(1).strip())
    return {
        "domains": sorted(domains),
        "proxy_pass_targets": sorted(proxy_targets),
    }

def parse_nginx_dump(dump_text: str):
    lines = dump_text.splitlines()
    brace_depth = 0

    servers = []
    upstreams = {}

    in_server = False
    server_start_depth = None
    cur_server = None

    in_upstream = False
    upstream_start_depth = None
    cur_upstream = None

    def finish_server():
        nonlocal cur_server, in_server, server_start_depth
        if not cur_server:
            in_server = False
            server_start_depth = None
            return
        # de-dupe
        cur_server["server_names"] = sorted(set(cur_server["server_names"]))
        cur_server["listens"] = sorted(set(cur_server["listens"]))
        cur_server["proxy_pass"] = sorted(set(cur_server["proxy_pass"]))
        cur_server["returns"] = sorted(set(cur_server["returns"]))
        servers.append(cur_server)
        cur_server = None
        in_server = False
        server_start_depth = None

    def finish_upstream():
        nonlocal cur_upstream, in_upstream, upstream_start_depth
        if not cur_upstream:
            in_upstream = False
            upstream_start_depth = None
            return
        name = cur_upstream.get("name")
        if name:
            cur_upstream["servers"] = sorted(set(cur_upstream["servers"]))
            upstreams[name] = cur_upstream
        cur_upstream = None
        in_upstream = False
        upstream_start_depth = None

    for raw in lines:
        line = raw.rstrip("\n")

        # Detect upstream start (works even if nested under http/stream)
        m = RE_UPSTREAM_START.match(line)
        if m and not in_upstream:
            in_upstream = True
            cur_upstream = {"name": m.group(1), "servers": []}
            upstream_start_depth = brace_depth
            # fall through to brace update

        # Detect server start
        if RE_SERVER_START.match(line) and not in_server:
            in_server = True
            cur_server = {
                "server_names": [],
                "listens": [],
                "proxy_pass": [],
                "returns": [],
            }
            server_start_depth = brace_depth
            # fall through to parse directives + brace update

        # Parse directives when inside server
        if in_server and cur_server is not None:
            m = RE_SERVER_NAME.match(line)
            if m:
                cur_server["server_names"].extend(split_hosts(m.group(1)))
            m = RE_LISTEN.match(line)
            if m:
                cur_server["listens"].append(m.group(1).strip())
            m = RE_PROXY_PASS.match(line)
            if m:
                cur_server["proxy_pass"].append(m.group(1).strip())
            m = RE_RETURN.match(line)
            if m:
                cur_server["returns"].append(m.group(1).strip())

        # Parse directives when inside upstream
        if in_upstream and cur_upstream is not None:
            m = re.match(r"^\s*server\s+([^;#]+)", line)
            if m:
                cur_upstream["servers"].append(m.group(1).strip())

        # Update brace depth at end of line
        brace_depth += line.count("{") - line.count("}")

        # Close blocks when brace depth returns below start depth
        if in_server and server_start_depth is not None and brace_depth <= server_start_depth:
            finish_server()

        if in_upstream and upstream_start_depth is not None and brace_depth <= upstream_start_depth:
            finish_upstream()

    # In case file ends unexpectedly
    if in_server:
        finish_server()
    if in_upstream:
        finish_upstream()

    # Build domain map from server blocks
    domain_map = {}
    for idx, s in enumerate(servers):
        for d in s["server_names"]:
            entry = domain_map.setdefault(d, {"listens": [], "proxy_pass": [], "returns": [], "sources": []})
            entry["listens"] = sorted(set(entry["listens"] + s["listens"]))
            entry["proxy_pass"] = sorted(set(entry["proxy_pass"] + s["proxy_pass"]))
            entry["returns"] = sorted(set(entry["returns"] + s["returns"]))
            entry["sources"] = sorted(set(entry["sources"] + [f"server_block:{idx}"]))

    return {
        "servers": servers,
        "upstreams": upstreams,
        "domains": domain_map,
    }

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--nginx_dump", required=True)
    ap.add_argument("--nginx_hints", required=False, default="")
    ap.add_argument("--out", required=True)
    args = ap.parse_args()

    dump_text = read_text(Path(args.nginx_dump))
    hints_text = read_text(Path(args.nginx_hints)) if args.nginx_hints else ""

    parsed = parse_nginx_dump(dump_text)
    hints = parse_hints(hints_text) if hints_text else {"domains": [], "proxy_pass_targets": []}

    # Merge: ensure every hinted domain exists in output, even if we couldn't associate targets
    for d in hints["domains"]:
        parsed["domains"].setdefault(d, {"listens": [], "proxy_pass": [], "returns": [], "sources": ["hints_only"]})

    out = {
        "stats": {
            "domains": len(parsed["domains"]),
            "servers": len(parsed["servers"]),
            "upstreams": len(parsed["upstreams"]),
            "hints_domains": len(hints["domains"]),
        },
        "hints": hints,
        "upstreams": parsed["upstreams"],
        "servers": parsed["servers"],
        "domains": parsed["domains"],
        "notes": [
            "upstreams may be 0 if config uses direct proxy_pass to IP:port.",
            "domains includes hints-only entries when server blocks could not be associated.",
        ],
    }

    Path(args.out).write_text(json.dumps(out, indent=2) + "\n")
    print(f"Wrote {args.out} (domains={out['stats']['domains']}, servers={out['stats']['servers']}, upstreams={out['stats']['upstreams']})")

if __name__ == "__main__":
    main()