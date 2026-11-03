#!/usr/bin/env node
// 레짐 로테이션 후보 분석 — docs/regime-rotation-candidates.md 의 수치를 재현 가능하게 만드는 정식 스크립트.
// 종목 list/구간/비중안은 analysis/universe.json 한 곳에서 관리하고, 매매 시뮬레이션은 라이브 봇과 같은
// src/strategy.js 의 simulateBacktestTrace(=runBacktestSimulation)를 그대로 쓴다(로직 복제 없음).
//
// 사용법:
//   node scripts/regime-rotation-analysis.mjs [--universe analysis/universe.json] [--out analysis/reports] [--refresh]
// 산출물: <out>/regime-rotation-YYYY-MM-DD.md (분석 문서), 같은 이름의 .json (원자료)
// 가격은 analysis/.cache/ 에 캐시한다(gitignore). --refresh 로 다시 받는다.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getExternalDailyCandles } from "../src/marketData.js";
import { simulateBacktestTrace } from "../src/strategy.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WARMUP_DAYS = 210; // slowSma 최대 200일 + 여유. 구간 시작 전 데이터로만 지표를 데운다.

const args = parseArgs(process.argv.slice(2));
const universePath = path.resolve(ROOT, args.universe ?? "analysis/universe.json");
const outDir = path.resolve(ROOT, args.out ?? "analysis/reports");
const cacheDir = path.join(ROOT, "analysis", ".cache");

const universe = JSON.parse(await fs.readFile(universePath, "utf8"));
const today = new Date().toISOString().slice(0, 10);
const symbols = universe.symbols.map((item) => item.symbol);

process.stdout.write(`가격 수집: ${symbols.join(", ")}\n`);
const candlesBySymbol = {};
const failures = [];
for (const symbol of symbols) {
  try {
    candlesBySymbol[symbol] = await loadCandles(symbol, Boolean(args.refresh));
  } catch (error) {
    failures.push({ symbol, error: error.message });
  }
}

const results = { generatedAt: new Date().toISOString(), universe: path.relative(ROOT, universePath), failures, windows: {} };

for (const window of universe.windows) {
  const rows = {};
  for (const entry of universe.symbols) {
    const candles = candlesBySymbol[entry.symbol];
    if (!candles) continue;
    rows[entry.symbol] = analyzeSymbol(entry, candles, window);
  }
  results.windows[window.id] = { ...window, rows };
}

results.correlation = buildCorrelation(results.windows[universe.correlationWindowId], universe.benchmarks.sector);
results.redistribution = buildRedistribution(universe);
results.portfolios = buildPortfolios(universe);
results.verdicts = buildVerdicts(universe, results);

await fs.mkdir(outDir, { recursive: true });
const base = path.join(outDir, `regime-rotation-${today}`);
await fs.writeFile(`${base}.json`, JSON.stringify(stripTraces(results), null, 2));
await fs.writeFile(`${base}.md`, renderReport(universe, results));
process.stdout.write(`완료: ${path.relative(ROOT, base)}.md / .json${failures.length ? ` (실패 ${failures.length}건)` : ""}\n`);

// ---------- 분석 ----------

function analyzeSymbol(entry, candles, window) {
  const inWindowEnd = candles.filter((item) => item.timestamp.slice(0, 10) <= window.end);
  const startIndex = inWindowEnd.findIndex((item) => item.timestamp.slice(0, 10) >= window.start);
  if (startIndex < 0) return { available: false, reason: "구간 데이터 없음" };
  if (startIndex < WARMUP_DAYS) return { available: false, reason: `워밍업 부족(${startIndex}일)` };

  const target = { symbol: entry.symbol, ...universe.defaults.candidateParams, ...(entry.params ?? {}) };
  const sim = simulateBacktestTrace({ target, candles: inWindowEnd, settings: universe.defaults.settings, startIndex });
  const startClose = inWindowEnd[startIndex].close;
  const endClose = inWindowEnd.at(-1).close;
  const trace = sim.trace;
  return {
    available: true,
    days: trace.length,
    buyHoldPct: round(((endClose - startClose) / startClose) * 100, 1),
    strategyPct: sim.totalReturnPct,
    strategyMddPct: sim.maxDrawdownPct,
    exposurePct: round((trace.filter((item) => item.held).length / trace.length) * 100, 1),
    trades: sim.trades,
    winRatePct: sim.winRatePct,
    trace
  };
}

