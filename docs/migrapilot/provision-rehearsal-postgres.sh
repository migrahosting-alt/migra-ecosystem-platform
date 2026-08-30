#!/bin/bash
#
# Provision an ISOLATED PostgreSQL target for the legacy-import rehearsal.
#
# Same shape as provision-brain-postgres.sh, and for the same reason: the agent's
# hook permits elevation only through the migrapilot-app-core alias, and db-core
# is outside that scope.
#
# The password is generated ON THIS HOST and never printed. It goes into a
# root-only DSN file, and from there straight into an env file on VM111 that the
# rehearsal sources — the value never passes through a terminal, a log, or the
# repository.
#
# WHY A SEPARATE DATABASE. The rehearsal imports real production conversations.
# It must not touch `migrapilot_brain` (the Brain's own target) or the candidate
# database, both of which hold state the acceptance gates depend on. Isolated
# also means: when the rehearsal is done, this database can be dropped whole,
# with no argument about what else lived in it.
#
#   scp docs/migrapilot/provision-rehearsal-postgres.sh db-core:/tmp/
#   ssh db-core 'chmod +x /tmp/provision-rehearsal-postgres.sh && sudo /tmp/provision-rehearsal-postgres.sh'
#
# Then install it on VM111, where systemd reads it (still never printed):
#
#   ssh db-core 'sudo cat /root/.migrapilot_rehearsal_dsn' \
#     | ssh migrapilot-app-core '
#         sudo tee /etc/migrapilot/brain-rehearsal.env >/dev/null &&
#         sudo chown root:root /etc/migrapilot/brain-rehearsal.env &&
#         sudo chmod 600 /etc/migrapilot/brain-rehearsal.env &&
#         echo installed
#       '
#
# ROOT-OWNED, and it stays that way. The rehearsal is consumed through a systemd
# unit's EnvironmentFile (install-rehearsal-units.sh), never sourced into a
# shell — making the file readable to an ordinary user to run a command would
# defeat the permissions it was given. The rehearsal holds real production
# conversations; it gets production posture.
#
set -euo pipefail

DSN_FILE=/root/.migrapilot_rehearsal_dsn
DB_HOST=100.77.51.91   # db-core, tailnet
DB_NAME=migrapilot_brain_rehearsal
DB_ROLE=migrapilot_rehearsal

if sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='${DB_ROLE}'" | grep -q 1; then
  echo "role ${DB_ROLE} already exists — refusing to recreate or reset its password"
  echo "to start clean:  sudo -u postgres dropdb --if-exists ${DB_NAME} && sudo -u postgres dropuser ${DB_ROLE}"
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
echo "NEXT: PROBE CONNECTIVITY BEFORE TOUCHING pg_hba.conf."
echo "  The Brain's own database already authenticates from VM111, so the"
echo "  existing rules may already cover this one. Editing production"
echo "  authentication to fix a problem that may not exist is the wrong order."
echo
echo "    sudo systemctl start migrapilot-rehearsal-probe"
echo "    tail -n 20 /var/log/migrapilot/rehearsal.log"
echo
echo "  ONLY if that reports a pg_hba rejection, add the two narrow rules:"
echo "    host  ${DB_NAME}  ${DB_ROLE}  10.10.0.13/32   scram-sha-256"
echo "    host  ${DB_NAME}  ${DB_ROLE}  100.95.14.29/32 scram-sha-256"
echo "    (then: sudo systemctl reload postgresql)"
echo
echo "The rehearsal creates its own NOBYPASSRLS application role inside the"
echo "database via migration 4, exactly as the Brain's own target does — so the"
echo "import is exercised under real row-level security, not as a superuser."
