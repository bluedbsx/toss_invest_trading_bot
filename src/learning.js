import { strategySummary } from "./strategy.js";

// 결정 샘플은 data/decision-samples.json 사이드카에만 저장되어(state.json/백업 제외) 보관 비용이 낮다.
// 엔진 다음 버전 개발에 쓸 이력을 더 길게 남기기 위해 상향(시간당 ~50개 기준 약 4일치).
const MAX_DECISION_SAMPLES = 5000;
const MAX_RECOMMENDATION_EVENTS = 300;
const MAX_REPORTS = 50;

export function ensureLearningState(state) {
  if (!state.learning) {
    state.learning = {
      version: "learning-v1",
      decisionSamples: [],
      recommendationEvents: [],
      closedCycles: [],
      reports: [],
      lastReport: null,
      updatedAt: null
    };
  }
  state.learning.decisionSamples ??= [];
  state.learning.recommendationEvents ??= [];
  state.learning.closedCycles ??= [];
  state.learning.reports ??= [];
  return state.learning;
}

export function recordDecisionSample(
  state,
  { target, signal, backtest, position, orderPlan, price, isRegularMarket, matchingBuyWeight }
) {
  const learning = ensureLearningState(state);
  learning.decisionSamples.unshift({
    id: `${Date.now()}-${target.symbol}-${learning.decisionSamples.length}`,
    collectedAt: new Date().toISOString(),
    engineVersion: strategySummary.name,
    symbol: target.symbol,
    isRegularMarket: Boolean(isRegularMarket),
    matchingBuyWeight: round(matchingBuyWeight ?? 0, 2),
    target: pickTargetSnapshot(target),
    signal: {
      action: signal?.action ?? "UNKNOWN",
      reasons: signal?.reasons ?? [],
      metrics: signal?.metrics ?? {},
      risk: signal?.risk ?? null
    },
    orderPlan: summarizeOrderPlan(orderPlan),
    backtest: summarizeBacktest(backtest),
    position: summarizePosition(position),
    price: {
      lastPrice: numberOrNull(price?.lastPrice ?? signal?.metrics?.lastPrice),
      timestamp: price?.timestamp ?? null
    }
  });
  learning.decisionSamples = learning.decisionSamples.slice(0, MAX_DECISION_SAMPLES);
  learning.updatedAt = new Date().toISOString();
}

export function attachTradeLearningContext(event, { target, signal, backtest, settings, isRegularMarket }) {
  event.strategyContext = {
    engineVersion: strategySummary.name,
    capturedAt: new Date().toISOString(),
    isRegularMarket: Boolean(isRegularMarket),
    target: pickTargetSnapshot(target),
    settings: pickSettingsSnapshot(settings),
    signal: {
      action: signal?.action ?? null,
      reasons: signal?.reasons ?? [],
      metrics: signal?.metrics ?? {},
      risk: signal?.risk ?? null
    },
    backtest: summarizeBacktest(backtest)
  };
}

export function recordRecommendationEvent(state, type, payload) {
  const learning = ensureLearningState(state);
  learning.recommendationEvents.unshift({
    id: `${Date.now()}-${type}`,
    type,
    createdAt: new Date().toISOString(),
    engineVersion: strategySummary.name,
    payload: compactPayload(payload)
  });
  learning.recommendationEvents = learning.recommendationEvents.slice(0, MAX_RECOMMENDATION_EVENTS);
  learning.updatedAt = new Date().toISOString();
}

