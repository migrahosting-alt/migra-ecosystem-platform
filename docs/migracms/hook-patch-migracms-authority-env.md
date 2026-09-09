# Hook grant — MigraCMS commercial-authority env (Part G)

**Status: AUTHORIZED by Bonex 2026-09-09, INSTALLED, TEMPORARY.**
Includes a one-shot repair extension, also authorized 2026-09-09.
Both are removed together once `/v1/plans` is proven from MigraCMS.

## Why a grant is needed

`migracms.service` declares exactly one environment source:

```
User=migracms
Group=migracms
EnvironmentFile=/etc/migracms/migracms.env
```

`/etc/migracms` is `750 migracms:migracms`; the account we reach the host as
(`migraadmin`) can neither read nor write it. Extending that existing file —
rather than inventing a second secret store — needs elevation.

## Why there is a two-host clause

`MIGRAPANEL_API_KEY` must equal panel-api's `PANEL_INTERNAL_TOKEN`, which lives
on migrapanel-core. Moving it means printing it (forbidden), staging it on the
workstation (same exposure, and it persists), or piping it host-to-host so it
exists only in memory. Only the third is acceptable, and it inherently names two
hosts — so the one-host rule stands and the read half gets its own stricter rule.

## Authorized scope

| | Read half | Write half |
|---|---|---|
| Host | migrapanel-core only | migracms-core only |
| Path | `/opt/MigraPanel/apps/panel-api/.env`, nothing else | `/etc/migracms/migracms.env`, its directory, `/dev/null` |
| Extraction | `sed -n` performing the rename; **no arbitrary grep** | — |
| Keys | only `PANEL_INTERNAL_TOKEN`, renamed to `MIGRAPANEL_API_KEY=` | only the four `MIGRAPANEL_*` keys |
| Elevation | forbidden | `tee stat grep systemctl ls wc` |
| Write shape | — | append only; `tee` must carry `-a` |
| Redirection | none | `/dev/null` only (plus `2>&1`) |
| Reading back | — | `grep -c`/`-q` only |
| systemd | — | `restart\|status\|is-active\|show\|cat migracms`; `--property`/`-p` refused |

Refused everywhere: shell tracing, ssh options that run commands
(`ProxyCommand`, `LocalCommand`, `RemoteCommand`, `ProxyJump`), wildcards,
`install(1)`, running as another user, any second pipe.

### One-shot repair extension

Part G is append-only by design, so it cannot undo a bad write. The extension is
**not** a `sed -i` permission: exactly two commands are permitted, compared as
whole strings after stripping a leading `timeout N` and `ssh -o Option=value`
pairs. A different path, expression, extra `-e`, `-i.bak`, `-n`, `$` or backtick
changes the string and fails equality.

```
repair    sudo sed -i -e '/^MIGRAPANEL_/d' -e '/^# MigraPanel/d' /etc/migracms/migracms.env
checksum  sudo sed    -e '/^MIGRAPANEL_/d' -e '/^# MigraPanel/d' /etc/migracms/migracms.env | sha256sum
```

The checksum cannot disclose the secret: the API key line is one of the lines it
filters out.

## Six defects the permit/deny suite caught

The suite is `hook-patch-migracms-authority-env.controls.sh` (61 cases), fed to
the real hook rather than a copy. Four of these nothing else would have caught.

| # | Defect | Consequence |
|---|---|---|
| 1 | `grep` allowed unconditionally | `grep MIGRAPANEL_API_KEY <envfile>` **prints the matching line** |
| 2 | content verbs matched case-sensitively | `--property=Environment` contains `Environ`, not `environ` |
| 3 | `tee` echoes what it writes | without a forced discard the relayed secret lands in tool output |
| 4 | **the read half needs no elevation** | the elevation dispatch never saw it: staging the token locally *and* piping it to an external collector were **both ALLOWED**. Closed with an unconditional companion rule |
| 5 | `*"sh -"*` (for `sh -x`) also matched `ssh -o` | refused the legitimate relay |
| 6 | `2>&1` parsed as a file-redirect target | refused every diagnostic |

