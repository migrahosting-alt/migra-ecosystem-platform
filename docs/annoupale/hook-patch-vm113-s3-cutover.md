# Scoped exception — VM 113 S3 namespace switch (private validation only)

Requested 2026-09-05, for steps 8–11 of the S3 isolation sequence:
point **VM 113 only** at the new `annoupale` bucket + `annoupale_app_storage`
identity, then test media read, write and a single dedicated-object delete.

Narrower than the deployment grant it replaces: **no docker, no git, no builds.**
Only the annoupale service account, only `/opt/annoupale`, only VM 113.

The new S3 secret is transferred cloud-core → VM 113 by pipe and is never
displayed, so the rule permits `S3_SECRET_ACCESS_KEY` only as a shell
substitution or via stdin, and denies a hand-typed literal — the same shape as
the Pale-secret rule Bonex approved earlier.

```bash
vm113_annoupale_s3_cutover() {
  local c="$1"

  # 1. HOST — VM 113 only. cloud-core is permitted ONLY as a pipe source for
  #    the secret handover, never as an elevation target (rule 6 enforces that).
  [[ "$c" == *"ssh "* ]] || return 1
  [[ "$c" == *"bonex@10.10.0.15"* ]] || return 1
  case "$c" in
    *"root@10.10.0.15"*|*"app-core"*|*"db-core"*|*"nginx-proxy-core"*|\
    *"migrapilot"*|*"pct exec"*|*"@10.10.0.1"[0-4]*|*"@138.201"*) return 1 ;;
  esac

  # 2. PALE — neutralise our own product name first, then anything still
  #    matching a Pale form is genuinely Pale.
  local _p="${c//annoupale/OURS}"
  case "$_p" in
    *"/opt/pale/"*|*"/opt/pale "*|*"pale-api"*|*"pale-livekit"*|\
    *"internal.pale.app"*) return 1 ;;
  esac
  case "$_p" in
    *"PALE_INTERNAL_API_SECRET="*) return 1 ;;
  esac

  # 3. THE OLD BUCKET IS READ-ONLY AND OFF-LIMITS FROM VM 113.
  #    VM 110 keeps the old bucket until public cutover; the candidate must
  #    never name it, so no candidate operation can write or delete there.
  case "$_p" in
    *"S3_BUCKET=pale"*|*"/pale/"*|*"local/pale"*|*"aptest/pale"*) return 1 ;;
  esac

  # 4. THE NEW SECRET MAY NEVER BE TYPED AS A LITERAL.
  #    A substitution or a stdin read cannot be a value pasted by the agent.
  case "$c" in
    *"S3_SECRET_ACCESS_KEY="'$'*) : ;;
    *"S3_SECRET_ACCESS_KEY=\""'$'*) : ;;
    *"S3_SECRET_ACCESS_KEY="*) return 1 ;;
  esac

  # 5. HARD DENY — absolutes and everything outside this scope.
  case "$c" in
    *"mkfs"*|*"dd if="*|*" fdisk"*|*"parted"*)                        return 1 ;;
    *"/etc/ssh"*|*"sshd"*|*"authorized_keys"*|*"visudo"*)             return 1 ;;
    *"ufw "*|*"iptables"*|*"nft "*|*"firewall-cmd"*)                  return 1 ;;
    *"nginx"*|*"named"*|*"bind9"*|*"/etc/hosts"*)                     return 1 ;;
    *"reboot"*|*"shutdown"*|*"init 0"*|*"init 6"*)                    return 1 ;;
    *"passwd "*|*"usermod"*|*"gpasswd"*|*"adduser"*|*"useradd"*)      return 1 ;;
    *"apt "*|*"apt-get"*|*"yum "*|*"dnf "*)                           return 1 ;;
    *"docker"*|*"git "*|*"npm "*|*"nest build"*|*"next build"*)       return 1 ;;
    *"postgresql.conf"*|*"pg_hba.conf"*)                              return 1 ;;
    *"livekit"*|*"mc admin"*|*"mc anonymous"*|*"mc mb"*|*"mc rb"*)    return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  # 6. ELEVATION TARGET — the annoupale service account only. No docker.
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} -u annoupale"*|*"${ELEV} -n -u annoupale"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 7. PM2 — only AnnouPale-named processes, restart/status only.
  if [[ "$c" == *"pm2"* ]]; then
    case "$c" in
      *"pm2 list"*|*"pm2 jlist"*|*"pm2 logs"*|*"pm2 describe"*) : ;;
      *"pm2 restart"*|*"pm2 stop"*|*"pm2 start"*)
        [[ "$c" == *"annoupale-"* ]] || return 1 ;;
      *) return 1 ;;
    esac
    case "$c" in *"pm2 kill"*|*"pm2 delete"*|*"pm2 unstartup"*) return 1 ;; esac
  fi

  # 8. FILESYSTEM SCOPE — every write path must be AnnouPale's own.
  case "$c" in
    *"tee "*|*"chmod"*|*"chown"*|*"install "*|*" > "*|*" >> "*|*"cp "*|\
    *"mv "*|*"sed -i"*|*"mkdir"*|*"shred"*|*"truncate"*)
      case "$c" in
        *"/opt/annoupale"*) : ;;
        *) return 1 ;;
      esac ;;
  esac

  return 0
}
```

Dispatch line:

```bash
  elif vm113_annoupale_s3_cutover "$CMD"; then
    : # permitted: VM113 S3 namespace switch, per Bonex 2026-09-05.
      # TEMPORARY — remove with the function once media validation is complete.
```

**Removed immediately after step 11 (media read / write / single-object delete)
is verified.**
