import { relevanceMatcher } from "./tickers.js";

// 거시 이벤트(CPI·FOMC 등)는 calendar.js가 실제 경제 캘린더에서 동적으로 가져와 calendarRisk로 반영하므로
// 여기서는 다루지 않는다(중복·노후 방지). 종목별 실적 등 이벤트는 state.customEvents(사용자 추가)로 주입한다.
// 과거의 하드코딩 이벤트(고정 날짜·옛 티커)는 시간이 지나면 죽은 데이터라 제거했다.
const BUILTIN_EVENTS = [];

export function getEventRisk(symbol, now = new Date(), events = BUILTIN_EVENTS) {
  const normalizedSymbol = String(symbol ?? "").toUpperCase();
  const applicable = (Array.isArray(events) ? events : [])
    .filter((event) => eventAppliesToSymbol(event, normalizedSymbol))
    .map((event) => ({ ...event, distanceMs: new Date(event.startsAt).getTime() - now.getTime() }))
    .sort((a, b) => Math.abs(a.distanceMs) - Math.abs(b.distanceMs));
  const active = applicable.find((event) => isInWindow(event, now));
  const upcoming = applicable.find((event) => event.distanceMs > 0) ?? null;

  if (!active) {
    return {
      blocked: false,
      budgetMultiplier: 1,
      label: "이벤트 위험 낮음",
      activeEvent: null,
      upcomingEvent: summarizeEvent(upcoming),
      reason: null
    };
  }

  const hardBlocked = isInHardBlockWindow(active, now);
  if (!hardBlocked) {
    const multiplier = active.severity === "high" ? 0.35 : 0.55;
    return {
      blocked: false,
      budgetMultiplier: multiplier,
      label: "이벤트 주의 구간",
      activeEvent: summarizeEvent(active),
      upcomingEvent: summarizeEvent(upcoming),
      reason: `${active.title} 전후 주의 구간: 신규매수 예산 ${Math.round(multiplier * 100)}%로 축소`
    };
  }

  return {
    blocked: true,
    budgetMultiplier: 0,
    label: "이벤트 직전/직후 차단",
    activeEvent: summarizeEvent(active),
    upcomingEvent: summarizeEvent(upcoming),
    reason: `${active.title} 직전/직후 고변동성 구간`
  };
}

export function getNewsRisk(symbol, news = [], now = new Date(), name) {
  const relevant = news
    .filter((item) => isRecent(item.publishedAt, now, 36))
    .filter((item) => isRelevant(symbol, item, name))
    .slice(0, 8);
  const negative = relevant.filter((item) => item.sentiment === "negative");
  const positive = relevant.filter((item) => item.sentiment === "positive");
  const score = positive.length - negative.length;
  // 가중 합(강도 반영): 단일이라도 강한 악재(예: "폭락/투매" -4)면 호재가 일부 있어도 반응한다.
  const weightedScore = relevant.reduce((sum, item) => sum + Number(item.signalScore ?? 0), 0);

  if (negative.length >= 2 || score <= -2 || weightedScore <= -3) {
    return {
      budgetMultiplier: 0.5,
      label: "악재 뉴스 감지",
      reason: negative[0]?.signalReasons?.join(", ") || "최근 부정 뉴스가 강함"
    };
  }

  return {
    budgetMultiplier: 1,
    label: score > 0 ? "뉴스 우호적" : "뉴스 중립",
    reason: positive[0]?.signalReasons?.join(", ") || null
  };
}

export function listEventCalendar(events = BUILTIN_EVENTS, now = new Date()) {
  const cutoff = now.getTime() - 2 * 86_400_000; // 종료 2일 지난 이벤트는 숨긴다(자동 만료).
  return (Array.isArray(events) ? events : [])
    .filter((event) => new Date(event.startsAt).getTime() + Number(event.postBlockHours ?? 0) * 3_600_000 >= cutoff)
    .sort((a, b) => new Date(a.startsAt) - new Date(b.startsAt))
    .map(summarizeEvent);
}

function isInWindow(event, now) {
  const start = new Date(event.startsAt).getTime();
  const current = now.getTime();
  const pre = Number(event.preBlockHours) * 3_600_000;
  const post = Number(event.postBlockHours) * 3_600_000;
  return current >= start - pre && current <= start + post;
}

function isInHardBlockWindow(event, now) {
  const start = new Date(event.startsAt).getTime();
  const current = now.getTime();
  const isHigh = event.severity === "high";
  const preHours = event.type === "earnings" ? (isHigh ? 8 : 4) : (isHigh ? 4 : 2);
  const postHours = event.type === "earnings" ? (isHigh ? 4 : 2) : (isHigh ? 2 : 1);
  return current >= start - preHours * 3_600_000 && current <= start + postHours * 3_600_000;
}

function summarizeEvent(event) {
  if (!event) return null;
  return {
    id: event.id,
    title: event.title,
    type: event.type,
    symbols: event.symbols,
    startsAt: event.startsAt,
    preBlockHours: event.preBlockHours,
    postBlockHours: event.postBlockHours,
    severity: event.severity,
    estimated: Boolean(event.estimated)
  };
}

function eventAppliesToSymbol(event, symbol) {
  if (!symbol) return false;
  if (event.type === "macro") return true;
  const syms = (event.symbols ?? []).map((item) => String(item).toUpperCase());
  return syms.includes("*") || syms.includes(symbol);
}

function isRecent(publishedAt, now, hours) {
  const time = new Date(publishedAt).getTime();
  if (!Number.isFinite(time)) return false;
  return now.getTime() - time <= hours * 3_600_000;
}

// 종목별 관련성은 공유 ticker 프로필(별칭 + 섹터 키워드)로 판정한다(news.js와 동일 출처).
// 거시(연준/금리/인플레)는 전 종목 공통으로 먼저 통과시킨다.
function isRelevant(symbol, item, name) {
  const text = `${item.title ?? ""} ${item.summary ?? ""} ${item.koreanSummary ?? ""}`.toLowerCase();
  const macroRelevant = /\bfed\b|fomc|\brates?\b|\bcpi\b|\bpce\b|\bppi\b|inflation|\bgdp\b|\bjobs?\b|unemployment|연준|금리|인플레이션|고용|실업|경기/.test(text);
  if (macroRelevant) return true;
  return relevanceMatcher(symbol, name)(text);
}