## UNRESOLVED PROVISIONING ANOMALY

The first provisioning run left the file with duplicate keys. The end state has
been corrected; **the cause has not been explained.** These are different things
and this record keeps them apart deliberately.

```text
Observed:
8 MigraPanel key lines, 2 identical copies of each

Proven:
- heredoc emits once
- relay emits once
- reader emits once
- tests did not execute writes
- all duplicate values identical
- no unexpected lines written

Cause:
UNKNOWN

Remediation:
exact-scope normalization + single reprovision
```

Each "proven" line is a direct test on the same hosts, not an inference: a
3-line heredoc appended exactly 3 lines to a scratch file; the two-hop relay
appended exactly 1; piping the reader into `grep -c -F -f -` returned a count
consistent with one emitted pattern; and the suite's `DATABASE_URL=postgres://x`
fixture never appeared in the file, which is what it would have done had the
harness executed its cases.

One correlated observation, recorded as a lead and **not** as a cause: the
re-provisioning run used `ssh -n` on the read half, closing its stdin, and did
not duplicate. That is a single unreplicated trial. It does not establish that
an inherited stdin or a lingering connection caused the original duplication,
and it must not be written up as though it did.

### Repair evidence

```
before   MIGRAPANEL_* = 8, comment = 1, 26 lines
filtered sha256 (MigraPanel lines excluded) = 62f99061e3bc08e3a4f64bd7bbb449076d6266ef57402af85b7eb97b4464cf74
after deletion   MIGRAPANEL_* = 0, comment = 0, 17 lines, 640 migracms:migracms
filtered sha256  = 62f99061...4464cf74   (IDENTICAL — repair touched only the intended slice)
after reprovision MIGRAPANEL_* = 4, one of each, 22 lines, 640 migracms:migracms
filtered sha256  = 62f99061...4464cf74   (IDENTICAL)
API key byte-identity vs PANEL_INTERNAL_TOKEN: grep -c -F -f - = 1
```

## The exact rule as installed

