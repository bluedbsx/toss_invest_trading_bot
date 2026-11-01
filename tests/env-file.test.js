// Codex: external private configuration must not fall back to stale repository secrets.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, cp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

test("external env pointer, process overrides, and missing private file fail closed", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "toss-env-"));
  try {
    await mkdir(path.join(dir, "src"));
    await cp(new URL("../src/env.js", import.meta.url), path.join(dir, "src/env.js"));
    await writeFile(path.join(dir, "package.json"), '{"type":"module"}');
    const privateFile = path.join(dir, "private.env");
    await writeFile(path.join(dir, ".env"), `TOSS_ENV_FILE=${privateFile}\nTOSS_CLIENT_SECRET=stale-synthetic\n`);
    await writeFile(privateFile, "DATA_DIR=/synthetic-private-data\nTOSS_CLIENT_SECRET=synthetic-secret\n");
    const env = { ...process.env };
    for (const name of ["TOSS_ENV_FILE", "DATA_DIR", "TOSS_CLIENT_SECRET"]) delete env[name];
    const code = "await import('./src/env.js'); console.log(JSON.stringify([process.env.DATA_DIR,process.env.TOSS_CLIENT_SECRET]));";
    const run = (vars) => spawnSync(process.execPath, ["--input-type=module", "-e", code], { cwd: dir, env: vars, encoding: "utf8" });
    let result = run(env);
    assert.equal(result.status, 0);
    assert.deepEqual(JSON.parse(result.stdout), ["/synthetic-private-data", "synthetic-secret"]);
    result = run({ ...env, DATA_DIR: "/explicit-process-dir" });
    assert.deepEqual(JSON.parse(result.stdout), ["/explicit-process-dir", "synthetic-secret"]);
    result = run({ ...env, TOSS_ENV_FILE: path.join(dir, "missing.env") });
    assert.notEqual(result.status, 0);
    assert.equal(result.stdout, "");
  } finally { await rm(dir, { recursive: true, force: true }); }
});
