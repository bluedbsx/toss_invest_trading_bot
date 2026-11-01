// Codex: export the complete stopped ledger, excluding credentials and source code.
import "../src/env.js";
import { mkdir, chmod, stat, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";

const dataDir = path.resolve(process.env.DATA_DIR || "data");
await stat(path.join(dataDir, "state.json"));
const checkTree = async (dir) => {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error("Refusing to export symlinked data.");
    if (entry.isDirectory()) await checkTree(path.join(dir, entry.name));
  }
};
await checkTree(dataDir);
process.umask(0o077);
const backupDir = path.join(os.homedir(), ".local/share/toss-invest/exports");
await mkdir(backupDir, { recursive: true, mode: 0o700 });
await chmod(backupDir, 0o700);
const output = path.join(backupDir, `ledger-${new Date().toISOString().replace(/[:.]/g, "-")}.tar.gz`);
execFileSync("tar", ["-czf", output, "-C", dataDir, "."], { stdio: "inherit" });
await chmod(output, 0o600);
console.log(`Private ledger snapshot: ${output}\nContains account data. Credentials excluded. Keep both source and destination bots stopped during migration.`);
