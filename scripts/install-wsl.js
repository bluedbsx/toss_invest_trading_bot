// Codex: private WSL configuration, ledger adoption, and a restartable user service.
import { existsSync, readFileSync } from "node:fs";
import { mkdir, writeFile, chmod, cp, readdir } from "node:fs/promises";
import { execFileSync, spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import { parseEnv } from "../src/env.js";

if (!/microsoft/i.test(readFileSync("/proc/version", "utf8"))) throw new Error("Run this installer in WSL.");
if (spawnSync("systemctl", ["--user", "is-active", "--quiet", "toss-invest.service"]).status === 0) {
  throw new Error("Stop toss-invest.service before reinstalling; no running configuration was changed.");
}
execFileSync("systemctl", ["--user", "show-environment"], { stdio: "ignore" });
process.umask(0o077);
const root = fileURLToPath(new URL("../", import.meta.url));
const configDir = path.join(os.homedir(), ".config/toss-invest");
const dataDir = path.join(os.homedir(), ".local/share/toss-invest/data");
const configFile = path.join(configDir, "env");
const unitDir = path.join(os.homedir(), ".config/systemd/user");
const sourceDir = path.resolve(root, process.env.DATA_DIR || "data");
await mkdir(configDir, { recursive: true, mode: 0o700 });
await chmod(configDir, 0o700);
await mkdir(dataDir, { recursive: true, mode: 0o700 });

if (sourceDir !== dataDir && existsSync(path.join(sourceDir, "state.json"))) {
  if ((await readdir(dataDir)).length) throw new Error("Destination data already exists; refusing to merge ledgers.");
  for (const entry of await readdir(sourceDir)) {
    await cp(path.join(sourceDir, entry), path.join(dataDir, entry), { recursive: true, force: false, errorOnExist: true });
  }
}
async function restrictTree(dir) {
  await chmod(dir, 0o700);
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) throw new Error("Symlink found in private data; inspect it before installation.");
    if (entry.isDirectory()) await restrictTree(target);
    else await chmod(target, 0o600);
  }
}
await restrictTree(dataDir);
if (!existsSync(configFile)) {
  const initial = {
    PORT: "3000", HOST: "127.0.0.1", DATA_DIR: dataDir, LIVE_TRADING: "false", NEWS_REFRESH_MINUTES: "30",
    DASHBOARD_PASSWORD: process.env.DASHBOARD_PASSWORD || crypto.randomBytes(32).toString("base64url"),
    TOSS_CLIENT_ID: process.env.TOSS_CLIENT_ID || "", TOSS_CLIENT_SECRET: process.env.TOSS_CLIENT_SECRET || "",
    TOSS_ACCOUNT_SEQ: process.env.TOSS_ACCOUNT_SEQ || "", TOSS_BASE_URL: "https://openapi.tossinvest.com"
  };
  await writeFile(configFile, "# Private WSL settings. Never commit or share this file.\n" +
    Object.entries(initial).map(([key, value]) => `${key}=${value}`).join("\n") + "\n", { flag: "wx", mode: 0o600 });
}
await chmod(configFile, 0o600);
const config = parseEnv(readFileSync(configFile, "utf8"));
if (path.resolve(config.DATA_DIR || "") !== dataDir) throw new Error("Existing configuration uses another DATA_DIR; inspect it manually.");
if (!existsSync(path.join(dataDir, "state.json"))) {
  throw new Error("No existing ledger to adopt. Initialize a new ledger with TOSS_ENV_FILE pointing to the private config, then rerun.");
}
const quote = (value) => '"' + value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/%/g, "%%") + '"';
const directoryValue = root.replace(/[%\\\s]/g, (char) => char === "%" ? "%%" : `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
await mkdir(unitDir, { recursive: true });
await writeFile(path.join(unitDir, "toss-invest.service"), `[Unit]
Description=Local Toss Invest dashboard (WSL)
StartLimitIntervalSec=60
StartLimitBurst=5

[Service]
Type=simple
WorkingDirectory=${directoryValue}
Environment=${quote("TOSS_ENV_FILE=" + configFile)}
ExecStart=${quote(process.execPath)} ${quote(path.join(root, "server.js"))}
Restart=on-failure
RestartSec=10
UMask=0077
NoNewPrivileges=true
TimeoutStopSec=30

[Install]
WantedBy=default.target
`, { mode: 0o600 });
// The repository-local .env now contains only the external path, never credentials.
await writeFile(path.join(root, ".env"), `# WSL private configuration (Codex).\nTOSS_ENV_FILE=${configFile}\n`);
execFileSync("systemctl", ["--user", "daemon-reload"], { stdio: "inherit" });
execFileSync("systemctl", ["--user", "enable", "toss-invest.service"], { stdio: "inherit" });
console.log(`Private configuration: ${configFile}\nPrivate ledger: ${dataDir}\nInstalled and enabled; not started. Use bash deploy/wsl/manage.sh start.`);
