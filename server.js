import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchNews } from "./src/news.js";
import { loadState, saveState, saveTraderState, updateState } from "./src/store.js";
import {
  optimizeTargetSettings,
  isCurrentStrategyEngine,
  recommendPortfolioWeights,
  recommendTargetSettings,
  robustBacktestTarget,
  strategySummary
} from "./src/strategy.js";
import { getExternalDailyCandles } from "./src/marketData.js";
import { actionCostsForTargets } from "./src/rateLimiter.js";
import { TossClient } from "./src/tossClient.js";
import { Trader } from "./src/trader.js";
import { buildLearningReport, recordRecommendationEvent } from "./src/learning.js";
import { buildValidation, BENCHMARK_SYMBOL } from "./src/validation.js";
import { fetchEconomicCalendar, summarizeMacroTone } from "./src/calendar.js";
import { fetchEarningsEvents } from "./src/earnings.js";
import { listEventCalendar } from "./src/eventRisk.js";
import { enforceDashboardAuth } from "./src/auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "public");
loadEnvFile(path.join(__dirname, ".env"));
const port = Number(process.env.PORT || 3000);
const tossClient = new TossClient();
const trader = new Trader({ tossClient, store: { loadState, saveState, saveTraderState } });
const recommendationCache = new Map();
const RECOMMENDATION_CACHE_MS = 60 * 60_000;
let publicIpCache = null;
const PUBLIC_IP_CACHE_MS = 5 * 60_000;

trader.start();
refreshNews().catch(() => {});
setInterval(refreshNews, Math.max(5, Number(process.env.NEWS_REFRESH_MINUTES || 30)) * 60_000);
// 경제(증시) 캘린더 자동 갱신(60분). 손 안 대도 최신 일정·발표 결과(호재/악재)가 유지된다.
refreshEconomicCalendar().catch(() => {});
setInterval(() => refreshEconomicCalendar().catch(() => {}), 60 * 60_000);
// 종목 실적 발표일 자동 수집(Nasdaq). 사용자 입력 없이 활성 종목의 실적 전후 신규매수를 차단한다.
refreshEarningsEvents().catch(() => {});
setInterval(() => refreshEarningsEvents().catch(() => {}), 12 * 60 * 60_000);

const server = http.createServer(async (request, response) => {
  try {
    if (!enforceDashboardAuth(request, response)) return;
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(request, response, url);
      return;
    }
    await serveStatic(response, url.pathname);
  } catch (error) {
    sendJson(response, 500, { error: error.message, data: error.data ?? null });
  }
});

server.listen(port, () => {
  console.log(`Toss Invest Terminal running on http://localhost:${port}`);
});
setInterval(() => runAutomationIfDue().catch(() => {}), 60_000);
// 개선 리포트 자동 갱신: autoLearningReports가 켜져 있으면 주기적으로(30분) 스스로 돌린다.
// 저장된 데이터만 분석하는 가벼운 작업이라 외부 호출이 없다. 마지막 자동 실행 시각도 남긴다.
const LEARNING_AUTO_INTERVAL_MS = 30 * 60_000;
refreshLearningReportIfEnabled().catch(() => {});
setInterval(() => refreshLearningReportIfEnabled().catch(() => {}), LEARNING_AUTO_INTERVAL_MS);
async function refreshLearningReportIfEnabled() {
  await updateState((draft) => {
    if (!draft.settings?.autoLearningReports) return;
    buildLearningReport(draft);
    draft.learning.lastAutoReportAt = new Date().toISOString();
  });
}

