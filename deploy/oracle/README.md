# Oracle Always Free VM Deployment

This app controls a live brokerage account. Treat the VM like a production server.

## Before You Deploy

1. Reissue the Toss API key and secret before putting them on a cloud VM.
2. Create a long dashboard password.
3. Keep the dashboard private. Prefer Tailscale or Cloudflare Access. If you expose port 3000, use HTTPS and a strong password.
4. Add the Oracle VM public IP to the Toss Open API allowed IP list.

## VM Setup

Use an Oracle Always Free compute instance with Ubuntu or Oracle Linux.

```bash
sudo apt-get update
sudo apt-get install -y rsync curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Copy this project to the VM, then run:

```bash
sudo bash deploy/oracle/install.sh
sudo nano /etc/toss-invest/toss-invest.env
sudo systemctl restart toss-invest
```

Check logs:

```bash
sudo journalctl -u toss-invest -f
```

## Environment

`/etc/toss-invest/toss-invest.env` should contain:

```bash
PORT=3000
DATA_DIR=/opt/toss-invest/data
LIVE_TRADING=true
NEWS_REFRESH_MINUTES=30
DASHBOARD_PASSWORD=use-a-long-random-password
TOSS_CLIENT_ID=...
TOSS_CLIENT_SECRET=...
TOSS_ACCOUNT_SEQ=...
TOSS_BASE_URL=https://openapi.tossinvest.com
```

## Data

State is stored under:

```text
/opt/toss-invest/data/state.json
/opt/toss-invest/data/backups/
```

The app protects against accidental shortening of order history and creates rolling state backups at most once every 10 minutes. Large decision samples are stored separately so normal state backups stay small.

```text
/opt/toss-invest/data/decision-samples.json
/opt/toss-invest/data/decision-samples-archive.ndjson
```

Optional manual backup:

```bash
sudo DATA_DIR=/opt/toss-invest/data bash /opt/toss-invest/app/deploy/oracle/backup-state.sh
```

## Firewall

For safest operation, do not open port 3000 to the world. Use Tailscale and connect privately.

If you must expose it temporarily:

```bash
sudo ufw allow 3000/tcp
```

Remove when done:

```bash
sudo ufw delete allow 3000/tcp
```
