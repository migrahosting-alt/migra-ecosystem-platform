#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE_URL="${BASE_URL:-}"
ORIGIN="${ORIGIN:-}"
SMOKE_USE_SMTP="${SMOKE_USE_SMTP:-false}"
SMOKE_VERIFY_TOKEN="${SMOKE_VERIFY_TOKEN:-}"
SMOKE_VERIFY_TOKEN_CMD="${SMOKE_VERIFY_TOKEN_CMD:-}"
SMOKE_EXPECT_SIGNUP_DISABLED="${SMOKE_EXPECT_SIGNUP_DISABLED:-false}"
SMOKE_PROBE_REQUEST_ACCESS="${SMOKE_PROBE_REQUEST_ACCESS:-true}"
SMOKE_PROBE_ENTITLEMENT="${SMOKE_PROBE_ENTITLEMENT:-false}"
SMOKE_PROBE_AUDIT_EXPORT="${SMOKE_PROBE_AUDIT_EXPORT:-false}"

if [[ "${LOAD_DOTENV:-true}" == "true" && -f "${ROOT_DIR}/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ROOT_DIR}/.env"
  set +a
fi

BASE_URL="${BASE_URL:-}"
ORIGIN="${ORIGIN:-${BASE_URL%/}}"

if [[ -z "${BASE_URL}" ]]; then
  echo "BASE_URL is required (example: https://migrateck.com)"
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required to run DB-backed smoke steps"
  exit 1
fi

BASE_URL="${BASE_URL%/}"

tmpdir="$(mktemp -d)"
trap 'rm -rf "${tmpdir}"' EXIT

cookie_a="${tmpdir}/cookie-a.txt"
cookie_b="${tmpdir}/cookie-b.txt"

request_json() {
  local method="$1"
  local path="$2"
  local json_payload="$3"
  local cookie_file="$4"
  local origin_header="$5"
  local out_body="$6"
  local out_headers="$7"

  local -a cmd=(curl -sS -o "${out_body}" -D "${out_headers}" -w "%{http_code}" -X "${method}" "${BASE_URL}${path}")

  if [[ -n "${origin_header}" ]]; then
    cmd+=(-H "origin: ${origin_header}" -H "referer: ${origin_header}/")
  fi

  if [[ -n "${json_payload}" ]]; then
    cmd+=(-H "content-type: application/json" --data "${json_payload}")
  fi

  if [[ -n "${cookie_file}" ]]; then
    cmd+=(-b "${cookie_file}" -c "${cookie_file}")
  fi

  "${cmd[@]}"
}

json_expr() {
  local file_path="$1"
  local expression="$2"

  node - "${file_path}" "${expression}" <<'NODE'
const fs = require("fs");
const filePath = process.argv[2];
const expression = process.argv[3];
const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
const result = Function("data", `return (${expression});`)(data);
if (result === undefined || result === null) {
  process.exit(3);
}
if (typeof result === "object") {
  process.stdout.write(JSON.stringify(result));
} else {
  process.stdout.write(String(result));
}
NODE
}

assert_status() {
  local got="$1"
  local expected="$2"
  local label="$3"

  if [[ "${got}" != "${expected}" ]]; then
    echo "[FAIL] ${label}: expected ${expected}, got ${got}"
    exit 1
  fi

  echo "[PASS] ${label}: ${got}"
}

db_user_id_by_email() {
  local email="$1"

  cd "${ROOT_DIR}"
  node - "${email}" <<'NODE'
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const email = process.argv[2];
    const user = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });

    if (!user) {
      process.exit(2);
    }

    process.stdout.write(user.id);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => process.exit(1));
NODE
}

