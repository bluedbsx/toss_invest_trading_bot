import { adx, atr, normalizeCandles, rsi, sma } from "./indicators.js";

export const strategySummary = {
  name: "Adaptive Momentum Guard v0.9 Dual-Backtest",
  aliases: ["Leveraged Momentum Guard v0.9 Dual-Backtest"],
  purpose:
    "1x 성장주/ETF와 레버리지 ETF 모두를 종목별 파라미터로 다루되, 장기 방치하지 않고 상승 추세에서만 참여하며 손절/익절/노출 한도로 실전 리스크를 관리합니다. " +
    "v0.9: 표준(Wilder) RSI/ATR, 수수료·슬리피지 반영 + 과적합 억제 백테스트, 한국 새벽 정규장 정상 인식, " +
    "당일 급락 신규매수 차단 재활성, ADX 선택 필터, 뉴스·거시 예산 축소를 반영합니다.",
  buyRules: [
    "종목별 fastSmaDays 이동평균 > slowSmaDays 이동평균",
    "현재가 > 종목별 fastSmaDays 이동평균",
    "종목별 momentumDays 모멘텀 > 0%",
    "RSI가 종목별 minBuyRsi~maxBuyRsi 사이",
    "ATR 비율이 종목별 maxAtrPct 이하",
    "종목별 ADX 필터가 켜진 경우 기준 추세강도 이상"
  ],
  sellRules: [
    "현재가가 종목별 fastSmaDays 이동평균 아래로 이탈",
    "수익이 1차 익절선에 닿으면 일부만 먼저 매도",
    "종목별 익절률에 닿으면 남은 수량 전량 매도",
    "종목별 손절률 도달",
    "고점 대비 트레일링 스탑 도달",
    "RSI가 종목별 takeProfitRsi 이상이면 익절/축소"
  ],
  safeguards: [
    "LIVE_TRADING=false 기본값으로 실제 주문 차단",
    "소수점 매수는 미국 정규장 + 시장가 + orderAmount, 소수점 매도는 실제 판매 가능 수량 이내 quantity 사용",
    "소수점 거래 ON이어도 정규장외 방어 매도는 정수 보유분만 허용",
    "정규장외 신규매수와 일반 익절은 차단",
    "정규장외 방어 매도는 손절/급락/고점이탈 신호에서만 허용",
    "소수점 OFF이면 정수 수량 주문만 허용",
    "정해둔 봇 자금만 사용 ON이면 매수 예산은 봇 원금과 봇 손익 안에서만 계산",
    "손실 후 원금 보충 허용 OFF이면 손실분을 계좌 전체 현금에서 자동 보충하지 않음",
    "종목별/전체 모니터링 토글",
    "남는 투자금 몰아주기 옵션",
    "보유 중 추가매수는 별도 토글과 최소 간격으로 제한하되, 새 종목 진입은 봇 장부 기준으로 판단",
    "당일 봇 손실 한도는 작은 시드의 일상 흔들림을 감안한 최소 달러 한도를 함께 적용",
    "당일 시가 대비 급락 구간에서는 신규 매수를 차단해 낙하 칼날 진입을 피함",
    "변동성이 기준보다 크지만 상승 조건이 강하면 신규매수를 완전 차단하지 않고 예산을 50%로 축소",
    "종목별 최대 비중과 전체 레버리지 노출 한도 적용",
    "최근 데이터 기반 단순 백테스트를 화면에 표시",
    "당일 손실 한도와 안전설정 추천값을 화면에 표시"
  ]
};

export function isCurrentStrategyEngine(engineVersion) {
  return Boolean(
    engineVersion &&
      (engineVersion === strategySummary.name || strategySummary.aliases?.includes(engineVersion))
  );
}