// 봇 자가판단: 켜진 자동화 항목(안전설정/전체비중/종목전략/개선리포트)을 검토 주기마다 한 번씩 실행한다.
// - force=true(수동 "지금 자가판단 실행")이면 주기와 상관없이 즉시 실행한다.
// - 전체비중/안전설정은 추천값을 계산해 곧바로 적용한다.
// - 종목전략은 보유 중인 종목이면 적용하지 않고 추천만 보류 저장한다.
// - 외부 데이터 호출은 추천 캐시(1시간)를 재사용해 과도한 호출을 막는다.
async function runAutomationIfDue({ force = false } = {}) {
  const baseState = await loadState();
  const settings = baseState.settings ?? {};
  const flags = {
    weights: Boolean(settings.autoWeightRecommendations),
    safety: Boolean(settings.autoSafetyRecommendations),
    target: Boolean(settings.autoTargetRecommendations),
    learning: Boolean(settings.autoLearningReports)
  };
  if (!Object.values(flags).some(Boolean)) {
    return { skipped: true, reason: "켜진 자가판단 항목이 없습니다.", state: baseState, actions: [] };
  }

  const intervalMs = Math.max(60, Number(settings.autoRecommendationIntervalMinutes ?? 360)) * 60_000;
  const lastRunAt = baseState.automation?.lastRunAt ? new Date(baseState.automation.lastRunAt).getTime() : 0;
  if (!force && lastRunAt && Date.now() - lastRunAt < intervalMs) {
    const waitMinutes = Math.ceil((intervalMs - (Date.now() - lastRunAt)) / 60_000);
    return { skipped: true, reason: `자동 검토 주기까지 약 ${waitMinutes}분 남았습니다.`, state: baseState, actions: [] };
  }

  const actions = [];
  const errors = [];
  let weightRecommendation = null;
  let safetyRecommendation = null;
  const targetRecommendations = [];

  if (flags.weights) {
    try {
      weightRecommendation = await cachedRecommendation(
        `weights:${targetsCacheKey(baseState.targets)}:${backtestSafetyCacheKey(baseState.settings)}`,
        async () => {
          const backtests = await buildBacktests(
            baseState.targets.filter((target) => target.enabled !== false),
            baseState.settings
          );
          return recommendPortfolioWeights({ targets: baseState.targets, snapshots: baseState.marketSnapshots, backtests });
        }
      );
      const preview = Object.entries(weightRecommendation.weights ?? {})
        .map(([symbol, weight]) => `${symbol} ${weight}%`)
        .join(", ");
      actions.push({ type: "portfolio-weights", message: `전체비중 추천 적용: ${preview || "변경 없음"}` });
    } catch (error) {
      errors.push(`전체비중 추천 실패: ${error.message}`);
    }
  }

  // 비중을 먼저 반영한 미리보기 상태로 안전설정을 계산해, 같은 회차의 변경이 서로 어긋나지 않게 한다.
  const previewTargets = baseState.targets.map((target) =>
    weightRecommendation?.weights?.[target.symbol] !== undefined
      ? { ...target, allocationPct: weightRecommendation.weights[target.symbol] }
      : target
  );

  if (flags.safety) {
    try {
      safetyRecommendation = recommendSafetySettings({ ...baseState, targets: previewTargets });
      actions.push({ type: "safety-settings", message: `안전설정 추천 적용 (점수 ${safetyRecommendation.score}/100)` });
    } catch (error) {
      errors.push(`안전설정 추천 실패: ${error.message}`);
    }
  }

  if (flags.target) {
    for (const target of baseState.targets.filter((item) => item.enabled !== false)) {
      const held = Number(baseState.positions?.[target.symbol]?.quantity ?? 0) > 1e-6;
      try {
        const recommendation = await cachedRecommendation(
          `target:fast:${target.symbol}:${targetCacheKey(target)}:${backtestSafetyCacheKey(baseState.settings)}`,
          async () => {
            const candles = await loadCandlesForRecommendation(target.symbol);
            return recommendTargetSettings({
              target,
              snapshot: baseState.marketSnapshots?.[target.symbol],
              candles,
              mode: "fast",
              settings: baseState.settings
            });
          }
        );
        targetRecommendations.push({ symbol: target.symbol, recommendation, applied: !held });
        actions.push({
          type: "target-settings",
          message: held
            ? `${target.symbol} 종목전략 추천 보류(보유 중) · 점수 ${recommendation.score}/100`
            : `${target.symbol} 종목전략 추천 적용 · 점수 ${recommendation.score}/100`
        });
      } catch (error) {
        errors.push(`${target.symbol} 종목전략 추천 실패: ${error.message}`);
      }
    }
  }

  const finalState = await updateState((draft) => {
    if (weightRecommendation?.weights) {
      for (const target of draft.targets) {
        if (weightRecommendation.weights[target.symbol] !== undefined) {
          target.allocationPct = weightRecommendation.weights[target.symbol];
        } else if (target.enabled === false) {
          target.allocationPct = 0;
        }
      }
      draft.lastWeightRecommendation = { ...weightRecommendation, appliedAt: new Date().toISOString() };
      recordRecommendationEvent(draft, "portfolio-weights", draft.lastWeightRecommendation);
    }

    if (safetyRecommendation?.recommended) {
      draft.settings = { ...draft.settings, ...safetyRecommendation.recommended };
      if (draft.settings.liveTradingEnabled && process.env.LIVE_TRADING !== "true") {
        draft.settings.liveTradingEnabled = false;
        draft.settings.dryRun = true;
        draft.health.lastError = "LIVE_TRADING=true 환경변수가 없어 실제 주문을 켤 수 없습니다.";
      }
      draft.lastSafetyRecommendation = { ...safetyRecommendation, appliedAt: new Date().toISOString() };
      recordRecommendationEvent(draft, "safety-settings", draft.lastSafetyRecommendation);
    }

    for (const { symbol, recommendation, applied } of targetRecommendations) {
      const draftTarget = draft.targets.find((item) => item.symbol === symbol);
      if (!draftTarget) continue;
      // before 비교가 변경 전 값을 담도록, 추천값을 적용하기 전에 요약을 만든다.
      const summary = summarizeTargetRecommendation(draftTarget, recommendation);
      if (applied && recommendation.recommended) {
        Object.assign(draftTarget, recommendation.recommended);
      }
      draftTarget.lastRecommendation = summary;
      if (applied && recommendationMatchesTarget(draftTarget, draftTarget.lastRecommendation)) {
        draftTarget.lastStrategyReview = {
          ...(draftTarget.lastRecommendation.backtest ?? {}),
          engineVersion: strategySummary.name,
          reviewedAt: new Date().toISOString()
        };
        draftTarget.lastRecommendation.appliedAt = new Date().toISOString();
      }
      recordRecommendationEvent(draft, "target-settings", { symbol, mode: "fast", applied, recommendation: draftTarget.lastRecommendation });
    }

    if (flags.learning) {
      const report = buildLearningReport(draft);
      actions.push({ type: "learning-report", message: `개선 리포트 갱신 (데이터 품질 ${report.dataQuality?.grade ?? "-"})` });
    }

    draft.automation = {
      lastRunAt: new Date().toISOString(),
      lastActions: actions,
      lastError: errors.length ? errors.join(" / ") : null
    };
  });

  return { skipped: false, state: finalState, actions, errors };
}