function buildCorrelation(window, sectorSymbol) {
  const base = dailyReturns(window.rows[sectorSymbol]?.trace);
  const out = {};
  for (const [symbol, row] of Object.entries(window.rows)) {
    if (!row.available || !base) continue;
    out[symbol] = round(pearson(base, dailyReturns(row.trace)), 2);
  }
  return { windowId: window.id, against: sectorSymbol, values: out };
}

// 재분배 효과: 봇은 redistributeUnusedAllocation=true라 BUY 신호가 뜬 종목끼리 예산을 다시 나눈다.
// 날짜별로 (반도체 전부 OFF?) (대체 후보 신호 있음?) (대체 후보 유효비중 ≥ 50%?)를 센다.
function buildRedistribution(config) {
  const portfolio = config.portfolios.find((item) => item.id === config.redistributionPortfolioId);
  if (!portfolio) return null;
  const groupOf = Object.fromEntries(config.symbols.map((item) => [item.symbol, item.group]));
  const out = {};
  for (const window of Object.values(results.windows)) {
    const signals = signalMap(window, Object.keys(portfolio.weights));
    let semiOff = 0, semiOffAlt = 0, altHalf = 0, total = 0;
    for (const day of signals.dates) {
      total += 1;
      let semiW = 0, altW = 0;
      for (const [symbol, weight] of Object.entries(portfolio.weights)) {
        if (!signals.bySymbol[symbol]?.get(day)) continue;
        if (groupOf[symbol] === "semi") semiW += weight;
        else altW += weight;
      }
      if (semiW === 0) semiOff += 1;
      if (semiW === 0 && altW > 0) semiOffAlt += 1;
      if (altW > 0 && altW / (semiW + altW) >= 0.5) altHalf += 1;
    }
    out[window.id] = {
      days: total,
      semiOffPct: pct(semiOff, total),
      semiOffWithAltPct: pct(semiOffAlt, total),
      altHalfWeightPct: pct(altHalf, total)
    };
  }
  return { portfolioId: portfolio.id, weights: portfolio.weights, windows: out };
}

// 정적 비중 슬리브 포트폴리오: 종목마다 비중만큼 자본을 떼어 각자 봇 전략을 독립 운용(재분배 미반영 근사).
function buildPortfolios(config) {
  const market = config.benchmarks.market;
  const out = {};
  for (const window of Object.values(results.windows)) {
    const marketRow = window.rows[market];
    const marketPct = marketRow?.available ? marketRow.buyHoldPct : null;
    out[window.id] = config.portfolios.map((portfolio) => {
      const entries = Object.entries(portfolio.weights);
      const totalWeight = entries.reduce((sum, [, weight]) => sum + weight, 0);
      const missing = entries.filter(([symbol]) => !window.rows[symbol]?.available).map(([symbol]) => symbol);
      if (missing.length) return { id: portfolio.id, label: portfolio.label, available: false, reason: `데이터 없음: ${missing.join(",")}` };
      const curves = entries.map(([symbol, weight]) => ({ weight: weight / totalWeight, map: new Map(window.rows[symbol].trace.map((item) => [day(item), item.equity / 1000])) }));
      const dates = [...new Set(curves.flatMap((curve) => [...curve.map.keys()]))].sort();
      const last = curves.map(() => 1);
      const equity = dates.map((date) =>
        curves.reduce((sum, curve, index) => {
          if (curve.map.has(date)) last[index] = curve.map.get(date);
          return sum + curve.weight * last[index];
        }, 0)
      );
      const finalReturn = entries.reduce((sum, [symbol, weight]) => sum + (weight / totalWeight) * window.rows[symbol].strategyPct, 0);
      return {
        id: portfolio.id,
        label: portfolio.label,
        available: true,
        strategyPct: round(finalReturn, 1),
        mddPct: round(maxDrawdown(equity) * 100, 1),
        vsMarketPctPt: marketPct === null ? null : round(finalReturn - marketPct, 1)
      };
    });
    out[window.id].marketBuyHoldPct = marketPct;
  }
  return out;
}