export function evaluateTarget({ target, candles, price, position, settings, isRegularMarket, eventRisk, newsRisk, calendarRisk, botBudget }) {
  const normalized = normalizeCandles(candles);
  const closes = normalized.map((item) => item.close);
  const last = Number(price?.lastPrice ?? price?.last ?? closes.at(-1));
  const params = getStrategyParams(target);
  const fastSma = sma(closes, params.fastSmaDays);
  const slowSma = sma(closes, params.slowSmaDays);
  const currentRsi = rsi(closes, 14);
  const currentAtr = atr(normalized, 14);
  const currentAdx = adx(normalized, 14);
  const momentumBase = closes.at(-(params.momentumDays + 1));
  const momentumPct = momentumBase ? ((last - momentumBase) / momentumBase) * 100 : null;
  const atrPct = currentAtr && last ? (currentAtr / last) * 100 : null;
  const hasPosition = Number(position?.quantity ?? 0) > 0 || Number(position?.investedAmountUsd ?? 0) > 0;
  const canOpenBuy = !hasPosition || (settings.allowAdditionalBuys && position?.canAddMore);
  const entryPrice = Number(position?.averagePrice ?? position?.lastBuyPrice ?? 0);
  const peakPrice = Math.max(Number(position?.peakPrice ?? 0), last || 0);
  // 백테스트(runBacktestSimulation)와 동일한 기본값을 사용해 라이브 평가와 검증이 어긋나지 않게 한다.
  // 익절/1차익절/트레일링은 0이면 "끈 것"으로 보고 발동하지 않는다(값 누락 시 본전 즉시 매도 방지).
  const stopLossPct = Number(target.stopLossPct ?? 8);
  const takeProfitPct = Number(target.takeProfitPct ?? 18);
  const partialTakeProfitPct = Number(target.partialTakeProfitPct ?? 10);
  const trailingStopPct = Number(target.trailingStopPct ?? 10);
  const takeProfitRsi = Number(target.takeProfitRsi ?? 78);
  const stopLossHit = hasPosition && entryPrice > 0 && stopLossPct > 0 && last <= entryPrice * (1 - stopLossPct / 100);
  const takeProfitHit = hasPosition && entryPrice > 0 && takeProfitPct > 0 && last >= entryPrice * (1 + takeProfitPct / 100);
  const partialTakeProfitHit =
    hasPosition &&
    !position?.partialTakeProfitTaken &&
    entryPrice > 0 &&
    partialTakeProfitPct > 0 &&
    last >= entryPrice * (1 + partialTakeProfitPct / 100);
  const trailingHit = hasPosition && peakPrice > 0 && trailingStopPct > 0 && last <= peakPrice * (1 - trailingStopPct / 100);
  const trendExit = hasPosition && fastSma && last < fastSma;
  const overboughtExit = hasPosition && currentRsi && takeProfitRsi > 0 && currentRsi >= takeProfitRsi;
  const dailyMovePct = calculateDailyMovePct(normalized, last);
  // §HH: 당일(시가 대비) 급락 시 신규매수 차단을 재활성화한다.
  // §N(일봉 백테스트)은 이 가드가 수익만 깎는다고 봤지만, 일봉 백테스트는 §U가 라이브에서 확인한
  // 고변동 종목의 장중/갭 급락(꼬리손실)을 못 본다. 현재 1x 단일주도 갭 리스크가 크므로,
  // 추세가 살아있어도 당일 큰 급락엔 낙하 칼날 매수를 막는 §U 계열 가드를 유지한다.
  // (이전 v0.9의 'last<fastSma' 조건은 매수조건 trendOk와 상호배타라 사실상 무효였음 — 그 무효를 해소.)
  const dailyDropBlock =
    Number.isFinite(dailyMovePct) && dailyMovePct <= -Number(settings.intradayDropBlockPct ?? 4.5);
  // 패닉 매도(보유분 방어)는 일봉 백테스트가 진짜 장중 급락을 못 보므로 보수적으로 그대로 유지.
  const dailyPanicExit = hasPosition && Number.isFinite(dailyMovePct) && dailyMovePct <= -Number(settings.intradayPanicExitPct ?? 8);
  const trendOk = fastSma && slowSma && last > fastSma && fastSma > slowSma;
  const rsiOk = currentRsi !== null && currentRsi >= params.minBuyRsi && currentRsi <= params.maxBuyRsi;
  const momentumOk = momentumPct !== null && momentumPct > 0;
  // ADX 추세강도 필터: minAdx>0이면 추세가 그 이상 강할 때만 신규매수(횡보장 회피 → 레버리지 decay 방지).
  // 종목별 설정(target.minAdx)을 우선하고 없으면 전역(settings.minAdx)로 폴백 — 횡보 상품만 켜기 위함.
  const minAdx = Number(target.minAdx ?? settings.minAdx ?? 0);
  const adxOk = !(minAdx > 0) || (currentAdx !== null && currentAdx >= minAdx);
  const maxAtrPct = Number(target.maxAtrPct ?? 12);
  const volatilityOk = atrPct === null || atrPct <= maxAtrPct;
  const softVolatilityLimitPct = Math.min(30, Math.max(maxAtrPct + 8, maxAtrPct * 1.6));
  const volatilitySoftOk =
    !volatilityOk &&
    atrPct !== null &&
    atrPct <= softVolatilityLimitPct &&
    Boolean(trendOk && rsiOk && momentumOk);
  const volatilityTradable = volatilityOk || volatilitySoftOk;
  const volatilityBudgetMultiplier = volatilitySoftOk ? 0.5 : 1;
  const budget = resolveTradingBudget({ settings, botBudget });
  const allocationOk = budget.buyingPowerUsd > 0;

  let action = "HOLD";
  const reasons = [];

  if (!target.enabled) reasons.push("종목 자동매매 OFF");
  if (!settings.monitoringEnabled) reasons.push("전체 모니터링 OFF");
  if (!Number.isFinite(last)) reasons.push("현재가 없음");

  if (hasPosition && (stopLossHit || takeProfitHit || trailingHit || trendExit || overboughtExit || dailyPanicExit)) {
    action = "SELL";
    if (stopLossHit) reasons.push(`손절 ${stopLossPct}% 도달`);
    if (takeProfitHit) reasons.push(`익절 ${takeProfitPct}% 도달`);
    if (trailingHit) reasons.push(`고점 대비 ${trailingStopPct}% 이탈`);
    if (trendExit) reasons.push(`${params.fastSmaDays}일선 이탈`);
    if (overboughtExit) reasons.push(`RSI ${takeProfitRsi} 이상 과열`);
    if (dailyPanicExit) reasons.push(`당일 시가 대비 ${Math.abs(Number(settings.intradayPanicExitPct ?? 8))}% 이상 하락`);
  } else if (partialTakeProfitHit) {
    action = "PARTIAL_SELL";
    reasons.push(`1차 익절 ${partialTakeProfitPct}% 도달`);
  } else if (
    target.enabled &&
    settings.monitoringEnabled &&
    canOpenBuy &&
    allocationOk &&
    trendOk &&
    rsiOk &&
    momentumOk &&
    adxOk &&
    volatilityTradable &&
    !dailyDropBlock
  ) {
    action = "BUY";
    reasons.push(`상승 추세 + RSI 정상 + ${params.momentumDays}일 모멘텀 양호`);
    if (volatilitySoftOk) reasons.push("가격 흔들림 큼, 매수 예산 50%로 축소");
    if (eventRisk?.blocked) {
      reasons.push(`이벤트 전후 신규매수 차단: ${eventRisk.reason}`);
      action = "HOLD";
    } else if (eventRisk?.budgetMultiplier < 1 && eventRisk?.reason) {
      reasons.push(eventRisk.reason);
    }
    if (calendarRisk?.blocked) {
      reasons.push(`지표 발표 임박 신규매수 차단: ${calendarRisk.reason}`);
      action = "HOLD";
    } else if (calendarRisk?.budgetMultiplier < 1 && calendarRisk?.reason) {
      reasons.push(calendarRisk.reason);
    }
    if (!isRegularMarket) {
      reasons.push(settings.allowFractional ? "소수점 거래 ON이라 정규장만 거래" : "장외 신규매수 금지");
      action = "HOLD";
    }
  } else {
    if (hasPosition && !settings.allowAdditionalBuys) reasons.push("이미 보유 중이라 추가매수 OFF");
    if (hasPosition && settings.allowAdditionalBuys && !position?.canAddMore) {
      reasons.push("추가매수 최소 간격 대기");
    }
    if (!trendOk) reasons.push("추세 조건 미충족");
    if (!rsiOk) reasons.push("RSI 조건 미충족");
    if (!momentumOk) reasons.push(`${params.momentumDays}일 모멘텀 미충족`);
    if (!adxOk) reasons.push(`추세 강도(ADX) 약함 — 횡보 구간 매수 보류(기준 ${minAdx})`);
    if (!volatilityTradable) reasons.push("변동성 과다");
    else if (volatilitySoftOk) reasons.push("가격 흔들림 큼, 예산 축소 조건");
    if (dailyDropBlock) reasons.push(`당일 시가 대비 ${settings.intradayDropBlockPct}% 이상 하락 구간 — 신규매수 보류`);
    if (!allocationOk) reasons.push("배정 시드/현금 버퍼 부족");
  }

  return {
    symbol: target.symbol,
    action,
    reasons,
    metrics: {
      lastPrice: round(last, 4),
      fastSma: round(fastSma, 4),
      slowSma: round(slowSma, 4),
      rsi14: round(currentRsi, 2),
      adx14: round(currentAdx, 1),
      atrPct: round(atrPct, 2),
      momentum5dPct: round(momentumPct, 2),
      momentumPct: round(momentumPct, 2),
      strategyParams: params,
      dailyMovePct: round(dailyMovePct, 2),
      peakPrice: round(peakPrice, 4),
      softVolatilityLimitPct: round(softVolatilityLimitPct, 2),
      volatilityBudgetMultiplier
    },
    risk: {
      event: eventRisk ?? null,
      news: newsRisk ?? null,
      calendar: calendarRisk ?? null,
      budgetMultiplier: round(
        Math.min(
          eventRisk?.budgetMultiplier ?? 1,
          newsRisk?.budgetMultiplier ?? 1,
          calendarRisk?.budgetMultiplier ?? 1,
          volatilityBudgetMultiplier
        ),
        2
      )
    }
  };
}