export function buildLearningReport(state) {
  const learning = ensureLearningState(state);
  const samples = scopedDecisionSamples(state, learning.decisionSamples ?? []);
  const recentSamples = samples.slice(0, 500);
  const trades = scopedTrades(state, state.tradeHistory ?? []);
  const closedCycles = learning.closedCycles ?? [];
  const finalTrades = trades.filter((trade) => trade.syncStatus === "FINAL" || trade.dryRun);
  const buyTrades = finalTrades.filter((trade) => trade.side === "BUY");
  const sellTrades = finalTrades.filter((trade) => trade.side === "SELL");
  const realizedPnlUsd = round(
    sellTrades.reduce((sum, trade) => sum + Number(trade.realizedPnlUsd ?? 0), 0),
    2
  );
  const totalBuyUsd = round(
    buyTrades.reduce((sum, trade) => sum + Number(trade.actualCostUsd ?? trade.actualValueUsd ?? trade.estimatedValueUsd ?? 0), 0),
    2
  );
  const totalSellUsd = round(
    sellTrades.reduce((sum, trade) => sum + Number(trade.actualValueUsd ?? trade.estimatedValueUsd ?? 0), 0),
    2
  );
  const actionCounts = countBy(recentSamples, (sample) => sample.signal.action);
  const orderModeCounts = countBy(recentSamples, (sample) => sample.orderPlan?.mode ?? "NO_ORDER");
  const topReasons = topCounts(flatten(recentSamples.map((sample) => sample.signal.reasons ?? [])), 6);
  const topSkips = topCounts(
    recentSamples
      .filter((sample) => sample.orderPlan?.mode === "SKIP")
      .map((sample) => sample.orderPlan?.reason)
      .filter(Boolean),
    6
  );
  const bySymbol = Object.fromEntries(
    (state.targets ?? []).map((target) => {
      const symbolSamples = recentSamples.filter((sample) => sample.symbol === target.symbol);
      const symbolTrades = trades.filter((trade) => trade.symbol === target.symbol);
      const latestSample = symbolSamples[0] ?? null;
      return [
        target.symbol,
        {
          samples: symbolSamples.length,
          trades: symbolTrades.length,
          latestAction: latestSample?.signal?.action ?? "대기",
          latestReason: latestSample?.signal?.reasons?.[0] ?? null,
          latestScore: latestSample?.backtest?.score ?? target.lastStrategyReview?.score ?? null,
          currentAllocationPct: Number(target.allocationPct ?? 0)
        }
      ];
    })
  );
  const recommendationCounts = countBy(learning.recommendationEvents ?? [], (event) => event.type);
  const scopedCycles = scopedClosedCycles(state, closedCycles);
  const cycleWins = scopedCycles.filter((cycle) => Number(cycle.realizedPnlUsd ?? 0) > 0).length;
  const cycleRealizedPnlUsd = round(
    scopedCycles.reduce((sum, cycle) => sum + Number(cycle.realizedPnlUsd ?? 0), 0),
    2
  );
  const dataQuality = assessDataQuality({ samples, finalTrades, sellTrades, closedCycles: scopedCycles });
  const nextActions = buildNextActions({ samples, finalTrades, sellTrades, closedCycles: scopedCycles, topSkips, dataQuality });
  const report = {
    id: `${Date.now()}-learning-report`,
    generatedAt: new Date().toISOString(),
    engineVersion: strategySummary.name,
    summary: {
      decisionSamples: samples.length,
      recentSamples: recentSamples.length,
      tradeCount: trades.length,
      finalTradeCount: finalTrades.length,
      buyCount: buyTrades.length,
      sellCount: sellTrades.length,
      realizedPnlUsd,
      totalBuyUsd,
      totalSellUsd,
      closedCycles: scopedCycles.length,
      cycleWinRatePct: scopedCycles.length ? round((cycleWins / scopedCycles.length) * 100, 1) : null,
      cycleRealizedPnlUsd,
      recommendationEvents: learning.recommendationEvents.length
    },
    actionCounts,
    orderModeCounts,
    topReasons,
    topSkips,
    bySymbol,
    recommendationCounts,
    dataQuality,
    nextActions
  };
  learning.lastReport = report;
  learning.reports.unshift(report);
  learning.reports = learning.reports.slice(0, MAX_REPORTS);
  learning.updatedAt = report.generatedAt;
  return report;
}

function scopedDecisionSamples(state, samples) {
  return (samples ?? []).filter((sample) => inActiveUniverse(state, sample) && afterPaperSessionStart(state, sample.collectedAt));
}

