// 경제(증시) 캘린더 — TradingView 공개 경제캘린더(무키)에서 미국 지표 일정을 가져와
// 발표값(actual)을 예상치(forecast)와 비교해 호재/악재를 자동 판단한다. 외부 의존성 없음(fetch만).
// 자동 갱신은 server.js의 타이머가 담당(손 안 대도 최신 유지).

const TV_URL = "https://economic-calendar.tradingview.com/events";

// 지표 방향: "실제값이 예상보다 높을 때" 증시에 좋은가/나쁜가.
// 성장·고용 지표는 높을수록 호재, 인플레·실업 지표는 높을수록 악재(연준 매파 우려).
const HIGHER_IS_GOOD = /gdp|pmi|ism|retail|confidence|durable|industrial|manufactur|production|\bsales\b|payroll|adp|nonfarm|jolts|\bjob\b|housing starts|building permits/i;
const HIGHER_IS_BAD = /inflation|\bcpi\b|\bpce\b|\bppi\b|price index|unemployment|jobless|initial claims|continuing claims/i;
// 반도체/이 포트폴리오에 특히 중요한 고영향 매크로(매매 차단 창에 사용).
const HIGH_IMPACT = /\bcpi\b|inflation rate|\bpce\b|\bppi\b|interest rate decision|fed interest rate|non.?farm|nonfarm|unemployment rate|\bgdp\b|ism manufacturing|ism services|retail sales|fomc/i;

export async function fetchEconomicCalendar({ daysBack = 3, daysAhead = 14 } = {}) {
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
    // 저중요도(-1)는 너무 많아 제외, 중·고중요도만(0/1).
    .filter((event) => Number(event.importance) >= 0)
    .map(normalizeEvent)
    .sort((left, right) => new Date(left.date) - new Date(right.date))
    .slice(0, 60);
}

// 매매 영향(거시 지표는 전 종목 공통): 고영향 지표 발표 임박엔 신규매수 차단,
// 최근 발표된 강한 악재면 매수 예산 축소, 24시간 내 예정이면 일부 축소.
export function getCalendarRisk(calendar = [], now = new Date()) {
  const t = now.getTime();
  const high = (Array.isArray(calendar) ? calendar : []).filter((event) => event.highImpact);
  const imminent = high.find((event) => {
    const d = new Date(event.date).getTime();
    return Number.isFinite(d) && !event.released && d > t && d - t <= 4 * 3_600_000;
  });
  if (imminent) {
    return { blocked: true, budgetMultiplier: 0, label: "지표 발표 임박", reason: `${imminent.title} 발표 임박(4시간 내) — 신규매수 차단`, event: summarize(imminent) };
  }
  const recentBad = high.find((event) => {
    const d = new Date(event.date).getTime();
    return event.released && event.bias === "악재" && Number.isFinite(d) && t - d >= 0 && t - d <= 8 * 3_600_000;
  });
  if (recentBad) {
    return { blocked: false, budgetMultiplier: 0.5, label: "지표 악재", reason: `${recentBad.title} · ${recentBad.biasReason}`, event: summarize(recentBad) };
  }
  const upcoming = high.find((event) => {
    const d = new Date(event.date).getTime();
    return !event.released && Number.isFinite(d) && d > t && d - t <= 24 * 3_600_000;
  });
  if (upcoming) {
    return { blocked: false, budgetMultiplier: 0.7, label: "지표 발표 예정", reason: `${upcoming.title} 24시간 내 발표 예정`, event: summarize(upcoming) };
  }
  return { blocked: false, budgetMultiplier: 1, label: "지표 영향 낮음", reason: null, event: null };
}

function summarize(event) {
  return { title: event.title, date: event.date, bias: event.bias, importance: event.importance };
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
    bias: judged.bias, // "호재" | "악재" | "중립" | "예정"
    biasReason: judged.reason
  };
}

// 발표 전: "예정"(중요도에 따라 매수 주의). 발표 후: 실제 vs 예상 + 지표 방향으로 호재/악재.
function judgeBias({ title, indicator, actual, forecast, previous, actualText, forecastText, previousText }) {
  const text = `${title ?? ""} ${indicator ?? ""}`;
  if (actual === null) {
    return { bias: "예정", reason: forecastText ? `예상치 ${forecastText}` : "발표 예정" };
  }
  // 금리 결정: 인하=호재, 인상=악재.
  if (/interest rate decision|fed interest rate/i.test(text) && previous !== null) {
    if (actual < previous) return { bias: "호재", reason: `금리 인하 ${previousText}→${actualText}` };
    if (actual > previous) return { bias: "악재", reason: `금리 인상 ${previousText}→${actualText}` };
    return { bias: "중립", reason: `금리 동결 ${actualText}` };
  }
  if (forecast === null) {
    return { bias: "중립", reason: `발표값 ${actualText}${previousText ? ` (이전 ${previousText})` : ""}` };
  }
  const beat = actual - forecast; // 양수면 예상 상회
  if (Math.abs(beat) < 1e-9) return { bias: "중립", reason: `예상 부합 ${actualText}` };
  const higherGood = HIGHER_IS_GOOD.test(text);
  const higherBad = HIGHER_IS_BAD.test(text);
  if (!higherGood && !higherBad) {
    return { bias: "중립", reason: `발표 ${actualText} vs 예상 ${forecastText}` };
  }
  const good = higherBad ? beat < 0 : beat > 0; // 인플레/실업은 낮을수록 호재
  const label = beat > 0 ? "예상 상회" : "예상 하회";
  return {
    bias: good ? "호재" : "악재",
    reason: `${label} (발표 ${actualText} vs 예상 ${forecastText})`
  };
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function textOrNull(value) {
  return value === null || value === undefined || value === "" ? null : String(value);
}