export function buildOrderPlan({
  target,
  signal,
  price,
  settings,
  position,
  isRegularMarket,
  matchingBuyWeight = 0,
  exposure = {},
  botBudget = null,
  sellableQuantity = null
}) {
  const last = Number(price?.lastPrice ?? signal.metrics.lastPrice);
  const budget = resolveTradingBudget({ settings, botBudget });
  const investableBudget = budget.buyingPowerUsd;
  const targetBudget =
    settings.redistributeUnusedAllocation && signal.action === "BUY" && matchingBuyWeight > 0
      ? (investableBudget * Number(target.allocationPct)) / matchingBuyWeight
      : (investableBudget * Number(target.allocationPct)) / 100;
  const adjustedBudget = targetBudget * Number(signal.risk?.budgetMultiplier ?? 1);
  const cappedBudget = capBuyBudget({
    budget: adjustedBudget,
    target,
    position,
    settings,
    exposure,
    capitalBaseUsd: budget.capitalBaseUsd
  });

  if (signal.action === "BUY") {
    if (!isRegularMarket) {
      return {
        side: "BUY",
        mode: "SKIP",
        reason: settings.allowFractional ? "소수점 거래 ON이라 정규장만 거래" : "장외 신규매수 금지"
      };
    }
    if (cappedBudget.amount <= 0) {
      return { side: "BUY", mode: "SKIP", reason: cappedBudget.reason || "비중/레버리지 한도 도달" };
    }
    if (settings.allowFractional && isRegularMarket) {
      return {
        side: "BUY",
        orderType: "MARKET",
        mode: "AMOUNT",
        orderAmount: round(Math.max(0, cappedBudget.amount), 2),
        expectedQuantity: last ? round(cappedBudget.amount / last, 6) : null,
        originalBudget: round(targetBudget, 2),
        availableBudget: round(investableBudget, 2),
        capitalBaseUsd: round(budget.capitalBaseUsd, 2),
        virtualSeed: budget.virtualSeed,
        budgetMultiplier: round(Number(signal.risk?.budgetMultiplier ?? 1), 2),
        capReason: cappedBudget.reason
      };
    }

    const quantity = Math.floor(cappedBudget.amount / last);
    if (quantity < 1) {
      const reason =
        cappedBudget.reason
          ? `${cappedBudget.reason}, 1주 매수 예산 부족`
          : settings.allowFractional && !isRegularMarket
          ? "정규장 밖이라 소수점 주문 대기, 1주 매수 예산 부족"
          : "소수점 OFF 상태에서 1주 매수 예산 부족";
      return { side: "BUY", mode: "SKIP", reason };
    }
    return {
      side: "BUY",
      orderType: "MARKET",
      mode: "QUANTITY",
      quantity,
      originalBudget: round(targetBudget, 2),
      availableBudget: round(investableBudget, 2),
      capitalBaseUsd: round(budget.capitalBaseUsd, 2),
      virtualSeed: budget.virtualSeed,
      budgetMultiplier: round(Number(signal.risk?.budgetMultiplier ?? 1), 2),
      capReason: cappedBudget.reason
    };
  }

  if (signal.action === "SELL" || signal.action === "PARTIAL_SELL") {
    if (!isRegularMarket) {
      const defensiveSell = isDefensiveSellSignal(signal);
      const allowDefensiveSell =
        Boolean(settings.allowExtendedHoursDefensiveSells) || Boolean(settings.allowExtendedHoursTrading);
      if (!defensiveSell || !allowDefensiveSell) {
        const reason = defensiveSell
            ? "장외 방어매도 OFF"
            : "장외 일반매도 차단";
        return {
          side: "SELL",
          mode: "SKIP",
          reason
        };
      }
    }
    if (!isRegularMarket && signal.action === "PARTIAL_SELL") {
      return {
        side: "SELL",
        mode: "SKIP",
        reason: "장외 일반매도 차단"
      };
    }
    const positionQuantity = Math.max(0, Number(position?.quantity ?? 0));
    const availableQuantity = Number.isFinite(Number(sellableQuantity))
      ? Math.max(0, Math.min(positionQuantity, Number(sellableQuantity)))
      : positionQuantity;
    const sellRatio =
      signal.action === "PARTIAL_SELL"
        ? clamp(Number(target.partialTakeProfitSellPct ?? 40) / 100, 0.1, 1)
        : 1;
    if (settings.allowFractional && isRegularMarket) {
      const fractionalQuantity = floorDecimal(availableQuantity * sellRatio, 6);
      if (!(fractionalQuantity > 0)) {
        return {
          side: "SELL",
          mode: "SKIP",
          reason: "토스 판매 가능 수량이 없어 매도를 보류"
        };
      }
      return {
        side: "SELL",
        orderType: "MARKET",
        mode: "QUANTITY",
        quantity: fractionalQuantity,
        fractional: fractionalQuantity % 1 !== 0,
        requestedPositionQuantity: round(positionQuantity, 6),
        sellableQuantity: round(availableQuantity, 6),
        sellRatio,
        exitType: signal.action === "PARTIAL_SELL" ? "PARTIAL_TAKE_PROFIT" : "FULL_EXIT"
      };
    }
    const requestedQuantity = availableQuantity * sellRatio;
    const wholeQuantity = Math.floor(requestedQuantity);
    if (wholeQuantity < 1) {
      return {
        side: "SELL",
        mode: "SKIP",
        reason: isRegularMarket ? "매도 가능한 수량 없음" : "소수점 보유분은 정규장에서 매도 대기"
      };
    }
    return {
      side: "SELL",
      orderType: "MARKET",
      mode: "QUANTITY",
      quantity: wholeQuantity,
      sellRatio,
      exitType: signal.action === "PARTIAL_SELL" ? "PARTIAL_TAKE_PROFIT" : "FULL_EXIT",
      capReason: !isRegularMarket && wholeQuantity < requestedQuantity ? "장외 정수 매도라 소수점 잔량 보류" : null
    };
  }

  return null;
}

export function isDefensiveSellSignal(signal) {
  if (signal?.action !== "SELL") return false;
  const reasonText = (signal.reasons ?? []).join(" ");
  return /손절|고점 대비|급락|하락|손실|일봉 기준/.test(reasonText);
}

export function recommendTargetSettings({ target, snapshot, candles, mode = "fast", settings = {} }) {
  const metrics = snapshot?.signal?.metrics ?? {};
  const optimized =
    mode === "deep"
      ? optimizeTargetSettingsDeep({ target, candles, settings })
      : optimizeTargetSettings({ target, candles, settings });
  const fallbackBacktest = candles?.length ? robustBacktestTarget({ target, candles, settings }) : snapshot?.backtest;
  const leverage = parseLeverage(target.leverage);
  const atrPct = Number(metrics.atrPct ?? target.maxAtrPct ?? 12);
  const rsi14 = Number(metrics.rsi14 ?? 55);
  const momentum = Number(metrics.momentumPct ?? metrics.momentum5dPct ?? 0);
  const volatilityBand = clamp(Number.isFinite(atrPct) ? atrPct : 12, 6, 24);
  const leverageRisk = leverage >= 3 ? 1.15 : 1;
  const momentumBoost = momentum > 15 ? 1.08 : momentum < 0 ? 0.92 : 1;

  const stopLossPct = clamp(volatilityBand * 0.75 * leverageRisk, 6, 14);
  const trailingStopPct = clamp(stopLossPct * 1.35, 8, 18);
  const partialTakeProfitPct = clamp(stopLossPct * 1.35 * momentumBoost, 8, 20);
  const partialTakeProfitSellPct = clamp(leverage >= 3 ? 45 : 40, 30, 50);
  const takeProfitPct = clamp(stopLossPct * 2.2 * momentumBoost, 12, 32);
  const takeProfitRsi = clamp(leverage >= 3 ? 76 : 80, 72, rsi14 > 68 ? 76 : 82);
  const maxAtrPct = clamp(volatilityBand * 1.15, leverage >= 3 ? 10 : 11, leverage >= 3 ? 18 : 20);

  const baseReasons = [
    `최근 변동성(ATR)이 약 ${round(atrPct, 2)}%라 손절폭은 ${round(stopLossPct, 1)}%로 계산했습니다.`,
    `${target.leverage || "레버리지"} 상품이라 고점 이탈 기준은 손절보다 넓게 ${round(trailingStopPct, 1)}%로 잡았습니다.`,
    `수익이 먼저 난 구간에서는 ${round(partialTakeProfitPct, 1)}%에서 ${round(partialTakeProfitSellPct, 0)}%만 일부 익절하도록 제안합니다.`,
    `익절 목표는 손절폭의 약 2배 이상으로 ${round(takeProfitPct, 1)}%를 제안합니다.`,
    `RSI가 과열권에 가까워지면 추격 보유를 줄이도록 과열 매도선을 ${round(takeProfitRsi, 0)}로 둡니다.`,
    `ATR 제한은 현재 변동성보다 약간 여유 있게 ${round(maxAtrPct, 1)}%로 둡니다.`
  ];
  const params = getStrategyParams(target);
  const recommended = optimized?.recommended ?? {
    fastSmaDays: Number(params.fastSmaDays),
    slowSmaDays: Number(params.slowSmaDays),
    momentumDays: Number(params.momentumDays),
    minBuyRsi: Number(params.minBuyRsi),
    maxBuyRsi: Number(params.maxBuyRsi),
    stopLossPct: round(stopLossPct, 1),
    partialTakeProfitPct: round(partialTakeProfitPct, 1),
    partialTakeProfitSellPct: round(partialTakeProfitSellPct, 0),
    takeProfitPct: round(takeProfitPct, 1),
    trailingStopPct: round(trailingStopPct, 1),
    takeProfitRsi: round(takeProfitRsi, 0),
    maxAtrPct: round(maxAtrPct, 1)
  };

  return {
    symbol: target.symbol,
    recommended,
    score: optimized?.score ?? scoreBacktest(fallbackBacktest),
    grade: gradeScore(optimized?.score ?? scoreBacktest(fallbackBacktest)),
    backtest: optimized?.backtest ?? fallbackBacktest ?? null,
    warning:
      (optimized?.score ?? scoreBacktest(fallbackBacktest)) < 65
        ? "백테스트 점수가 낮습니다. 실전에서는 비중을 줄이거나 조건을 재검토하는 편이 안전합니다."
        : null,
    reasons: optimized
      ? [
          `최근 ${optimized.backtest.days}개 일봉을 ${mode === "deep" ? "정밀" : "빠른"} 추천으로 검사했고, 점수 ${optimized.score}/100 조합을 선택했습니다.`,
          ...optimized.reasons
        ]
      : baseReasons
  };
}

