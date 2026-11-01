// Codex: initialize a NEW installation only; never reset an existing account ledger.
import "../src/env.js";
import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { createInitialState } from "../src/store.js";

const [budgetText, symbolText, weightText] = process.argv.slice(2);
const budget = Number(budgetText);
const symbols = String(symbolText || "").toUpperCase().split(",");
const weights = weightText ? weightText.split(",").map(Number) : symbols.map(() => 100 / symbols.length);
if (!(budget > 0 && Number.isFinite(budget)) || symbols.some((s) => !/^[A-Z][A-Z0-9.-]{0,14}$/.test(s)) ||
    new Set(symbols).size !== symbols.length || weights.length !== symbols.length ||
    weights.some((w) => !Number.isFinite(w) || w <= 0) || Math.abs(weights.reduce((a, b) => a + b, 0) - 100) > 0.001) {
  throw new Error("Usage: node scripts/init-deployment.js BUDGET_USD SYMBOL1,SYMBOL2 [WEIGHT1,WEIGHT2]; weights must total 100.");
}
if (process.env.LIVE_TRADING === "true") throw new Error("Initialize with LIVE_TRADING=false and the server stopped.");
const state = createInitialState();
Object.assign(state.settings, {
  allocationUsd: budget,
  botStartedAt: new Date().toISOString(),
  monitoringEnabled: false,
  liveTradingEnabled: false,
  dryRun: true,
  autoWeightRecommendations: false,
  autoSafetyRecommendations: false,
  autoTargetRecommendations: false,
  autoLearningReports: false
});
// Same generic starting parameters as POST /api/targets; not optimized recommendations.
state.targets = symbols.map((symbol, index) => ({
  symbol, name: symbol, enabled: true, riskProfile: "custom", allocationPct: weights[index], leverage: "1x",
  fastSmaDays: 20, slowSmaDays: 50, momentumDays: 5, minBuyRsi: 45, maxBuyRsi: 72,
  stopLossPct: 8, partialTakeProfitPct: 10, partialTakeProfitSellPct: 40, takeProfitPct: 18,
  trailingStopPct: 10, takeProfitRsi: 78, maxAtrPct: 12, minAdx: 0,
  notes: "Initial generic parameters; review in paper mode before live trading."
}));
const dataDir = path.resolve(process.env.DATA_DIR || "data");
await mkdir(dataDir, { recursive: true, mode: 0o700 });
const file = await open(path.join(dataDir, "state.json"), "wx", 0o600);
try {
  await file.writeFile(JSON.stringify(state, null, 2));
} finally {
  await file.close();
}
console.log("Initialized new paused paper ledger. Existing manual holdings were not imported. Live trading remains disabled.");
