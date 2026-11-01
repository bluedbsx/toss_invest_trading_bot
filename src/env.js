// Codex: load local configuration before modules resolve DATA_DIR.
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export function parseEnv(text) {
  const values = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    values[key] = value;
  }
  return values;
}

const localFile = fileURLToPath(new URL("../.env", import.meta.url));
const localValues = existsSync(localFile) ? parseEnv(readFileSync(localFile, "utf8")) : {};
// Codex: .env may be a non-secret pointer to a Linux-private configuration file.
const configuredFile = process.env.TOSS_ENV_FILE || localValues.TOSS_ENV_FILE;
const envFile = configuredFile ? path.resolve(path.dirname(localFile), configuredFile) : localFile;
if (configuredFile && !existsSync(envFile)) throw new Error("Configured TOSS_ENV_FILE does not exist.");
const values = configuredFile ? parseEnv(readFileSync(envFile, "utf8")) : localValues;
for (const [key, value] of Object.entries(values)) {
  if (!(key in process.env)) process.env[key] = value;
}