export function recommendPortfolioWeights({ targets, snapshots, backtests = {} }) {
  const enabledTargets = targets.filter((target) => target.enabled !== false);
  if (!enabledTargets.length) return { weights: {}, reasons: ["활성 종목이 없습니다."] };

  const scored = enabledTargets.map((target) =>
    scoreTargetWeight(target, snapshots?.[target.symbol], backtests?.[target.symbol])
  );
  const totalScore = scored.reduce((sum, item) => sum + item.score, 0);
  if (totalScore <= 0) {
    const averageScore = scored.length
      ? scored.reduce((sum, item) => sum + item.score100, 0) / scored.length
      : 0;
    return {
      weights: Object.fromEntries(scored.map((item) => [item.symbol, 0])),
      score: round(averageScore, 0),
      grade: "전략 재검토",
      reasons: scored.map((item) => `${item.symbol}: ${item.reason}`)
    };
  }
  const rawWeights = scored.map((item) => ({
    ...item,
    weight: (item.score / totalScore) * 100
  }));
  const adjusted = normalizeWeightsWithFloor(rawWeights);

  return {
    weights: Object.fromEntries(adjusted.map((item) => [item.symbol, round(item.weight, 1)])),
    score: round(adjusted.reduce((sum, item) => sum + item.score100 * (item.weight / 100), 0), 0),
    grade: gradeScore(adjusted.reduce((sum, item) => sum + item.score100 * (item.weight / 100), 0)),
    reasons: adjusted.map((item) => `${item.symbol}: ${item.reason}`)
  };
}

export function backtestTarget({ target, candles, settings = {} }) {
  const normalized = normalizeCandles(candles);
  if (normalized.length < 55) {
    return { available: false, engineVersion: strategySummary.name, reason: "백테스트에 필요한 일봉이 부족합니다." };
  }

  const guarded = runBacktestSimulation({ target, candles: normalized, settings, includeDailyGuards: true });
  const alpha = runBacktestSimulation({ target, candles: normalized, settings, includeDailyGuards: false });
  const guardReturnDragPct = round(Number(guarded.totalReturnPct ?? 0) - Number(alpha.totalReturnPct ?? 0), 1);
  const guardDrawdownChangePct = round(Number(guarded.maxDrawdownPct ?? 0) - Number(alpha.maxDrawdownPct ?? 0), 1);
  const guardScoreChange = Number(guarded.score ?? 0) - Number(alpha.score ?? 0);

  return {
    ...guarded,
    alphaBacktest: summarizeBacktestVariant(alpha),
    guardedBacktest: summarizeBacktestVariant(guarded),
    guardImpact: {
      scoreChange: guardScoreChange,
      returnPctChange: guardReturnDragPct,
      drawdownPctChange: guardDrawdownChangePct,
      explanation:
        guardReturnDragPct < 0
          ? "안전장치가 일부 하락 구간을 피했지만 반등 구간도 놓쳐 수익률을 낮췄습니다."
          : guardReturnDragPct > 0
            ? "안전장치가 손실 구간을 줄여 수익률에 보탬이 됐습니다."
            : "안전장치가 이번 구간 수익률에는 거의 영향을 주지 않았습니다."
    },
    guardCoverage: {
      included: ["당일 급락 신규매수 차단", "당일 급락 방어매도", `추정 수수료·슬리피지(왕복 약 ${round(BACKTEST_COST_PER_SIDE * 2 * 100, 2)}%)`],
      excluded: ["뉴스 감성", "실적·거시 이벤트", "포트폴리오 당일 손실 한도", "종목별 비중·전체 레버리지 노출 한도", "체결 지연·부분체결"]
    },
    summary:
      `${guarded.summary} · 안전장치 영향 ${guardScoreChange >= 0 ? "+" : ""}${guardScoreChange}점, 수익률 ` +
      `${guardReturnDragPct >= 0 ? "+" : ""}${guardReturnDragPct}%p`
  };
}

// 백테스트 한쪽 거래당 추정 비용(수수료+슬리피지). 0.1%/측 ≈ 왕복 0.2% 가정값.
// 실제 토스 수수료/체결오차와 다를 수 있는 보수적 추정치로, 백테스트를 실제에 조금 더 가깝게 만든다.
const BACKTEST_COST_PER_SIDE = 0.001;

