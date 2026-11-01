import test from "node:test";
import assert from "node:assert/strict";
import { resolveAllocationUsd } from "../src/budget.js";
import { buildCapitalFlows } from "../src/validation.js";

test("paper capital is optional and never changes the live seed", () => {
  const settings = { allocationUsd: 1000, paperAllocationUsd: 10000, dryRun: true };
  assert.equal(resolveAllocationUsd(settings), 10000);
  assert.equal(resolveAllocationUsd({ ...settings, dryRun: false }), 1000);
  assert.equal(resolveAllocationUsd({ ...settings, paperAllocationUsd: null }), 1000);
});

test("paper top-ups do not become live benchmark deposits", () => {
  const state = {
    settings: { allocationUsd: 1000, dryRun: false, botStartedAt: "2026-01-01T00:00:00Z" },
    learning: { recommendationEvents: [
      { type: "budget-add", createdAt: "2026-02-01T00:00:00Z", payload: { mode: "paper", amountUsd: 9000 } }
    ] }
  };
  const flows = buildCapitalFlows(state);
  assert.equal(flows.length, 1);
  assert.equal(flows[0].amountUsd, 1000);
});
