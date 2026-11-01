#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/toss-invest/app"
DATA_DIR="/opt/toss-invest/data"
ENV_DIR="/etc/toss-invest"
SERVICE_FILE="/etc/systemd/system/toss-invest.service"

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run with sudo: sudo bash deploy/oracle/install.sh" >&2
  exit 1
fi

id -u tossinvest >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin tossinvest

mkdir -p "${APP_DIR}" "${DATA_DIR}" "${ENV_DIR}"
umask 077
if systemctl is-active --quiet toss-invest; then
  echo "Stop toss-invest and confirm no pending orders before replacing the running app." >&2
  exit 1
fi
rsync -a --delete \
  --exclude ".git" \
  --exclude ".env" \
  --exclude "data" \
  --exclude "node_modules" \
  ./ "${APP_DIR}/"

if [[ ! -f "${ENV_DIR}/toss-invest.env" ]]; then
  cp "${APP_DIR}/deploy/oracle/toss-invest.env.example" "${ENV_DIR}/toss-invest.env"
  chmod 600 "${ENV_DIR}/toss-invest.env"
  DASHBOARD_SETUP_PASSWORD="$(node -e 'console.log(require("node:crypto").randomBytes(32).toString("base64url"))')"
  sed -i "s/replace-with-long-random-password/${DASHBOARD_SETUP_PASSWORD}/" "${ENV_DIR}/toss-invest.env"
  unset DASHBOARD_SETUP_PASSWORD
  echo "Created ${ENV_DIR}/toss-invest.env. Edit it before enabling live trading."
fi

cp "${APP_DIR}/deploy/oracle/toss-invest.service" "${SERVICE_FILE}"
chown -R tossinvest:tossinvest /opt/toss-invest
chmod 750 /opt/toss-invest
chmod 750 "${DATA_DIR}"

systemctl daemon-reload
echo "Installed without starting. Add credentials, initialize a NEW ledger, then enable the service as documented."