async function handleApi(request, response, url) {
  if (request.method === "GET" && url.pathname === "/api/state") {
    const state = await loadState();
    const enabledTargetCount = state.targets.filter((target) => target.enabled !== false).length;
    const publicIp = await getPublicIp();
    const validation = await computeValidation(state);
    sendJson(response, 200, {
      ...state,
      // 무거운 결정 샘플 배열은 폴링 응답에서 빼고 개수만 보낸다(브라우저는 길이만 사용).
      learning: {
        ...state.learning,
        decisionSamples: undefined,
        decisionSampleCount: state.learning?.decisionSamples?.length ?? 0
      },
      validation,
      macroTone: summarizeMacroTone(state.economicCalendar),
      strategy: strategySummary,
      runtime: {
        liveTradingEnv: process.env.LIVE_TRADING === "true",
        mockMode: tossClient.isMockMode(),
        publicIp,
        localNetwork: getLocalNetworkInfo(),
        rateLimits: {
          ...tossClient.getRateLimitSnapshot(),
          actions: actionCostsForTargets(enabledTargetCount)
        }
      }
    });
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/public-ip") {
    sendJson(response, 200, await getPublicIp({ force: url.searchParams.get("refresh") === "true" }));
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/local-network") {
    sendJson(response, 200, getLocalNetworkInfo());
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/rate-limits") {
    const state = await loadState();
    const enabledTargetCount = state.targets.filter((target) => target.enabled !== false).length;
    sendJson(response, 200, {
      ...tossClient.getRateLimitSnapshot(),
      actions: actionCostsForTargets(enabledTargetCount)
    });
    return;
  }

  if (request.method === "PATCH" && url.pathname === "/api/settings") {
    const body = await readBody(request);
    const state = await updateState((draft) => {
      draft.settings = { ...draft.settings, ...pickSettings(body) };
      if (body.liveTradingEnabled && process.env.LIVE_TRADING !== "true") {
        draft.settings.liveTradingEnabled = false;
        draft.settings.dryRun = true;
        draft.health.lastError = "LIVE_TRADING=true 환경변수가 없어 실제 주문을 켤 수 없습니다.";
      }
      draft.settings.dryRun = !(process.env.LIVE_TRADING === "true" && draft.settings.liveTradingEnabled);
    });
    sendJson(response, 200, state);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/engine/toggle") {
    const body = await readBody(request);
    const state = await updateState((draft) => {
      draft.settings.monitoringEnabled = Boolean(body.enabled);
      draft.health.status = body.enabled ? "monitoring" : "paused";
    });
    sendJson(response, 200, state);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/bot-budget/add") {
    const body = await readBody(request);
    const amount = Number(body.amountUsd ?? body.amount ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("추가할 금액은 0보다 커야 합니다.");
    }
    const state = await updateState((draft) => {
      const before = Math.max(0, Number(draft.settings.allocationUsd ?? 0));
      const next = roundNumber(before + amount, 2);
      draft.settings.allocationUsd = next;
      draft.settings.useVirtualSeed = true;
      draft.settings.allowSeedTopUp = false;
      draft.orderEvents.unshift({
        id: `${Date.now()}-BOT-BUDGET_ADD`,
        symbol: "BOT",
        type: "BUDGET",
        message: `봇 자금 ${formatUsd(amount)} 추가: ${formatUsd(before)} → ${formatUsd(next)}`,
        createdAt: new Date().toISOString()
      });
      draft.orderEvents = draft.orderEvents.slice(0, 100);
      recordRecommendationEvent(draft, "budget-add", {
        amountUsd: roundNumber(amount, 2),
        beforeAllocationUsd: before,
        afterAllocationUsd: next
      });
    });
    sendJson(response, 200, state);
    return;
  }

  if (
    (request.method === "GET" || request.method === "POST") &&
    url.pathname === "/api/recommendations/safety"
  ) {
    const state = await loadState();
    const body = request.method === "POST" ? await readBody(request) : {};
    const preview = withPreviewSettings(state, body.settings ?? body);
    sendJson(response, 200, recommendSafetySettings(preview));
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/recommendations/safety/apply") {
    const current = await loadState();
    const body = await readBody(request);
    const inputSettings = pickSettings(body.settings ?? body);
    const preview = withPreviewSettings(current, inputSettings);
    const recommendation = recommendSafetySettings(preview);
    const state = await updateState((draft) => {
      draft.settings = { ...draft.settings, ...inputSettings, ...recommendation.recommended };
      if (draft.settings.liveTradingEnabled && process.env.LIVE_TRADING !== "true") {
        draft.settings.liveTradingEnabled = false;
        draft.settings.dryRun = true;
        draft.health.lastError = "LIVE_TRADING=true 환경변수가 없어 실제 주문을 켤 수 없습니다.";
      }
      draft.lastSafetyRecommendation = {
        ...recommendation,
        appliedAt: new Date().toISOString()
      };
      recordRecommendationEvent(draft, "safety-settings", draft.lastSafetyRecommendation);
    });
    sendJson(response, 200, state);
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/recommendations/weights") {
    const state = await loadState();
    const recommendation = await cachedRecommendation(
      `weights:${targetsCacheKey(state.targets)}:${backtestSafetyCacheKey(state.settings)}`,
      async () => {
      const backtests = await buildBacktests(state.targets.filter((target) => target.enabled !== false), state.settings);
      return recommendPortfolioWeights({ targets: state.targets, snapshots: state.marketSnapshots, backtests });
      }
    );
    sendJson(response, 200, { ...recommendation, engineVersion: strategySummary.name });
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/recommendations/weights/apply") {
    const current = await loadState();
    const recommendation = await cachedRecommendation(
      `weights:${targetsCacheKey(current.targets)}:${backtestSafetyCacheKey(current.settings)}`,
      async () => {
      const backtests = await buildBacktests(current.targets.filter((target) => target.enabled !== false), current.settings);
      return recommendPortfolioWeights({ targets: current.targets, snapshots: current.marketSnapshots, backtests });
      }
    );
    const state = await updateState((draft) => {
      for (const target of draft.targets) {
        if (recommendation.weights[target.symbol] !== undefined) {
          target.allocationPct = recommendation.weights[target.symbol];
        } else if (target.enabled === false) {
          // 비활성 종목은 배정 대상이 아니라 비중 0으로 둬, 활성 종목 비중 합이 100을 넘어 보이지 않게 한다.
          target.allocationPct = 0;
        }
      }
      draft.lastWeightRecommendation = {
        ...recommendation,
        appliedAt: new Date().toISOString()
      };
      recordRecommendationEvent(draft, "portfolio-weights", draft.lastWeightRecommendation);
    });
    sendJson(response, 200, state);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/targets") {
    const body = await readBody(request);
    const state = await updateState((draft) => {
      const symbol = String(body.symbol ?? "").trim().toUpperCase();
      if (!symbol) throw new Error("symbol is required");
      if (draft.targets.some((target) => target.symbol === symbol)) throw new Error("target already exists");
      draft.targets.push({
        symbol,
        name: body.name || symbol,
        enabled: body.enabled ?? true,
        riskProfile: body.riskProfile || "custom",
        allocationPct: Number(body.allocationPct || 10),
        leverage: body.leverage || "custom",
        fastSmaDays: Number(body.fastSmaDays || 20),
        slowSmaDays: Number(body.slowSmaDays || 50),
        momentumDays: Number(body.momentumDays || 5),
        minBuyRsi: Number(body.minBuyRsi || 45),
        maxBuyRsi: Number(body.maxBuyRsi || 72),
        stopLossPct: Number(body.stopLossPct || 8),
        partialTakeProfitPct: Number(body.partialTakeProfitPct || 10),
        partialTakeProfitSellPct: Number(body.partialTakeProfitSellPct || 40),
        takeProfitPct: Number(body.takeProfitPct || 18),
        trailingStopPct: Number(body.trailingStopPct || 10),
        takeProfitRsi: Number(body.takeProfitRsi || 78),
        maxAtrPct: Number(body.maxAtrPct || 12),
        minAdx: Number(body.minAdx || 0),
        notes: body.notes || ""
      });
    });
    // 새 종목의 뉴스·실적 일정을 즉시 반영(다음 폴링에서 표시). 응답은 기다리지 않는다.
    refreshNews().catch(() => {});
    refreshEarningsEvents().catch(() => {});
    sendJson(response, 200, state);
    return;
  }

  const targetMatch = url.pathname.match(/^\/api\/targets\/([A-Za-z0-9.-]+)$/);
  const recommendMatch = url.pathname.match(/^\/api\/targets\/([A-Za-z0-9.-]+)\/recommendation$/);
  if (recommendMatch && request.method === "GET") {
    const symbol = recommendMatch[1].toUpperCase();
    const state = await loadState();
    const target = state.targets.find((item) => item.symbol === symbol);
    if (!target) throw new Error("target not found");
    const mode = url.searchParams.get("mode") === "deep" ? "deep" : "fast";
    const recommendation = await cachedRecommendation(
      `target:${mode}:${symbol}:${targetCacheKey(target)}:${backtestSafetyCacheKey(state.settings)}`,
      async () => {
      const candles = await loadCandlesForRecommendation(symbol);
      return recommendTargetSettings({ target, snapshot: state.marketSnapshots?.[symbol], candles, mode, settings: state.settings });
      }
    );
    await updateState((draft) => {
      const draftTarget = draft.targets.find((item) => item.symbol === symbol);
      if (!draftTarget) return;
      draftTarget.lastRecommendation = summarizeTargetRecommendation(target, recommendation);
      recordRecommendationEvent(draft, "target-settings", {
        symbol,
        mode,
        recommendation: draftTarget.lastRecommendation
      });
    });
    sendJson(response, 200, { ...recommendation, engineVersion: strategySummary.name });
    return;
  }

  if (targetMatch && request.method === "PATCH") {
    const body = await readBody(request);
    const symbol = targetMatch[1].toUpperCase();
    const state = await updateState((draft) => {
      const target = draft.targets.find((item) => item.symbol === symbol);
      if (!target) throw new Error("target not found");
      const updates = pickTarget(body);
      const hadAllocation = Number(target.allocationPct ?? 0);
      const togglingOff = Object.prototype.hasOwnProperty.call(updates, "enabled") && updates.enabled === false;
      const togglingOn = Object.prototype.hasOwnProperty.call(updates, "enabled") && updates.enabled !== false;
      if (togglingOff && hadAllocation > 0) target.pausedAllocationPct = hadAllocation;
      Object.assign(target, updates);
      // 자동투자 대상을 끄면 배정 비중을 0으로 맞춘다(꺼진 종목이 시드 비중을 차지하지 않도록).
      if (target.enabled === false) target.allocationPct = 0;
      // 다시 켤 때는 OFF 직전 비중을 복구한다. 사용자가 편집창에서 직접 0%를 저장한 경우는 존중한다.
      if (togglingOn && !Object.prototype.hasOwnProperty.call(updates, "allocationPct") && Number(target.allocationPct ?? 0) <= 0) {
        const paused = Number(target.pausedAllocationPct ?? 0);
        target.allocationPct = paused > 0 ? paused : 10;
      }
      if (recommendationMatchesTarget(target, target.lastRecommendation)) {
        target.lastStrategyReview = {
          ...(target.lastRecommendation.backtest ?? {}),
          engineVersion: strategySummary.name,
          reviewedAt: new Date().toISOString()
        };
        target.lastRecommendation.appliedAt = new Date().toISOString();
      } else if (isCurrentStrategyEngine(target.lastRecommendation?.engineVersion)) {
        target.lastStrategyReview = null;
      }
    });
    // 종목을 켜고 끄면 추적 대상(뉴스 심볼·실적 일정)이 바뀌므로 즉시 새로고침한다.
    if ("enabled" in body) {
      refreshNews().catch(() => {});
      refreshEarningsEvents().catch(() => {});
    }
    sendJson(response, 200, state);
    return;
  }

  if (targetMatch && request.method === "DELETE") {
    const symbol = targetMatch[1].toUpperCase();
    const state = await updateState((draft) => {
      draft.targets = draft.targets.filter((item) => item.symbol !== symbol);
      delete draft.positions[symbol];
      delete draft.marketSnapshots[symbol];
    });
    refreshNews().catch(() => {});
    refreshEarningsEvents().catch(() => {});
    sendJson(response, 200, state);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/events/refresh") {
    await refreshEarningsEvents();
    sendJson(response, 200, await loadState());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/run-once") {
    await trader.tick({ force: true });
    sendJson(response, 200, await loadState());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sync-news") {
    await refreshNews();
    sendJson(response, 200, await loadState());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/sync-orders") {
    sendJson(response, 200, await trader.syncOrdersOnly());
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/learning/report") {
    const report = await updateState((draft) => buildLearningReport(draft));
    sendJson(response, 200, report);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/automation/run") {
    const result = await runAutomationIfDue({ force: true });
    sendJson(response, 200, result);
    return;
  }

  if (request.method === "POST" && url.pathname === "/api/test-connection") {
    try {
      const accounts = await tossClient.getAccounts();
      await updateState((draft) => {
        draft.health.lastError = null;
        draft.health.tossConnected = !tossClient.isMockMode();
        draft.health.mockMode = tossClient.isMockMode();
        draft.health.lastApiSyncAt = new Date().toISOString();
      });
      sendJson(response, 200, { ok: true, mockMode: tossClient.isMockMode(), accounts: accounts.result ?? [] });
    } catch (error) {
      await updateState((draft) => {
        draft.health.lastError = error.data?.error_description || error.message;
        draft.health.tossConnected = false;
        draft.health.mockMode = tossClient.isMockMode();
        draft.health.lastApiSyncAt = new Date().toISOString();
      });
      sendJson(response, 200, {
        ok: false,
        mockMode: tossClient.isMockMode(),
        error: error.data?.error_description || error.message,
        data: error.data ?? null
      });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

async function serveStatic(response, pathname) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(publicDir, safePath));
  if (!filePath.startsWith(publicDir)) {
    sendJson(response, 403, { error: "Forbidden" });
    return;
  }
  const data = await readFile(filePath);
  response.writeHead(200, { "Content-Type": contentType(filePath) });
  response.end(data);
}

async function readBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw ? JSON.parse(raw) : {};
}