function runBacktestSimulation({ target, candles, settings, includeDailyGuards }) {
  const cost = BACKTEST_COST_PER_SIDE;
  let cash = 1000;
  let quantity = 0;
  let entryPrice = 0;
  let entryCostPerShare = 0;
  let peakPrice = 0;
  let partialTaken = false;
  let realizedTradePnl = 0;
  let wins = 0;
  let losses = 0;
  let trades = 0;
  let maxEquity = cash;
  let maxDrawdownPct = 0;

  for (let index = 50; index < candles.length; index += 1) {
    const window = candles.slice(0, index + 1);
    const closes = window.map((item) => item.close);
    const last = window.at(-1).close;
    const params = getStrategyParams(target);
    const fastSma = sma(closes, params.fastSmaDays);
    const slowSma = sma(closes, params.slowSmaDays);
    const currentRsi = rsi(closes, 14);
    const currentAtr = atr(window, 14);
    const currentAdx = adx(window, 14);
    const atrPct = currentAtr && last ? (currentAtr / last) * 100 : null;
    const momentumBase = closes.at(-(params.momentumDays + 1));
    const momentumPct = momentumBase ? ((last - momentumBase) / momentumBase) * 100 : null;
    const dailyMovePct = calculateDailyMovePct(window, last);
    // §HH: 라이브 evaluateTarget와 동일하게 당일 급락 매수차단을 적용(추세확인 조건 제거 — 재활성).
    const dailyDropBlock =
      includeDailyGuards &&
      Number.isFinite(dailyMovePct) &&
      dailyMovePct <= -Number(settings.intradayDropBlockPct ?? Number.POSITIVE_INFINITY);
    const dailyPanicExit =
      includeDailyGuards &&
      quantity > 0 &&
      Number.isFinite(dailyMovePct) &&
      dailyMovePct <= -Number(settings.intradayPanicExitPct ?? Number.POSITIVE_INFINITY);
    const equity = cash + quantity * last;

    maxEquity = Math.max(maxEquity, equity);
    maxDrawdownPct = Math.max(maxDrawdownPct, maxEquity > 0 ? ((maxEquity - equity) / maxEquity) * 100 : 0);

    if (quantity > 0) {
      peakPrice = Math.max(peakPrice, last);
      const stopLossHit = last <= entryPrice * (1 - Number(target.stopLossPct ?? 8) / 100);
      const partialHit = !partialTaken && last >= entryPrice * (1 + Number(target.partialTakeProfitPct ?? 10) / 100);
      const takeProfitHit = last >= entryPrice * (1 + Number(target.takeProfitPct ?? 18) / 100);
      const trailingHit = last <= peakPrice * (1 - Number(target.trailingStopPct ?? 10) / 100);
      const trendExit = fastSma && last < fastSma;
      const overboughtExit = currentRsi && currentRsi >= Number(target.takeProfitRsi ?? 78);

      if (quantity > 0 && (stopLossHit || takeProfitHit || trailingHit || trendExit || overboughtExit || dailyPanicExit)) {
        const exitProceeds = quantity * last * (1 - cost);
        const exitPnl = quantity * (last * (1 - cost) - entryCostPerShare) + realizedTradePnl;
        cash += exitProceeds;
        quantity = 0;
        trades += 1;
        if (exitPnl >= 0) wins += 1;
        else losses += 1;
        entryPrice = 0;
        entryCostPerShare = 0;
        peakPrice = 0;
        partialTaken = false;
        realizedTradePnl = 0;
        continue;
      }

      if (partialHit) {
        const sellQuantity = quantity * clamp(Number(target.partialTakeProfitSellPct ?? 40) / 100, 0.1, 1);
        cash += sellQuantity * last * (1 - cost);
        realizedTradePnl += sellQuantity * (last * (1 - cost) - entryCostPerShare);
        quantity -= sellQuantity;
        partialTaken = true;
      }
      continue;
    }

    const trendOk = fastSma && slowSma && last > fastSma && fastSma > slowSma;
    const rsiOk = currentRsi !== null && currentRsi >= params.minBuyRsi && currentRsi <= params.maxBuyRsi;
    const momentumOk = momentumPct !== null && momentumPct > 0;
    const minAdx = Number(target.minAdx ?? settings.minAdx ?? 0);
    const adxOk = !(minAdx > 0) || (currentAdx !== null && currentAdx >= minAdx);
    const maxAtrPct = Number(target.maxAtrPct ?? 12);
    const volatilityOk = atrPct === null || atrPct <= maxAtrPct;
    const softVolatilityLimitPct = Math.min(30, Math.max(maxAtrPct + 8, maxAtrPct * 1.6));
    const volatilitySoftOk =
      !volatilityOk &&
      atrPct !== null &&
      atrPct <= softVolatilityLimitPct &&
      Boolean(trendOk && rsiOk && momentumOk);
    const volatilityTradable = volatilityOk || volatilitySoftOk;
    const buyCashMultiplier = volatilitySoftOk ? 0.5 : 1;

    if (trendOk && rsiOk && momentumOk && adxOk && volatilityTradable && !dailyDropBlock) {
      const buyCash = cash * buyCashMultiplier;
      // 매수 비용을 체결가에 반영해 받는 수량을 줄인다(수수료+슬리피지).
      quantity = buyCash / (last * (1 + cost));
      cash -= buyCash;
      entryPrice = last;
      entryCostPerShare = last * (1 + cost);
      peakPrice = last;
      partialTaken = false;
      realizedTradePnl = 0;
    }
  }

  const finalPrice = candles.at(-1).close;
  const finalEquity = cash + quantity * finalPrice;
  const totalReturnPct = ((finalEquity - 1000) / 1000) * 100;
  const completedTrades = wins + losses;

  return {
    available: true,
    engineVersion: strategySummary.name,
    days: candles.length,
    trades,
    winRatePct: completedTrades > 0 ? round((wins / completedTrades) * 100, 1) : null,
    totalReturnPct: round(totalReturnPct, 1),
    maxDrawdownPct: round(maxDrawdownPct, 1),
    score: scoreBacktest({
      available: true,
      days: candles.length,
      trades,
      winRatePct: completedTrades > 0 ? (wins / completedTrades) * 100 : null,
      totalReturnPct,
      maxDrawdownPct
    }),
    variant: includeDailyGuards ? "guarded" : "alpha",
    summary:
      completedTrades > 0
        ? `최근 ${candles.length}개 일봉 기준 승률 ${round((wins / completedTrades) * 100, 1)}%, 수익률 ${round(totalReturnPct, 1)}%, 최대낙폭 ${round(maxDrawdownPct, 1)}%`
        : `최근 ${candles.length}개 일봉에서 완료된 매매가 아직 없습니다.`
  };
}

function summarizeBacktestVariant(backtest) {
  return {
    score: Number(backtest.score ?? 0),
    days: Number(backtest.days ?? 0),
    trades: Number(backtest.trades ?? 0),
    winRatePct: backtest.winRatePct,
    totalReturnPct: backtest.totalReturnPct,
    maxDrawdownPct: backtest.maxDrawdownPct,
    summary: backtest.summary
  };
}

export function robustBacktestTarget({ target, candles, settings = {} }) {
  const normalized = normalizeCandles(candles);
  if (normalized.length < 120) {
    const full = backtestTarget({ target, candles: normalized, settings });
    return {
      ...full,
      robust: false,
      score: Math.min(scoreBacktest(full), 55),
      summary: `${full.summary ?? "백테스트 부족"} · 데이터가 짧아 점수 상한을 55점으로 제한`
    };
  }

  const split = Math.max(80, Math.floor(normalized.length * 0.68));
  const trainCandles = normalized.slice(0, split);
  const validationCandles = normalized.slice(Math.max(0, split - 50));
  const train = backtestTarget({ target, candles: trainCandles, settings });
  const validation = backtestTarget({ target, candles: validationCandles, settings });
  const full = backtestTarget({ target, candles: normalized, settings });
  const trainScore = scoreBacktest(train);
  const validationScore = scoreBacktest(validation);
  const overfitPenalty = Math.max(0, trainScore - validationScore) * 0.35;
  const robustScore = round(clamp(trainScore * 0.35 + validationScore * 0.65 - overfitPenalty, 0, 100), 0);

  return {
    ...full,
    score: robustScore,
    robust: true,
    train,
    validation,
    summary: `${full.summary}; 전체 ${normalized.length}일 점수 ${scoreBacktest(full)}/100, 검증구간 ${validation.days}일 점수 ${validationScore}/100, 최종 ${robustScore}/100`
  };
}

// 과적합 완화: 최고점수 조합이 현재 설정보다 이 점수 이상 높을 때만 변경을 추천한다.
// (다수 조합 중 최댓값 선택은 검증구간에도 운 좋은 조합을 뽑는 선택편향이 있어, 작은 차이는 잡음으로 본다.)
const OPTIMIZE_IMPROVE_MARGIN = 5;

function backtestGap(backtest) {
  const train = Number(backtest?.train?.score);
  const validation = Number(backtest?.validation?.score);
  if (!Number.isFinite(train) || !Number.isFinite(validation)) return 0;
  return Math.max(0, train - validation);
}

