# Scoped exception — read ONE validation OTP from Redis on VM 113

Requested 2026-09-05 during the browser user test. The candidate's OTP screen is
open for `+15550001111`; the validation adapter wrote the code to Redis and sends
no SMS, so the only way to continue the sign-in is to read that key on the host.

Target key: `otpval:7a8e1bad42416f9a364e27b5494f2499090def39371344dfe39915f3c5dd1a75`
(= `sha256("+15550001111")`, computed locally — the adapter never stores the
number itself).

This is the narrowest rule in the migration: it permits **nothing except a read
of the `otpval:` namespace**. Any command that does not invoke `redis-cli`
against an `otpval:` key is denied outright by rule 2's catch-all.

```bash
vm113_annoupale_otp_read() {
  local c="$1"

  # 1. HOST — VM 113 only, by either its vmbr10 or tailnet address.
  [[ "$c" == *"ssh "* ]] || return 1
  case "$c" in
    *"bonex@10.10.0.15"*|*"bonex@100.72.225.113"*) : ;;
    *) return 1 ;;
  esac
  case "$c" in
    *"root@"*|*"app-core"*|*"db-core"*|*"cloud-core"*|*"nginx-proxy-core"*|\
    *"migrapilot"*|*"pct exec"*|*"qm "*) return 1 ;;
  esac

  # 2. THE ONLY PERMITTED OPERATION — GET or TTL of ONE exact key.
  #    Bonex pinned the exact key rather than the namespace, so no other
  #    otpval:* entry (including the second test number's) can be read.
  case "$c" in
    *"redis-cli"*)
      [[ "$c" == *"otpval:7a8e1bad42416f9a364e27b5494f2499090def39371344dfe39915f3c5dd1a75"* ]] || return 1
      case "$c" in
        *" GET "*|*" TTL "*) : ;;
        *) return 1 ;;
      esac ;;
    *) return 1 ;;
  esac

  # 3. NO MUTATION, NO ENUMERATION, NO ADMIN — belt and braces on top of rule 2.
  case "$c" in
    *"FLUSHALL"*|*"FLUSHDB"*|*" SET "*|*" DEL "*|*" KEYS"*|*" SCAN"*|\
    *"CONFIG"*|*"MONITOR"*|*"SHUTDOWN"*|*"DEBUG"*|*"MIGRATE"*|*"REPLICAOF"*|\
    *"SLAVEOF"*|*"ACL "*|*"CLIENT "*|*"--rdb"*|*"--pipe"*) return 1 ;;
  esac

  # 4. NO CONFIG WRITES. Reading REDIS_URL is required to authenticate to Redis;
  #    assigning it, or naming any other secret, is not.
  case "$c" in
    *"REDIS_URL="*|*"DATABASE_URL="*|*"S3_"*"="*|*"JWT_SECRET="*|\
    *"REFRESH_TOKEN_SECRET="*|*"db.pw"*|*"PALE_"*) return 1 ;;
  esac

  # 5. ELEVATION TARGET — the annoupale service account only.
  if [[ "$c" == *"${ELEV} "* ]]; then
    case "$c" in
      *"${ELEV} -u annoupale"*|*"${ELEV} -n -u annoupale"*) : ;;
      *) return 1 ;;
    esac
  fi

  # 6. ABSOLUTES — no writes, no other tooling, no lifecycle control.
  case "$c" in
    *"rm "*|*" > "*|*" >> "*|*"tee "*|*"sed -i"*|*"chmod"*|*"chown"*|\
    *"docker"*|*"git "*|*"npm "*|*"pm2"*|*"psql"*|*"mc "*|*"tailscale"*|\
    *"reboot"*|*"shutdown"*|*"systemctl"*|*"apt"*) return 1 ;;
  esac
  [[ "$c" == *"-rf"* || "$c" == *"-fr"* ]] && return 1

  return 0
}
```

Dispatch line:

```bash
  elif vm113_annoupale_otp_read "$CMD"; then
    : # permitted: read one validation OTP during the user test, per Bonex 2026-09-05.
      # TEMPORARY — remove once the user test is complete.
```

The single command it admits, in shape (elevation shown as `<ELEV>` so this
document is not itself a runnable privileged command):

```text
ssh bonex@100.72.225.113 '<ELEV> -n -u annoupale bash -lc "
  set -a; . /opt/annoupale/config/api.env; set +a;
  X=${REDIS_URL#redis://:};
  redis-cli -h 127.0.0.1 -p 6379 -a \"${X%@*}\" --no-auth-warning
    GET otpval:7a8e1bad42416f9a364e27b5494f2499090def39371344dfe39915f3c5dd1a75"'
```

It prints a 6-digit code that expires in 10 minutes and is single-use.

**Removed as soon as the user test is finished.**
