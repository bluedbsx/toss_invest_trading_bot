// 종목 실적 발표일 자동 수집 — 사용자가 직접 입력하지 않는다(오입력 방지). Nasdaq 공개 엔드포인트 사용
// (키 불필요). 날짜만 제공되므로 미국 마감 후(20:00 UTC≈16:00 ET) 가정 + 넉넉한 전후 차단창으로 둔다.
// 실패하면 빈 배열을 반환해 "이벤트 없음"으로 안전하게 떨어진다(잘못된 차단을 만들지 않는다).
const NASDAQ_HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Accept: "application/json",
  Origin: "https://www.nasdaq.com",
  Referer: "https://www.nasdaq.com/"
};
const CACHE_MS = 6 * 60 * 60_000; // 6시간 캐시(실적일은 자주 안 바뀜)
const cache = new Map();

export async function fetchEarningsEvents(symbols = []) {
  const events = [];
  const seen = new Set();
  for (const raw of symbols) {
    const symbol = String(raw ?? "").toUpperCase();
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    const event = await fetchOneEarnings(symbol).catch(() => null);
    if (event) events.push(event);
  }
  return events;
}

async function fetchOneEarnings(symbol) {
  const cached = cache.get(symbol);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.event;
  const url = `https://api.nasdaq.com/api/analyst/${encodeURIComponent(symbol)}/earnings-date`;
  const response = await fetch(url, { headers: NASDAQ_HEADERS, signal: AbortSignal.timeout(12_000) });
  if (!response.ok) return cacheAndReturn(symbol, null);
  const data = await response.json().catch(() => null);
  const announcement = data?.data?.announcement ?? "";
  // 예: "Earnings announcement* for TSM: Jul 16, 2026" → 날짜만 추출. 미제공이면 ": " 뒤가 비어 매칭 안 됨.
  const match = announcement.match(/:\s*([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})\s*$/);
  if (!match) return cacheAndReturn(symbol, null);
  const date = new Date(`${match[1]} 20:00:00 GMT`);
  if (Number.isNaN(date.getTime())) return cacheAndReturn(symbol, null);
  const event = {
    id: `earnings-${symbol}-${date.toISOString().slice(0, 10)}`,
    title: `${symbol} 실적 발표`,
    type: "earnings",
    symbols: [symbol],
    startsAt: date.toISOString(),
    preBlockHours: 18,
    postBlockHours: 18,
    severity: "high",
    estimated: true, // 시각은 마감 후로 가정(날짜만 확정)
    source: "Nasdaq"
  };
  return cacheAndReturn(symbol, event);
}

function cacheAndReturn(symbol, event) {
  cache.set(symbol, { at: Date.now(), event });
  return event;
}