function scopedTrades(state, trades) {
  const paperMode = Boolean(state?.settings?.dryRun || state?.settings?.liveTradingEnabled === false);
  return (trades ?? []).filter((trade) => {
    if (!inActiveUniverse(state, trade)) return false;
    if (paperMode) return Boolean(trade.dryRun) && afterPaperSessionStart(state, trade.requestedAt);
    return !trade.dryRun;
  });
}

function scopedClosedCycles(state, cycles) {
  const paperMode = Boolean(state?.settings?.dryRun || state?.settings?.liveTradingEnabled === false);
  if (paperMode) return [];
  return (cycles ?? []).filter((cycle) => inActiveUniverse(state, cycle));
}

function inActiveUniverse(state, item) {
  const activeSymbols = activeSymbolSet(state);
  if (!activeSymbols.size) return true;
  return activeSymbols.has(String(item?.symbol ?? "").toUpperCase());
}

function activeSymbolSet(state) {
  return new Set(
    (state?.targets ?? [])
      .filter((target) => target.enabled !== false)
      .map((target) => String(target.symbol ?? "").toUpperCase())
      .filter(Boolean)
  );
}

function afterPaperSessionStart(state, at) {
  const paperMode = Boolean(state?.settings?.dryRun || state?.settings?.liveTradingEnabled === false);
  const startedAt = state?.paperSession?.startedAt ? new Date(state.paperSession.startedAt).getTime() : 0;
  if (!paperMode || !startedAt) return true;
  const time = new Date(at ?? 0).getTime();
  return Number.isFinite(time) && time >= startedAt;
}

function buildNextActions({ samples, finalTrades, sellTrades, closedCycles, topSkips, dataQuality }) {
  const actions = [];
  if (samples.length < 300) {
    actions.push("결정 샘플이 아직 적습니다. 자동 수집을 더 쌓은 뒤 추천값/비중 점수를 더 신뢰하세요.");
  }
  if (finalTrades.length < 20 || sellTrades.length < 5) {
    actions.push("실제 체결된 왕복 매매가 부족해서 엔진 자체를 자동 변경하기에는 이릅니다. 우선 추천 후보만 만들고 적용은 확인 버튼으로 유지하는 편이 안전합니다.");
  }
  if (closedCycles.length < 5) {
    actions.push("매수-매도 사이클 표본이 아직 적습니다. 사이클별 진입 사유, 이벤트/뉴스 상태, 실현손익을 계속 축적합니다.");
  }
  if (topSkips.some((item) => /변동성/.test(item.label))) {
    actions.push("변동성 때문에 매수 대기가 많습니다. 종목별 maxAtrPct와 손절폭을 함께 비교하는 후보군을 다음 정밀추천에 우선 반영할 수 있습니다.");
  }
  if (topSkips.some((item) => /레버리지|비중|한도/.test(item.label))) {
    actions.push("노출 한도 때문에 주문이 자주 막힙니다. 전체비중 추천과 안전설정 추천이 같은 한도를 보도록 조정 후보를 기록했습니다.");
  }
  if (dataQuality.grade === "낮음") {
    actions.push("데이터 품질이 낮습니다. 오늘은 전략 자동 변경보다 체결 동기화와 샘플 축적이 우선입니다.");
  }
  if (!actions.length) {
    actions.push("데이터 수집 상태가 양호합니다. 다음 단계는 종목별 추천값 후보와 실제 체결 후 성과를 비교하는 버전업 리포트입니다.");
  }
  return actions;
}

function assessDataQuality({ samples, finalTrades, sellTrades, closedCycles }) {
  let score = 0;
  if (samples.length >= 100) score += 25;
  if (samples.length >= 500) score += 20;
  if (finalTrades.length >= 5) score += 20;
  if (finalTrades.length >= 20) score += 15;
  if (sellTrades.length >= 3) score += 10;
  if (closedCycles.length >= 3) score += 10;
  return {
    score,
    grade: score >= 75 ? "높음" : score >= 45 ? "보통" : "낮음",
    notes: [
      `결정 샘플 ${samples.length}개`,
      `최종/연습 포함 주문 ${finalTrades.length}개`,
      `매도 결과 ${sellTrades.length}개`,
      `왕복 사이클 ${closedCycles.length}개`
    ]
  };
}