function sendJson(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function contentType(filePath) {
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".js")) return "application/javascript; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  return "text/html; charset=utf-8";
}

async function refreshEconomicCalendar() {
  try {
    const calendar = await fetchEconomicCalendar();
    await updateState((draft) => {
      draft.economicCalendar = calendar;
      draft.health.lastCalendarRefreshAt = new Date().toISOString();
    });
  } catch (error) {
    await updateState((draft) => {
      draft.health.lastError = `경제 캘린더 조회 실패: ${error.message}`;
    });
  }
}

async function refreshNews() {
  try {
    const current = await loadState();
    const news = await fetchNews(current.targets ?? []);
    await updateState((draft) => {
      draft.news = news;
      draft.health.lastNewsRefreshAt = new Date().toISOString();
    });
  } catch (error) {
    await updateState((draft) => {
      draft.health.lastError = `뉴스 동기화 실패: ${error.message}`;
    });
  }
}

// 활성 종목의 실적 발표일을 자동 수집해 state.earningsEvents에 저장한다(사용자 입력 없음).
// 실패해도 빈 배열로 떨어져 잘못된 차단을 만들지 않는다.
async function refreshEarningsEvents() {
  try {
    const current = await loadState();
    const symbols = [
      ...new Set(
        (current.targets ?? [])
          .filter((target) => target.enabled !== false && target.symbol)
          .map((target) => String(target.symbol).toUpperCase())
      )
    ];
    const events = await fetchEarningsEvents(symbols);
    await updateState((draft) => {
      draft.earningsEvents = events;
      draft.eventCalendar = listEventCalendar(events);
      draft.health.lastEarningsRefreshAt = new Date().toISOString();
    });
  } catch (error) {
    await updateState((draft) => {
      draft.health.lastError = `실적 일정 동기화 실패: ${error.message}`;
    });
  }
}

