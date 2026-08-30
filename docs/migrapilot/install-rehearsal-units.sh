#!/bin/bash
#
# Install the rehearsal units on VM111.
#
# WHY UNITS AND NOT A SHELL COMMAND. The rehearsal DSN lives in a root-owned
# 0600 EnvironmentFile. Sourcing that into an ordinary shell would mean making
# it readable to a non-root user, which is the thing the file permissions exist
# to prevent. systemd reads it as root and hands it to the process; it never
# passes through a terminal, a shell history, or the repository.
#
# Each operation is its OWN unit rather than one unit with variable arguments,
# so what ran is a matter of record instead of a matter of what was typed.
#
#   scp docs/migrapilot/install-rehearsal-units.sh migrapilot-app-core:/tmp/
#   ssh migrapilot-app-core 'chmod +x /tmp/install-rehearsal-units.sh && sudo /tmp/install-rehearsal-units.sh <stage-dir>'
#
set -euo pipefail

STAGE="${1:?usage: install-rehearsal-units.sh /home/bonex/stage-<sha>}"
ENV_FILE=/etc/migrapilot/brain-rehearsal.env
TOOL="${STAGE}/dist/src/engine/persistence/migration/runMigration.js"
SOURCE_DB=/var/lib/migrapilot/migration/legacy-copy.db
RUN_ID="${MIGRAPILOT_REHEARSAL_RUN_ID:-rehearsal-1}"

[ -f "${TOOL}" ] || { echo "missing ${TOOL} — deploy a stage containing the migration tool first"; exit 1; }
# The env file is NOT required to install the units: the snapshot unit does not
# need a database, and being able to take the snapshot before the rehearsal
# database exists is useful. The units that do need it will fail loudly.
[ -f "${ENV_FILE}" ] || echo "note: ${ENV_FILE} not present yet — probe/import/verify will fail until it is"


# The snapshot holds real production conversations, so it gets the same posture
# as the secret: root-owned, not world-readable, off /home.
install -d -m 0750 -o root -g root /var/lib/migrapilot/migration

write_unit() {
  local name="$1" desc="$2" args="$3"
  cat > "/etc/systemd/system/${name}.service" <<UNIT
[Unit]
Description=${desc}
After=network-online.target

[Service]
Type=oneshot
User=root
Group=root
EnvironmentFile=${ENV_FILE}
WorkingDirectory=${STAGE}
ExecStart=/usr/bin/node ${TOOL} ${args}
StandardOutput=append:/var/log/migrapilot/rehearsal.log
StandardError=append:/var/log/migrapilot/rehearsal.log
UNIT
  echo "  wrote ${name}.service"
}

install -d -m 0755 /var/log/migrapilot

# Produced by root, in place, from a READ-ONLY connection to the live database —
# so the copy is never owned by a login user on its way to its destination, and
# no elevated copy across an ownership boundary is needed. Needs no DSN.
write_unit migrapilot-rehearsal-snapshot \
  "MigraPilot legacy rehearsal — consistent snapshot of the live state" \
  "--snapshot --live-source /var/lib/migrapilot/brain-state.db --out ${SOURCE_DB}"

# For the three below, the DSN comes from MIGRAPILOT_BRAIN_DATABASE_URL in the
# EnvironmentFile. --database-url is deliberately NOT passed: `ps` shows command
# lines to every user on the box.
write_unit migrapilot-rehearsal-probe \
  "MigraPilot legacy rehearsal — connectivity probe" \
  "--probe"

write_unit migrapilot-rehearsal-import \
  "MigraPilot legacy rehearsal — import + exact reconciliation" \
  "--source ${SOURCE_DB} --run-id ${RUN_ID} --json /var/lib/migrapilot/migration/rehearsal-report.json"

write_unit migrapilot-rehearsal-verify \
  "MigraPilot legacy rehearsal — reconciliation only, no writes" \
  "--source ${SOURCE_DB} --run-id ${RUN_ID} --verify-only --json /var/lib/migrapilot/migration/verify-report.json"

systemctl daemon-reload
echo
echo "installed. run them in this order:"
echo "  sudo systemctl start migrapilot-rehearsal-snapshot  # needs no database"
echo "  sudo systemctl start migrapilot-rehearsal-probe     # connectivity FIRST, before any pg_hba edit"
echo "  sudo systemctl start migrapilot-rehearsal-import"
echo "  sudo systemctl start migrapilot-rehearsal-verify"
echo
echo "output: /var/log/migrapilot/rehearsal.log (the tool redacts any DSN before printing)"
