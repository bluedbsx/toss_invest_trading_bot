#!/usr/bin/env bash
# Codex: all service and snapshot operations use the same private WSL ledger.
set -euo pipefail
CONFIG_FILE="${TOSS_ENV_FILE:-${HOME}/.config/toss-invest/env}"
case "${1:-status}" in
  start|stop|restart) systemctl --user "$1" toss-invest.service ;;
  status) systemctl --user status toss-invest.service --no-pager ;;
  logs) journalctl --user -u toss-invest.service -n 80 --no-pager ;;
  keepalive)
    systemctl --user start toss-invest.service
    echo "WSL keepalive running. Keep this terminal open while operating the bot."
    exec sleep infinity
    ;;
  backup)
    if systemctl --user is-active --quiet toss-invest.service; then
      echo "Stop the service before taking a consistent migration snapshot." >&2
      exit 1
    fi
    TOSS_ENV_FILE="${CONFIG_FILE}" node "$(dirname "$0")/../../scripts/export-data.js"
    ;;
  *) echo "Usage: bash deploy/wsl/manage.sh {start|stop|restart|status|logs|keepalive|backup}" >&2; exit 1 ;;
esac
