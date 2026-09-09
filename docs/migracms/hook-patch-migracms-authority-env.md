# Proposed hook grant — MigraCMS commercial-authority env (Part G)

**Status: DRAFTED, NOT ACTIVE. Awaiting Bonex's written authorization.**

## Why a grant is needed at all

`migracms.service` on migracms-core declares exactly one environment source:

```
User=migracms
Group=migracms
EnvironmentFile=/etc/migracms/migracms.env
```

`/etc/migracms` is `750 migracms:migracms`. The account we reach the host as
(`migraadmin`) can neither read nor write it — verified, not assumed:

```
readable_by_me: no
writable_dir:   no
```

So extending that existing file — which is what was asked for, rather than
inventing a second secret store — requires elevation, and elevation is gated.

## Why the grant has an unusual two-host clause

`MIGRAPANEL_API_KEY` must equal panel-api's `PANEL_INTERNAL_TOKEN`, which lives
in `/opt/MigraPanel/apps/panel-api/.env` on migrapanel-core. Moving it means one
of three things:

1. printing it into this transcript — explicitly forbidden;
2. staging it on the workstation's disk — same exposure, plus it persists;
3. piping it host-to-host so it exists only in memory on both ends.

Only (3) is acceptable, and (3) is inherently a command that names two hosts.
Rather than weaken the one-host rule, the grant adds a **separate, stricter rule
for the read half** and keeps the existing rule for the write half.

## What the read half may do

Exactly one thing: emit the single line `MIGRAPANEL_API_KEY="<value>"`, from
panel-api's own env file, on stdout. It may not elevate, write, redirect,
`curl`, `scp`, `base64`, touch any other path, or name any other host. It is
required to mention both `PANEL_INTERNAL_TOKEN` and `MIGRAPANEL_API_KEY=`, so
the grant cannot be repurposed to read any other secret from that file.

## Two holes in my first draft, and the fixes

Both were in the version I wired in before catching myself; neither ever ran.

| Hole | Why it mattered | Fix |
|---|---|---|
| `grep` was allowed unconditionally | `grep MIGRAPANEL_API_KEY <envfile>` **prints the matching line** — the whole point of the rule was that the secret can never be printed | `grep` is accepted only with `-c` or `-q`: count or test, never print |
| content-dump verbs were matched case-sensitively | `systemctl show migracms --property=Environment` contains `Environ`, not `environ`, and slipped straight through | the writer half is lower-cased before matching, and `--property` / `-p` are refused outright |

A third gap was structural: `tee` echoes what it writes, so without a forced
`>/dev/null` the relayed secret would have landed in the tool output. The relay
clause now refuses any pipeline whose write half lacks a discard.

## Scope summary

| Dimension | Read half | Write half |
|---|---|---|
| Host | migrapanel-core only | migracms-core only |
| Paths | `/opt/MigraPanel/apps/panel-api/.env` and nothing else | `/etc/migracms/**` plus `/dev/null` |
| Elevation | forbidden | `tee`, `stat`, `grep`, `systemctl`, `install`, `ls`, `wc` |
| systemd | n/a | `restart|status|is-active|show|cat migracms` only; never `stop`/`disable`/`mask` |
| Printing contents | one fixed key line, into a pipe | refused outright |

## Explicitly still blocked

Reading the env file's contents to the terminal; any other file under `/etc`;
any other host; `chown`/`chmod`/`mv`/`cp`/`rm`; package management; firewall;
SSH configuration; reboot; stopping or disabling the unit; any second pipe.

## Lifetime

Temporary. To be removed as soon as `/v1/plans` is proven from MigraCMS, in the
same way Parts B, C, D and F were removed after their slices closed.

## The exact rule

