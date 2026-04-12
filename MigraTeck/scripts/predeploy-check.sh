#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ "${LOAD_DOTENV:-true}" == "true" && -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

failures=0
warnings=0
require_production="${REQUIRE_PRODUCTION:-true}"
allow_wildcard_hosts="${ALLOW_WILDCARD_HOSTS:-false}"

pass() {
  printf '[PASS] %s\n' "$1"
}

warn() {
  printf '[WARN] %s\n' "$1"
  warnings=$((warnings + 1))
}

fail() {
  printf '[FAIL] %s\n' "$1"
  failures=$((failures + 1))
}

require_var() {
  local name="$1"
  if [[ -z "${!name:-}" ]]; then
    fail "${name} is required"
    return 1
  fi

  pass "${name} is set"
  return 0
}

require_secret_len() {
  local name="$1"
  local min_len="$2"
  local value="${!name:-}"

  if [[ -z "${value}" ]]; then
    fail "${name} is required"
    return
  fi

  if [[ ${#value} -lt ${min_len} ]]; then
    fail "${name} must be at least ${min_len} characters"
    return
  fi

  pass "${name} length is acceptable"
}

validate_origins() {
  local origins_csv="$1"

  node - "${origins_csv}" <<'NODE'
const raw = process.argv[2] || "";
const values = raw.split(",").map((item) => item.trim()).filter(Boolean);

if (values.length === 0) {
  process.exit(2);
}

for (const value of values) {
  if (value.includes("*")) {
    console.error(`Wildcard origin not allowed: ${value}`);
    process.exit(3);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    console.error(`Invalid origin URL: ${value}`);
    process.exit(4);
  }

  if (!(parsed.protocol === "http:" || parsed.protocol === "https:")) {
    console.error(`Invalid origin protocol: ${value}`);
    process.exit(5);
  }

  if (parsed.pathname !== "/" || parsed.search || parsed.hash) {
    console.error(`Origin must not include path/query/hash: ${value}`);
    process.exit(6);
  }
}
NODE
}

validate_hosts() {
  local hosts_csv="$1"
  local allow_wildcards="$2"

  node - "${hosts_csv}" "${allow_wildcards}" <<'NODE'
const raw = process.argv[2] || "";
const allowWildcards = process.argv[3] === "true";
const values = raw.split(",").map((item) => item.trim()).filter(Boolean);

if (values.length === 0) {
  process.exit(2);
}

for (const value of values) {
  let wildcardHost = false;

  if (value.includes("*")) {
    if (!allowWildcards) {
      console.error(`Wildcard host not allowed: ${value}`);
      process.exit(3);
    }

    if (!/^\*\.[a-zA-Z0-9.-]+(?::\d+)?$/.test(value)) {
      console.error(`Wildcard host must use *.example.com format: ${value}`);
      process.exit(6);
    }

    wildcardHost = true;
  }

  if (value.includes("://") || value.includes("/")) {
    console.error(`Host must be host[:port], not URL/path: ${value}`);
    process.exit(4);
  }

  if (!wildcardHost && !/^[a-zA-Z0-9.-]+(?::\d+)?$/.test(value)) {
    console.error(`Invalid host format: ${value}`);
    process.exit(5);
  }
}
NODE
}

validate_https_url() {
  local value="$1"
  local label="$2"

  node - "${value}" "${label}" <<'NODE'
const raw = process.argv[2] || "";
const label = process.argv[3] || "URL";

let parsed;
try {
  parsed = new URL(raw);
} catch {
  console.error(`${label} is not a valid URL: ${raw}`);
  process.exit(2);
}

if (parsed.protocol !== "https:") {
  console.error(`${label} must use https:// (${raw})`);
  process.exit(3);
}
NODE
}

check_db_indexes() {
  if [[ "${SKIP_DB_INDEX_CHECK:-false}" == "true" ]]; then
    warn "Skipping database index check (SKIP_DB_INDEX_CHECK=true)"
    return
  fi

  if [[ -z "${DATABASE_URL:-}" ]]; then
    warn "Skipping database index check (DATABASE_URL not set)"
    return
  fi

  if ! command -v node >/dev/null 2>&1; then
    warn "Skipping database index check (node not found)"
    return
  fi

  local output
  if ! output="$(cd "${ROOT_DIR}" && node <<'NODE' 2>&1
const { PrismaClient } = require("@prisma/client");

function hasColumns(indexDef, columns) {
  const compact = indexDef.replace(/\s+/g, " ").toLowerCase();
  const openParen = compact.lastIndexOf("(");
  const closeParen = compact.lastIndexOf(")");
  const columnSegment = openParen !== -1 && closeParen > openParen ? compact.slice(openParen + 1, closeParen) : compact;

  return columns.every((column) => {
    const target = column.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(`(^|[\\s,])"?${target}"?([\\s,]|$)`);
    return pattern.test(columnSegment);
  });
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL missing");
  }

  const schema = new URL(url).searchParams.get("schema") || "public";
  const prisma = new PrismaClient();

  try {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 AND tablename IN ($2, $3, $4)`,
      schema,
      "Session",
      "RateLimitEvent",
      "LaunchTokenNonce",
    );

    const byTable = rows.reduce((acc, row) => {
      const table = row.tablename;
      if (!acc[table]) {
        acc[table] = [];
      }
      acc[table].push(row.indexdef);
      return acc;
    }, {});

    const missing = [];

    const sessionIndexes = byTable.Session || [];
    if (!sessionIndexes.some((indexDef) => hasColumns(indexDef, ["userId", "expires"]))) {
      missing.push("Session(userId, expires)");
    }

    const rateIndexes = byTable.RateLimitEvent || [];
    if (!rateIndexes.some((indexDef) => hasColumns(indexDef, ["key", "createdAt"]))) {
      missing.push("RateLimitEvent(key, createdAt)");
    }

    const nonceIndexes = byTable.LaunchTokenNonce || [];
    if (!nonceIndexes.some((indexDef) => hasColumns(indexDef, ["nonceHash"]))) {
      missing.push("LaunchTokenNonce(nonceHash)");
    }
    if (!nonceIndexes.some((indexDef) => hasColumns(indexDef, ["expiresAt"]))) {
      missing.push("LaunchTokenNonce(expiresAt)");
    }

    if (missing.length > 0) {
      console.error(`MISSING:${missing.join(",")}`);
      process.exit(10);
    }

    console.log("INDEX_OK");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error.message || String(error));
  process.exit(1);
});
NODE
)"; then
    fail "Database index check failed: ${output}"
    return
  fi

  pass "Database indexes verified (${output})"
}

printf 'Running MigraTeck pre-deploy checks...\n'

if [[ "${NODE_ENV:-}" != "production" ]]; then
  if [[ "${require_production}" == "true" ]]; then
    fail "NODE_ENV must be 'production' (current: '${NODE_ENV:-unset}')"
  else
    warn "NODE_ENV is '${NODE_ENV:-unset}' (expected 'production' for deploy validation)"
  fi
else
  pass "NODE_ENV is production"
fi

require_secret_len "NEXTAUTH_SECRET" 32
require_secret_len "LAUNCH_TOKEN_SECRET" 32

if [[ -n "${NEXTAUTH_SECRET:-}" && -n "${LAUNCH_TOKEN_SECRET:-}" ]]; then
  if [[ "${NEXTAUTH_SECRET}" == "${LAUNCH_TOKEN_SECRET}" ]]; then
    fail "NEXTAUTH_SECRET and LAUNCH_TOKEN_SECRET must be different"
  else
    pass "NEXTAUTH_SECRET and LAUNCH_TOKEN_SECRET are distinct"
  fi
fi

require_var "DATABASE_URL"

if [[ -n "${DATABASE_URL_TEST:-}" ]]; then
  if [[ "${NODE_ENV:-}" == "production" ]]; then
    fail "DATABASE_URL_TEST must not be set in production runtime"
  else
    warn "DATABASE_URL_TEST is set (fine for non-production environments)"
  fi
else
  pass "DATABASE_URL_TEST is not set"
fi

if [[ -n "${DATABASE_URL:-}" && -n "${DATABASE_URL_TEST:-}" && "${DATABASE_URL}" == "${DATABASE_URL_TEST}" ]]; then
  fail "DATABASE_URL and DATABASE_URL_TEST must not match"
fi

if [[ "${NODE_ENV:-}" == "production" ]]; then
  if [[ -z "${BASE_URL:-}" ]]; then
    fail "BASE_URL must be set in production"
  elif validate_https_url "${BASE_URL}" "BASE_URL"; then
    pass "BASE_URL is a valid https URL"
  else
    fail "BASE_URL must be a valid https URL"
  fi

  if [[ -n "${NEXTAUTH_URL:-}" ]]; then
    if validate_https_url "${NEXTAUTH_URL}" "NEXTAUTH_URL"; then
      pass "NEXTAUTH_URL is a valid https URL"
    else
      fail "NEXTAUTH_URL must be a valid https URL in production"
    fi
  else
    warn "NEXTAUTH_URL is unset; set it explicitly in production for stable callback/cookie behavior"
  fi

  if [[ -n "${BASE_URL:-}" && -n "${NEXTAUTH_URL:-}" ]]; then
    base_host="$(node -e 'console.log(new URL(process.argv[1]).host)' "${BASE_URL}")"
    nextauth_host="$(node -e 'console.log(new URL(process.argv[1]).host)' "${NEXTAUTH_URL}")"
    if [[ "${base_host}" != "${nextauth_host}" ]]; then
      warn "BASE_URL host (${base_host}) differs from NEXTAUTH_URL host (${nextauth_host})"
    else
      pass "BASE_URL and NEXTAUTH_URL hosts are aligned"
    fi
  fi

  if [[ -z "${TRUST_PROXY_X_FORWARDED_PROTO:-}" ]]; then
    warn "Set TRUST_PROXY_X_FORWARDED_PROTO=true in deploy config docs and ensure proxy forwards X-Forwarded-Proto=https"
  else
    pass "TRUST_PROXY_X_FORWARDED_PROTO marker is set (${TRUST_PROXY_X_FORWARDED_PROTO})"
  fi

  if [[ -z "${SECURITY_ALLOWED_ORIGINS:-}" ]]; then
    fail "SECURITY_ALLOWED_ORIGINS must be set in production"
  elif validate_origins "${SECURITY_ALLOWED_ORIGINS}"; then
    pass "SECURITY_ALLOWED_ORIGINS is valid"
  else
    fail "SECURITY_ALLOWED_ORIGINS is invalid"
  fi

  if [[ -z "${SECURITY_ALLOWED_HOSTS:-}" ]]; then
    fail "SECURITY_ALLOWED_HOSTS must be set in production"
  elif validate_hosts "${SECURITY_ALLOWED_HOSTS}" "${allow_wildcard_hosts}"; then
    pass "SECURITY_ALLOWED_HOSTS is valid"
  else
    fail "SECURITY_ALLOWED_HOSTS is invalid"
  fi
else
  if [[ -n "${SECURITY_ALLOWED_ORIGINS:-}" ]]; then
    if validate_origins "${SECURITY_ALLOWED_ORIGINS}"; then
      pass "SECURITY_ALLOWED_ORIGINS is valid"
    else
      fail "SECURITY_ALLOWED_ORIGINS is invalid"
    fi
  else
    warn "SECURITY_ALLOWED_ORIGINS is unset"
  fi

  if [[ -n "${SECURITY_ALLOWED_HOSTS:-}" ]]; then
    if validate_hosts "${SECURITY_ALLOWED_HOSTS}" "${allow_wildcard_hosts}"; then
      pass "SECURITY_ALLOWED_HOSTS is valid"
    else
      fail "SECURITY_ALLOWED_HOSTS is invalid"
    fi
  else
    warn "SECURITY_ALLOWED_HOSTS is unset"
  fi
fi

if [[ "${NEXT_PUBLIC_ENABLE_MAGIC_LINKS:-false}" == "true" ]]; then
  missing_smtp=0
  for smtp_var in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM; do
    if [[ -z "${!smtp_var:-}" ]]; then
      fail "${smtp_var} must be set when NEXT_PUBLIC_ENABLE_MAGIC_LINKS=true"
      missing_smtp=1
    fi
  done

  if [[ ${missing_smtp} -eq 0 ]]; then
    pass "Magic-link SMTP configuration is complete"
  fi
else
  if [[ -n "${SMTP_HOST:-}${SMTP_PORT:-}${SMTP_USER:-}${SMTP_PASSWORD:-}${SMTP_FROM:-}" ]]; then
    warn "SMTP values are set while magic links are disabled"
  else
    pass "Magic links disabled and SMTP values not required"
  fi
fi

download_provider="${DOWNLOAD_STORAGE_PROVIDER:-}"
if [[ -z "${download_provider}" ]]; then
  if [[ "${NODE_ENV:-}" == "production" ]]; then
    fail "DOWNLOAD_STORAGE_PROVIDER must be set in production (allowed: s3|minio)"
  else
    warn "DOWNLOAD_STORAGE_PROVIDER is unset (non-production defaults to mock; production should set s3|minio)"
  fi
elif [[ "${download_provider}" != "s3" && "${download_provider}" != "minio" && "${download_provider}" != "mock" ]]; then
  fail "DOWNLOAD_STORAGE_PROVIDER must be one of: s3|minio|mock"
elif [[ "${NODE_ENV:-}" == "production" && "${download_provider}" == "mock" ]]; then
  fail "DOWNLOAD_STORAGE_PROVIDER=mock is not allowed in production"
else
  pass "DOWNLOAD_STORAGE_PROVIDER is set (${download_provider})"
fi

if [[ "${download_provider}" == "s3" || "${download_provider}" == "minio" ]]; then
  for storage_var in S3_ENDPOINT S3_REGION S3_BUCKET S3_ACCESS_KEY_ID S3_SECRET_ACCESS_KEY; do
    if [[ -z "${!storage_var:-}" ]]; then
      fail "${storage_var} must be set when DOWNLOAD_STORAGE_PROVIDER=${download_provider}"
    fi
  done
fi

if [[ -n "${DOWNLOAD_URL_TTL_SECONDS:-}" ]]; then
  if [[ "${DOWNLOAD_URL_TTL_SECONDS}" =~ ^[0-9]+$ ]] && [[ "${DOWNLOAD_URL_TTL_SECONDS}" -gt 0 ]]; then
    if [[ "${NODE_ENV:-}" == "production" ]]; then
      if [[ "${DOWNLOAD_URL_TTL_SECONDS}" -lt 60 || "${DOWNLOAD_URL_TTL_SECONDS}" -gt 3600 ]]; then
        fail "DOWNLOAD_URL_TTL_SECONDS must be between 60 and 3600 seconds in production"
      else
        pass "DOWNLOAD_URL_TTL_SECONDS is valid (${DOWNLOAD_URL_TTL_SECONDS})"
      fi
    else
      pass "DOWNLOAD_URL_TTL_SECONDS is valid (${DOWNLOAD_URL_TTL_SECONDS})"
    fi
  else
    fail "DOWNLOAD_URL_TTL_SECONDS must be a positive integer"
  fi
else
  if [[ "${NODE_ENV:-}" == "production" ]]; then
    fail "DOWNLOAD_URL_TTL_SECONDS must be set in production"
  else
    warn "DOWNLOAD_URL_TTL_SECONDS is unset (default 300 seconds)"
  fi
fi

if [[ "${ACCESS_REQUEST_NOTIFY_EMAIL:-false}" == "true" ]]; then
  if [[ -z "${ACCESS_REQUEST_NOTIFY_TO:-}" ]]; then
    fail "ACCESS_REQUEST_NOTIFY_TO must be set when ACCESS_REQUEST_NOTIFY_EMAIL=true"
  else
    pass "ACCESS_REQUEST_NOTIFY_TO is set"
  fi

  missing_notify_smtp=0
  for smtp_var in SMTP_HOST SMTP_PORT SMTP_USER SMTP_PASSWORD SMTP_FROM; do
    if [[ -z "${!smtp_var:-}" ]]; then
      fail "${smtp_var} must be set when ACCESS_REQUEST_NOTIFY_EMAIL=true"
      missing_notify_smtp=1
    fi
  done

  if [[ ${missing_notify_smtp} -eq 0 ]]; then
    pass "Access-request notification SMTP configuration is complete"
  fi
fi

if [[ "${STRIPE_BILLING_ENABLED:-false}" == "true" ]]; then
  if [[ -z "${STRIPE_SECRET_KEY:-}" ]]; then
    fail "STRIPE_SECRET_KEY must be set when STRIPE_BILLING_ENABLED=true"
  else
    if [[ "${STRIPE_SECRET_KEY}" == sk_test_* || "${STRIPE_SECRET_KEY}" == sk_live_* ]]; then
      pass "STRIPE_SECRET_KEY mode prefix is valid"
    else
      fail "STRIPE_SECRET_KEY must start with sk_test_ or sk_live_"
    fi
  fi

  if [[ -z "${STRIPE_WEBHOOK_SECRET:-}" ]]; then
    fail "STRIPE_WEBHOOK_SECRET must be set when STRIPE_BILLING_ENABLED=true"
  else
    pass "STRIPE_WEBHOOK_SECRET is set"
  fi

  if [[ -n "${STRIPE_WEBHOOK_TOLERANCE_SECONDS:-}" ]]; then
    if [[ "${STRIPE_WEBHOOK_TOLERANCE_SECONDS}" =~ ^[0-9]+$ ]] && [[ "${STRIPE_WEBHOOK_TOLERANCE_SECONDS}" -gt 0 ]]; then
      pass "STRIPE_WEBHOOK_TOLERANCE_SECONDS is valid (${STRIPE_WEBHOOK_TOLERANCE_SECONDS})"
    else
      fail "STRIPE_WEBHOOK_TOLERANCE_SECONDS must be a positive integer"
    fi
  else
    warn "STRIPE_WEBHOOK_TOLERANCE_SECONDS is unset (default 300 seconds)"
  fi

  if [[ "${NODE_ENV:-}" == "production" && "${STRIPE_SECRET_KEY:-}" == sk_test_* ]]; then
    fail "STRIPE_SECRET_KEY must be a live key (sk_live_) in production"
  fi
else
  if [[ -n "${STRIPE_SECRET_KEY:-}${STRIPE_WEBHOOK_SECRET:-}" ]]; then
    warn "Stripe secrets are set while STRIPE_BILLING_ENABLED=false"
  fi
fi

if [[ -n "${PROVISIONING_ENGINE_MAX_ATTEMPTS:-}" ]]; then
  if [[ "${PROVISIONING_ENGINE_MAX_ATTEMPTS}" =~ ^[0-9]+$ ]] && [[ "${PROVISIONING_ENGINE_MAX_ATTEMPTS}" -gt 0 ]]; then
    pass "PROVISIONING_ENGINE_MAX_ATTEMPTS is valid (${PROVISIONING_ENGINE_MAX_ATTEMPTS})"
  else
    fail "PROVISIONING_ENGINE_MAX_ATTEMPTS must be a positive integer"
  fi
fi

if [[ -z "${JOB_ENVELOPE_SIGNING_SECRET:-}" ]]; then
  if [[ "${NODE_ENV:-}" == "production" ]]; then
    fail "JOB_ENVELOPE_SIGNING_SECRET must be set in production"
  else
    warn "JOB_ENVELOPE_SIGNING_SECRET is unset (set for tamper-resistant signed jobs)"
  fi
elif [[ ${#JOB_ENVELOPE_SIGNING_SECRET} -lt 32 ]]; then
  fail "JOB_ENVELOPE_SIGNING_SECRET must be at least 32 characters"
else
  pass "JOB_ENVELOPE_SIGNING_SECRET length is acceptable"
fi

if [[ -n "${PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS:-}" ]]; then
  if [[ "${PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS}" =~ ^[0-9]+$ ]] && [[ "${PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS}" -gt 0 ]]; then
    pass "PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS is valid (${PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS})"
  else
    fail "PROVISIONING_JOB_DEFAULT_MAX_ATTEMPTS must be a positive integer"
  fi
fi

if [[ -n "${PROVISIONING_JOB_BACKOFF_BASE_SECONDS:-}" ]]; then
  if [[ "${PROVISIONING_JOB_BACKOFF_BASE_SECONDS}" =~ ^[0-9]+$ ]] && [[ "${PROVISIONING_JOB_BACKOFF_BASE_SECONDS}" -gt 0 ]]; then
    pass "PROVISIONING_JOB_BACKOFF_BASE_SECONDS is valid (${PROVISIONING_JOB_BACKOFF_BASE_SECONDS})"
  else
    fail "PROVISIONING_JOB_BACKOFF_BASE_SECONDS must be a positive integer"
  fi
fi

if [[ -n "${STEP_UP_TIER2:-}" ]]; then
  if [[ "${STEP_UP_TIER2}" == "NONE" || "${STEP_UP_TIER2}" == "REAUTH" || "${STEP_UP_TIER2}" == "TOTP" || "${STEP_UP_TIER2}" == "PASSKEY" ]]; then
    pass "STEP_UP_TIER2 is valid (${STEP_UP_TIER2})"
  else
    fail "STEP_UP_TIER2 must be one of: NONE|REAUTH|TOTP|PASSKEY"
  fi
fi

if [[ "${STEP_UP_TIER2:-NONE}" == "TOTP" ]]; then
  if [[ -z "${STEP_UP_TOTP_ENCRYPTION_KEY:-}" ]]; then
    fail "STEP_UP_TOTP_ENCRYPTION_KEY must be set when STEP_UP_TIER2=TOTP"
  else
    pass "STEP_UP_TOTP_ENCRYPTION_KEY is set"
  fi
fi

if [[ -n "${OPS_ALERT_WEBHOOK_URL:-}" ]]; then
  if node -e 'new URL(process.argv[1]);' "${OPS_ALERT_WEBHOOK_URL}" >/dev/null 2>&1; then
    pass "OPS_ALERT_WEBHOOK_URL is a valid URL"
  else
    fail "OPS_ALERT_WEBHOOK_URL must be a valid URL"
  fi
fi

for threshold_var in OPS_ALERT_WEBHOOK_FAILURE_THRESHOLD OPS_ALERT_QUEUE_STUCK_SECONDS OPS_ALERT_RETRY_THRESHOLD OPS_ALERT_AUTO_RESTRICT_BURST_THRESHOLD OPS_ALERT_LOCKDOWN_BLOCK_BURST_THRESHOLD; do
  if [[ -n "${!threshold_var:-}" ]]; then
    if [[ "${!threshold_var}" =~ ^[0-9]+$ ]] && [[ "${!threshold_var}" -gt 0 ]]; then
      pass "${threshold_var} is valid (${!threshold_var})"
    else
      fail "${threshold_var} must be a positive integer"
    fi
  fi
done

check_db_indexes

if REQUIRE_DATABASE_URL=true bash "${ROOT_DIR}/scripts/prisma-verify.sh"; then
  pass "Prisma migration verification passed"
else
  fail "Prisma migration verification failed"
fi

printf '\nSummary: %d failure(s), %d warning(s)\n' "${failures}" "${warnings}"

if [[ ${failures} -gt 0 ]]; then
  exit 1
fi
