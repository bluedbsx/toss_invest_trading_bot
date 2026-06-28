// 검증(validation) 모듈 — 순수 함수만(파일/네트워크 접근 없음, 캔들·시세는 호출자가 주입).
// 목적: "봇이 단순 보유(buy-and-hold)를 이겼는가"를 정직하게 측정하고, 시드 증액 판단(게이트)을 돕는다.
// 구성: ① 벤치마크(현금흐름 반영) ② 지표(승률·손익비·MDD·초과수익) ③ 증액 게이트.
// 매매 로직은 전혀 건드리지 않는다(측정·표시 전용). AGENTS.md §3: 근거/가정을 함께 남긴다.
import { DEFAULT_BOT_STARTED_AT } from "./store.js";

// 시드 증액 게이트 기준(시스템 자체의 buildNextActions 기준과 일치시켜 교차검증 가능하게 둠).
export const GATE_MIN_CYCLES = 5; // 왕복(매수-매도) 사이클 최소 표본
export const GATE_MIN_FILLS = 20; // 최종 체결(BUY+SELL) 최소 표본
export const BENCHMARK_SYMBOL = process.env.BENCHMARK_SYMBOL || "QQQ"; // 기본 벤치마크 = 나스닥100(QQQ). 필요하면 BENCHMARK_SYMBOL 환경변수로 변경.

// 봇에 투입된 자본의 현금흐름을 복원한다.
// 초기 시드(botStartedAt) + 이후 "일회성 봇 자금 추가"(budget-add) 이벤트들의 시간/금액.
// 근거: 시드를 여러 번 더하면 그 각각이 현금흐름이라, 벤치마크도 "그 시점에 그만큼 매수"로 비교해야 공정하다.
export function buildCapitalFlows(state) {
  const settings = state?.settings ?? {};
  const startedAt = settings.botStartedAt ?? DEFAULT_BOT_STARTED_AT;
  const currentSeed = Math.max(0, Number(state?.botBudget?.startingSeedUsd ?? settings.allocationUsd ?? 0));
  const events = (state?.learning?.recommendationEvents ?? []).filter((event) => event.type === "budget-add");
  const topUps = events
    .map((event) => ({
      at: event.payload?.at ?? event.createdAt,
      amountUsd: Number(event.payload?.amountUsd ?? 0),
      kind: "topup"
    }))
    .filter((flow) => Number.isFinite(flow.amountUsd) && flow.amountUsd > 0)
    .sort((left, right) => new Date(left.at) - new Date(right.at));
  const totalTopUp = topUps.reduce((sum, flow) => sum + flow.amountUsd, 0);
  const initialSeed = currentSeed - totalTopUp;
  const flows = [];
  // 데이터 불일치(추가 합 > 현재 시드)면 보수적으로 현재 시드를 단일 초기 투입으로 본다.
  if (initialSeed > 0.005 && totalTopUp <= currentSeed + 0.005) {
    flows.push({ at: startedAt, amountUsd: round(initialSeed, 2), kind: "initial" });
    flows.push(...topUps);
  } else {
    flows.push({ at: startedAt, amountUsd: round(currentSeed, 2), kind: "initial" });
  }
  return flows;
}

// 캔들(일봉, 시간 오름차순)에서 특정 시점의 종가를 찾는다. 그 날짜 이하의 마지막 캔들 종가를 쓴다.
function closeAt(candles, at) {
  const t = new Date(at).getTime();
  if (!Number.isFinite(t) || !candles?.length) return null;
  let chosen = null;
  for (const candle of candles) {
    const ct = new Date(candle.timestamp).getTime();
    if (ct <= t) chosen = candle;
    else break;
  }
  // 투입 시점이 첫 캔들보다 이르면 첫 캔들로 근사.
  return Number((chosen ?? candles[0])?.close ?? null);
}

// 벤치마크: 각 현금흐름을 그 시점 BENCHMARK_SYMBOL 종가로 매수해 보유했다면의 현재 가치.
export function computeBenchmark({ flows, candles, currentPrice }) {
  const latest = Number(currentPrice ?? candles?.at?.(-1)?.close);
  if (!(latest > 0) || !candles?.length) {
    return { available: false, reason: "벤치마크 가격 데이터가 없습니다." };
  }
  let units = 0;
  let invested = 0;
  for (const flow of flows) {
    const price = closeAt(candles, flow.at);
    if (!(price > 0)) continue;
    units += flow.amountUsd / price;
    invested += flow.amountUsd;
  }
  const value = units * latest;
  return {
    available: true,
    symbol: BENCHMARK_SYMBOL,
    investedUsd: round(invested, 2),
    units: round(units, 6),
    valueUsd: round(value, 2),
    latestPrice: round(latest, 4),
    returnPct: invested > 0 ? round(((value - invested) / invested) * 100, 2) : null
  };
}

