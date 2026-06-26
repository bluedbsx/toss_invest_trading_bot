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
rsync -a --delete \
  --exclude ".git" \
  --exclude ".env" \
  --exclude "data" \
  --exclude "node_modules" \
  ./ "${APP_DIR}/"

if [[ ! -f "${ENV_DIR}/toss-invest.env" ]]; then
  cp "${APP_DIR}/deploy/oracle/toss-invest.env.example" "${ENV_DIR}/toss-invest.env"
  chmod 600 "${ENV_DIR}/toss-invest.env"
  echo "Created ${ENV_DIR}/toss-invest.env. Edit it before enabling live trading."
fi

cp "${APP_DIR}/deploy/oracle/toss-invest.service" "${SERVICE_FILE}"
chown -R tossinvest:tossinvest /opt/toss-invest
chmod 750 /opt/toss-invest
chmod 750 "${DATA_DIR}"

systemctl daemon-reload
systemctl enable toss-invest
systemctl restart toss-invest
systemctl status toss-invest --no-pager
