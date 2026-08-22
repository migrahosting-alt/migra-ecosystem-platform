#!/bin/bash
#
# Provision the Brain's dedicated PostgreSQL database.
#
# RUN THIS ON db-core AS A USER WITH sudo. The agent cannot: its hook permits
# elevation only through the migrapilot-app-core alias, and db-core is outside
# that scope.
#
# The password is generated ON THIS HOST and never printed. It goes straight
# into a root-only DSN file, which is then piped into the Brain's env without
# passing through anyone's terminal.
#
#   scp docs/migrapilot/provision-brain-postgres.sh db-core:/tmp/
#   ssh db-core 'chmod +x /tmp/provision-brain-postgres.sh && sudo /tmp/provision-brain-postgres.sh'
#
# Then, to install it into the Brain env (also never printing the value):
#
#   ssh db-core 'sudo cat /root/.migrapilot_brain_dsn' \
#     | ssh migrapilot-app-core 'sudo tee -a /etc/migrapilot/brain.env | wc -c'
#
set -euo pipefail

DSN_FILE=/root/.migrapilot_brain_dsn
DB_HOST=100.77.51.91   # db-core, tailnet
DB_NAME=migrapilot_brain
DB_ROLE=migrapilot_brain

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_ROLE}'" | grep -q 1; then
  echo "role ${DB_ROLE} already exists — refusing to recreate or reset its password"
  exit 0
fi

# URL-safe: the value goes into a connection string, so characters that would
# need percent-encoding are excluded rather than escaped later.
PW="$(openssl rand -base64 48 | tr -d '\n=+/' | cut -c1-40)"

sudo -u postgres psql -v ON_ERROR_STOP=1 -q <<SQL
CREATE ROLE ${DB_ROLE}
  LOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  PASSWORD '${PW}';

CREATE DATABASE ${DB_NAME} OWNER ${DB_ROLE};

-- The Console's runtime role gets nothing here just because both are MigraPilot
-- products. The existing Prisma-managed \`migrapilot\` database is untouched.
REVOKE ALL ON DATABASE ${DB_NAME} FROM PUBLIC;
GRANT CONNECT ON DATABASE ${DB_NAME} TO ${DB_ROLE};
SQL

sudo -u postgres psql -v ON_ERROR_STOP=1 -q -d "${DB_NAME}" <<SQL
REVOKE ALL ON SCHEMA public FROM PUBLIC;
ALTER SCHEMA public OWNER TO ${DB_ROLE};
GRANT USAGE, CREATE ON SCHEMA public TO ${DB_ROLE};
SQL

printf 'MIGRAPILOT_BRAIN_DATABASE_URL=postgresql://%s:%s@%s:5432/%s\n' \
  "${DB_ROLE}" "${PW}" "${DB_HOST}" "${DB_NAME}" | sudo tee "${DSN_FILE}" > /dev/null
sudo chmod 600 "${DSN_FILE}"
unset PW

echo "provisioned ${DB_NAME}; DSN written to ${DSN_FILE} (root-only, not printed)"
echo
echo "NEXT: confirm VM111 can reach it. pg_hba.conf must permit the Brain host:"
echo "  host  ${DB_NAME}  ${DB_ROLE}  10.10.0.13/32   scram-sha-256"
echo "  host  ${DB_NAME}  ${DB_ROLE}  100.95.14.29/32 scram-sha-256"
