#!/usr/bin/env bash
set -euo pipefail

DATA_DIR="${DATA_DIR:-/opt/toss-invest/data}"
BACKUP_DIR="${BACKUP_DIR:-/opt/toss-invest/data/offsite-ready}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"

mkdir -p "${BACKUP_DIR}"
if [[ -f "${DATA_DIR}/state.json" ]]; then
  cp "${DATA_DIR}/state.json" "${BACKUP_DIR}/state-${STAMP}.json"
fi
find "${BACKUP_DIR}" -name 'state-*.json' -type f | sort -r | tail -n +121 | xargs -r rm -f
echo "Backup complete: ${BACKUP_DIR}"