// 점수가 분명히 높으면 채택, 비슷하면(±2점) 학습-검증 격차가 작은(과적합 적은) 쪽을 고른다.
function isMoreRobustCandidate(candidate, best) {
  if (!best) return true;
  if (candidate.score > best.score + 2) return true;
  if (candidate.score < best.score - 2) return false;
  return backtestGap(candidate.backtest) < backtestGap(best.backtest);
}

function recommendedFromCandidate(candidate, base) {
  // 비중(allocationPct)은 종목별 추천이 아니라 전체비중 추천의 영역이라 여기서 추천하지 않는다.
  // (이전엔 base 비중을 그대로 메아리해 전체비중 추천값과 충돌해 보였다.)
  return {
    fastSmaDays: Number(candidate.fastSmaDays),
    slowSmaDays: Number(candidate.slowSmaDays),
    momentumDays: Number(candidate.momentumDays),
    minBuyRsi: Number(candidate.minBuyRsi),
    maxBuyRsi: Number(candidate.maxBuyRsi),
    stopLossPct: round(candidate.stopLossPct, 1),
    partialTakeProfitPct: round(candidate.partialTakeProfitPct, 1),
    partialTakeProfitSellPct: round(candidate.partialTakeProfitSellPct, 0),
    takeProfitPct: round(candidate.takeProfitPct, 1),
    trailingStopPct: round(candidate.trailingStopPct, 1),
    takeProfitRsi: round(candidate.takeProfitRsi, 0),
    maxAtrPct: round(candidate.maxAtrPct, 1)
  };
}

// 종목별 ADX 필터 추천: 끔(0) 대비 켜는 옵션이 명확히(+4점) 나을 때만 "켜기"를 추천한다.
// 필터는 거래 수를 줄이므로, 강한 추세 상품은 보통 끄기가 낫고 횡보가 심한 상품에서만 켜기가 유리하다.
const ADX_RECOMMEND_MARGIN = 4;
function recommendMinAdx({ candidate, candles, settings }) {
  const offScore = Number(robustBacktestTarget({ target: { ...candidate, minAdx: 0 }, candles, settings }).score ?? 0);
  let bestOn = { minAdx: 0, score: offScore };
  for (const minAdx of [18, 22, 26]) {
    const score = Number(robustBacktestTarget({ target: { ...candidate, minAdx }, candles, settings }).score ?? 0);
    if (score > bestOn.score) bestOn = { minAdx, score };
  }
  const turnOn = bestOn.minAdx > 0 && bestOn.score >= offScore + ADX_RECOMMEND_MARGIN;
  return {
    minAdx: turnOn ? bestOn.minAdx : 0,
    reason: turnOn
      ? `ADX 추세강도 필터 켜기 추천(기준 ${bestOn.minAdx}) — 횡보 구간 매수를 걸러 점수가 ${offScore}→${bestOn.score}로 개선됩니다.`
      : `ADX 추세강도 필터 끄기 추천 — 추세가 강해 필터가 좋은 거래를 잘라냅니다(끔 ${offScore}점 vs 최적 켬 ${bestOn.minAdx === 0 ? "없음" : bestOn.minAdx + "@" + bestOn.score + "점"}).`
  };
}

function finalizeOptimization({ best, base, candles, settings, comboCount, label }) {
  if (!best) return null;
  const currentCandidate = { ...base, ...getStrategyParams(base) };
  const baselineBacktest = robustBacktestTarget({ target: currentCandidate, candles, settings });
  const baselineScore = Number(baselineBacktest.score ?? 0);
  const improvement = best.score - baselineScore;
  const useBest = improvement >= OPTIMIZE_IMPROVE_MARGIN;
  const chosen = useBest ? best.candidate : currentCandidate;
  // 선택된 파라미터 조합 위에서 종목별 ADX 필터 켜기/끄기를 추천한다.
  const adxRec = recommendMinAdx({ candidate: chosen, candles, settings });
  const recommended = { ...recommendedFromCandidate(chosen, base), minAdx: adxRec.minAdx };

  if (!useBest) {
    return {
      recommended,
      backtest: baselineBacktest,
      score: baselineScore,
      reasons: [
        `검증 결과는 ${baselineBacktest.summary}입니다.`,
        `${comboCount}개 후보 중 최고 점수(${best.score})가 현재 설정(${baselineScore})보다 ${OPTIMIZE_IMPROVE_MARGIN}점 이상 높지 않아, 과적합을 피하려 현재 설정 유지를 추천합니다.`,
        adxRec.reason,
        baselineScore < 65
          ? "점수가 낮은 편이라 비중을 줄이거나 조건을 재검토하는 편이 좋습니다."
          : "현재 설정이 충분히 견고한 편입니다."
      ]
    };
  }

  return {
    recommended,
    backtest: best.backtest,
    score: best.score,
    reasons: [
      `검증 결과는 ${best.backtest.summary}입니다.`,
      best.score < 65
        ? "점수가 낮아 추천값을 적용해도 실전에서는 비중을 줄이거나 조건을 재검토하는 편이 좋습니다."
        : best.score < 80
          ? "점수는 보통 이상이라 실전에서는 비중과 손실 한도를 함께 확인하는 편이 좋습니다."
          : "점수가 양호해 현재 후보군 중 상대적으로 안정적인 조합입니다.",
      adxRec.reason,
      `${label} ${comboCount}개 후보 조합을 비교했고, 현재 설정보다 ${round(improvement, 0)}점 높은 조합을 골랐습니다.`
    ]
  };
}

export function optimizeTargetSettings({ target, candles, settings = {} }) {
  const normalized = normalizeCandles(candles);
  if (normalized.length < 120) return null;

  const base = {
    ...target,
    allocationPct: Number(target.allocationPct)
  };
  const strategyProfiles = buildStrategyProfiles(base);
  const riskProfiles = buildRiskProfiles(base);
  let best = null;

  for (const strategyProfile of strategyProfiles) {
    for (const riskProfile of riskProfiles) {
      const candidate = {
        ...base,
        ...strategyProfile,
        ...riskProfile
      };
      if (candidate.trailingStopPct < candidate.stopLossPct * 0.9) continue;
      if (candidate.takeProfitPct <= candidate.partialTakeProfitPct) continue;
      const backtest = robustBacktestTarget({ target: candidate, candles: normalized, settings });
      const score = backtest.score;
      if (isMoreRobustCandidate({ candidate, backtest, score }, best)) {
        best = { candidate, backtest, score };
      }
    }
  }

  return finalizeOptimization({
    best,
    base,
    candles: normalized,
    settings,
    comboCount: strategyProfiles.length * riskProfiles.length,
    label: "빠른 계산으로"
  });
}

export function optimizeTargetSettingsDeep({ target, candles, settings = {} }) {
  const normalized = normalizeCandles(candles);
  if (normalized.length < 120) return null;

  const base = {
    ...target,
    allocationPct: Number(target.allocationPct)
  };
  const strategyProfiles = buildStrategyProfiles(base);
  const riskProfiles = buildRiskProfiles(base);
  const stopScales = [0.9, 1, 1.12];
  const targetScales = [0.9, 1, 1.15];
  const atrScales = [0.92, 1, 1.12];
  let best = null;
  let tested = 0;

  for (const strategyProfile of strategyProfiles) {
    for (const riskProfile of riskProfiles) {
      for (const stopScale of stopScales) {
        for (const targetScale of targetScales) {
          for (const atrScale of atrScales) {
            const stopLossPct = round(clamp(riskProfile.stopLossPct * stopScale, 5, 16), 1);
            const candidate = {
              ...base,
              ...strategyProfile,
              ...riskProfile,
              stopLossPct,
              trailingStopPct: round(clamp(riskProfile.trailingStopPct * stopScale, 7, 22), 1),
              partialTakeProfitPct: round(clamp(riskProfile.partialTakeProfitPct * targetScale, 7, 24), 1),
              takeProfitPct: round(clamp(riskProfile.takeProfitPct * targetScale, 12, 40), 1),
              maxAtrPct: round(clamp(riskProfile.maxAtrPct * atrScale, 8, 26), 1)
            };
            if (candidate.trailingStopPct < candidate.stopLossPct * 0.9) continue;
            if (candidate.takeProfitPct <= candidate.partialTakeProfitPct) continue;
            const backtest = robustBacktestTarget({ target: candidate, candles: normalized, settings });
            const score = backtest.score;
            tested += 1;
            if (isMoreRobustCandidate({ candidate, backtest, score }, best)) {
              best = { candidate, backtest, score };
            }
          }
        }
      }
    }
  }

  return finalizeOptimization({
    best,
    base,
    candles: normalized,
    settings,
    comboCount: tested,
    label: "정밀 추천으로"
  });
}

