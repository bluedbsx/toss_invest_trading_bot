// 경제(증시) 캘린더 — TradingView 공개 경제캘린더(무키)에서 미국 지표 일정을 가져와
// 발표값(actual)을 예상치(forecast)와 비교해 호재/악재를 자동 판단한다. 외부 의존성 없음(fetch만).
// 자동 갱신은 server.js의 타이머가 담당(손 안 대도 최신 유지).
//
// 정교화(§FF): 서프라이즈 크기 + 지표별 가중치(레버리지·금리 민감 포트폴리오 기준) + 중요도로
// biasScore를 수치화하고, 강한/보통/약한 강도를 매긴다. 고용 지표는 "성장 호조이나 금리인하 지연"
// 양면성을 반영해 가중을 낮추고 주석을 단다. 매수 축소도 biasScore 강도에 비례한다.

const TV_URL = "https://economic-calendar.tradingview.com/events";

// 지표 카테고리: 정규식 매칭 + 방향(높을수록 호재인가) + 포트폴리오 가중치.
// 이 봇은 레버리지 반도체(금리 민감)라 인플레·금리 경로의 가중을 크게, 고용은 양면성으로 작게 둔다.
const CATEGORIES = [
  { name: "rate", re: /interest rate decision|fed interest rate|fed funds/i, special: "rate", weight: 1.6 },
  { name: "inflation", re: /inflation|\bcpi\b|\bpce\b|\bppi\b|price index/i, higherIsGood: false, weight: 1.4 },
  // 노동지표(실업·고용)는 이 레버리지·금리민감 포트폴리오엔 양면적: 강하면 성장 호재이나 금리인하 지연(매파),
  // 약하면 둔화 우려이나 인하 기대(비둘기). 한 방향으로 호재/악재라 단정하지 않고 "혼조"(정보용)로 둔다.
  { name: "unemployment", re: /unemployment rate|jobless|initial claims|continuing claims/i, higherIsGood: false, weight: 0.8, twoSided: true },
  { name: "jobs", re: /payroll|non.?farm|nonfarm|\badp\b|jolts|job offers|job openings|employment change/i, higherIsGood: true, weight: 0.6, twoSided: true },
  { name: "growth", re: /\bgdp\b|\bpmi\b|\bism\b|retail|consumer confidence|durable|industrial|manufactur|production|\bsales\b|housing starts|building permits|business confidence/i, higherIsGood: true, weight: 1.0 }
];
const HIGH_IMPACT = /\bcpi\b|inflation rate|\bpce\b|\bppi\b|interest rate decision|fed interest rate|non.?farm|nonfarm|unemployment rate|\bgdp\b|ism manufacturing|ism services|retail sales|fomc/i;

export async function fetchEconomicCalendar({ daysBack = 4, daysAhead = 14 } = {}) {
  const from = new Date(Date.now() - daysBack * 86_400_000).toISOString();
  const to = new Date(Date.now() + daysAhead * 86_400_000).toISOString();
  const url = `${TV_URL}?from=${from}&to=${to}&countries=US`;
  const response = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json", Origin: "https://www.tradingview.com" },
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`경제 캘린더 조회 실패: ${response.status}`);
  const data = await response.json();
  const events = data.result || data.data || (Array.isArray(data) ? data : []);
  return events
    .filter((event) => Number(event.importance) >= 0) // 저중요도(-1)는 너무 많아 제외
    .map(normalizeEvent)
    .sort((left, right) => new Date(left.date) - new Date(right.date))
    .slice(0, 60);
}