// 자동 판정 규칙(문서에 그대로 표기). 사람이 최종 판단한다 — 근거 정리용 1차 분류.
function buildVerdicts(config, res) {
  const bear = res.windows[config.bearWindowId]?.rows ?? {};
  const long = res.windows[config.correlationWindowId]?.rows ?? {};
  const corr = res.correlation.values;
  return Object.fromEntries(
    config.symbols.map((entry) => {
      const s = entry.symbol;
      if (entry.role === "core") return [s, "운용 중(코어)"];
      if (entry.role === "benchmark") return [s, "비교 기준"];
      if (entry.group === "inverse") return [s, "고위험 paper 전용"];
      const c = corr[s];
      const bearOk = bear[s]?.available && bear[s].strategyPct > 0;
      const longOk = long[s]?.available && long[s].strategyPct > 0;
      if (Number.isFinite(c) && c >= 0.9) return [s, "중복 노출(분산효과 없음)"];
      if (bearOk && longOk && c < 0.5) return [s, "실매매 후보"];
      if (bearOk || (longOk && c < 0.5)) return [s, "paper 관찰"];
      return [s, "보류"];
    })
  );
}

// ---------- 문서 렌더링 ----------

function renderReport(config, res) {
  const L = [];
  const candidates = config.symbols.filter((item) => item.role === "candidate");
  const byVerdict = (label) => candidates.filter((item) => res.verdicts[item.symbol] === label).map((item) => `\`${item.symbol}\``);
  L.push(`# 레짐 로테이션 후보 분석 (${today})`, "");
  L.push(`작성: \`scripts/regime-rotation-analysis.mjs\` 자동 생성  `);
  L.push(`입력 종목 list: \`${res.universe}\` (갱신 ${config.updated})  `);
  L.push("목적: 반도체 추세 이탈 시 봇 예산을 받을 대체 후보를 같은 봇 로직으로 비교한다. 투자 조언이 아니다.", "");
  if (res.failures.length) L.push(`> 가격 수집 실패: ${res.failures.map((item) => `${item.symbol}(${item.error})`).join(", ")}`, "");

  L.push("## 요약 결론", "");
  L.push(`- 실매매 후보: ${byVerdict("실매매 후보").join(", ") || "없음"}`);
  L.push(`- paper 관찰 후보: ${byVerdict("paper 관찰").join(", ") || "없음"}`);
  L.push(`- 보류: ${byVerdict("보류").join(", ") || "없음"}`);
  L.push(`- 중복 노출: ${byVerdict("중복 노출(분산효과 없음)").join(", ") || "없음"}`);
  L.push(`- 고위험 paper 전용: ${byVerdict("고위험 paper 전용").join(", ") || "없음"}`, "");
  L.push("판정 규칙(자동 1차 분류, 최종 판단은 사람/에이전트 토론):", "");
  L.push(`- 실매매 후보: ${label(config.bearWindowId)} 봇 전략 수익 > 0 **그리고** ${label(config.correlationWindowId)} 봇 전략 수익 > 0 **그리고** ${config.benchmarks.sector} 상관 < 0.5`);
  L.push("- paper 관찰: 베어 구간 수익 > 0 이거나, 장기 수익 > 0 이면서 상관 < 0.5");
  L.push(`- 중복 노출: ${config.benchmarks.sector} 상관 ≥ 0.9 / 고위험 paper 전용: 인버스 그룹`, "");

  L.push("## 현재 봇 메커니즘", "");
  L.push("- 시뮬레이션: `src/strategy.js` `simulateBacktestTrace` → 라이브 `backtestTarget`과 같은 `runBacktestSimulation`(guarded 변형: 당일 급락 매수차단·방어매도, 왕복 비용 0.2%).");
  L.push("- 매수: 현재가 > fast SMA > slow SMA, 모멘텀 > 0, RSI 허용 범위, ATR 변동성 조건, 당일 급락 차단 아님.");
  L.push("- 청산: 손절 / 익절 / 트레일링 / fast SMA 이탈 / RSI 과열 / 당일 급락 방어매도, 부분익절.");
  L.push("- `redistributeUnusedAllocation: true`(`src/store.js`) → BUY 신호 종목끼리 예산 재분배.", "");

  L.push("## 검증 방법", "");
  L.push("- 데이터: `src/marketData.js` Yahoo Finance 수정 일봉(range 20y).");
  L.push(`- 구간: ${config.windows.map((w) => `${w.label} (${w.start} ~ ${w.end})`).join(", ")}`);
  L.push(`- 워밍업: 구간 시작 전 ${WARMUP_DAYS}거래일 이상을 지표 계산에만 사용(수익·MDD는 구간 안에서만 측정). 부족하면 제외.`);
  L.push("- 파라미터: core는 `src/store.js` 기본값, 후보는 신규 종목 기본값(`server.js` POST /api/targets) — `analysis/universe.json`의 `params`로 덮어쓸 수 있음.");
  L.push("- 한계: 일봉 종가 체결, 갭·장중·세금·환율·부분체결 미반영. 포트폴리오 표는 정적 비중 슬리브 근사(재분배 미반영).", "");

  for (const window of config.windows) {
    const rows = res.windows[window.id].rows;
    L.push(`## ${window.label} 결과 (${window.start} ~ ${window.end})`, "");
    L.push("| 종목 | 역할 | 단순 보유 | 봇 전략 수익 | 봇 MDD | 롱 노출일 | 거래 | 판정 |", "|---|---|---:|---:|---:|---:|---:|---|");
    for (const entry of config.symbols) {
      const r = rows[entry.symbol];
      if (!r) continue;
      if (!r.available) {
        L.push(`| ${entry.symbol} | ${entry.role} | - | - | - | - | - | ${r.reason} |`);
        continue;
      }
      L.push(`| ${entry.symbol} | ${entry.role} | ${signed(r.buyHoldPct)}% | ${signed(r.strategyPct)}% | ${r.strategyMddPct}% | ${r.exposurePct}% | ${r.trades} | ${res.verdicts[entry.symbol]} |`);
    }
    L.push("");
  }

  if (res.redistribution) {
    const weights = Object.entries(res.redistribution.weights).map(([s, w]) => `${s} ${w}`).join(" / ");
    L.push("## 재분배 효과 검증", "", `비중안 \`${weights}\` 기준 (거래일 비율):`, "");
    L.push("| 구간 | 반도체 신호 OFF | 반도체 OFF + 대체 후보 신호 | 대체 후보 유효비중 ≥ 50% |", "|---|---:|---:|---:|");
    for (const window of config.windows) {
      const r = res.redistribution.windows[window.id];
      L.push(`| ${window.label} | ${r.semiOffPct}% | ${r.semiOffWithAltPct}% | ${r.altHalfWeightPct}% |`);
    }
    L.push("");
  }

  L.push(`## ${config.benchmarks.sector}와의 상관`, "", `${label(res.correlation.windowId)} 일간수익률 기준:`, "");
  L.push(`| 종목 | ${config.benchmarks.sector}와 상관 | 그룹 |`, "|---|---:|---|");
  for (const entry of config.symbols) {
    const value = res.correlation.values[entry.symbol];
    if (value === undefined || entry.symbol === config.benchmarks.sector) continue;
    L.push(`| ${entry.symbol} | ${value.toFixed(2)} | ${entry.group} |`);
  }
  L.push("");

  L.push(`## 포트폴리오별 ${config.benchmarks.market} 비교`, "");
  L.push(`정적 비중 슬리브 근사. ${config.benchmarks.market} 열은 같은 구간 단순 보유 대비 초과수익(%p).`, "");
  L.push(`| 구간 | 포트폴리오 | 봇 전략 수익 | MDD | vs ${config.benchmarks.market} |`, "|---|---|---:|---:|---:|");
  for (const window of config.windows) {
    for (const p of res.portfolios[window.id]) {
      if (!p.available) L.push(`| ${window.label} | ${p.label} | - | - | ${p.reason} |`);
      else L.push(`| ${window.label} | ${p.label} | ${signed(p.strategyPct)}% | ${p.mddPct}% | ${p.vsMarketPctPt === null ? "-" : `${signed(p.vsMarketPctPt)}%p`} |`);
    }
    L.push(`| ${window.label} | ${config.benchmarks.market} 단순 보유 | ${res.portfolios[window.id].marketBuyHoldPct === null ? "-" : `${signed(res.portfolios[window.id].marketBuyHoldPct)}%`} | - | 0 |`);
  }
  L.push("");

  L.push("## 후보별 판단", "");
  for (const entry of candidates) {
    const bear = res.windows[config.bearWindowId].rows[entry.symbol];
    const long = res.windows[config.correlationWindowId].rows[entry.symbol];
    L.push(`### ${entry.symbol}: ${res.verdicts[entry.symbol]}`, "");
    L.push(`- 논리: ${entry.thesis ?? "-"}`);
    if (bear?.available) L.push(`- ${label(config.bearWindowId)}: 단순 보유 ${signed(bear.buyHoldPct)}%, 봇 전략 ${signed(bear.strategyPct)}%, MDD ${bear.strategyMddPct}%`);
    if (long?.available) L.push(`- ${label(config.correlationWindowId)}: 단순 보유 ${signed(long.buyHoldPct)}%, 봇 전략 ${signed(long.strategyPct)}%, MDD ${long.strategyMddPct}%`);
    const c = res.correlation.values[entry.symbol];
    if (c !== undefined) L.push(`- ${config.benchmarks.sector} 상관: ${c.toFixed(2)}`);
    L.push("");
  }

  L.push("## 재현", "", "```bash", "node scripts/regime-rotation-analysis.mjs            # 캐시 사용", "node scripts/regime-rotation-analysis.mjs --refresh  # 가격 재수집", "```", "");
  L.push("종목 추가/삭제·구간·비중안 변경은 `analysis/universe.json`만 수정한다. 같은 캐시로 다시 돌리면 같은 수치가 나온다(Yahoo 수정주가는 배당/분할 반영으로 재수집 시 소폭 달라질 수 있음).", "");
  return L.join("\n");
}