// 일별 자산곡선에서 최대낙폭(MDD, %)을 계산한다.
export function computeMaxDrawdown(equityCurve = []) {
  let peak = 0;
  let mdd = 0;
  for (const point of equityCurve) {
    const equity = Number(point?.equityUsd ?? 0);
    if (!(equity > 0)) continue;
    peak = Math.max(peak, equity);
    if (peak > 0) mdd = Math.max(mdd, ((peak - equity) / peak) * 100);
  }
  return round(mdd, 2);
}

// 봇 거래 지표: 현재 모드에 맞춰 paper 세션 또는 live 체결만 집계한다.
// live에서는 왕복 사이클(closedCycles)을 우선 사용(FIFO 매칭이라 가장 정확).
export function computeBotTradeMetrics(state) {
  const scope = tradeMetricScope(state);
  const cycles = scope.cycles.filter((cycle) => Number.isFinite(Number(cycle.realizedPnlUsd)));
  const source = cycles.length
    ? cycles.map((cycle) => Number(cycle.realizedPnlUsd))
    : scope.sellTrades
        .map((trade) => Number(trade.realizedPnlUsd));
  const wins = source.filter((pnl) => pnl > 0);
  const losses = source.filter((pnl) => pnl < 0);
  const grossWin = wins.reduce((sum, pnl) => sum + pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, pnl) => sum + pnl, 0));
  return {
    basis: scope.basis,
    closedCount: source.length,
    cycleCount: cycles.length || scope.sellTrades.length,
    finalTradeCount: scope.finalTrades.length,
    winCount: wins.length,
    lossCount: losses.length,
    winRatePct: source.length ? round((wins.length / source.length) * 100, 1) : null,
    // 손익비(profit factor): 번 돈 합 ÷ 잃은 돈 합. 손실이 0이면 무한대 대신 null(표본 부족 신호).
    profitFactor: grossLoss > 0 ? round(grossWin / grossLoss, 2) : grossWin > 0 ? null : 0,
    grossWinUsd: round(grossWin, 2),
    grossLossUsd: round(grossLoss, 2),
    avgPnlUsd: source.length ? round((grossWin - grossLoss) / source.length, 2) : null
  };
}

function tradeMetricScope(state) {
  const activeSymbols = new Set(
    (state?.targets ?? [])
      .filter((target) => target.enabled !== false)
      .map((target) => String(target.symbol ?? "").toUpperCase())
      .filter(Boolean)
  );
  const inActiveUniverse = (item) => {
    if (!activeSymbols.size) return true;
    return activeSymbols.has(String(item?.symbol ?? "").toUpperCase());
  };
  const paperMode = Boolean(state?.settings?.dryRun || state?.settings?.liveTradingEnabled === false);
  const paperStartedAt = state?.paperSession?.startedAt ? new Date(state.paperSession.startedAt).getTime() : 0;
  const afterPaperStart = (trade) => {
    if (!paperStartedAt) return true;
    const at = new Date(trade?.requestedAt ?? 0).getTime();
    return Number.isFinite(at) && at >= paperStartedAt;
  };

  if (paperMode) {
    const finalTrades = (state?.tradeHistory ?? []).filter(
      (trade) => trade.dryRun && afterPaperStart(trade) && inActiveUniverse(trade)
    );
    return {
      basis: "paper",
      cycles: [],
      finalTrades,
      sellTrades: finalTrades.filter((trade) => trade.side === "SELL" && Number.isFinite(Number(trade.realizedPnlUsd)))
    };
  }

  const cycles = (state?.learning?.closedCycles ?? []).filter(inActiveUniverse);
  const finalTrades = (state?.tradeHistory ?? []).filter(
    (trade) => !trade.dryRun && trade.syncStatus === "FINAL" && inActiveUniverse(trade)
  );
  return {
    basis: "live",
    cycles,
    finalTrades,
    sellTrades: finalTrades.filter((trade) => trade.side === "SELL" && Number.isFinite(Number(trade.realizedPnlUsd)))
  };
}