async function getPublicIp({ force = false } = {}) {
  const now = Date.now();
  if (!force && publicIpCache && now - publicIpCache.createdAt < PUBLIC_IP_CACHE_MS) {
    return {
      ...publicIpCache.value,
      cache: {
        hit: true,
        ttlSec: Math.max(0, Math.ceil((PUBLIC_IP_CACHE_MS - (now - publicIpCache.createdAt)) / 1000))
      }
    };
  }

  try {
    const response = await fetch("https://api.ipify.org?format=json", {
      headers: { Accept: "application/json" }
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const data = await response.json();
    const value = {
      ip: String(data.ip ?? ""),
      checkedAt: new Date(now).toISOString(),
      source: "api.ipify.org",
      error: null
    };
    publicIpCache = { createdAt: now, value };
    return {
      ...value,
      cache: {
        hit: false,
        ttlSec: Math.ceil(PUBLIC_IP_CACHE_MS / 1000)
      }
    };
  } catch (error) {
    return {
      ip: publicIpCache?.value?.ip ?? null,
      checkedAt: publicIpCache?.value?.checkedAt ?? null,
      source: publicIpCache?.value?.source ?? "api.ipify.org",
      error: `공인 IP 조회 실패: ${error.message}`,
      cache: {
        hit: Boolean(publicIpCache),
        ttlSec: 0
      }
    };
  }
}

function getLocalNetworkInfo() {
  const interfaces = os.networkInterfaces();
  const addresses = Object.entries(interfaces)
    .flatMap(([name, entries]) =>
      (entries ?? [])
        .filter((entry) => entry.family === "IPv4" && !entry.internal)
        .map((entry) => ({
          name,
          ip: entry.address,
          url: `http://${entry.address}:${port}`
        }))
    )
    .sort((left, right) => scoreLocalIp(right.ip, right.name) - scoreLocalIp(left.ip, left.name));

  return {
    primary: addresses[0] ?? null,
    addresses,
    checkedAt: new Date().toISOString()
  };
}

function scoreLocalIp(ip, name) {
  let score = 0;
  if (/^192\.168\./.test(ip)) score += 5;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) score += 4;
  if (/^10\./.test(ip)) score += 3;
  if (/^en|^wl|wi-fi|wifi|ap/i.test(name)) score += 2;
  if (/bridge|docker|utun|awdl|llw/i.test(name)) score -= 4;
  return score;
}

// 검증(벤치마크·지표·증액게이트) 블록을 만든다. 벤치마크 캔들은 외부 데이터라 짧게 캐시해
// /api/state 폴링(20초)마다 야후를 때리지 않게 한다(getExternalDailyCandles 자체도 30분 캐시).
let validationCache = null;
const VALIDATION_CACHE_MS = 30_000;
async function computeValidation(state) {
  const now = Date.now();
  if (validationCache && now - validationCache.createdAt < VALIDATION_CACHE_MS) {
    return buildValidation({ ...validationCache.inputs, state });
  }
  let candles = [];
  try {
    candles = await getExternalDailyCandles(BENCHMARK_SYMBOL, { range: "5y" });
  } catch {
    candles = [];
  }
  const currentPrice = Number(
    state?.marketSnapshots?.[BENCHMARK_SYMBOL]?.signal?.metrics?.lastPrice ?? candles.at(-1)?.close
  );
  validationCache = { createdAt: now, inputs: { candles, currentPrice } };
  return buildValidation({ state, candles, currentPrice });
}

async function loadCandlesForRecommendation(symbol) {
  try {
    return await getExternalDailyCandles(symbol, { range: "5y" });
  } catch (error) {
    throw new Error(`추천 계산용 외부 데이터 조회 실패: ${symbol}. 잠시 후 다시 시도해 주세요. (${error.message})`);
  }
}

async function buildBacktests(targets, settings = {}) {
  const entries = await Promise.all(
    targets.map(async (target) => {
      try {
        const candles = await loadCandlesForRecommendation(target.symbol);
        const optimized = optimizeTargetSettings({ target, candles, settings });
        return [target.symbol, optimized?.backtest ?? robustBacktestTarget({ target, candles, settings })];
      } catch (error) {
        return [
          target.symbol,
          {
            available: false,
            source: "external",
            reason: error.message,
            score: 0
          }
        ];
      }
    })
  );
  return Object.fromEntries(entries);
}

async function cachedRecommendation(key, producer) {
  const cached = recommendationCache.get(key);
  const now = Date.now();
  if (cached && now - cached.createdAt < RECOMMENDATION_CACHE_MS) {
    return {
      ...cached.value,
      cache: {
        hit: true,
        createdAt: new Date(cached.createdAt).toISOString(),
        ttlMinutes: Math.round((RECOMMENDATION_CACHE_MS - (now - cached.createdAt)) / 60_000)
      }
    };
  }
  const value = await producer();
  recommendationCache.set(key, { createdAt: now, value });
  return {
    ...value,
    cache: {
      hit: false,
      createdAt: new Date(now).toISOString(),
      ttlMinutes: Math.round(RECOMMENDATION_CACHE_MS / 60_000)
    }
  };
}

function targetCacheKey(target) {
  return JSON.stringify({ engineVersion: strategySummary.name, target: pickStrategyFields(target) });
}

function backtestSafetyCacheKey(settings) {
  return JSON.stringify({
    intradayDropBlockPct: Number(settings?.intradayDropBlockPct ?? 0),
    intradayPanicExitPct: Number(settings?.intradayPanicExitPct ?? 0)
  });
}

function targetsCacheKey(targets) {
  return JSON.stringify({ engineVersion: strategySummary.name, targets: targets.map((target) => pickStrategyFields(target)) });
}

function pickStrategyFields(target) {
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
  return Object.fromEntries(keys.map((key) => [key, target[key]]));
}

function summarizeStrategyReview(recommendation) {
  const backtest = recommendation.backtest ?? {};
  return {
    engineVersion: strategySummary.name,
    score: recommendation.score ?? null,
    grade: recommendation.grade ?? null,
    warning: recommendation.warning ?? null,
    summary: backtest.summary ?? null,
    days: backtest.days ?? null,
    robust: Boolean(backtest.robust),
    trainDays: backtest.train?.days ?? null,
    trainScore: backtest.train?.score ?? null,
    validationDays: backtest.validation?.days ?? null,
    validationScore: backtest.validation?.score ?? null,
    guardCoverage: backtest.guardCoverage ?? null,
    guardImpact: backtest.guardImpact ?? null,
    alphaBacktest: backtest.alphaBacktest ?? null,
    guardedBacktest: backtest.guardedBacktest ?? null,
    reviewedAt: new Date().toISOString()
  };
}

function summarizeTargetRecommendation(currentTarget, recommendation) {
  return {
    engineVersion: strategySummary.name,
    score: recommendation.score ?? null,
    grade: recommendation.grade ?? null,
    warning: recommendation.warning ?? null,
    recommended: recommendation.recommended ?? null,
    before: pickStrategyFields(currentTarget),
    reasons: recommendation.reasons ?? [],
    backtest: summarizeStrategyReview(recommendation),
    calculatedAt: new Date().toISOString(),
    cache: recommendation.cache ?? null
  };
}

function recommendationMatchesTarget(target, recommendation) {
  if (!recommendation?.recommended || !isCurrentStrategyEngine(recommendation.engineVersion)) return false;
  return Object.entries(recommendation.recommended).every(([key, value]) => {
    const current = target[key];
    if (typeof value === "number") return Math.abs(Number(current) - value) < 0.000001;
    return current === value;
  });
}

function recommendSafetySettings(state) {
  const activeTargets = state.targets.filter((target) => target.enabled !== false);
  const scoredTargets = activeTargets.map((target) => {
    // 엔진 버전이 바뀐 뒤의 옛 리뷰 점수를 쓰지 않도록, 현재 엔진 리뷰만 신뢰하고 아니면 현재 스냅샷 백테스트로 폴백.
    const review = target.lastStrategyReview;
    const reviewScore = review && isCurrentStrategyEngine(review.engineVersion) ? review.score : undefined;
    const score = Number(reviewScore ?? state.marketSnapshots?.[target.symbol]?.backtest?.score ?? 55);
    const leverage = parseLeverageText(target.leverage);
    const allocation = Number(target.allocationPct ?? 0);
    const atr = Number(state.marketSnapshots?.[target.symbol]?.signal?.metrics?.atrPct ?? target.maxAtrPct ?? 12);
    return { target, score, leverage, allocation, atr };
  });
  const maxLeverage = Math.max(1, ...scoredTargets.map((item) => item.leverage));
  const weightedScore = weightedAverage(scoredTargets.map((item) => [item.score, item.allocation])) ?? 55;
  const weightedAtr = weightedAverage(scoredTargets.map((item) => [item.atr, item.allocation])) ?? 12;
  const weakCount = scoredTargets.filter((item) => item.score < 65).length;
  const hasTriple = scoredTargets.some((item) => item.leverage >= 3);
  const hasLowConfidence = scoredTargets.some((item) => item.score < 55);
  const allocationUsd = Math.max(0, Number(state.settings.allocationUsd ?? 1000));
  const bufferRate = hasTriple ? 0.18 : 0.12;
  const minimumBuffer = allocationUsd <= 0 ? 0 : allocationUsd < 100 ? Math.max(1, allocationUsd * 0.08) : 25;
  const maximumBuffer = allocationUsd <= 0 ? 0 : Math.max(1, allocationUsd * 0.2);

  const cashBufferUsd = roundToStep(clampNumber(allocationUsd * bufferRate, minimumBuffer, maximumBuffer), allocationUsd < 100 ? 1 : 5);
  const maxDailyLossPct = roundNumber(clampNumber(hasTriple ? 4.5 : 5.5, 3, weightedScore >= 85 ? 6 : 5.5), 1);
  const maxPositionPct = Math.round(clampNumber(weightedScore >= 85 && weakCount === 0 ? 60 : 45 - weakCount * 5, 25, 60));
  const maxLeveragedExposurePct = Math.round(clampNumber(hasTriple ? 105 : 130, 70, weightedScore >= 85 ? 135 : 115));
  const intradayDropBlockPct = roundNumber(clampNumber(Math.max(2.5, weightedAtr * 0.32), hasLowConfidence ? 2.5 : 3, 6), 1);
  const intradayPanicExitPct = roundNumber(clampNumber(Math.max(5, weightedAtr * 0.62), hasTriple ? 6 : 7, 11), 1);
  const additionalBuyCooldownMinutes = hasTriple || hasLowConfidence ? 360 : 240;
  const allowAdditionalBuys = weightedScore >= 85 && !hasLowConfidence && maxLeverage < 3;

  return {
    recommended: {
      useVirtualSeed: true,
      allowSeedTopUp: false,
      cashBufferUsd,
      maxDailyLossPct,
      maxPositionPct,
      maxLeveragedExposurePct,
      intradayDropBlockPct,
      intradayPanicExitPct,
      additionalBuyCooldownMinutes,
      allowAdditionalBuys
    },
    score: Math.round(weightedScore),
    reasons: [
      `활성 종목 ${activeTargets.map((target) => target.symbol).join(", ") || "없음"} 기준으로 계산했습니다.`,
      `자동투자 금액 ${formatUsd(allocationUsd)}를 기준으로 현금 버퍼를 계산했습니다.`,
      `가중 점수 ${Math.round(weightedScore)}/100, 평균 변동성 ${roundNumber(weightedAtr, 1)}%, 최대 레버리지 ${maxLeverage}x를 반영했습니다.`,
      "계좌가 분리되지 않는 환경이라 정해둔 봇 자금만 사용은 켜고, 손실 후 원금 자동 보충은 끄는 값을 권장합니다.",
      hasLowConfidence
        ? "점수가 낮거나 데이터가 짧은 종목이 있어 추가매수와 급락 기준을 보수적으로 잡았습니다."
        : "점수가 안정적인 편이라 기본 방어선을 유지했습니다.",
      "자동투자에 쓸 돈은 사용자가 정하는 값이라 추천에서 제외했습니다."
    ]
  };
}

function weightedAverage(pairs) {
  const valid = pairs.filter(([value, weight]) => Number.isFinite(value) && Number.isFinite(weight) && weight > 0);
  const totalWeight = valid.reduce((sum, [, weight]) => sum + weight, 0);
  if (!totalWeight) return null;
  return valid.reduce((sum, [value, weight]) => sum + value * weight, 0) / totalWeight;
}

function withPreviewSettings(state, settings) {
  return {
    ...state,
    settings: {
      ...state.settings,
      ...pickSettings(settings ?? {})
    }
  };
}

function parseLeverageText(value) {
  const match = String(value ?? "1x").match(/(\d+(?:\.\d+)?)x/i);
  return match ? Number(match[1]) : 1;
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function roundNumber(value, digits) {
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function roundToStep(value, step) {
  return Math.round(Number(value) / step) * step;
}

function formatUsd(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "$0";
  return `$${number.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function pickSettings(body) {
  const allowed = [
    "monitoringEnabled",
    "liveTradingEnabled",
    "allocationUsd",
    "cashBufferUsd",
    "useVirtualSeed",
    "allowSeedTopUp",
    "maxDailyLossPct",
    "maxPositionPct",
    "maxLeveragedExposurePct",
    "intradayDropBlockPct",
    "intradayPanicExitPct",
    "minAdx",
    "allowFractional",
    "allowExtendedHoursTrading",
    "allowExtendedHoursDefensiveSells",
    "redistributeUnusedAllocation",
    "allowAdditionalBuys",
    "additionalBuyCooldownMinutes",
    "smallSeedNoiseFloorUsd",
    "autoSafetyRecommendations",
    "autoWeightRecommendations",
    "autoTargetRecommendations",
    "autoLearningReports",
    "autoRecommendationIntervalMinutes",
    "pollIntervalSec"
  ];
  return Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
}

function pickTarget(body) {
  const allowed = [
    "name",
    "enabled",
    "riskProfile",
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
    "minAdx",
    "notes"
  ];
  return Object.fromEntries(Object.entries(body).filter(([key]) => allowed.includes(key)));
}

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  const lines = readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}