// 매매 영향(거시 지표는 전 종목 공통): 고영향 지표 임박엔 신규매수 차단,
// 최근 발표된 악재면 biasScore 강도에 비례해 매수 예산 축소, 24시간 내 예정이면 일부 축소.
export function getCalendarRisk(calendar = [], now = new Date()) {
  const t = now.getTime();
  const high = (Array.isArray(calendar) ? calendar : []).filter((event) => event.highImpact);
  // 최근 5일 거시 기조(개별 이벤트가 지나도 지속되는 배경) → 강한 악재면 예산 축소 바닥값.
  // 호재 기조여도 예산을 1 위로 키우지 않는다(거시 낙관으로 사이즈를 부풀리지 않음 — 축소 전용).
  const tone = summarizeMacroTone(calendar, now);
  const toneMultiplier = tone.score <= -5 ? 0.6 : tone.score <= -3 ? 0.8 : 1;

  const imminent = high.find((event) => {
    const d = new Date(event.date).getTime();
    return Number.isFinite(d) && !event.released && d > t && d - t <= 4 * 3_600_000;
  });
  if (imminent) {
    return { blocked: true, budgetMultiplier: 0, label: "지표 발표 임박", reason: `${imminent.title} 발표 임박(4시간 내) — 신규매수 차단`, event: summarize(imminent), macroTone: tone };
  }
  // 최근 8시간 내 발표된 악재 중 가장 강한 것으로 축소 강도 결정.
  const recentBad = high
    .filter((event) => {
      const d = new Date(event.date).getTime();
      return event.released && event.bias === "악재" && Number.isFinite(d) && t - d >= 0 && t - d <= 8 * 3_600_000;
    })
    .sort((a, b) => a.biasScore - b.biasScore)[0];
  if (recentBad) {
    const eventMult = recentBad.biasScore <= -1.8 ? 0.4 : recentBad.biasScore <= -0.9 ? 0.6 : 0.75;
    const multiplier = Math.min(eventMult, toneMultiplier); // 단일 악재와 거시 기조 중 더 강한 축소
    const toneNote = toneMultiplier < 1 ? ` · 거시 ${tone.tone}` : "";
    return { blocked: false, budgetMultiplier: multiplier, label: `지표 ${recentBad.biasStrength} 악재`, reason: `${recentBad.title} · ${recentBad.biasReason}${toneNote}`, event: summarize(recentBad), macroTone: tone };
  }
  const upcoming = high.find((event) => {
    const d = new Date(event.date).getTime();
    return !event.released && Number.isFinite(d) && d > t && d - t <= 24 * 3_600_000;
  });
  const upcomingMult = upcoming ? 0.7 : 1;
  const multiplier = Math.min(upcomingMult, toneMultiplier);
  if (multiplier < 1) {
    // 임박 단일 악재가 없어도, 24h 내 예정 또는 5일 거시 기조가 강한 악재면 예산 축소.
    const parts = [];
    if (upcoming) parts.push(`${upcoming.title} 24시간 내 발표 예정`);
    if (toneMultiplier < 1) parts.push(`최근 5일 거시 ${tone.tone}(${tone.label})`);
    const label = toneMultiplier < upcomingMult ? "거시 악재 기조" : "지표 발표 예정";
    return { blocked: false, budgetMultiplier: multiplier, label, reason: parts.join(" · "), event: upcoming ? summarize(upcoming) : null, macroTone: tone };
  }
  return { blocked: false, budgetMultiplier: 1, label: "지표 영향 낮음", reason: null, event: null, macroTone: tone };
}

// 최근 발표(기본 5일) 지표들의 biasScore를 합산해 거시 기조를 요약한다.
export function summarizeMacroTone(calendar = [], now = new Date(), days = 5) {
  const t = now.getTime();
  const recent = (Array.isArray(calendar) ? calendar : []).filter((event) => {
    const d = new Date(event.date).getTime();
    return event.released && Number.isFinite(d) && t - d >= 0 && t - d <= days * 86_400_000 && Number.isFinite(event.biasScore);
  });
  if (!recent.length) return { tone: "중립", score: 0, label: "최근 발표 없음", count: 0 };
  const score = recent.reduce((sum, event) => sum + event.biasScore, 0);
  const tone = score >= 2 ? "호재 우위" : score <= -2 ? "악재 우위" : "중립";
  const top = [...recent].sort((a, b) => Math.abs(b.biasScore) - Math.abs(a.biasScore)).slice(0, 3);
  return {
    tone,
    score: round1(score),
    count: recent.length,
    label: `최근 ${days}일 ${recent.length}건 합산 ${round1(score) > 0 ? "+" : ""}${round1(score)}`,
    drivers: top.map((event) => `${event.bias === "호재" ? "+" : event.bias === "악재" ? "−" : "·"}${event.title}`)
  };
}

function normalizeEvent(event) {
  // 미발표 이벤트도 actualRaw가 0으로 오는 경우가 있어, "발표 여부"는 표시용 actual로 판단한다.
  const released = event.actual !== null && event.actual !== undefined && event.actual !== "";
  const actual = released ? numberOrNull(event.actualRaw ?? event.actual) : null;
  const forecast = numberOrNull(event.forecastRaw ?? event.forecast);
  const previous = numberOrNull(event.previousRaw ?? event.previous);
  const judged = judgeBias({
    title: event.title,
    indicator: event.indicator,
    importance: Number(event.importance ?? 0),
    actual,
    forecast,
    previous,
    actualText: textOrNull(event.actual),
    forecastText: textOrNull(event.forecast),
    previousText: textOrNull(event.previous)
  });
  return {
    id: String(event.id ?? `${event.title}-${event.date}`),
    title: event.title ?? event.indicator ?? "지표",
    indicator: event.indicator ?? null,
    period: event.period ?? null,
    date: event.date,
    importance: Number(event.importance ?? -1),
    highImpact: HIGH_IMPACT.test(`${event.title ?? ""} ${event.indicator ?? ""}`),
    actual: event.actual ?? null,
    forecast: event.forecast ?? null,
    previous: event.previous ?? null,
    unit: event.unit ?? "",
    released,
    category: judged.category,
    bias: judged.bias, // "호재" | "악재" | "중립" | "예정"
    biasStrength: judged.strength, // "강한" | "보통" | "약한" | null
    biasScore: judged.score, // 부호 있는 수치(호재 +, 악재 −)
    biasLabel: judged.label, // 예: "강한 호재"
    biasReason: judged.reason
  };
}