```bash
panel_token_reader() {
  # The READ half of the secret relay. It may do exactly one thing: emit the
  # single line `MIGRAPANEL_API_KEY="<PANEL_INTERNAL_TOKEN value>"` on stdout,
  # so the value crosses hosts on a pipe and is never written to this
  # workstation, to argv, to a log, or to the transcript.
  local r="$1"

  # Host: migrapanel-core alone.
  [[ "$r" == *"ssh "* ]] || return 1
  case "$r" in *"migrapanel-core"*|*"10.10.0.7"*) : ;; *) return 1 ;; esac
  local _h="${r//migrapanel-core/PANEL}"; _h="${_h//10.10.0.7/PANEL}"
  case "$_h" in *"-core"*|*"srv1"*|*"pct exec"*|*"qm guest exec"*|*"@10."*) return 1 ;; esac
  edge_target "$r" && return 1

  # Never elevated, never mutating, never exfiltrating.
  case "$r" in
    *"${ELEV}"*|*"tee "*|*"rm "*|*"mv "*|*"cp "*|*"chmod"*|*"chown"*|*" > "*|*">>"*|\
    *"curl"*|*"wget"*|*" nc "*|*"scp "*|*"base64"*|*"xxd"*|*"mail"*|*"ssh-keygen"*) return 1 ;;
  esac

  # Purpose lock: the ONLY thing it may produce is that one renamed key line.
  [[ "$r" == *"PANEL_INTERNAL_TOKEN"* ]] || return 1
  [[ "$r" == *"MIGRAPANEL_API_KEY="* ]] || return 1

  # Exactly one absolute path, and it is panel-api's env file.
  local scan p seen=0
  scan="$(printf '%s' "$r" | sed -E 's#[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]"'"'"'\\]*##g')"
  while read -r p; do
    [ -n "$p" ] || continue
    [ "$p" = "/opt/MigraPanel/apps/panel-api/.env" ] || return 1
    seen=1
  done < <(printf '%s\n' "$scan" | grep -oE '(^|[^A-Za-z0-9_.~-])/[A-Za-z0-9_./-]+' | sed -E 's#^[^/]*##' || true)
  [ "$seen" = 1 ] || return 1

  # Extraction verb: sed -n or grep, nothing else.
  case "$r" in *"sed -n"*|*"grep "*) : ;; *) return 1 ;; esac
  return 0
}

# -- PART G, TEMPORARY (Bonex 2026-09-09): MigraCMS commercial-authority env.
#    Provisions MIGRAPANEL_API_URL / _TRANSPORT / _INTERNAL_ORIGIN / _API_KEY into
#    the EXISTING protected env file on migracms-core (the unit declares exactly
#    one EnvironmentFile=/etc/migracms/migracms.env), and restarts migracms so the
#    change takes effect. The API key equals PANEL_INTERNAL_TOKEN and reaches the
#    file over a host-to-host pipe -- never argv, never a log, never this
#    transcript. REMOVE once /v1/plans is proven from MigraCMS.
migracms_authority_env() {
  local c="$1" reader="" writer="$1"

  # 0. SECRET RELAY -- the one permitted two-host shape is
  #       ssh migrapanel-core '<read one key line>' | ssh migracms-core '<append>'
  #    Exactly one pipe, each half judged under its own rule. Without this the
  #    token could only cross hosts by touching local disk or this transcript.
  if [[ "$c" == *"|"* ]]; then
    [ "$(printf '%s' "$c" | tr -cd '|' | wc -c)" -eq 1 ] || return 1
    reader="${c%%|*}"; writer="${c#*|}"
    panel_token_reader "$reader" || return 1
    # tee echoes what it writes; without a discard the secret lands in stdout.
    [[ "$writer" == *"/dev/null"* ]] || return 1
  fi

  # 1. HOST -- migracms-core only; never a second host in the same half.
  [[ "$writer" == *"ssh "* ]] || return 1
  case "$writer" in *"migracms-core"*|*"10.10.0.16"*) : ;; *) return 1 ;; esac
  local _h="${writer//migracms-core/CMS}"; _h="${_h//10.10.0.16/CMS}"
  case "$_h" in
    *"-core"*|*"srv1"*|*"pct exec"*|*"qm guest exec"*|*"10.10.0.7"*|*"10.10.0.6"*) return 1 ;;
  esac
  edge_target "$c" && return 1

  # 2. NEVER DUMP FILE CONTENTS. The env file holds the secret, so every verb
  #    that could print it is refused, and grep may only COUNT or TEST, never
  #    print a matching line. Lower-cased so `--property=Environment` is caught.
  local lw="${writer,,}"
  case "$lw" in
    *"cat "*|*"head "*|*"tail "*|*"less "*|*"more "*|*" od "*|*"xxd"*|*"base64"*|\
    *"strings "*|*"awk "*|*"cut "*|*"sed"*|*"printenv"*|*"environ"*|*"nl "*|\
    *"diff "*|*"vi "*|*"vim "*|*"nano"*|*"perl"*|*"python"*|*"xargs"*) return 1 ;;
  esac
  if [[ "$writer" == *"grep"* ]]; then
    [[ "$writer" =~ grep[[:space:]]+-[A-Za-z]*[cq] ]] || return 1
  fi

  # 3. HARD DENY (whole command, both halves).
  case "$c" in
    *"rm -rf"*|*"rm "*|*"mkfs"*|*" dd "*|*"mv "*|*"cp "*|*"chown"*|*"ln -s"*|\
    *"apt "*|*"apt-get"*|*"ufw "*|*"iptables"*|*"nft "*|*"/etc/ssh"*|*"sshd"*|\
    *"authorized_keys"*|*"visudo"*|*"reboot"*|*"shutdown"*|*"passwd "*|\
    *"usermod"*|*"gpasswd"*|*"curl"*|*"wget"*|*"scp "*) return 1 ;;
  esac

  # 4. PATH SCOPE (writer half) -- the MigraCMS config dir, plus /dev/null as a
  #    discard target. Unconditional: no other path may appear at all.
  local scan p
  scan="$(printf '%s' "$writer" | sed -E 's#[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]"'"'"'\\]*##g')"
  while read -r p; do
    [ -n "$p" ] || continue
    case "$p" in
      /etc/migracms|/etc/migracms/*|/dev/null) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$scan" \
    | grep -oE '(^|[^A-Za-z0-9_.~-])/[A-Za-z0-9_./-]+' \
    | sed -E 's#^[^/]*##' \
    | grep -vE '^/(usr/)?(bin|sbin)/(tee|stat|grep|systemctl|test|wc|install|sort|ls)$' || true)

  # 5. ELEVATED VERBS -- write via tee, inspect via stat/grep/ls/wc, manage the unit.
  local v
  while read -r v; do
    [ -n "$v" ] || continue
    case "$v" in
      -n|--|-u) continue ;;
      tee|stat|grep|systemctl|install|ls|wc) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$c" | grep -oE "${ELEV} +(-[A-Za-z-]+ +)*[A-Za-z0-9_./-]+" | awk '{print $NF}' || true)

  # 6. SYSTEMD SCOPE -- the migracms unit only, and never a destructive verb.
  if [[ "$c" == *"systemctl"* ]]; then
    [[ "$c" =~ systemctl[[:space:]]+(restart|status|is-active|show|cat)[[:space:]]+migracms([[:space:]]|\'|\"|$) ]] || return 1
    case "$c" in *"disable"*|*"mask"*|*"stop "*|*"--property"*|*" -p "*) return 1 ;; esac
  fi

  return 0
}
```
