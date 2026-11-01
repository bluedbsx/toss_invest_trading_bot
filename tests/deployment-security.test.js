// Codex: regression coverage for the deployment security boundary; no real network API calls.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { enforceDashboardAuth, enforceRequestBoundary, setSecurityHeaders } from "../src/auth.js";
import { TossClient } from "../src/tossClient.js";
import { safeNewsUrl } from "../public/safeUrl.js";

function response() {
  return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(s) { this.status = s; }, end() {} };
}
const savedEnv = { ...process.env };
test.afterEach(() => { process.env = { ...savedEnv }; });

test("loopback and disabled flag do not bypass authentication", () => {
  delete process.env.DASHBOARD_PASSWORD;
  process.env.DASHBOARD_AUTH_DISABLED = "true";
  const req = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
  const res = response();
  assert.equal(enforceDashboardAuth(req, res), false);
  assert.equal(res.status, 503);
  process.env.DASHBOARD_PASSWORD = "test-password";
  assert.equal(enforceDashboardAuth(req, response()), false);
  req.headers.authorization = `Basic ${Buffer.from("user:test-password").toString("base64")}`;
  assert.equal(enforceDashboardAuth(req, response()), true);
});

test("Host, Origin and cross-site requests are checked", () => {
  process.env.PORT = "3000";
  delete process.env.DASHBOARD_ALLOWED_HOSTS;
  for (const headers of [
    { host: "attacker.example" },
    { host: "localhost:3000", origin: "https://attacker.example" },
    { host: "localhost:3000", origin: "null" },
    { host: "localhost:3000", "sec-fetch-site": "cross-site" }
  ]) assert.equal(enforceRequestBoundary({ headers }, response()), false);
  assert.equal(enforceRequestBoundary({ headers: { host: "localhost:3000", origin: "http://localhost:3000" } }, response()), true);
});

test("API rejects foreign/non-HTTPS origins before any request", () => {
  for (const url of ["http://openapi.tossinvest.com", "https://attacker.example", "https://openapi.tossinvest.com@attacker.example", "https://openapi.tossinvest.com/other", "https://user@openapi.tossinvest.com"]) {
    process.env.TOSS_BASE_URL = url;
    assert.throws(() => new TossClient());
  }
  process.env.TOSS_BASE_URL = "https://openapi.tossinvest.com/";
  assert.equal(new TossClient().baseUrl, "https://openapi.tossinvest.com");
});

test("RSS executable schemes are rejected and quotes cannot escape href", () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,evil', '//attacker.example', '"]<img src=x onerror=alert(1)>']) {
    assert.equal(safeNewsUrl(url), "#");
  }
  assert.ok(!safeNewsUrl('https://example.com/" onmouseover="evil').includes('"'));
  const res = response();
  setSecurityHeaders(res);
  assert.equal(res.headers["Cache-Control"], "no-store");
  assert.match(res.headers["Content-Security-Policy"], /connect-src 'self'/);
  assert.match(res.headers["Content-Security-Policy"], /script-src 'self';/);
});

test("Toss fetch refuses redirects and has a deadline", async () => {
  const originalFetch = globalThis.fetch;
  try {
    process.env.TOSS_BASE_URL = "https://openapi.tossinvest.com";
    process.env.TOSS_CLIENT_ID = "synthetic-id";
    process.env.TOSS_CLIENT_SECRET = "synthetic-secret";
    globalThis.fetch = async (url, options) => {
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(new URL(url).origin, "https://openapi.tossinvest.com");
      return new Response(JSON.stringify({ access_token: "synthetic-token", expires_in: 60 }));
    };
    assert.equal(await new TossClient().issueToken(), "synthetic-token");
  } finally { globalThis.fetch = originalFetch; }
});

test("fresh setup is paused, capped to configured seed, and refuses overwrite", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "toss-setup-test-"));
  try {
    const env = { ...process.env, DATA_DIR: dir, LIVE_TRADING: "false" };
    const args = ["scripts/init-deployment.js", "1234", "AAA,BBB,CCC"];
    const run = () => spawnSync(process.execPath, args, { env, encoding: "utf8" });
    assert.equal(run().status, 0);
    const before = await readFile(path.join(dir, "state.json"), "utf8");
    const state = JSON.parse(before);
    assert.equal(state.settings.allocationUsd, 1234);
    assert.equal(state.settings.allowSeedTopUp, false);
    assert.equal(state.settings.autoWeightRecommendations, false);
    assert.equal(state.settings.autoSafetyRecommendations, false);
    assert.equal(state.settings.monitoringEnabled, false);
    assert.equal(state.settings.liveTradingEnabled, false);
    assert.equal(state.settings.dryRun, true);
    assert.deepEqual(Object.keys(state.positions), []);
    assert.deepEqual(state.targets.map(t => t.symbol), ["AAA", "BBB", "CCC"]);
    assert.equal(run().status, 1);
    assert.equal(await readFile(path.join(dir, "state.json"), "utf8"), before);
    const live = spawnSync(process.execPath, args, { env: { ...env, LIVE_TRADING: "true" } });
    assert.notEqual(live.status, 0);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