function scoreTargetWeight(target, snapshot, overrideBacktest) {
  const metrics = snapshot?.signal?.metrics ?? {};
  const backtest = overrideBacktest ?? snapshot?.backtest;
  const leverage = parseLeverage(target.leverage);
  const atrPct = Number(metrics.atrPct ?? target.maxAtrPct ?? 12);
  const momentum = Number(metrics.momentumPct ?? metrics.momentum5dPct ?? 0);
  const rsi14 = Number(metrics.rsi14 ?? 55);
  const eventBlocked = Boolean(snapshot?.signal?.risk?.event?.blocked);
  const newsMultiplier = Number(snapshot?.signal?.risk?.news?.budgetMultiplier ?? 1);
  const volatilityPenalty = clamp(1 - (atrPct - 8) / 28, 0.35, 1.15);
  const leveragePenalty = leverage >= 3 ? 0.78 : leverage >= 2 ? 0.9 : 1;
  const momentumBoost = clamp(1 + momentum / 80, 0.65, 1.35);
  const rsiPenalty = rsi14 > 72 ? 0.75 : rsi14 < 40 ? 0.85 : 1;
  const eventPenalty = eventBlocked ? 0.45 : 1;
  const score100 = scoreBacktest(backtest);
  const allocationFloorPct = eventBlocked || score100 < 55 ? 0 : score100 < 70 ? 3 : 5;
  const canAllocate = !eventBlocked && score100 >= 55;
  const backtestBoost =
    score100 < 40 ? 0.05 : score100 < 55 ? 0.18 : score100 < 70 ? 0.5 : score100 < 85 ? 0.9 : 1.35;
  const rawScore =
    volatilityPenalty * leveragePenalty * momentumBoost * rsiPenalty * eventPenalty * newsMultiplier * backtestBoost;
  const score = canAllocate ? Math.max(0.1, rawScore) : 0;
  const reason = [
    `변동성 ${round(atrPct, 1)}%`,
    `모멘텀 ${round(momentum, 1)}%`,
    `${target.leverage || "1x"}`,
    backtest?.available ? `백테스트 ${score100}/100` : "백테스트 부족",
    eventBlocked ? "이벤트 위험 반영" : "이벤트 위험 낮음",
    canAllocate ? (allocationFloorPct === 0 ? "최소비중 없음" : `최소 ${allocationFloorPct}%`) : "새 비중 0%"
  ].join(", ");
  return { symbol: target.symbol, score, score100, reason, allocationFloorPct };
}

function normalizeWeightsWithFloor(items) {
  const totalFloor = items.reduce((sum, item) => sum + Number(item.allocationFloorPct ?? 0), 0);
  if (totalFloor >= 100) {
    const equal = 100 / items.length;
    return items.map((item) => ({ ...item, weight: equal }));
  }
  const floored = items.map((item) => ({ ...item, weight: Math.max(Number(item.allocationFloorPct ?? 0), item.weight) }));
  const total = floored.reduce((sum, item) => sum + item.weight, 0);
  if (Math.abs(total - 100) < 0.01) return floored;
  const adjustable = floored.filter((item) => item.weight > Number(item.allocationFloorPct ?? 0));
  const fixedTotal = floored
    .filter((item) => item.weight <= Number(item.allocationFloorPct ?? 0))
    .reduce((sum, item) => sum + item.weight, 0);
  const adjustableTotal = adjustable.reduce((sum, item) => sum + item.weight, 0) || 1;
  return floored.map((item) => {
    if (item.weight <= Number(item.allocationFloorPct ?? 0)) return item;
    return { ...item, weight: (item.weight / adjustableTotal) * (100 - fixedTotal) };
  });
}

function calculateDailyMovePct(candles, last) {
  if (!candles.length || !Number.isFinite(last)) return null;
  const latest = candles.at(-1);
  const previous = candles.at(-2);
  const start = Number(latest?.open || previous?.close || latest?.close);
  if (!(start > 0)) return null;
  const move = ((last - start) / start) * 100;
  return Math.abs(move) > 60 ? null : move;
}

export function resolveTradingBudget({ settings, botBudget = {} }) {
  const allocationUsd = Math.max(0, Number(settings?.allocationUsd ?? 0));
  const cashBufferUsd = Math.max(0, Number(settings?.cashBufferUsd ?? 0));
  const useVirtualSeed = settings?.useVirtualSeed !== false;
  const allowSeedTopUp = Boolean(settings?.allowSeedTopUp);
  const virtualCashUsd = Number.isFinite(Number(botBudget?.virtualCashUsd))
    ? Number(botBudget.virtualCashUsd)
    : allocationUsd;
  const currentMarketValueUsd = Math.max(0, Number(botBudget?.currentMarketValueUsd ?? 0));
  const reservedPendingBuyUsd = Math.max(0, Number(botBudget?.reservedPendingBuyUsd ?? 0));
  const equityUsd = Number.isFinite(Number(botBudget?.equityUsd))
    ? Number(botBudget.equityUsd)
    : Math.max(0, virtualCashUsd + currentMarketValueUsd + reservedPendingBuyUsd);
  const topUpCashLimit = Math.max(0, allocationUsd - currentMarketValueUsd - reservedPendingBuyUsd);
  const cashForBudget = useVirtualSeed
    ? allowSeedTopUp
      ? Math.max(virtualCashUsd, topUpCashLimit)
      : virtualCashUsd
    : allocationUsd;
  const capitalBaseUsd = useVirtualSeed
    ? allowSeedTopUp
      ? Math.max(allocationUsd, equityUsd)
      : equityUsd
    : allocationUsd;

  return {
    virtualSeed: useVirtualSeed,
    allowSeedTopUp,
    buyingPowerUsd: Math.max(0, cashForBudget - cashBufferUsd),
    capitalBaseUsd: Math.max(0, capitalBaseUsd),
    cashForBudgetUsd: Math.max(0, cashForBudget),
    cashBufferUsd
  };
}

function capBuyBudget({ budget, target, position, settings, exposure, capitalBaseUsd }) {
  const currentPositionValue = Number(position?.marketValueUsd ?? 0);
  const maxPositionValue = Number(capitalBaseUsd ?? 0) * (Number(settings.maxPositionPct ?? 45) / 100);
  const positionRoom = maxPositionValue - currentPositionValue;
  const leverage = parseLeverage(target.leverage);
  const maxLeveragedExposure = Number(capitalBaseUsd ?? 0) * (Number(settings.maxLeveragedExposurePct ?? 120) / 100);
  const currentLeveragedExposure = Number(exposure.currentLeveragedExposureUsd ?? 0);
  const leveragedRoom = (maxLeveragedExposure - currentLeveragedExposure) / Math.max(1, leverage);
  const amount = Math.min(Number(budget), positionRoom, leveragedRoom);
  const reasons = [];
  if (positionRoom < Number(budget)) reasons.push("종목별 최대 비중 한도");
  if (leveragedRoom < Number(budget)) reasons.push("전체 레버리지 노출 한도");
  return {
    amount: Math.max(0, amount),
    reason: reasons.join(", ")
  };
}

