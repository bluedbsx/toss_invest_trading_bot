import { backtestTarget, buildOrderPlan, evaluateTarget, parseLeverage } from "./strategy.js";
import { normalizeCandles } from "./indicators.js";
import { getEventRisk, getNewsRisk, listEventCalendar } from "./eventRisk.js";
import { getCalendarRisk } from "./calendar.js";
import { attachTradeLearningContext, recordDecisionSample } from "./learning.js";
import { recordEquitySnapshot } from "./validation.js";
import { DEFAULT_BOT_STARTED_AT } from "./store.js";

// 부동소수점 매매로 남는 미세한 수량 찌꺼기(예: 3e-18주)를 보유로 오인하지 않기 위한 기준값.
// 소수점 수량은 6자리까지만 추적하므로 1e-6주 미만은 사실상 0(전량 매도)으로 본다.
const POSITION_DUST_EPSILON = 1e-6;

export class Trader {
  constructor({ tossClient, store }) {
    this.tossClient = tossClient;
    this.store = store;
    this.timer = null;
    this.running = false;
  }

  start() {
    if (this.timer) clearInterval(this.timer);
    this.tick().catch(() => {});
    this.timer = setInterval(() => this.tick().catch(() => {}), 15_000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick({ force = false } = {}) {
    if (this.running) return;
    this.running = true;
    try {
      const state = await this.store.loadState();
      const intervalMs = Math.max(15, Number(state.settings.pollIntervalSec)) * 1000;
      const lastRunAt = state.settings.lastRunAt ? new Date(state.settings.lastRunAt).getTime() : 0;
      if (!force && Date.now() - lastRunAt < intervalMs) return;

      const result = await this.runOnce(state);
      await this.store.saveTraderState(result);
    } catch (error) {
      const state = await this.store.loadState();
      state.health = {
        ...state.health,
        status: state.settings.monitoringEnabled ? "monitoring" : "paused",
        lastError: error.data?.error_description || error.message,
        lastApiSyncAt: new Date().toISOString(),
        tossConnected: false,
        mockMode: this.tossClient.isMockMode()
      };
      await this.store.saveTraderState(state);
    } finally {
      this.running = false;
    }
  }

  async runOnce(state) {
    const calendar = await this.safe(() => this.tossClient.getUsCalendar(), null);
    const isRegularMarket = isUsRegularMarketOpen(calendar);
    const holdings = await this.safe(() => this.tossClient.getHoldings(), null);
    const liveTradingAllowed = process.env.LIVE_TRADING === "true" && state.settings.liveTradingEnabled;

    state.health = {
      ...state.health,
      status: state.settings.monitoringEnabled ? "monitoring" : "paused",
      lastError: null,
      lastApiSyncAt: new Date().toISOString(),
      tossConnected: !this.tossClient.isMockMode(),
      mockMode: this.tossClient.isMockMode()
    };

    state.settings.lastRunAt = new Date().toISOString();
    state.settings.dryRun = !liveTradingAllowed;
    state.settings.accountSeq = process.env.TOSS_ACCOUNT_SEQ || state.settings.accountSeq || "";
    state.account = holdings?.result ?? state.account ?? null;
    state.eventCalendar = listEventCalendar(state.customEvents ?? []);
    if (liveTradingAllowed) markPaperSessionInactive(state);
    if (!this.tossClient.isMockMode()) {
      await syncExecutedBotOrders(state, this.tossClient, { holdings, updatePortfolio: liveTradingAllowed });
    }
    if (!liveTradingAllowed) ensureDryRunPaperSession(state);
    state.ledgerMode = liveTradingAllowed ? "live" : "paper";

    const managedTargets = state.targets.filter(
      (target) => target.enabled || Number(state.positions?.[target.symbol]?.quantity ?? 0) > 0
    );
    const symbols = managedTargets.map((target) => target.symbol);
    const priceResponse = symbols.length ? await this.tossClient.getPrices(symbols) : { result: [] };
    const prices = Object.fromEntries((priceResponse.result ?? []).map((item) => [item.symbol, item]));

    const preparedTargets = [];
    const exposure = summarizeExposure(state, managedTargets, prices);
    const botBudget = summarizeBotBudget(state, exposure);
    state.botBudget = botBudget;
    // 검증용 일별 자산 스냅샷(하루 1개, 외부 호출 없이 이미 계산된 equity만 사용 → 틱 비용 불변).
    recordEquitySnapshot(state);
    const riskGuard = calculateDailyRiskGuard(state, managedTargets, prices);
    state.riskGuard = riskGuard;
    // 거시 지표 캘린더 리스크(전 종목 공통): 고영향 지표 임박/최근 악재면 신규매수 차단·축소.
    const calendarRisk = getCalendarRisk(state.economicCalendar);

    for (const target of managedTargets) {
      const candleResponse = await getCandlesWithFallback(this.tossClient, target.symbol, "1d", [260, 200, 120, 80]);
      const candles = candleResponse.result?.candles ?? [];
      const position = {
        ...hydratePosition(state, target.symbol, prices[target.symbol], holdings),
        canAddMore: canAddMore(state, target.symbol, state.settings)
      };
      persistPeakPrice(state, target.symbol, position);
      const eventRisk = getEventRisk(target.symbol, new Date(), state.customEvents ?? []);
      const newsRisk = getNewsRisk(target.symbol, state.news ?? [], new Date(), target.name);
      let signal = evaluateTarget({
        target,
        candles,
        price: prices[target.symbol],
        position,
        settings: state.settings,
        isRegularMarket,
        eventRisk,
        newsRisk,
        calendarRisk,
        botBudget
      });
      const backtest = backtestTarget({ target, candles, settings: state.settings });
      signal = applyProductionRiskGuards({ signal, position, riskGuard });

      preparedTargets.push({
        target,
        candles,
        position,
        signal,
        backtest
      });
    }

    const matchingBuyWeight = preparedTargets
      .filter((item) => item.signal.action === "BUY")
      .reduce((sum, item) => sum + Number(item.target.allocationPct ?? 0), 0);

    for (const { target, candles, position, signal, backtest } of preparedTargets) {

      state.marketSnapshots[target.symbol] = {
        price: prices[target.symbol] ?? null,
        signal,
        backtest,
        chart: buildChartSnapshot(target, candles, position, prices[target.symbol]),
        position: summarizePosition(target, position),
        isRegularMarket,
        updatedAt: new Date().toISOString()
      };

      const sellableQuantity = ["SELL", "PARTIAL_SELL"].includes(signal.action)
        ? await this.getSellableQuantity(target.symbol, position.quantity)
        : null;
      const orderPlan = buildOrderPlan({
        target,
        signal,
        price: prices[target.symbol],
        settings: state.settings,
        position,
        isRegularMarket,
        matchingBuyWeight,
        exposure,
        botBudget,
        sellableQuantity
      });
      recordDecisionSample(state, {
        target,
        signal,
        backtest,
        position,
        orderPlan,
        price: prices[target.symbol],
        isRegularMarket,
        matchingBuyWeight
      });

      if (!orderPlan || orderPlan.mode === "SKIP" || !state.settings.monitoringEnabled) {
        if (orderPlan?.mode === "SKIP") pushEvent(state, target.symbol, "SKIP", orderPlan.reason);
        else if (state.settings.monitoringEnabled) pushSafetyEvent(state, target.symbol, signal);
        continue;
      }

      const pendingSameSide = findPendingOrder(state, target.symbol, orderPlan.side);
      if (pendingSameSide) {
        pushEvent(state, target.symbol, "SKIP", `${orderPlan.side === "SELL" ? "매도" : "매수"} 주문이 이미 처리 중`);
        continue;
      }

      const order = toTossOrder(target.symbol, orderPlan);
      const lastPrice = Number(prices[target.symbol]?.lastPrice);
      const event = {
        id: `${Date.now()}-${target.symbol}`,
        symbol: target.symbol,
        side: order.side,
        mode: orderPlan.mode,
        quantity: orderPlan.quantity ?? orderPlan.expectedQuantity ?? null,
        orderAmount: orderPlan.orderAmount ?? null,
        estimatedPrice: Number.isFinite(lastPrice) ? lastPrice : null,
        estimatedValueUsd: estimateOrderValue(orderPlan, lastPrice),
        fractional: orderPlan.mode === "AMOUNT" || Boolean(orderPlan.fractional) || Number(orderPlan.quantity) % 1 !== 0,
        exitType: orderPlan.exitType ?? null,
        capReason: orderPlan.capReason ?? null,
        dryRun: !liveTradingAllowed,
        reason: signal.reasons.join(", "),
        requestedAt: new Date().toISOString(),
        request: order,
        response: null
      };
      attachTradeLearningContext(event, {
        target,
        signal,
        backtest,
        settings: state.settings,
        isRegularMarket
      });

      if (liveTradingAllowed) {
        try {
          event.response = await this.tossClient.createOrder(order);
        } catch (error) {
          event.status = "REJECTED";
          event.syncStatus = "REJECTED";
          event.error = {
            code: error.data?.error?.code ?? null,
            message: error.data?.error?.message ?? error.message,
            data: error.data?.error?.data ?? null
          };
          state.tradeHistory.unshift(event);
          state.tradeHistory = state.tradeHistory.slice(0, 300);
          state.health.lastTradingError = `${target.symbol} ${order.side}: ${event.error.message}`;
          pushEvent(state, target.symbol, "ORDER_ERROR", event.error.message);
          await this.store.saveTraderState(state);
          continue;
        }
      } else {
        event.response = { result: { status: "DRY_RUN", orderId: `dry-${event.id}` } };
      }
      event.orderId = extractOrderId(event.response);
      event.clientOrderId = event.request.clientOrderId;
      event.syncStatus = event.dryRun ? "DRY_RUN" : "PENDING";

      state.tradeHistory.unshift(event);
      state.tradeHistory = state.tradeHistory.slice(0, 300);
      if (event.dryRun) {
        const realizedPnlUsd = updatePaperPosition(state, target.symbol, orderPlan, lastPrice);
        if (Number.isFinite(realizedPnlUsd)) event.realizedPnlUsd = round(realizedPnlUsd, 2);
      }
      reserveExposureForOrder(exposure, target, orderPlan, lastPrice);
      await this.store.saveTraderState(state);
    }

    return state;
  }

  async syncOrdersOnly() {
    const state = await this.store.loadState();
    try {
      if (!this.tossClient.isMockMode()) {
        const holdings = await this.tossClient.getHoldings();
        state.account = holdings?.result ?? state.account ?? null;
        const liveTradingAllowed = process.env.LIVE_TRADING === "true" && state.settings.liveTradingEnabled;
        if (liveTradingAllowed) markPaperSessionInactive(state);
        await syncExecutedBotOrders(state, this.tossClient, { forceRecovery: true, holdings, updatePortfolio: liveTradingAllowed });
      }
      state.health = {
        ...state.health,
        lastError: null,
        lastApiSyncAt: new Date().toISOString(),
        tossConnected: !this.tossClient.isMockMode(),
        mockMode: this.tossClient.isMockMode()
      };
      await this.store.saveTraderState(state);
      return state;
    } catch (error) {
      state.health = {
        ...state.health,
        lastError: error.data?.error_description || error.message,
        lastApiSyncAt: new Date().toISOString(),
        tossConnected: false,
        mockMode: this.tossClient.isMockMode()
      };
      await this.store.saveTraderState(state);
      throw error;
    }
  }

  async safe(fn, fallback) {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  }

  async getSellableQuantity(symbol, fallbackQuantity) {
    if (this.tossClient.isMockMode()) return Number(fallbackQuantity ?? 0);
    try {
      const response = await this.tossClient.getSellableQuantity(symbol);
      return Number(response?.result?.sellableQuantity ?? response?.sellableQuantity ?? fallbackQuantity ?? 0);
    } catch {
      return Number(fallbackQuantity ?? 0);
    }
  }
}

function canAddMore(state, symbol, settings) {
  if (!settings.allowAdditionalBuys) return false;
  const cooldownMs = Math.max(1, Number(settings.additionalBuyCooldownMinutes ?? 240)) * 60_000;
  const lastBuy = state.tradeHistory.find((trade) => trade.symbol === symbol && trade.side === "BUY");
  if (!lastBuy?.requestedAt) return true;
  return Date.now() - new Date(lastBuy.requestedAt).getTime() >= cooldownMs;
}

async function getCandlesWithFallback(tossClient, symbol, interval, counts) {
  let lastError = null;
  for (const count of counts) {
    try {
      return await tossClient.getCandles(symbol, interval, count);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? new Error("캔들 데이터를 가져오지 못했습니다.");
}

function summarizeExposure(state, targets, prices) {
  const positions = state.positions ?? {};
  let currentMarketValueUsd = 0;
  let currentLeveragedExposureUsd = 0;

  for (const target of targets) {
    const position = positions[target.symbol];
    if (!position) continue;
    const quantity = Number(position.quantity ?? 0);
    const lastPrice = Number(prices[target.symbol]?.lastPrice ?? position.lastBuyPrice ?? position.averagePrice ?? 0);
    if (!(quantity > 0 && lastPrice > 0)) continue;
    const marketValue = quantity * lastPrice;
    currentMarketValueUsd += marketValue;
    currentLeveragedExposureUsd += marketValue * parseLeverage(target.leverage);
  }

  return {
    currentMarketValueUsd: round(currentMarketValueUsd, 2),
    currentLeveragedExposureUsd: round(currentLeveragedExposureUsd, 2)
  };
}

function reserveExposureForOrder(exposure, target, orderPlan, lastPrice) {
  const value = estimateOrderValue(orderPlan, lastPrice);
  if (!(value > 0)) return;
  const leverage = parseLeverage(target.leverage);
  const direction = orderPlan.side === "SELL" ? -1 : 1;
  exposure.currentMarketValueUsd = round(Math.max(0, Number(exposure.currentMarketValueUsd ?? 0) + direction * value), 2);
  exposure.currentLeveragedExposureUsd = round(
    Math.max(0, Number(exposure.currentLeveragedExposureUsd ?? 0) + direction * value * leverage),
    2
  );
}

function summarizeBotBudget(state, exposure) {
  const allocationUsd = Math.max(0, Number(state.settings?.allocationUsd ?? 0));
  const totalBuyAmountUsd = Number(state.performance?.totalBuyAmountUsd ?? 0);
  const totalSellAmountUsd = Number(state.performance?.totalSellAmountUsd ?? 0);
  const currentMarketValueUsd = Math.max(0, Number(exposure.currentMarketValueUsd ?? 0));
  const reservedPendingBuyUsd = (state.tradeHistory ?? [])
    .filter(
      (trade) =>
        trade.side === "BUY" &&
        !trade.dryRun &&
        !["FINAL", "DRY_RUN", "REJECTED", "CANCELED"].includes(String(trade.syncStatus ?? ""))
    )
    .reduce((sum, trade) => sum + Number(trade.orderAmount ?? trade.estimatedValueUsd ?? 0), 0);
  const virtualCashUsd = allocationUsd - totalBuyAmountUsd + totalSellAmountUsd - reservedPendingBuyUsd;
  const equityUsd = virtualCashUsd + reservedPendingBuyUsd + currentMarketValueUsd;
  const realizedPnlUsd = Number(state.performance?.realizedPnlUsd ?? 0);
  const openPnlUsd = currentMarketValueUsd - Object.values(state.positions ?? {})
    .reduce((sum, position) => sum + Number(position.investedAmountUsd ?? 0), 0);

  return {
    mode: state.settings?.useVirtualSeed === false ? "fixed-allocation" : "virtual-seed",
    allowSeedTopUp: Boolean(state.settings?.allowSeedTopUp),
    startingSeedUsd: round(allocationUsd, 2),
    virtualCashUsd: round(virtualCashUsd, 2),
    reservedPendingBuyUsd: round(reservedPendingBuyUsd, 2),
    currentMarketValueUsd: round(currentMarketValueUsd, 2),
    equityUsd: round(equityUsd, 2),
    realizedPnlUsd: round(realizedPnlUsd, 2),
    openPnlUsd: round(openPnlUsd, 2),
    totalPnlUsd: round(realizedPnlUsd + openPnlUsd, 2),
    updatedAt: new Date().toISOString()
  };
}

function calculateDailyRiskGuard(state, targets, prices) {
  const allocationUsd = Math.max(0, Number(state.settings?.allocationUsd ?? 0));
  const maxDailyLossPct = Math.max(0, Number(state.settings?.maxDailyLossPct ?? 0));
  const percentLossUsd = allocationUsd * (maxDailyLossPct / 100);
  // 소액 시드 일상 흔들림 허용 바닥값(달러). 시드가 작을 때 %한도가 너무 빨리 걸리는 걸 막는다. 설정으로 조절 가능.
  const noiseFloorCapUsd = Number.isFinite(Number(state.settings?.smallSeedNoiseFloorUsd))
    ? Number(state.settings.smallSeedNoiseFloorUsd)
    : 5;
  const smallSeedNoiseFloorUsd = allocationUsd > 0 ? Math.min(noiseFloorCapUsd, allocationUsd * 0.1) : 0;
  const maxLossUsd = Math.max(percentLossUsd, smallSeedNoiseFloorUsd);
  const positions = state.positions ?? {};
  const targetMap = new Map(targets.map((target) => [target.symbol, target]));
  let openPnlUsd = 0;

  for (const [symbol, position] of Object.entries(positions)) {
    if (!targetMap.has(symbol)) continue;
    const quantity = Number(position.quantity ?? 0);
    const investedAmount = Number(position.investedAmountUsd ?? 0);
    const lastPrice = Number(prices[symbol]?.lastPrice ?? position.lastBuyPrice ?? position.averagePrice ?? 0);
    if (!(quantity > 0 && lastPrice > 0)) continue;
    openPnlUsd += quantity * lastPrice - investedAmount;
  }

  const todayKey = localDayKey(new Date());
  const realizedPnlUsd = (state.tradeHistory ?? [])
    .filter((trade) => trade.side === "SELL" && localDayKey(new Date(trade.requestedAt)) === todayKey)
    .reduce((sum, trade) => sum + Number(trade.realizedPnlUsd ?? 0), 0);
  const totalPnlUsd = openPnlUsd + realizedPnlUsd;
  const blocked = maxLossUsd > 0 && totalPnlUsd <= -maxLossUsd;

  return {
    blocked,
    maxDailyLossPct: round(maxDailyLossPct, 2),
    maxLossUsd: round(maxLossUsd, 2),
    percentLossUsd: round(percentLossUsd, 2),
    smallSeedNoiseFloorUsd: round(smallSeedNoiseFloorUsd, 2),
    openPnlUsd: round(openPnlUsd, 2),
    realizedPnlUsd: round(realizedPnlUsd, 2),
    totalPnlUsd: round(totalPnlUsd, 2),
    checkedAt: new Date().toISOString(),
    reason: blocked ? `당일 봇 손실 ${round(Math.abs(totalPnlUsd), 2)}달러가 한도 ${round(maxLossUsd, 2)}달러를 넘었습니다.` : null
  };
}

function applyProductionRiskGuards({ signal, position, riskGuard }) {
  const guardedSignal = {
    ...signal,
    risk: {
      ...(signal.risk ?? {}),
      guard: riskGuard
    }
  };
  const hasPosition = Number(position?.quantity ?? 0) > 0 || Number(position?.investedAmountUsd ?? 0) > 0;

  if (riskGuard?.blocked) {
    if (!hasPosition && signal.action !== "BUY") return guardedSignal;
    return {
      ...guardedSignal,
      action: hasPosition ? "SELL" : "HOLD",
      reasons: [
        hasPosition ? "당일 봇 손실 한도 도달, 방어 매도" : "당일 봇 손실 한도 도달, 신규매수 중단",
        ...(guardedSignal.reasons ?? [])
      ]
    };
  }

  return guardedSignal;
}

function localDayKey(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  // 당일 손실 가드의 "하루"는 미국 거래일(ET) 기준으로 잡는다. KST 자정 기준이면 미국 정규장
  // (KST 22:30~05:00) 한가운데서 카운터가 리셋돼 한 세션의 손실이 두 날로 쪼개져 가드가 약해진다(§HH).
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

const LEDGER_HISTORY_CAP = 20;

// 봇 장부(보유/성과/예산)만 비운다. tradeHistory(dryRun 태그로 페이퍼/실거래 구분)와
// closedCycles(체결에서 재계산되는 파생)는 건드리지 않는다.
function wipeBotBook(state) {
  state.positions = {};
  state.performance = { realizedPnlUsd: 0, totalBuyAmountUsd: 0, totalSellAmountUsd: 0 };
  state.botBudget = null;
}

// 장부 한 구간(에폭)이 끝날 때 요약을 ledgerHistory에 남긴다. "데이터가 사라진 것처럼 보이는" 문제를
// 장부를 오염시키지 않고 해결하기 위한 체계적 기록(append-only, 최대 LEDGER_HISTORY_CAP개).
function archiveLedgerEpoch(state, mode, reason) {
  const hadActivity =
    Number(state.performance?.totalBuyAmountUsd ?? 0) > 0 || Object.keys(state.positions ?? {}).length > 0;
  if (!hadActivity) return;
  const epoch = {
    mode,
    reason,
    startedAt: state.paperSession?.startedAt ?? state.settings?.botStartedAt ?? null,
    endedAt: new Date().toISOString(),
    equityUsd: round(Number(state.botBudget?.equityUsd ?? 0), 2),
    realizedPnlUsd: round(Number(state.performance?.realizedPnlUsd ?? 0), 2),
    tradeCount: (state.tradeHistory ?? []).filter((trade) => (mode === "paper" ? trade.dryRun : !trade.dryRun)).length,
    cycleCount: (state.learning?.closedCycles ?? []).length
  };
  state.ledgerHistory = [epoch, ...(state.ledgerHistory ?? [])].slice(0, LEDGER_HISTORY_CAP);
}

function ensureDryRunPaperSession(state) {
  const signature = paperTargetSignature(state);
  if (state.paperSession?.active && state.paperSession.targetSignature === signature) return;
  // 활성 종목/파라미터가 바뀌면 페이퍼 장부를 새 후보 전략 기준으로 깨끗이 다시 시작한다.
  archiveLedgerEpoch(state, "paper", state.paperSession?.active ? "후보 전략 변경으로 페이퍼 장부 재시작" : "페이퍼 검증 시작");
  state.paperSession = {
    active: true,
    startedAt: new Date().toISOString(),
    targetSignature: signature,
    reason: "dry-run 페이퍼 장부를 현재 활성 종목 기준으로 새로 시작"
  };
  // 페이퍼(검증) 장부는 현재 후보 전략만의 깨끗한 종이 장부여야 한다. 과거 장부가 섞이면 수익률/검증 게이트가
  // 오염되므로 봇 보유/성과/예산을 초기화한다. 과거 실거래 장부는 tradeHistory(dryRun=false)에 남아 있고,
  // 실거래를 켜면 syncExecutedBotOrders가 체결 이력으로 라이브 장부를 다시 재구성한다.
  wipeBotBook(state);
  pushEvent(state, "BOT", "PAPER_SESSION", "dry-run 페이퍼 장부를 현재 활성 종목 기준으로 새로 시작했습니다.");
}

function markPaperSessionInactive(state) {
  if (!state.paperSession?.active) return;
  // 실거래로 전환: 페이퍼 종이 장부를 비우고, 이후 syncExecutedBotOrders가 실제 체결로 라이브 장부를 재구성한다.
  archiveLedgerEpoch(state, "paper", "실거래 장부로 전환");
  wipeBotBook(state);
  state.paperSession = {
    ...state.paperSession,
    active: false,
    endedAt: new Date().toISOString(),
    reason: "실거래 장부로 복귀"
  };
}

function paperTargetSignature(state = {}) {
  const settings = state.settings ?? {};
  return JSON.stringify(
    {
      settings: {
        allocationUsd: Number(settings.allocationUsd ?? 0),
        cashBufferUsd: Number(settings.cashBufferUsd ?? 0),
        maxDailyLossPct: Number(settings.maxDailyLossPct ?? 0),
        maxPositionPct: Number(settings.maxPositionPct ?? 0),
        maxLeveragedExposurePct: Number(settings.maxLeveragedExposurePct ?? 0),
        intradayDropBlockPct: Number(settings.intradayDropBlockPct ?? 0),
        intradayPanicExitPct: Number(settings.intradayPanicExitPct ?? 0),
        allowAdditionalBuys: Boolean(settings.allowAdditionalBuys),
        minAdx: Number(settings.minAdx ?? 0)
      },
      targets: (state.targets ?? [])
        .filter((target) => target.enabled !== false)
        .map((target) => ({
          symbol: target.symbol,
          allocationPct: Number(target.allocationPct ?? 0),
          leverage: target.leverage ?? "",
          fastSmaDays: Number(target.fastSmaDays ?? 0),
          slowSmaDays: Number(target.slowSmaDays ?? 0),
          momentumDays: Number(target.momentumDays ?? 0),
          minBuyRsi: Number(target.minBuyRsi ?? 0),
          maxBuyRsi: Number(target.maxBuyRsi ?? 0),
          stopLossPct: Number(target.stopLossPct ?? 0),
          takeProfitPct: Number(target.takeProfitPct ?? 0),
          trailingStopPct: Number(target.trailingStopPct ?? 0),
          maxAtrPct: Number(target.maxAtrPct ?? 0),
          minAdx: Number(target.minAdx ?? 0)
        }))
        .sort((left, right) => String(left.symbol).localeCompare(String(right.symbol)))
    }
  );
}

async function syncExecutedBotOrders(state, tossClient, { forceRecovery = false, holdings = null, updatePortfolio = true } = {}) {
  if (updatePortfolio && (forceRecovery || shouldRecoverBotOrders(state) || hasHoldingShortfall(state, holdings))) {
    await recoverBotOrdersFromTossHistory(state, tossClient, holdings);
  }
  const syncable = state.tradeHistory.filter((trade) => trade.orderId && !trade.dryRun && trade.syncStatus !== "FINAL");
  for (const trade of syncable.slice(0, 20)) {
    const detail = await tossClient.getOrder(trade.orderId);
    const order = detail.result ?? detail;
    applyExecutionToTrade(state, trade, order);
  }
  if (!updatePortfolio) return;
  rebuildLiveBotPortfolio(state);
  reconcileBotPositionsWithHoldings(state, holdings);
}

function shouldRecoverBotOrders(state) {
  if (!(state.tradeHistory?.length > 0)) return true;
  const last = state.health?.lastBotOrderRecoveryAt ? new Date(state.health.lastBotOrderRecoveryAt).getTime() : 0;
  return !last || Date.now() - last > 30 * 60_000;
}

async function recoverBotOrdersFromTossHistory(state, tossClient, holdings) {
  state.health = {
    ...(state.health ?? {}),
    lastBotOrderRecoveryAt: new Date().toISOString()
  };
  const knownOrderIds = new Set((state.tradeHistory ?? []).map((trade) => String(trade.orderId ?? "")).filter(Boolean));
  const targetSymbols = new Set((state.targets ?? []).map((target) => String(target.symbol).toUpperCase()));
  const actualBySymbol = holdingsMap(holdings);
  const recoveryStart = new Date(state.settings?.botStartedAt ?? DEFAULT_BOT_STARTED_AT).getTime();
  const recovered = [];
  for (const status of ["CLOSED", "OPEN"]) {
    const response = await tossClient.getOrders(status, 100);
    const orders = extractOrderList(response);
    for (const order of orders) {
      const clientOrderId = extractClientOrderId(order);
      const orderId = extractOrderId(order);
      if (!orderId || knownOrderIds.has(String(orderId))) continue;
      const recoveryType = classifyRecoverableOrder(order, {
        clientOrderId,
        targetSymbols,
        recoveryStart,
        positions: state.positions,
        actualBySymbol
      });
      if (!recoveryType) continue;
      const trade = buildTradeFromTossOrder(order, { status, clientOrderId });
      if (!trade) continue;
      trade.source = recoveryType;
      if (recoveryType === "MANUAL_SELL") {
        const botQuantity = Number(state.positions?.[trade.symbol]?.quantity ?? 0);
        const accountQuantity = actualBySymbol
          ? Number(actualBySymbol.get(trade.symbol) ?? 0)
          : botQuantity;
        capManualSellToBotPosition(trade, Math.max(0, botQuantity - accountQuantity));
        if (!(Number(trade.execution?.filledQuantity ?? 0) > 0)) continue;
        trade.reason = "토스에서 직접 매도한 내역을 봇 보유분에 반영";
      }
      recovered.push(trade);
      knownOrderIds.add(String(orderId));
    }
  }
  if (!recovered.length) return;
  state.tradeHistory = [...recovered, ...(state.tradeHistory ?? [])]
    .sort((left, right) => new Date(right.requestedAt) - new Date(left.requestedAt))
    .slice(0, 300);
  pushEvent(state, "BOT", "RECOVERY", `토스 주문내역에서 봇 주문 ${recovered.length}건을 복구했습니다.`);
}

function classifyRecoverableOrder(order, { clientOrderId, targetSymbols, recoveryStart, positions, actualBySymbol }) {
  if (clientOrderId?.startsWith("ti-")) return "BOT";
  const symbol = String(order.symbol ?? order.ticker ?? order.stockCode ?? order.instrument?.symbol ?? "").toUpperCase();
  if (!targetSymbols.has(symbol)) return null;
  const orderedAt = new Date(order.orderedAt ?? order.requestedAt ?? order.createdAt ?? order.submittedAt ?? 0).getTime();
  if (!orderedAt || Number.isNaN(orderedAt) || orderedAt < recoveryStart) return null;
  if (!["FILLED", "PARTIAL_FILLED", "CLOSED"].includes(String(order.status ?? "").toUpperCase())) return null;
  const side = String(order.side ?? order.orderSide ?? "").toUpperCase();
  const botQuantity = Number(positions?.[symbol]?.quantity ?? 0);
  const accountQuantity = actualBySymbol ? Number(actualBySymbol.get(symbol) ?? 0) : botQuantity;
  if (side === "SELL" && botQuantity - accountQuantity > 0.000001) return "MANUAL_SELL";
  return null;
}

function extractOrderList(response) {
  const result = response?.result ?? response;
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.orders)) return result.orders;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function buildTradeFromTossOrder(order, { status, clientOrderId: inputClientOrderId }) {
  const orderId = extractOrderId(order);
  const clientOrderId = inputClientOrderId ?? extractClientOrderId(order);
  const symbol = order.symbol ?? order.ticker ?? order.stockCode ?? order.instrument?.symbol;
  const side = String(order.side ?? order.orderSide ?? "").toUpperCase();
  if (!orderId || !symbol || !["BUY", "SELL"].includes(side)) return null;
  const requestedAt =
    order.orderedAt ??
    order.requestedAt ??
    order.createdAt ??
    order.orderTime ??
    order.submittedAt ??
    order.updatedAt ??
    new Date().toISOString();
  const requestedAtIso = toIsoString(requestedAt);
  const trade = {
    id: `${new Date(requestedAtIso).getTime() || Date.now()}-${symbol}-recovered`,
    symbol: String(symbol).toUpperCase(),
    side,
    mode: order.orderAmount ? "AMOUNT" : "QUANTITY",
    quantity: numberOrNull(order.quantity ?? order.orderQuantity ?? order.executedQuantity),
    orderAmount: numberOrNull(order.orderAmount),
    estimatedPrice: numberOrNull(order.price ?? order.orderPrice),
    estimatedValueUsd: numberOrNull(order.orderAmount ?? order.amount),
    fractional: Boolean(order.orderAmount) || Number(order.quantity ?? order.orderQuantity ?? 0) % 1 !== 0,
    exitType: side === "SELL" ? "FULL_EXIT" : null,
    dryRun: false,
    reason: clientOrderId?.startsWith("ti-") ? "토스 주문내역에서 복구" : "대상 종목 주문내역에서 복구",
    requestedAt: requestedAtIso,
    request: {
      clientOrderId,
      symbol: String(symbol).toUpperCase(),
      side,
      orderType: order.orderType ?? "MARKET",
      quantity: order.quantity ?? undefined,
      orderAmount: order.orderAmount ?? undefined
    },
    response: { result: order },
    orderId,
    clientOrderId,
    syncStatus: status === "OPEN" ? "PENDING" : "PENDING"
  };
  applyExecutionToTrade(null, trade, order);
  return trade;
}

function applyExecutionToTrade(state, trade, order) {
  const execution = order.execution ?? order.executions ?? order.fill ?? {};
  const filledQuantity = Number(
    execution.filledQuantity ?? execution.executedQuantity ?? order.filledQuantity ?? order.executedQuantity ?? 0
  );
  const averageFilledPrice = Number(
    execution.averageFilledPrice ?? execution.averagePrice ?? order.averageFilledPrice ?? order.averagePrice ?? 0
  );
  const filledAmount = Number(execution.filledAmount ?? execution.executedAmount ?? order.filledAmount ?? order.executedAmount ?? 0);
  const commission = Number(execution.commission ?? order.commission ?? 0);
  const tax = Number(execution.tax ?? order.tax ?? 0);
  const netAmount = Math.max(0, filledAmount + commission + tax);
  const status = order.status ?? trade.status ?? "UNKNOWN";

  trade.status = status;
  trade.syncedAt = new Date().toISOString();
  trade.execution = {
    filledQuantity,
    averageFilledPrice,
    filledAmount,
    commission,
    tax,
    filledAt: execution.filledAt ?? null,
    settlementDate: execution.settlementDate ?? null
  };
  trade.quantity = filledQuantity || trade.quantity;
  trade.orderAmount = order.orderAmount ?? trade.orderAmount;
  trade.actualPrice = averageFilledPrice || trade.estimatedPrice;
  trade.actualValueUsd = filledAmount || trade.estimatedValueUsd;
  trade.actualCostUsd = netAmount || trade.actualValueUsd;
  trade.syncStatus = isFinalStatus(status) ? "FINAL" : filledQuantity > 0 ? "PARTIAL" : "PENDING";
}

function extractClientOrderId(order) {
  return (
    order?.clientOrderId ??
    order?.client_order_id ??
    order?.clientOrderID ??
    order?.request?.clientOrderId ??
    order?.result?.clientOrderId ??
    null
  );
}

export function rebuildLiveBotPortfolio(state) {
  const liveTrades = state.tradeHistory
    .filter((trade) => !trade.dryRun && trade.execution && Number(trade.execution.filledQuantity ?? 0) > 0)
    .slice()
    .reverse();
  if (!liveTrades.length) return;

  const positions = {};
  const performance = {
    realizedPnlUsd: 0,
    totalBuyAmountUsd: 0,
    totalSellAmountUsd: 0
  };

  for (const trade of liveTrades) {
    const symbol = trade.symbol;
    const quantity = Number(trade.execution.filledQuantity ?? 0);
    const amount = Number(trade.execution.filledAmount ?? trade.actualValueUsd ?? 0);
    const commission = Number(trade.execution.commission ?? 0);
    const tax = Number(trade.execution.tax ?? 0);
    const price = Number(trade.execution.averageFilledPrice ?? trade.actualPrice ?? 0);
    const current = positions[symbol] ?? { quantity: 0, investedAmountUsd: 0, peakPrice: 0 };

    if (trade.side === "BUY") {
      const cost = amount + commission + tax;
      const nextQuantity = current.quantity + quantity;
      const nextCost = current.investedAmountUsd + cost;
      performance.totalBuyAmountUsd += cost;
      positions[symbol] = {
        quantity: nextQuantity,
        investedAmountUsd: nextCost,
        averagePrice: nextQuantity > 0 ? nextCost / nextQuantity : 0,
        lastBuyPrice: price,
        peakPrice: Math.max(Number(current.peakPrice ?? 0), price),
        partialTakeProfitTaken: false
      };
    }

    if (trade.side === "SELL") {
      // 봇 장부에 실제로 있는 수량까지만 매도로 인정한다. 보유한 적 없는 수량(봇 보유 0일 때 들어온
      // 매뉴얼 매도, 매수보다 먼저 기록된 매도 등)은 원가 0으로 잡혀 대금 전액이 유령 이익이 되므로
      // (예: MUU 매뉴얼 매도 +$24가 원가 0으로 실현이익에 잡혀 봇 자산을 부풀린 사례) 봇 장부에서 제외한다.
      const heldQuantity = Number(current.quantity ?? 0);
      const effectiveQuantity = Math.min(quantity, heldQuantity);
      if (effectiveQuantity <= POSITION_DUST_EPSILON) {
        // 봇이 보유한 적 없는 수량의 매도 — 현금/실현/포지션 어디에도 반영하지 않는다.
        trade.realizedPnlUsd = 0;
        trade.unmatchedSellQuantity = round(quantity, 6);
        continue;
      }
      // 봇 보유분을 넘는 부분(유령)은 대금에서 비례 제외한다.
      const fillRatio = quantity > 0 ? effectiveQuantity / quantity : 1;
      const proceeds = Math.max(0, amount - commission - tax) * fillRatio;
      const closeRatio = heldQuantity > 0 ? Math.min(1, effectiveQuantity / heldQuantity) : 1;
      const costBasis = current.investedAmountUsd * closeRatio;
      const realizedPnlUsd = proceeds - costBasis;
      const rawRemainingQuantity = Math.max(0, heldQuantity - effectiveQuantity);
      const fullyClosed = rawRemainingQuantity <= POSITION_DUST_EPSILON;
      const remainingQuantity = fullyClosed ? 0 : rawRemainingQuantity;
      const remainingCost = fullyClosed ? 0 : Math.max(0, current.investedAmountUsd - costBasis);
      performance.totalSellAmountUsd += proceeds;
      performance.realizedPnlUsd += realizedPnlUsd;
      trade.realizedPnlUsd = round(realizedPnlUsd, 2);
      if (effectiveQuantity < quantity - POSITION_DUST_EPSILON) {
        trade.unmatchedSellQuantity = round(quantity - effectiveQuantity, 6);
      }
      positions[symbol] = {
        quantity: remainingQuantity,
        investedAmountUsd: remainingCost,
        averagePrice: remainingQuantity > 0 ? remainingCost / remainingQuantity : 0,
        lastSellPrice: price,
        peakPrice: remainingQuantity > 0 ? Number(current.peakPrice ?? 0) : 0,
        partialTakeProfitTaken:
          remainingQuantity > 0 ? Boolean(current.partialTakeProfitTaken || trade.exitType === "PARTIAL_TAKE_PROFIT") : false
      };
    }
  }

  state.positions = Object.fromEntries(
    Object.entries(positions).filter(([, position]) => Number(position.quantity ?? 0) > POSITION_DUST_EPSILON)
  );
  state.performance = performance;
  state.learning ??= {};
  state.learning.closedCycles = buildClosedCycles(liveTrades);
}

function capManualSellToBotPosition(trade, botQuantity) {
  const filledQuantity = Number(trade.execution?.filledQuantity ?? 0);
  if (!(filledQuantity > 0 && botQuantity > 0)) {
    if (trade.execution) trade.execution.filledQuantity = 0;
    return;
  }
  const managedQuantity = Math.min(filledQuantity, botQuantity);
  if (managedQuantity >= filledQuantity) return;
  const ratio = managedQuantity / filledQuantity;
  trade.execution.originalFilledQuantity = filledQuantity;
  trade.execution.filledQuantity = managedQuantity;
  trade.execution.filledAmount = Number(trade.execution.filledAmount ?? 0) * ratio;
  trade.execution.commission = Number(trade.execution.commission ?? 0) * ratio;
  trade.execution.tax = Number(trade.execution.tax ?? 0) * ratio;
  trade.quantity = managedQuantity;
  trade.actualValueUsd = trade.execution.filledAmount;
  trade.actualCostUsd = trade.execution.filledAmount + trade.execution.commission + trade.execution.tax;
}

function hasHoldingShortfall(state, holdings) {
  const actualBySymbol = holdingsMap(holdings);
  if (!actualBySymbol) return false;
  return Object.entries(state.positions ?? {}).some(
    ([symbol, position]) => Number(position.quantity ?? 0) - Number(actualBySymbol.get(symbol) ?? 0) > 0.000001
  );
}

function reconcileBotPositionsWithHoldings(state, holdings) {
  const actualBySymbol = holdingsMap(holdings);
  if (!actualBySymbol) return;
  state.externalTrackedHoldings = {};
  for (const [symbol, position] of Object.entries(state.positions ?? {})) {
    const botQuantity = Number(position.quantity ?? 0);
    const accountQuantity = Number(actualBySymbol.get(symbol) ?? 0);
    const difference = accountQuantity - botQuantity;
    if (difference < -0.000001) {
      position.reconciliation = {
        status: "SHORTFALL",
        accountQuantity: round(accountQuantity, 6),
        botQuantity: round(botQuantity, 6),
        checkedAt: new Date().toISOString()
      };
      pushEvent(
        state,
        symbol,
        "RECONCILE_WARNING",
        `계좌 보유 ${round(accountQuantity, 6)}주가 봇 장부 ${round(botQuantity, 6)}주보다 적습니다. 체결 동기화가 필요합니다.`
      );
      continue;
    }
    if (difference > 0.000001) {
      state.externalTrackedHoldings[symbol] = round(difference, 6);
      position.reconciliation = {
        status: "EXTERNAL_HOLDING",
        accountQuantity: round(accountQuantity, 6),
        botQuantity: round(botQuantity, 6),
        externalQuantity: round(difference, 6),
        checkedAt: new Date().toISOString()
      };
      pushEvent(
        state,
        symbol,
        "EXTERNAL_HOLDING",
        `계좌에 봇 장부 외 ${round(difference, 6)}주가 있습니다. 수동 매수분은 봇 자산과 매매 수량에서 제외합니다.`
      );
      continue;
    }
    delete position.reconciliation;
  }
  for (const target of state.targets ?? []) {
    const symbol = String(target.symbol ?? "").toUpperCase();
    if (state.positions?.[symbol]) continue;
    const accountQuantity = Number(actualBySymbol.get(symbol) ?? 0);
    if (!(accountQuantity > 0.000001)) continue;
    state.externalTrackedHoldings[symbol] = round(accountQuantity, 6);
    pushEvent(
      state,
      symbol,
      "EXTERNAL_HOLDING",
      `수동 보유 ${round(accountQuantity, 6)}주를 감지했습니다. 봇이 매수한 수량이 아니므로 자동매도와 봇 자산에서 제외합니다.`
    );
  }
}

function holdingsMap(holdings) {
  const result = holdings?.result ?? holdings;
  if (!Array.isArray(result?.items)) return null;
  return new Map(
    (result?.items ?? []).map((item) => [String(item.symbol ?? "").toUpperCase(), Number(item.quantity ?? 0)])
  );
}

function isFinalStatus(status) {
  return ["FILLED", "CANCELED", "REJECTED", "REPLACED", "CANCEL_REJECTED", "REPLACE_REJECTED"].includes(status);
}

function buildClosedCycles(liveTrades) {
  const lotsBySymbol = new Map();
  const cycles = [];

  for (const trade of liveTrades) {
    const symbol = trade.symbol;
    const quantity = Number(trade.execution?.filledQuantity ?? 0);
    const amount = Number(trade.execution?.filledAmount ?? trade.actualValueUsd ?? 0);
    const commission = Number(trade.execution?.commission ?? 0);
    const tax = Number(trade.execution?.tax ?? 0);
    const price = Number(trade.execution?.averageFilledPrice ?? trade.actualPrice ?? 0);
    if (!(quantity > 0 && amount > 0)) continue;

    if (trade.side === "BUY") {
      const lots = lotsBySymbol.get(symbol) ?? [];
      lots.push({
        trade,
        remainingQuantity: quantity,
        remainingCost: amount + commission + tax,
        entryPrice: price
      });
      lotsBySymbol.set(symbol, lots);
      continue;
    }

    if (trade.side !== "SELL") continue;
    const lots = lotsBySymbol.get(symbol) ?? [];
    let remainingSellQuantity = quantity;
    const proceedsPerShare = quantity > 0 ? Math.max(0, amount - commission - tax) / quantity : 0;
    let matchIndex = 0;

    while (remainingSellQuantity > 0 && lots.length) {
      const lot = lots[0];
      const matchedQuantity = Math.min(remainingSellQuantity, lot.remainingQuantity);
      const costBasis = lot.remainingQuantity > 0 ? lot.remainingCost * (matchedQuantity / lot.remainingQuantity) : 0;
      const proceeds = proceedsPerShare * matchedQuantity;
      const realizedPnlUsd = proceeds - costBasis;
      const entryTime = lot.trade.requestedAt;
      const exitTime = trade.requestedAt;
      const holdingMinutes = minutesBetween(entryTime, exitTime);

      cycles.push({
        id: `${trade.id}-${lot.trade.id}-${matchIndex}`,
        symbol,
        engineVersion: trade.strategyContext?.engineVersion ?? lot.trade.strategyContext?.engineVersion ?? null,
        buyTradeId: lot.trade.id,
        sellTradeId: trade.id,
        entryAt: entryTime,
        exitAt: exitTime,
        holdingMinutes,
        quantity: round(matchedQuantity, 6),
        entryPrice: numberOrNull(lot.entryPrice),
        exitPrice: numberOrNull(price),
        costBasisUsd: round(costBasis, 2),
        proceedsUsd: round(proceeds, 2),
        realizedPnlUsd: round(realizedPnlUsd, 2),
        returnPct: costBasis > 0 ? round((realizedPnlUsd / costBasis) * 100, 2) : null,
        exitType: trade.exitType ?? null,
        entryContext: compactTradeContext(lot.trade.strategyContext),
        exitContext: compactTradeContext(trade.strategyContext)
      });

      lot.remainingQuantity -= matchedQuantity;
      lot.remainingCost -= costBasis;
      remainingSellQuantity -= matchedQuantity;
      matchIndex += 1;
      if (lot.remainingQuantity <= 0.000001) lots.shift();
    }
  }

  return cycles
    .sort((left, right) => new Date(right.exitAt) - new Date(left.exitAt))
    .slice(0, 300);
}

function compactTradeContext(context) {
  if (!context) return null;
  return {
    engineVersion: context.engineVersion ?? null,
    isRegularMarket: Boolean(context.isRegularMarket),
    target: context.target ?? null,
    settings: context.settings ?? null,
    action: context.signal?.action ?? null,
    reasons: context.signal?.reasons ?? [],
    metrics: context.signal?.metrics ?? {},
    risk: context.signal?.risk ?? null,
    backtest: context.backtest ?? null
  };
}

function minutesBetween(start, end) {
  const startMs = new Date(start).getTime();
  const endMs = new Date(end).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return null;
  return round((endMs - startMs) / 60_000, 1);
}

export function isUsRegularMarketOpen(calendar, now = new Date()) {
  const t = now.getTime();
  const today = calendar?.result?.today;
  // 캘린더 자체가 없으면(조회 실패 등) 일시적 실패로 장을 닫힌 것으로 오판하지 않도록 시간 기반으로 판정.
  if (!today) return isWithinRegularHoursET(now);
  const session = today.regularMarket;
  // 캘린더가 명시적으로 세션 없음(휴장)이라고 하면 그대로 신뢰.
  if (!session?.startTime || !session?.endTime) return false;
  const start = new Date(session.startTime).getTime();
  const end = new Date(session.endTime).getTime();
  if (t >= start && t <= end) return true;
  // today 세션이 아직 시작 전(미래)이면, 토스 캘린더의 "오늘"이 한국 날짜 기준이라
  // 이른 새벽(KST 00:00~05:00)엔 전일 미국 정규장이 아직 진행 중일 수 있다 → 시간 기반으로 보정.
  if (t < start) return isWithinRegularHoursET(now);
  return false; // 세션 종료 후
}

// America/New_York 기준 평일 09:30~16:00(정규장) 여부. EDT/EST 전환은 Intl이 자동 처리.
function isWithinRegularHoursET(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(now);
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  let hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (hour === 24) hour = 0;
  if (weekday === "Sat" || weekday === "Sun") return false;
  const minutes = hour * 60 + minute;
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function hydratePosition(state, symbol, price, holdings) {
  const botPosition = state.positions[symbol];
  if (!botPosition) return {};
  const lastPrice = Number(price?.lastPrice ?? 0);
  return {
    ...botPosition,
    marketValueUsd: Number(botPosition.quantity ?? 0) * lastPrice,
    peakPrice: Math.max(Number(botPosition.peakPrice ?? 0), lastPrice)
  };
}

function persistPeakPrice(state, symbol, position) {
  if (!position?.active && !(Number(position?.quantity ?? 0) > 0)) return;
  const peakPrice = Number(position.peakPrice ?? 0);
  if (!(peakPrice > 0)) return;
  state.positions[symbol] = {
    ...(state.positions[symbol] ?? {}),
    peakPrice
  };
}

function toTossOrder(symbol, plan) {
  const clientOrderId = `ti-${Date.now()}`.slice(0, 36);
  if (plan.mode === "AMOUNT") {
    return {
      clientOrderId,
      symbol,
      side: plan.side,
      orderType: "MARKET",
      orderAmount: String(plan.orderAmount),
      confirmHighValueOrder: false
    };
  }
  return {
    clientOrderId,
    symbol,
    side: plan.side,
    orderType: "MARKET",
    quantity: String(plan.quantity),
    confirmHighValueOrder: false
  };
}

function extractOrderId(response) {
  return response?.result?.orderId ?? response?.orderId ?? response?.id ?? null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIsoString(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function updatePaperPosition(state, symbol, plan, lastPrice) {
  if (!Number.isFinite(lastPrice)) return;
  state.performance = {
    realizedPnlUsd: Number(state.performance?.realizedPnlUsd ?? 0),
    totalBuyAmountUsd: Number(state.performance?.totalBuyAmountUsd ?? 0),
    totalSellAmountUsd: Number(state.performance?.totalSellAmountUsd ?? 0)
  };
  const current = state.positions[symbol] ?? { quantity: 0, investedAmountUsd: 0, peakPrice: 0 };
  if (plan.side === "BUY") {
    const quantity = plan.mode === "AMOUNT" ? Number(plan.orderAmount) / lastPrice : Number(plan.quantity);
    const buyAmount = quantity * lastPrice;
    const investedAmountUsd = Number(current.investedAmountUsd ?? 0) + quantity * lastPrice;
    const totalQuantity = Number(current.quantity ?? 0) + quantity;
    state.performance.totalBuyAmountUsd += buyAmount;
    state.positions[symbol] = {
      quantity: totalQuantity,
      investedAmountUsd,
      averagePrice: investedAmountUsd / totalQuantity,
      lastBuyPrice: lastPrice,
      peakPrice: Math.max(Number(current.peakPrice ?? 0), lastPrice),
      partialTakeProfitTaken: false
    };
    return null;
  }
  if (plan.side === "SELL") {
    const sellQuantity = plan.mode === "AMOUNT" ? Number(plan.orderAmount) / lastPrice : Number(plan.quantity);
    const currentQuantity = Number(current.quantity ?? 0);
    const closedRatio = currentQuantity > 0 ? Math.min(1, sellQuantity / currentQuantity) : 1;
    const costBasis = Number(current.investedAmountUsd ?? 0) * closedRatio;
    const sellAmount = sellQuantity * lastPrice;
    const realizedPnlUsd = sellAmount - costBasis;
    const rawRemainingQuantity = Math.max(0, currentQuantity - sellQuantity);
    state.performance.totalSellAmountUsd += sellAmount;
    state.performance.realizedPnlUsd += realizedPnlUsd;
    if (rawRemainingQuantity <= POSITION_DUST_EPSILON) {
      // 전량 매도되면 미세 잔량을 남기지 말고 포지션을 완전히 비운다.
      delete state.positions[symbol];
      return realizedPnlUsd;
    }
    const remainingCost = Math.max(0, Number(current.investedAmountUsd ?? 0) - costBasis);
    state.positions[symbol] = {
      quantity: rawRemainingQuantity,
      investedAmountUsd: remainingCost,
      averagePrice: remainingCost / rawRemainingQuantity,
      lastSellPrice: lastPrice,
      peakPrice: Number(current.peakPrice ?? 0),
      partialTakeProfitTaken: plan.exitType === "PARTIAL_TAKE_PROFIT" || Boolean(current.partialTakeProfitTaken)
    };
    return realizedPnlUsd;
  }
  return null;
}

function estimateOrderValue(plan, lastPrice) {
  if (!Number.isFinite(lastPrice)) return null;
  if (plan.mode === "AMOUNT") return Number(plan.orderAmount ?? 0);
  return Number(plan.quantity ?? 0) * lastPrice;
}

function pushEvent(state, symbol, type, message) {
  const now = Date.now();
  const duplicate = (state.orderEvents ?? []).find(
    (event) =>
      event.symbol === symbol &&
      event.type === type &&
      event.message === message &&
      now - new Date(event.createdAt).getTime() < 30 * 60_000
  );
  if (duplicate) return;
  state.orderEvents.unshift({
    id: `${now}-${symbol}-${type}`,
    symbol,
    type,
    message,
    createdAt: new Date().toISOString()
  });
  state.orderEvents = state.orderEvents.slice(0, 100);
}

function findPendingOrder(state, symbol, side) {
  return (state.tradeHistory ?? []).find(
    (trade) =>
      trade.symbol === symbol &&
      trade.side === side &&
      !trade.dryRun &&
      ["PENDING", "PARTIAL"].includes(String(trade.syncStatus ?? ""))
  );
}

function pushSafetyEvent(state, symbol, signal) {
  const safetyReason = (signal.reasons ?? []).find((reason) =>
    /차단|정규장|급락|변동성|이벤트|비중|한도|대기|백테스트|손실/.test(String(reason))
  );
  if (!safetyReason) return;
  const now = Date.now();
  const recentDuplicate = state.orderEvents.find(
    (event) =>
      event.symbol === symbol &&
      event.type === "SAFETY" &&
      event.message === safetyReason &&
      now - new Date(event.createdAt).getTime() < 30 * 60_000
  );
  if (recentDuplicate) return;
  pushEvent(state, symbol, "SAFETY", safetyReason);
}

function buildChartSnapshot(target, candles, position, price) {
  const series = normalizeCandles(candles)
    .slice(-60)
    .map((item) => ({
      timestamp: item.timestamp,
      open: item.open,
      high: item.high,
      low: item.low,
      close: item.close
    }));
  const currentPrice = Number(price?.lastPrice);
  if (Number.isFinite(currentPrice) && series.length) {
    series[series.length - 1] = {
      ...series[series.length - 1],
      timestamp: price.timestamp ?? series[series.length - 1].timestamp,
      high: Math.max(series[series.length - 1].high, currentPrice),
      low: Math.min(series[series.length - 1].low, currentPrice),
      close: currentPrice
    };
  }
  const entry = Number(position?.averagePrice ?? position?.lastBuyPrice ?? 0);
  const hasPosition = Number(position?.quantity ?? 0) > 0 && entry > 0;
  if (!hasPosition) {
    return { series, lines: null };
  }
  return {
    series,
    lines: {
      buyPrice: round(entry, 4),
      partialTakeProfitPrice: round(entry * (1 + Number(target.partialTakeProfitPct ?? 10) / 100), 4),
      takeProfitPrice: round(entry * (1 + Number(target.takeProfitPct ?? 18) / 100), 4),
      stopLossPrice: round(entry * (1 - Number(target.stopLossPct ?? 8) / 100), 4)
    }
  };
}

function summarizePosition(target, position) {
  const quantity = Number(position?.quantity ?? 0);
  const averagePrice = Number(position?.averagePrice ?? position?.lastBuyPrice ?? 0);
  if (!(quantity > 0 && averagePrice > 0)) {
    return { active: false };
  }
  return {
    active: true,
    quantity: round(quantity, 6),
    averagePrice: round(averagePrice, 4),
    takeProfitPct: Number(target.takeProfitPct ?? 18),
    stopLossPct: Number(target.stopLossPct ?? 8),
    trailingStopPct: Number(target.trailingStopPct ?? 10)
  };
}

function round(value, digits) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}