function categoryOf(text) {
  return CATEGORIES.find((category) => category.re.test(text)) ?? null;
}

// 발표 전: "예정". 발표 후: 서프라이즈 크기 × 지표 가중치 × 중요도로 biasScore 산출 → 강도/방향 판단.
// (검증용으로 export — 다른 모듈은 사용하지 않음)
export function judgeBias({ title, indicator, importance, actual, forecast, previous, actualText, forecastText, previousText }) {
  const text = `${title ?? ""} ${indicator ?? ""}`;
  const category = categoryOf(text);
  if (actual === null) {
    return { bias: "예정", strength: null, score: 0, label: "예정", category: category?.name ?? null, reason: forecastText ? `예상치 ${forecastText}` : "발표 예정" };
  }
  const impWeight = importance >= 1 ? 1.3 : 1.0;

  // 금리 결정: 인하=호재, 인상=악재(가장 강한 영향).
  if (category?.special === "rate" && previous !== null) {
    if (actual === previous) return { bias: "중립", strength: null, score: 0, label: "중립", category: "rate", reason: `금리 동결 ${actualText}` };
    const cut = actual < previous;
    const score = (cut ? 1 : -1) * 2 * category.weight * impWeight;
    return mk(cut ? "호재" : "악재", score, "rate", `금리 ${cut ? "인하" : "인상"} ${previousText}→${actualText}`);
  }
  if (forecast === null || !category) {
    return { bias: "중립", strength: null, score: 0, label: "중립", category: category?.name ?? null, reason: `발표값 ${actualText}${previousText ? ` (이전 ${previousText})` : ""}` };
  }

  const surprise = actual - forecast;
  if (Math.abs(surprise) < 1e-9) {
    return { bias: "중립", strength: null, score: 0, label: "중립", category: category.name, reason: `예상 부합 ${actualText}` };
  }
  // 서프라이즈 상대크기(예상치 또는 이전값 대비) → 강도.
  const denom = Math.max(Math.abs(forecast), Math.abs(previous ?? 0), 1e-6);
  const rel = Math.abs(surprise) / denom;
  const magWeight = rel < 0.05 ? 0.6 : rel <= 0.2 ? 1.2 : 2.0;
  const directionGood = category.higherIsGood ? surprise > 0 : surprise < 0;
  const beatLabel = surprise > 0 ? "예상 상회" : "예상 하회";

  // 노동지표 양면성: 한 방향으로 호재/악재라 단정하지 않고 "혼조"로 표기(정보용). 점수는 부호만 유지하고
  // 크게 약화(매수예산 축소엔 '악재'만 반영되므로 혼조는 라이브 매매를 흔들지 않음 — 디스플레이/톤 합산용).
  if (category.twoSided) {
    const note = directionGood
      ? "성장 호조이나 금리인하 지연 가능(매파)"
      : "성장 둔화 우려이나 금리인하 기대(비둘기)";
    const score = round1((directionGood ? 1 : -1) * Math.min(magWeight, 1.2) * category.weight * impWeight * 0.3);
    return { bias: "혼조", strength: null, score, label: "혼조", category: category.name, reason: `${beatLabel} (발표 ${actualText} vs 예상 ${forecastText}) — ${note}` };
  }

  const score = round1((directionGood ? 1 : -1) * magWeight * category.weight * impWeight);
  const bias = score > 0.5 ? "호재" : score < -0.5 ? "악재" : "중립";
  return mk(bias, score, category.name, `${beatLabel} (발표 ${actualText} vs 예상 ${forecastText})`);
}

function mk(bias, score, category, reason) {
  const abs = Math.abs(score);
  const strength = bias === "중립" ? null : abs >= 1.8 ? "강한" : abs >= 0.9 ? "보통" : "약한";
  const label = bias === "중립" ? "중립" : strength === "보통" ? bias : `${strength} ${bias}`;
  return { bias, strength, score: round1(score), label, category, reason };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}

function summarize(event) {
  return { title: event.title, date: event.date, bias: event.bias, biasScore: event.biasScore, importance: event.importance };
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}