function scoreBacktest(backtest) {
  if (backtest?.score !== undefined && !backtest.available) return Number(backtest.score);
  if (!backtest?.available) return 45;
  if (backtest.score !== undefined && backtest.robust) return Number(backtest.score);
  const winRate = Number(backtest.winRatePct ?? 50);
  const totalReturn = Number(backtest.totalReturnPct ?? 0);
  const maxDrawdown = Number(backtest.maxDrawdownPct ?? 100);
  const trades = Number(backtest.trades ?? 0);
  const days = Number(backtest.days ?? 0);
  // 위험조정 점수: 과거엔 수익률을 그대로(*0.38) 더해 고수익 레버리지 백테스트가 전부 100점으로 포화 →
  // 낙폭(위험)을 구분하지 못하고 추천을 과대낙관으로 만들었다. Calmar(수익/낙폭)를 tanh로 압축해
  // 비포화로 쓰고, 낙폭은 별도 패널티로 둬서 "낮은 손해"를 점수에 직접 반영한다.
  const cappedDrawdown = Math.max(8, maxDrawdown);
  const calmar = totalReturn / cappedDrawdown;
  const calmarScore = 45 * Math.tanh(calmar / 12);
  const winScore = (winRate - 50) * 0.4;
  const tradePenalty = trades < 3 ? 24 : trades < 6 ? 12 : trades < 10 ? 5 : 0;
  const dataPenalty = days < 120 ? 25 : days < 200 ? 12 : days < 252 ? 6 : 0;
  const drawdownPenalty = maxDrawdown > 50 ? 25 : maxDrawdown > 40 ? 15 : maxDrawdown > 30 ? 8 : maxDrawdown > 22 ? 3 : 0;
  const raw = 40 + calmarScore + winScore - tradePenalty - dataPenalty - drawdownPenalty;
  return round(clamp(raw, 0, 100), 0);
}

function gradeScore(score) {
  const value = Number(score ?? 0);
  if (value >= 85) return "우수";
  if (value >= 70) return "주의하며 사용";
  if (value >= 55) return "소액 테스트";
  return "전략 재검토";
}

function getStrategyParams(target) {
  return {
    fastSmaDays: clampInt(target.fastSmaDays ?? 20, 5, 80),
    slowSmaDays: clampInt(target.slowSmaDays ?? 50, 20, 220),
    momentumDays: clampInt(target.momentumDays ?? 5, 2, 30),
    minBuyRsi: clamp(Number(target.minBuyRsi ?? 45), 20, 65),
    maxBuyRsi: clamp(Number(target.maxBuyRsi ?? 72), 45, 85)
  };
}

function buildStrategyProfiles(target) {
  const current = getStrategyParams(target);
  const profiles = [
    current,
    { fastSmaDays: 30, slowSmaDays: 100, momentumDays: 10, minBuyRsi: 40, maxBuyRsi: 68 },
    { fastSmaDays: 20, slowSmaDays: 100, momentumDays: 10, minBuyRsi: 42, maxBuyRsi: 70 },
    { fastSmaDays: 50, slowSmaDays: 120, momentumDays: 10, minBuyRsi: 38, maxBuyRsi: 66 },
    { fastSmaDays: 80, slowSmaDays: 200, momentumDays: 20, minBuyRsi: 35, maxBuyRsi: 65 }
  ];
  return profiles
    .filter((profile) => profile.fastSmaDays < profile.slowSmaDays)
    .filter((profile, index, all) => {
      const key = JSON.stringify(profile);
      return all.findIndex((item) => JSON.stringify(item) === key) === index;
    });
}

function buildRiskProfiles(target) {
  const leverage = parseLeverage(target.leverage);
  const leverageRisk = leverage >= 3 ? 1.12 : leverage >= 2 ? 1.05 : 1;
  const baseStop = clamp(Number(target.stopLossPct ?? 8), 5, 16);
  const volatilityStop = clamp(Number(target.maxAtrPct ?? 12) * 0.7 * leverageRisk, 6, 14);
  const profiles = [
    {
      stopLossPct: baseStop,
      partialTakeProfitPct: clamp(Number(target.partialTakeProfitPct ?? 10), 7, 22),
      partialTakeProfitSellPct: clamp(Number(target.partialTakeProfitSellPct ?? 40), 25, 60),
      takeProfitPct: clamp(Number(target.takeProfitPct ?? 18), 12, 36),
      trailingStopPct: clamp(Number(target.trailingStopPct ?? 10), 7, 20),
      takeProfitRsi: clamp(Number(target.takeProfitRsi ?? 78), 70, 86),
      maxAtrPct: clamp(Number(target.maxAtrPct ?? 12), 8, 24)
    },
    {
      stopLossPct: clamp(volatilityStop * 0.9, 5.5, 12),
      partialTakeProfitPct: clamp(volatilityStop * 1.1, 7, 16),
      partialTakeProfitSellPct: leverage >= 3 ? 45 : 40,
      takeProfitPct: clamp(volatilityStop * 2.1, 13, 28),
      trailingStopPct: clamp(volatilityStop * 1.25, 8, 17),
      takeProfitRsi: leverage >= 3 ? 76 : 78,
      maxAtrPct: clamp(Number(target.maxAtrPct ?? 12), 9, leverage >= 3 ? 18 : 21)
    },
    {
      stopLossPct: clamp(volatilityStop, 6, 14),
      partialTakeProfitPct: clamp(volatilityStop * 1.35, 8, 20),
      partialTakeProfitSellPct: leverage >= 3 ? 40 : 35,
      takeProfitPct: clamp(volatilityStop * 2.55, 16, 34),
      trailingStopPct: clamp(volatilityStop * 1.45, 9, 19),
      takeProfitRsi: leverage >= 3 ? 78 : 80,
      maxAtrPct: clamp(Number(target.maxAtrPct ?? 12) * 1.08, 10, leverage >= 3 ? 19 : 23)
    },
    {
      stopLossPct: clamp(volatilityStop * 1.12, 7, 15),
      partialTakeProfitPct: clamp(volatilityStop * 1.55, 10, 22),
      partialTakeProfitSellPct: 30,
      takeProfitPct: clamp(volatilityStop * 3, 18, 36),
      trailingStopPct: clamp(volatilityStop * 1.65, 10, 20),
      takeProfitRsi: leverage >= 3 ? 80 : 82,
      maxAtrPct: clamp(Number(target.maxAtrPct ?? 12) * 1.18, 11, 24)
    }
  ];
  return profiles
    .map((profile) =>
      Object.fromEntries(Object.entries(profile).map(([key, value]) => [key, round(value, key === "partialTakeProfitSellPct" || key === "takeProfitRsi" ? 0 : 1)]))
    )
    .filter((profile, index, all) => all.findIndex((item) => JSON.stringify(item) === JSON.stringify(profile)) === index);
}

function clampInt(value, min, max) {
  return Math.round(clamp(Number(value), min, max));
}

function round(value, digits) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function floorDecimal(value, digits) {
  const factor = 10 ** digits;
  return Math.floor((Number(value) + Number.EPSILON) * factor) / factor;
}

export function parseLeverage(value) {
  const match = String(value ?? "").match(/(\d+(?:\.\d+)?)x/i);
  return match ? Number(match[1]) : 1;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}