```bash
# ─────────────────────────────────────────────────────────────────────────────
# PART G, TEMPORARY — MigraCMS commercial-authority environment
#
# Authorized by Bonex, 2026-09-09, in writing, to the scope reproduced below.
# The full proposal, and the two holes found in the draft that preceded it, are
# in docs/migracms/hook-patch-migracms-authority-env.md (committed e625efc6).
#
#   READ HALF   host migrapanel-core only; source /opt/MigraPanel/apps/panel-api/.env
#               only; may extract only PANEL_INTERNAL_TOKEN; output must be
#               transformed directly to MIGRAPANEL_API_KEY=<value>; no arbitrary
#               grep; no env dumping; no shell tracing; no file staging; no
#               workstation persistence.
#
#   WRITE HALF  host migracms-core only; target /etc/migracms/migracms.env only;
#               only the four MIGRAPANEL_* keys may be written; tee stdout must
#               go to /dev/null; no readback of secret values; systemctl limited
#               to the migracms unit; `systemctl show ... Environment*` refused
#               case-insensitively.
#
# The write path is an APPEND of exactly those keys. It can neither replace nor
# truncate the file: `tee` without -a is refused, no redirection may target the
# env file, and `install` is not an allowed verb precisely because it overwrites.
#
# REMOVE once /v1/plans is proven from MigraCMS.
# ─────────────────────────────────────────────────────────────────────────────

# The four keys this grant exists to write, and nothing else.
migracms_key_allowed() {
  case "$1" in
    MIGRAPANEL_API_URL|MIGRAPANEL_API_TRANSPORT|MIGRAPANEL_INTERNAL_ORIGIN|MIGRAPANEL_API_KEY)
      return 0 ;;
  esac
  return 1
}

panel_token_reader() {
  # The READ half of the secret relay. It may do exactly one thing: emit the
  # single line `MIGRAPANEL_API_KEY="<PANEL_INTERNAL_TOKEN value>"` on stdout, so
  # the value crosses hosts in memory and is never written to this workstation,
  # to argv, to a log, or to the transcript.
  local r="$1"

  # HOST — migrapanel-core alone. Compared against a URL-stripped copy so a
  # host named in a config VALUE is never mistaken for an ssh destination.
  local bare
  bare="$(printf '%s' "$r" | sed -E 's#[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]"'"'"'\\]*##g')"
  [[ "$bare" == *"ssh "* ]] || return 1
  case "$bare" in *"migrapanel-core"*|*"10.10.0.7"*) : ;; *) return 1 ;; esac
  local _h="${bare//migrapanel-core/PANEL}"; _h="${_h//10.10.0.7/PANEL}"
  case "$_h" in *"-core"*|*"pct exec"*|*"qm guest exec"*|*"@10."*|*"@100."*) return 1 ;; esac
  edge_target "$r" && return 1

  # NO ARBITRARY GREP. The extraction verb is `sed -n` performing the rename,
  # and nothing else. A bare grep would PRINT the matching line.
  [[ "$r" =~ sed[[:space:]]+-n ]] || return 1
  case "$r" in *"grep"*) return 1 ;; esac

  # NO ENV DUMPING, NO SHELL TRACING, NO FILE STAGING, NO PERSISTENCE.
  case "$r" in
    *"printenv"*|*"environ"*|*" env "*|*"declare"*|*"export "*|*"/proc/"*) return 1 ;;
    *"xtrace"*|*"PS4"*) return 1 ;;
    *"tee "*|*"rm "*|*"mv "*|*"cp "*|*"chmod"*|*"chown"*|*">"*|*"<"*) return 1 ;;
    *"${ELEV}"*|*"curl"*|*"wget"*|*" nc "*|*"scp "*|*"rsync"*|*"base64"*|*"xxd"*|\
    *"mail"*|*"ssh-keygen"*|*"cat "*|*"head "*|*"tail "*|*"awk "*|*"cut "*) return 1 ;;
  esac

  # NO SHELL TRACING — matched on a word boundary. A blanket *"sh -"* also
  # matched `ssh -o`, refusing the very relay this grant exists to permit.
  [[ "$r" =~ (^|[^A-Za-z0-9_./-])(ba|z|k)?sh[[:space:]]+-[a-z]*x ]] && return 1
  [[ "$r" =~ (^|[^A-Za-z0-9_./-])set[[:space:]]+-[a-z]*x ]] && return 1

  # NO ssh OPTION THAT RUNS A COMMAND — these turn a read into an arbitrary
  # execution, on this workstation or a third host.
  case "$r" in
    *"ProxyCommand"*|*"LocalCommand"*|*"RemoteCommand"*|*"ProxyJump"*|*"-J "*|\
    *"PermitLocalCommand"*) return 1 ;;
  esac

  # PURPOSE LOCK — the only thing it may produce is that one renamed key line.
  [[ "$r" == *"PANEL_INTERNAL_TOKEN"* ]] || return 1
  [[ "$r" == *"MIGRAPANEL_API_KEY="* ]] || return 1
  case "$r" in *"*"*|*"?"*) return 1 ;; esac

  # EXACTLY ONE absolute path, and it is panel-api's env file.
  local p seen=0
  while read -r p; do
    [ -n "$p" ] || continue
    [ "$p" = "/opt/MigraPanel/apps/panel-api/.env" ] || return 1
    seen=1
  done < <(printf '%s\n' "$bare" | grep -oE '(^|[^A-Za-z0-9_.~-])/[A-Za-z0-9_./-]+' | sed -E 's#^[^/]*##' || true)
  [ "$seen" = 1 ] || return 1

  return 0
}

# ── ONE-SHOT REPAIR, authorized by Bonex 2026-09-09 as a narrow addition to
#    Part G. Part G is append-only by design, so it cannot undo a bad write; the
#    provisioning run left two identical copies of each key and there was no way
#    to normalise the file under the grant.
#
#    This is NOT a `sed -i` permission. Exactly two commands are permitted,
#    compared as WHOLE STRINGS after stripping a leading `timeout N` and any
#    `ssh -o Option=value` pairs. A different path, a different expression, an
#    extra -e, `-i.bak`, `-n`, or any `$`/backtick changes the string and fails
#    equality. Both are removed with Part G.
#
#      repair    delete only /^MIGRAPANEL_/ and /^# MigraPanel/ from the env file
#      checksum  sha256 of the file with exactly those lines filtered out, which
#                proves the repair touched nothing else (and cannot disclose the
#                secret, since the API key line is one of the filtered ones)
migracms_env_exact_repair() {
  local c="$1" norm del f
  norm="$(printf '%s' "$c" \
    | sed -E 's#^[[:space:]]*timeout[[:space:]]+[0-9]+[[:space:]]+##' \
    | sed -E 's#-o[[:space:]]+[A-Za-z]+=[A-Za-z0-9]+[[:space:]]+##g' \
    | tr -s '[:space:]' ' ' \
    | sed -E 's#^ ##; s# $##')"
  del="-e '/^MIGRAPANEL_/d' -e '/^# MigraPanel/d'"
  f="/etc/migracms/migracms.env"
  [ "$norm" = "ssh migracms-core \"${ELEV} sed -i $del $f\"" ] && return 0
  [ "$norm" = "ssh migracms-core \"${ELEV} sed $del $f | sha256sum\"" ] && return 0
  return 1
}

migracms_authority_env() {
  local c="$1" reader="" writer="$1" relay=0

  # The two exact repair commands are judged first: they carry a remote pipe and
  # a `sed`, both of which the rules below refuse on purpose.
  migracms_env_exact_repair "$c" && return 0

  # 0. SECRET RELAY — the one permitted two-host shape is
  #      ssh migrapanel-core '<rename one key line>' | ssh migracms-core '<sink>'
  #    Exactly one pipe, each half judged under its own rule. Only two sinks may
  #    consume the piped secret: an APPEND that discards stdout, or a counting
  #    grep. Anything else could echo the value back into the transcript.
  if [[ "$c" == *"|"* ]]; then
    [ "$(printf '%s' "$c" | tr -cd '|' | wc -c)" -eq 1 ] || return 1
    reader="${c%%|*}"; writer="${c#*|}"; relay=1
    panel_token_reader "$reader" || return 1
    if [[ "$writer" == *"tee"* ]]; then
      [[ "$writer" == *"/dev/null"* ]] || return 1
    elif [[ "$writer" == *"grep"* ]]; then
      :
    else
      return 1
    fi
  fi

  # 1. HOST — migracms-core only. URL-stripped, so MIGRAPANEL_API_URL's value
  #    may legitimately name 10.10.0.7 without looking like a second hop.
  local bare
  bare="$(printf '%s' "$writer" | sed -E 's#[a-zA-Z][a-zA-Z0-9+.-]*://[^[:space:]"'"'"'\\]*##g')"
  [[ "$bare" == *"ssh "* ]] || return 1
  case "$bare" in *"migracms-core"*|*"10.10.0.16"*) : ;; *) return 1 ;; esac
  local _h="${bare//migracms-core/CMS}"; _h="${_h//10.10.0.16/CMS}"
  case "$_h" in
    *"-core"*|*"pct exec"*|*"qm guest exec"*|*"@10."*|*"@100."*) return 1 ;;
  esac
  edge_target "$c" && return 1

  # 2. NO READBACK OF SECRET VALUES. Every verb that could print the file is
  #    refused, and grep may only COUNT or TEST. Lower-cased first, so
  #    `--property=Environment` cannot slip past a lowercase-only match.
  local lw="${writer,,}"
  case "$lw" in
    *"cat "*|*"head "*|*"tail "*|*"less "*|*"more "*|*" od "*|*"xxd"*|*"base64"*|\
    *"strings "*|*"awk "*|*"cut "*|*"sed"*|*"printenv"*|*"environ"*|*"nl "*|\
    *"diff "*|*"vi "*|*"vim "*|*"nano"*|*"perl"*|*"python"*|*"xargs"*|*"/proc/"*) return 1 ;;
  esac
  if [[ "$writer" == *"grep"* ]]; then
    [[ "$writer" =~ grep[[:space:]]+(-[A-Za-z]+[[:space:]]+)*-?[A-Za-z]*[cq] ]] || return 1
  fi

  # 3. HARD DENY.
  case "$c" in
    *"rm "*|*"mkfs"*|*" dd "*|*"mv "*|*"cp "*|*"chown"*|*"chmod"*|*"ln -s"*|\
    *"truncate"*|*"shred"*|*"install "*|*"apt "*|*"apt-get"*|*"ufw "*|*"iptables"*|\
    *"nft "*|*"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*|*"reboot"*|\
    *"shutdown"*|*"passwd "*|*"usermod"*|*"gpasswd"*|*"curl"*|*"wget"*|*"scp "*|\
    *"rsync"*|*"ProxyCommand"*|*"LocalCommand"*|*"RemoteCommand"*|*"ProxyJump"*|\
    *"-J "*|*"PermitLocalCommand"*) return 1 ;;
  esac
  case "$writer" in *"*"*|*"?"*) return 1 ;; esac   # no wildcard paths

  # 4. NEVER REPLACE OR TRUNCATE. Appending is the only write shape: tee must
  #    carry -a, and no redirection may target anything but /dev/null.
  if [[ "$writer" == *"tee"* ]]; then
    [[ "$writer" =~ tee[[:space:]]+(-[A-Za-z]+[[:space:]]+)*-a|tee[[:space:]]+-[A-Za-z]*a ]] || return 1
  fi
  local redir
  while read -r redir; do
    [ -n "$redir" ] || continue
    case "$redir" in
      /dev/null) continue ;;
      # `2>&1` duplicates a descriptor; it is not a file write. Anything that
      # names a path -- including bash's `&>file` form -- still has to be
      # /dev/null, so this cannot be used to reach the env file.
      "&"[0-9]) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$writer" | grep -oE '>>?[[:space:]]*[^[:space:]'"'"'"]+' | sed -E 's#^>>?[[:space:]]*##' || true)

  # 5. PATH SCOPE — the env file, its directory, and the discard target. Nothing
  #    else may appear at all.
  local p
  while read -r p; do
    [ -n "$p" ] || continue
    case "$p" in
      /etc/migracms|/etc/migracms/migracms.env|/dev/null) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$bare" \
    | grep -oE '(^|[^A-Za-z0-9_.~-])/[A-Za-z0-9_./-]+' \
    | sed -E 's#^[^/]*##' \
    | grep -vE '^/(usr/)?(bin|sbin)/(tee|stat|grep|systemctl|test|wc|ls)$' || true)

  # 6. KEY SCOPE — any VARIABLE=... written or matched must be one of the four.
  local kv
  while read -r kv; do
    [ -n "$kv" ] || continue
    migracms_key_allowed "$kv" || return 1
  done < <(printf '%s\n' "$writer" | grep -oE '\b[A-Z][A-Z0-9_]{2,}=' | sed 's/=$//' || true)

  # 7. ELEVATED VERBS — append via tee, inspect via stat/grep/ls/wc, manage the
  #    unit. `install` is absent on purpose: it overwrites. No -u, so this grant
  #    can never run as another user.
  local v
  while read -r v; do
    [ -n "$v" ] || continue
    case "$v" in
      -n|--) continue ;;
      tee|stat|grep|systemctl|ls|wc) continue ;;
      *) return 1 ;;
    esac
  done < <(printf '%s\n' "$c" | grep -oE "${ELEV} +(-[A-Za-z-]+ +)*[A-Za-z0-9_./-]+" | awk '{print $NF}' || true)

  # 8. SYSTEMD SCOPE — the migracms unit only, never a destructive verb, and
  #    never a property query that could carry environment contents.
  if [[ "$c" == *"systemctl"* ]]; then
    [[ "$c" =~ systemctl[[:space:]]+(restart|status|is-active|show|cat)[[:space:]]+migracms([[:space:]]|\'|\"|$) ]] || return 1
    case "$lw" in *"disable"*|*"mask"*|*"stop "*|*"--property"*|*" -p "*|*"environment"*) return 1 ;; esac
  fi

  return 0
}
```