// 증액 게이트: 다음 시드 트랜치를 넣어도 되는지 투명한 체크리스트로 판정한다(자동 변경 없음 — 사용자 판단 보조).
// 근거: 표본이 적을 때 +수익은 운(베타)일 수 있으므로, 표본 충분 + 벤치 초과를 함께 본다.
export function computeScalingGate({ metrics, botReturnPct, benchmark, maxDrawdownPct }) {
  const beatsBenchmark =
    benchmark?.available && Number.isFinite(Number(botReturnPct)) && Number.isFinite(Number(benchmark.returnPct))
      ? Number(botReturnPct) > Number(benchmark.returnPct)
      : null;
  const excessReturnPct =
    benchmark?.available && Number.isFinite(Number(botReturnPct)) && Number.isFinite(Number(benchmark.returnPct))
      ? round(Number(botReturnPct) - Number(benchmark.returnPct), 2)
      : null;
  const checks = [
    {
      key: "cycles",
      label: `왕복 사이클 ${metrics.cycleCount}/${GATE_MIN_CYCLES}`,
      pass: metrics.cycleCount >= GATE_MIN_CYCLES
    },
    {
      key: "fills",
      label: `체결 표본 ${metrics.finalTradeCount}/${GATE_MIN_FILLS}`,
      pass: metrics.finalTradeCount >= GATE_MIN_FILLS
    },
    {
      key: "benchmark",
      label:
        beatsBenchmark === null
          ? "벤치마크 비교 대기"
          : beatsBenchmark
            ? `벤치마크 초과 (+${excessReturnPct}%p)`
            : `벤치마크 미달 (${excessReturnPct}%p)`,
      pass: beatsBenchmark === true
    }
  ];
  const ready = checks.every((check) => check.pass);
  return {
    ready,
    beatsBenchmark,
    excessReturnPct,
    maxDrawdownPct: round(maxDrawdownPct, 2),
    checks,
    verdict: ready
      ? "표본·벤치마크 기준을 모두 통과했습니다. 다음 시드 트랜치 증액을 고려할 수 있습니다."
      : "아직 기준 미충족 — 데이터를 더 쌓는 동안 증액은 보류하거나 소액 트랜치로 제한하는 편이 안전합니다.",
    note:
      "이 게이트는 자동으로 아무것도 바꾸지 않습니다. 표본이 적을 때의 +수익은 시장(베타)일 수 있어 보수적으로 둡니다."
  };
}

// 전체 검증 블록을 만든다. candles/currentPrice는 호출자가 외부 데이터에서 주입한다.
export function buildValidation({ state, candles, currentPrice }) {
  const budget = state?.botBudget ?? {};
  const equityUsd = Number(budget.equityUsd ?? 0);
  const seedUsd = Math.max(0, Number(budget.startingSeedUsd ?? state?.settings?.allocationUsd ?? 0));
  const botReturnPct = seedUsd > 0 ? round(((equityUsd - seedUsd) / seedUsd) * 100, 2) : null;
  const flows = buildCapitalFlows(state);
  const benchmark = computeBenchmark({ flows, candles, currentPrice });
  const metrics = computeBotTradeMetrics(state);
  // MDD를 승률·손익비와 같은 기간으로 스코프한다. 페이퍼 세션 중에는 그 세션 시작 이후 자산곡선만 본다
  // (장부는 재시작 때 비워지지만 equityCurve는 최상위라 유지되므로, 옛 에폭의 낙폭이 섞이지 않게 필터).
  const fullCurve = state?.equityCurve ?? [];
  const epochStart =
    state?.paperSession?.active && state?.paperSession?.startedAt
      ? new Date(state.paperSession.startedAt).getTime()
      : 0;
  const equityCurve = epochStart
    ? fullCurve.filter((point) => new Date(point?.at ?? point?.day ?? 0).getTime() >= epochStart)
    : fullCurve;
  const maxDrawdownPct = computeMaxDrawdown(equityCurve);
  const gate = computeScalingGate({ metrics, botReturnPct, benchmark, maxDrawdownPct });
  return {
    generatedAt: new Date().toISOString(),
    seedUsd: round(seedUsd, 2),
    equityUsd: round(equityUsd, 2),
    botReturnPct,
    capitalFlows: flows,
    benchmark,
    metrics,
    maxDrawdownPct,
    equityCurvePoints: equityCurve.length,
    gate
  };
}

// 트레이더 틱에서 호출: 하루 1개씩 자산 스냅샷을 적립한다(같은 날은 최신값으로 덮어씀).
// 외부 데이터 호출 없이 이미 계산된 botBudget.equityUsd만 사용하므로 틱 비용이 늘지 않는다.
// state.equityCurve(최상위)에 둔다 — rebuildLiveBotPortfolio/updatePaperPosition이 state.performance를
// 통째로 교체하므로 거기에 두면 매 틱 history가 지워진다.
const MAX_EQUITY_POINTS = 400; // 하루 1개 기준 1년 이상.
export function recordEquitySnapshot(state, { now = new Date() } = {}) {
  const equityUsd = Number(state?.botBudget?.equityUsd ?? 0);
  if (!(equityUsd > 0)) return;
  const curve = Array.isArray(state.equityCurve) ? state.equityCurve : [];
  const day = localDayKey(now);
  const seedUsd = round(Number(state?.botBudget?.startingSeedUsd ?? 0), 2);
  const point = { day, at: now.toISOString(), equityUsd: round(equityUsd, 2), seedUsd };
  const last = curve[curve.length - 1];
  if (last && last.day === day) curve[curve.length - 1] = point;
  else curve.push(point);
  state.equityCurve = curve.slice(-MAX_EQUITY_POINTS);
}

function localDayKey(date) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(date);
}

function round(value, digits = 2) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const factor = 10 ** digits;
  return Math.round(number * factor) / factor;
}