function summarizeOrderPlan(orderPlan) {
  if (!orderPlan) return null;
  return {
    side: orderPlan.side ?? null,
    mode: orderPlan.mode ?? null,
    reason: orderPlan.reason ?? null,
    quantity: numberOrNull(orderPlan.quantity ?? orderPlan.expectedQuantity),
    sellableQuantity: numberOrNull(orderPlan.sellableQuantity),
    orderAmount: numberOrNull(orderPlan.orderAmount),
    originalBudget: numberOrNull(orderPlan.originalBudget),
    availableBudget: numberOrNull(orderPlan.availableBudget),
    capitalBaseUsd: numberOrNull(orderPlan.capitalBaseUsd),
    virtualSeed: orderPlan.virtualSeed ?? null,
    budgetMultiplier: numberOrNull(orderPlan.budgetMultiplier),
    capReason: orderPlan.capReason ?? null,
    exitType: orderPlan.exitType ?? null
  };
}

function summarizeBacktest(backtest) {
  if (!backtest) return null;
  return {
    available: backtest.available !== false,
    score: numberOrNull(backtest.score),
    grade: backtest.grade ?? null,
    days: numberOrNull(backtest.days),
    winRatePct: numberOrNull(backtest.winRatePct),
    returnPct: numberOrNull(backtest.totalReturnPct ?? backtest.returnPct),
    maxDrawdownPct: numberOrNull(backtest.maxDrawdownPct),
    guardCoverage: backtest.guardCoverage ?? null,
    guardImpact: backtest.guardImpact ?? null,
    alphaBacktest: backtest.alphaBacktest ?? null,
    guardedBacktest: backtest.guardedBacktest ?? null,
    reason: backtest.reason ?? null
  };
}

function summarizePosition(position) {
  return {
    active: Number(position?.quantity ?? 0) > 0,
    quantity: numberOrNull(position?.quantity),
    averagePrice: numberOrNull(position?.averagePrice),
    marketValueUsd: numberOrNull(position?.marketValueUsd),
    investedAmountUsd: numberOrNull(position?.investedAmountUsd),
    peakPrice: numberOrNull(position?.peakPrice)
  };
}

function pickTargetSnapshot(target) {
  const keys = [
    "symbol",
    "enabled",
    "allocationPct",
    "leverage",
    "fastSmaDays",
    "slowSmaDays",
    "momentumDays",
    "minBuyRsi",
    "maxBuyRsi",
    "stopLossPct",
    "partialTakeProfitPct",
    "partialTakeProfitSellPct",
    "takeProfitPct",
    "trailingStopPct",
    "takeProfitRsi",
    "maxAtrPct",
    "minAdx"
  ];
  return Object.fromEntries(keys.map((key) => [key, target?.[key]]));
}

function pickSettingsSnapshot(settings) {
  const keys = [
    "allocationUsd",
    "cashBufferUsd",
    "useVirtualSeed",
    "allowSeedTopUp",
    "maxDailyLossPct",
    "maxPositionPct",
    "maxLeveragedExposurePct",
    "intradayDropBlockPct",
    "intradayPanicExitPct",
    "allowFractional",
    "allowExtendedHoursDefensiveSells",
    "redistributeUnusedAllocation",
    "allowAdditionalBuys",
    "additionalBuyCooldownMinutes"
  ];
  return Object.fromEntries(keys.map((key) => [key, settings?.[key]]));
}

function compactPayload(payload) {
  if (!payload || typeof payload !== "object") return payload;
  return JSON.parse(JSON.stringify(payload, (_key, value) => {
    if (Array.isArray(value) && value.length > 20) return value.slice(0, 20);
    return value;
  }));
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = selector(item) || "없음";
    counts[key] = (counts[key] ?? 0) + 1;
    return counts;
  }, {});
}

function topCounts(items, limit) {
  return Object.entries(countBy(items, (item) => item))
    .map(([label, count]) => ({ label, count }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit);
}

function flatten(items) {
  return items.flatMap((item) => item ?? []);
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