db_insert_verification_token() {
  local user_id="$1"
  local token="$2"

  cd "${ROOT_DIR}"
  node - "${user_id}" "${token}" <<'NODE'
const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const userId = process.argv[2];
    const token = process.argv[3];

    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");

    await prisma.emailVerificationToken.create({
      data: {
        userId,
        tokenHash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => process.exit(1));
NODE
}

db_seed_verified_user_with_org() {
  local email="$1"
  local password="$2"
  local org_name="$3"
  local org_slug="$4"

  cd "${ROOT_DIR}"
  SMOKE_EMAIL="${email}" \
  SMOKE_PASSWORD="${password}" \
  SMOKE_ORG_NAME="${org_name}" \
  SMOKE_ORG_SLUG="${org_slug}" \
  node <<'NODE'
const argon2 = require("argon2");
const { PrismaClient, OrgRole } = require("@prisma/client");

const ARGON_CONFIG = {
  type: argon2.argon2id,
  memoryCost: 19456,
  timeCost: 2,
  parallelism: 1,
};

async function main() {
  const prisma = new PrismaClient();
  try {
    const email = process.env.SMOKE_EMAIL;
    const password = process.env.SMOKE_PASSWORD;
    const orgName = process.env.SMOKE_ORG_NAME;
    const orgSlug = process.env.SMOKE_ORG_SLUG;

    if (!email || !password || !orgName || !orgSlug) {
      process.exit(2);
    }

    const passwordHash = await argon2.hash(password, ARGON_CONFIG);

    const user = await prisma.user.create({
      data: {
        name: "Smoke User",
        email,
        passwordHash,
        emailVerified: new Date(),
      },
    });

    const org = await prisma.organization.create({
      data: {
        name: orgName,
        slug: orgSlug,
        createdById: user.id,
      },
    });

    await prisma.membership.create({
      data: {
        userId: user.id,
        orgId: org.id,
        role: OrgRole.OWNER,
      },
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { defaultOrgId: org.id },
    });

    process.stdout.write(JSON.stringify({ userId: user.id, orgId: org.id }));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => process.exit(1));
NODE
}

resolve_verification_token() {
  local email="$1"

  if [[ "${SMOKE_USE_SMTP}" != "true" ]]; then
    echo "${verify_token}"
    return 0
  fi

  if [[ -n "${SMOKE_VERIFY_TOKEN}" ]]; then
    echo "${SMOKE_VERIFY_TOKEN}"
    return 0
  fi

  if [[ -n "${SMOKE_VERIFY_TOKEN_CMD}" ]]; then
    local token_output
    if ! token_output="$(SMOKE_EMAIL="${email}" bash -lc "${SMOKE_VERIFY_TOKEN_CMD}")"; then
      echo "[FAIL] SMOKE_VERIFY_TOKEN_CMD failed"
      exit 1
    fi

    token_output="$(printf '%s' "${token_output}" | tr -d '[:space:]')"
    if [[ -z "${token_output}" ]]; then
      echo "[FAIL] SMOKE_VERIFY_TOKEN_CMD returned empty token"
      exit 1
    fi

    echo "${token_output}"
    return 0
  fi

  echo "[FAIL] SMOKE_USE_SMTP=true requires SMOKE_VERIFY_TOKEN or SMOKE_VERIFY_TOKEN_CMD"
  echo "       Example: SMOKE_VERIFY_TOKEN_CMD='your-mail-sink-cli --email \"\$SMOKE_EMAIL\"'"
  exit 1
}

db_activate_entitlement() {
  local org_id="$1"

  cd "${ROOT_DIR}"
  node - "${org_id}" <<'NODE'
const { PrismaClient } = require("@prisma/client");

async function main() {
  const prisma = new PrismaClient();
  try {
    const orgId = process.argv[2];

    await prisma.orgEntitlement.upsert({
      where: {
        orgId_product: {
          orgId,
          product: "MIGRAPILOT",
        },
      },
      update: {
        status: "ACTIVE",
      },
      create: {
        orgId,
        product: "MIGRAPILOT",
        status: "ACTIVE",
      },
    });
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(() => process.exit(1));
NODE
}

suffix="$(date +%s)-${RANDOM}"
email="smoke-${suffix}@example.com"
password="Sm0ke!${suffix}Pass123"
org_name="Smoke Org ${suffix}"
verify_token="smoke-verify-token-${suffix}-abcdef1234567890"

body_file="${tmpdir}/body.json"
headers_file="${tmpdir}/headers.txt"

echo "Running smoke flow against ${BASE_URL}"

status="$(request_json "GET" "/api/auth/csrf" "" "" "" "${body_file}" "${headers_file}")"
assert_status "${status}" "200" "auth csrf probe"

if [[ "${SMOKE_EXPECT_SIGNUP_DISABLED}" == "true" ]]; then
  status="$(request_json "POST" "/api/auth/signup" "{\"name\":\"Smoke User\",\"email\":\"${email}\",\"password\":\"${password}\",\"organizationName\":\"${org_name}\"}" "" "${ORIGIN}" "${body_file}" "${headers_file}")"
  assert_status "${status}" "403" "signup blocked in closed-signup posture"

  disabled_message="$(json_expr "${body_file}" 'data.error')"
  if [[ "${disabled_message}" != "Public signup is currently disabled. Request access from platform operations." ]]; then
    echo "[FAIL] unexpected closed-signup response: ${disabled_message}"
    exit 1
  fi
  echo "[PASS] closed-signup response matches expected production posture"

  seed_result="$(db_seed_verified_user_with_org "${email}" "${password}" "${org_name}" "smoke-org-${suffix}")"
  user_id="$(printf '%s' "${seed_result}" | node -e 'const data = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(data.userId);')"
  seeded_org_id="$(printf '%s' "${seed_result}" | node -e 'const data = JSON.parse(require("fs").readFileSync(0, "utf8")); process.stdout.write(data.orgId);')"
  if [[ -z "${user_id}" || -z "${seeded_org_id}" ]]; then
    echo "[FAIL] could not seed verified user for closed-signup smoke flow"
    exit 1
  fi
  echo "[PASS] verified user seeded for closed-signup smoke flow (${user_id})"
else
  status="$(request_json "POST" "/api/auth/signup" "{\"name\":\"Smoke User\",\"email\":\"${email}\",\"password\":\"${password}\",\"organizationName\":\"${org_name}\"}" "" "${ORIGIN}" "${body_file}" "${headers_file}")"
  assert_status "${status}" "200" "signup"

  user_id="$(db_user_id_by_email "${email}")"
  if [[ -z "${user_id}" ]]; then
    echo "[FAIL] could not resolve user id after signup"
    exit 1
  fi
  echo "[PASS] user created (${user_id})"

  if [[ "${SMOKE_USE_SMTP}" == "true" ]]; then
    echo "[INFO] SMTP mode enabled; waiting for token from configured source"
  else
    db_insert_verification_token "${user_id}" "${verify_token}"
    echo "[PASS] verification token inserted (DB-assisted mode)"
  fi

  verification_token="$(resolve_verification_token "${email}")"
  if [[ -z "${verification_token}" ]]; then
    echo "[FAIL] verification token could not be resolved"
    exit 1
  fi
  echo "[PASS] verification token resolved"

  status="$(request_json "POST" "/api/auth/verify-email" "{\"token\":\"${verification_token}\"}" "" "${ORIGIN}" "${body_file}" "${headers_file}")"
  assert_status "${status}" "200" "verify-email"
fi

status="$(request_json "POST" "/api/auth/login" "{\"email\":\"${email}\",\"password\":\"${password}\"}" "${cookie_a}" "${ORIGIN}" "${body_file}" "${headers_file}")"
assert_status "${status}" "200" "login session A"

cache_control="$(grep -i '^cache-control:' "${headers_file}" | tr -d '\r' | awk -F': ' '{print $2}')"
if [[ "${cache_control}" != *"no-store"* ]]; then
  echo "[FAIL] login cache-control missing no-store"
  exit 1
fi
echo "[PASS] login cache-control includes no-store"

status="$(request_json "POST" "/api/auth/refresh" "{}" "${cookie_a}" "${ORIGIN}" "${body_file}" "${headers_file}")"
assert_status "${status}" "200" "refresh session A"

status="$(request_json "GET" "/api/orgs" "" "${cookie_a}" "" "${body_file}" "${headers_file}")"
assert_status "${status}" "200" "orgs with session A"

org_id="$(json_expr "${body_file}" 'data.memberships[0].orgId')"
if [[ -z "${org_id}" ]]; then
  echo "[FAIL] unable to resolve org id"
  exit 1
fi
echo "[PASS] active org resolved (${org_id})"

if [[ "${SMOKE_PROBE_REQUEST_ACCESS}" == "true" ]]; then
  status="$(request_json "POST" "/api/products/request-access" "{\"orgId\":\"${org_id}\",\"product\":\"MIGRAVOICE\",\"message\":\"smoke probe\"}" "${cookie_a}" "${ORIGIN}" "${body_file}" "${headers_file}")"
  assert_status "${status}" "201" "request-access probe"
fi

if [[ "${SMOKE_PROBE_ENTITLEMENT}" == "true" ]]; then
  status="$(request_json "PUT" "/api/orgs/${org_id}/entitlements" "{\"product\":\"MIGRAPILOT\",\"status\":\"TRIAL\",\"notes\":\"smoke-probe\"}" "${cookie_a}" "${ORIGIN}" "${body_file}" "${headers_file}")"
  assert_status "${status}" "200" "entitlement update probe"
fi

if [[ "${SMOKE_PROBE_AUDIT_EXPORT}" == "true" ]]; then
  status="$(request_json "GET" "/api/audit/export?orgId=${org_id}&format=json" "" "${cookie_a}" "" "${body_file}" "${headers_file}")"
  assert_status "${status}" "200" "audit export probe"
fi

status="$(request_json "POST" "/api/auth/login" "{\"email\":\"${email}\",\"password\":\"${password}\"}" "${cookie_b}" "${ORIGIN}" "${body_file}" "${headers_file}")"
assert_status "${status}" "200" "login session B"

status="$(request_json "POST" "/api/auth/logout-all" "{}" "${cookie_a}" "${ORIGIN}" "${body_file}" "${headers_file}")"
assert_status "${status}" "200" "logout-all"

status="$(request_json "GET" "/api/orgs" "" "${cookie_b}" "" "${body_file}" "${headers_file}")"
assert_status "${status}" "401" "session B invalidated after logout-all"

status="$(request_json "POST" "/api/auth/refresh" "{}" "${cookie_b}" "${ORIGIN}" "${body_file}" "${headers_file}")"
assert_status "${status}" "401" "refresh session B invalidated after logout-all"

status="$(request_json "POST" "/api/auth/login" "{\"email\":\"${email}\",\"password\":\"${password}\"}" "${cookie_a}" "${ORIGIN}" "${body_file}" "${headers_file}")"
assert_status "${status}" "200" "login session A after logout-all"

status="$(request_json "POST" "/api/products/launch" "{\"product\":\"MIGRAPILOT\"}" "${cookie_a}" "${ORIGIN}" "${body_file}" "${headers_file}")"
assert_status "${status}" "403" "launch denied without entitlement"

db_activate_entitlement "${org_id}"
echo "[PASS] MIGRAPILOT entitlement activated"

status="$(request_json "POST" "/api/products/launch" "{\"product\":\"MIGRAPILOT\"}" "${cookie_a}" "${ORIGIN}" "${body_file}" "${headers_file}")"
assert_status "${status}" "200" "launch allowed with entitlement"

launch_url="$(json_expr "${body_file}" 'data.launchUrl')"
if [[ -z "${launch_url}" ]]; then
  echo "[FAIL] launchUrl missing in launch response"
  exit 1
fi
echo "[PASS] launch URL issued"

status="$(request_json "POST" "/api/orgs/switch" "{\"orgId\":\"${org_id}\"}" "${cookie_a}" "https://evil.example" "${body_file}" "${headers_file}")"
assert_status "${status}" "403" "csrf deny on wrong origin"

echo "Smoke flow completed successfully"