// ---------- 유틸 ----------

async function loadCandles(symbol, refresh) {
  const file = path.join(cacheDir, `${symbol}.json`);
  if (!refresh) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch {}
  }
  const candles = await getExternalDailyCandles(symbol, { range: "20y" });
  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(file, JSON.stringify(candles));
  return candles;
}

function signalMap(window, symbolList) {
  const bySymbol = {};
  const dates = new Set();
  for (const symbol of symbolList) {
    const row = window.rows[symbol];
    if (!row?.available) continue;
    bySymbol[symbol] = new Map(row.trace.map((item) => [day(item), item.buySignal]));
    for (const item of row.trace) dates.add(day(item));
  }
  return { bySymbol, dates: [...dates].sort() };
}

function dailyReturns(trace) {
  if (!trace) return null;
  const map = new Map();
  for (let i = 1; i < trace.length; i += 1) map.set(day(trace[i]), trace[i].close / trace[i - 1].close - 1);
  return map;
}

function pearson(a, b) {
  const xs = [], ys = [];
  for (const [date, value] of a) if (b.has(date)) { xs.push(value); ys.push(b.get(date)); }
  const n = xs.length;
  if (n < 30) return NaN;
  const mx = xs.reduce((s, v) => s + v, 0) / n;
  const my = ys.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i += 1) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

function maxDrawdown(values) {
  let peak = -Infinity, worst = 0;
  for (const v of values) {
    peak = Math.max(peak, v);
    worst = Math.max(worst, (peak - v) / peak);
  }
  return worst;
}

function stripTraces(res) {
  const copy = structuredClone(res);
  for (const window of Object.values(copy.windows)) for (const row of Object.values(window.rows)) delete row.trace;
  return copy;
}

function label(windowId) {
  return universe.windows.find((w) => w.id === windowId)?.label ?? windowId;
}

function day(item) {
  return item.timestamp.slice(0, 10);
}
function pct(n, d) {
  return d ? round((n / d) * 100, 1) : 0;
}
function signed(v) {
  return v > 0 ? `+${v}` : `${v}`;
}
function round(value, digits) {
  const f = 10 ** digits;
  return Math.round(value * f) / f;
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, "");
    if (key === "refresh") out.refresh = true;
    else out[key] = argv[++i];
  }
  return out;
}
