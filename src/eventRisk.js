const EVENTS = [
  {
    id: "mu-2026-q3",
    title: "Micron FY Q3 실적 발표",
    type: "earnings",
    symbols: ["MUU"],
    startsAt: "2026-06-24T20:30:00Z",
    preBlockHours: 72,
    postBlockHours: 12,
    severity: "high"
  },
  {
    id: "cpi-2026-06",
    title: "미국 CPI 6월 발표",
    type: "macro",
    symbols: ["SOXL", "MUU", "SNXX"],
    startsAt: "2026-07-14T12:30:00Z",
    preBlockHours: 24,
    postBlockHours: 8,
    severity: "high"
  },
  {
    id: "fomc-2026-07",
    title: "FOMC 금리 결정",
    type: "macro",
    symbols: ["SOXL", "MUU", "SNXX"],
    startsAt: "2026-07-29T18:00:00Z",
    preBlockHours: 24,
    postBlockHours: 8,
    severity: "high"
  },
  {
    id: "cpi-2026-07",
    title: "미국 CPI 7월 발표",
    type: "macro",
    symbols: ["SOXL", "MUU", "SNXX"],
    startsAt: "2026-08-12T12:30:00Z",
    preBlockHours: 24,
    postBlockHours: 8,
    severity: "high"
  },
  {
    id: "sndk-2026-q4-estimated",
    title: "SanDisk 실적 예상 기간",
    type: "earnings",
    symbols: ["SNXX"],
    startsAt: "2026-08-13T20:30:00Z",
    preBlockHours: 36,
    postBlockHours: 12,
    severity: "medium",
    estimated: true
  },
  {
    id: "fomc-2026-09",
    title: "FOMC 금리 결정",
    type: "macro",
    symbols: ["SOXL", "MUU", "SNXX"],
    startsAt: "2026-09-16T18:00:00Z",
    preBlockHours: 24,
    postBlockHours: 8,
    severity: "high"
  }
];

export function getEventRisk(symbol, now = new Date()) {
  const applicable = EVENTS.filter((event) => event.symbols.includes(symbol))
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

export function getNewsRisk(symbol, news = [], now = new Date()) {
  const relevant = news
    .filter((item) => isRecent(item.publishedAt, now, 36))
    .filter((item) => isRelevant(symbol, item))
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

export function listEventCalendar() {
  return EVENTS.map(summarizeEvent);
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

function isRecent(publishedAt, now, hours) {
  const time = new Date(publishedAt).getTime();
  if (!Number.isFinite(time)) return false;
  return now.getTime() - time <= hours * 3_600_000;
}

function isRelevant(symbol, item) {
  const text = `${item.title ?? ""} ${item.summary ?? ""} ${item.koreanSummary ?? ""}`.toLowerCase();
  if (symbol === "SOXL") return /fed|fomc|rate|cpi|inflation|semiconductor|chip|ai|반도체|연준|금리|인플레이션/.test(text);
  if (symbol === "MUU") return /micron|\bmu\b|memory|dram|hbm|반도체|메모리|실적/.test(text);
  if (symbol === "SNXX") return /sandisk|sndk|nand|storage|메모리|스토리지|실적/.test(text);
  return text.includes(symbol.toLowerCase());
}
