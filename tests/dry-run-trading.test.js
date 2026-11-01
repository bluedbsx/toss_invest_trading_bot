// Codex: exercise real trader BUY/SELL paths with in-memory data and no real API access.
import test from "node:test";
import assert from "node:assert/strict";
import { Trader } from "../src/trader.js";
import { createInitialState } from "../src/store.js";

for (const [envLive, webLive] of [["false", false], ["false", true], ["true", false]]) {
  test(`paper BUY and SELL never send orders when locks are ${envLive}/${webLive}`, async () => {
    const originalLive = process.env.LIVE_TRADING;
    const originalFetch = globalThis.fetch;
    let createOrderCalls = 0;
    let saves = 0;
    let price = 125.9;
    try {
      process.env.LIVE_TRADING = envLive;
      globalThis.fetch = async () => { throw new Error("Network forbidden in dry-run regression test"); };
      const state = createInitialState();
      Object.assign(state.settings, {
        allocationUsd: 1000, monitoringEnabled: true, liveTradingEnabled: webLive,
        autoSafetyRecommendations: false, autoWeightRecommendations: false
      });
      // Deliberately permissive synthetic signal fixture, never used as a live strategy.
      state.targets = [{
        ...state.targets[0], symbol: "TEST", name: "Synthetic", allocationPct: 100,
        fastSmaDays: 20, slowSmaDays: 50, momentumDays: 5,
        minBuyRsi: 0, maxBuyRsi: 100, takeProfitRsi: 0
      }];
      const candles = Array.from({ length: 260 }, (_, index) => {
        const close = 100 + index / 10 + Math.sin(index) * 0.4;
        return {
          timestamp: new Date(Date.now() - (259 - index) * 86_400_000).toISOString(),
          openPrice: close, highPrice: close + 0.2, lowPrice: close - 0.2, closePrice: close
        };
      });
      price = candles.at(-1).closePrice;
      const client = {
        isMockMode: () => false,
        getUsCalendar: async () => ({ result: { today: { regularMarket: {
          startTime: new Date(Date.now() - 3_600_000).toISOString(),
          endTime: new Date(Date.now() + 3_600_000).toISOString()
        } } } }),
        getHoldings: async () => ({ result: { items: [{ symbol: "MANUAL", quantity: "10" }] } }),
        getPrices: async () => ({ result: [{ symbol: "TEST", lastPrice: String(price) }] }),
        getCandles: async () => ({ result: { candles } }),
        getSellableQuantity: async () => ({ result: { sellableQuantity: "100" } }),
        createOrder: async () => { createOrderCalls++; throw new Error("Real order path invoked"); }
      };
      const trader = new Trader({ tossClient: client, store: { saveTraderState: async () => { saves++; } } });
      await trader.runOnce(state);
      assert.equal(state.tradeHistory.length, 1, "BUY must actually reach paper execution: " + JSON.stringify(state.marketSnapshots.TEST.signal));
      assert.equal(state.tradeHistory[0].side, "BUY");
      assert.equal(state.tradeHistory[0].dryRun, true);
      assert.equal(state.tradeHistory[0].syncStatus, "DRY_RUN");
      assert.ok(state.positions.TEST.quantity > 0);
      assert.ok(state.performance.totalBuyAmountUsd > 0);
      assert.equal(state.positions.MANUAL, undefined);
      price = 80; // Force a protective exit, also proving SELL stays paper-only.
      await trader.runOnce(state);
      assert.equal(state.tradeHistory.length, 2);
      assert.equal(state.tradeHistory[0].side, "SELL");
      assert.equal(state.positions.TEST, undefined);
      assert.ok(state.performance.totalSellAmountUsd > 0);
      assert.ok(state.performance.realizedPnlUsd < 0);
      assert.ok(state.tradeHistory.every(trade => trade.dryRun && trade.orderId.startsWith("dry-")));
      assert.equal(state.settings.dryRun, true);
      assert.equal(state.ledgerMode, "paper");
      assert.equal(createOrderCalls, 0);
      assert.equal(saves, 2);
    } finally {
      globalThis.fetch = originalFetch;
      if (originalLive === undefined) delete process.env.LIVE_TRADING;
      else process.env.LIVE_TRADING = originalLive;
    }
  });
}
