// 티커 "정체성" 단일 출처 — 뉴스 검색어(news.js), 뉴스 태깅(news.js), 뉴스/이벤트 관련성(eventRisk.js)이
// 모두 이 파일을 공유한다. 종목을 추가할 때 여기 한 곳에 프로필을 더하면 검색·태깅·관련성 판정이 한꺼번에
// 반영된다. 프로필이 없는 새 티커도 심볼 토큰 매칭으로 자동 동작한다(회사명 키워드만 빠질 뿐 기능은 유지).

export const TICKER_PROFILES = {
  MU: { keywords: ["Micron"], aliases: ["micron", "muu"], sector: "memory" },
  TSM: { keywords: ["TSMC", "Taiwan Semiconductor"], aliases: ["tsmc", "taiwan semiconductor"], sector: "semi" },
  WDC: { keywords: ["Western Digital"], aliases: ["western digital"], sector: "memory" },
  GOOGL: { keywords: ["Alphabet", "Google"], aliases: ["alphabet", "google", "goog"], sector: "ai" },
  SNDK: { keywords: ["SanDisk"], aliases: ["sandisk", "sndk", "snxx"], sector: "memory" },
  NVDA: { keywords: ["Nvidia"], aliases: ["nvidia", "nvda"], sector: "semi" },
  AVGO: { keywords: ["Broadcom"], aliases: ["broadcom", "avgo"], sector: "semi" },
  INTC: { keywords: ["Intel"], aliases: ["intel", "intc"], sector: "semi" },
  AMD: { keywords: ["AMD"], aliases: ["amd"], sector: "semi" },
  AAPL: { keywords: ["Apple"], aliases: ["apple", "aapl"], sector: "tech" },
  MSFT: { keywords: ["Microsoft"], aliases: ["microsoft", "msft"], sector: "tech" },
  AMZN: { keywords: ["Amazon"], aliases: ["amazon", "amzn"], sector: "tech" },
  META: { keywords: ["Meta Platforms"], aliases: ["meta platforms", "facebook"], sector: "ai" },
  TSLA: { keywords: ["Tesla"], aliases: ["tesla", "tsla"], sector: "tech" },
  QQQ: { keywords: ["Nasdaq 100"], aliases: ["qqq", "nasdaq 100"], sector: "index" },
  SOXX: { keywords: ["semiconductor ETF"], aliases: ["soxx"], sector: "semi" },
  SMH: { keywords: [], aliases: ["smh"], sector: "semi" },
  SOXL: { keywords: [], aliases: ["soxl"], sector: "semi" }
};

// 섹터 동향 키워드(섹터 뉴스가 그 섹터 종목에 영향). 종목 프로필의 sector로 연결한다.
export const SECTOR_KEYWORDS = {
  semi: /semiconductor|chips?|\bai\b|nvidia|tsmc|반도체/i,
  memory: /memory|dram|nand|hbm|storage|반도체|메모리|스토리지/i,
  ai: /\bai\b|artificial intelligence|cloud|data center|advertising|클라우드|데이터센터|검색|광고/i,
  tech: /technology|tech stocks|big tech|빅테크|기술주/i,
  index: /nasdaq|nasdaq 100|s&p ?500|technology|기술주|나스닥/i
};

// 보유하지 않아도 업황 맥락상 태그하는 동종업계 티커.
export const CONTEXT_TICKERS = ["NVDA", "AVGO", "INTC", "AMD"];

export function profileFor(symbol) {
  return TICKER_PROFILES[String(symbol ?? "").toUpperCase()] ?? null;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 회사명 흔한 접미사(매칭 토큰에서 제외 — 너무 일반적이라 오탐 유발).
const NAME_STOPWORDS = new Set([
  "inc", "corp", "corporation", "ltd", "co", "company", "technologies", "technology",
  "holdings", "group", "plc", "the", "class", "adr", "etf", "trust", "fund"
]);

// 프로필이 없는 티커는 name에서 식별 가능한 토큰(접미사 제외, 3글자+)을 별칭으로 만든다.
// 예: "Palantir Technologies" → ["palantir"], "Apple Inc" → ["apple"].
function nameAliases(name) {
  const cleaned = englishCompanyName(name);
  if (!cleaned) return [];
  return cleaned
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((word) => word.length >= 3 && !NAME_STOPWORDS.has(word));
}

// 본문에서 해당 심볼/회사를 인식하는 정규식(프로필 별칭 + name 추정 별칭 + 심볼 토큰, 단어경계).
export function aliasMatcher(symbol, name) {
  const sym = String(symbol ?? "").toLowerCase();
  const profile = profileFor(symbol);
  const tokens = [...new Set([sym, ...(profile?.aliases ?? []), ...nameAliases(name)])]
    .filter(Boolean)
    .map(escapeRegExp);
  if (!tokens.length) return /a^/; // 매칭 안 됨
  const body = tokens.map((token) => `(?:^|[^a-z0-9])${token}(?:[^a-z0-9]|$)`).join("|");
  return new RegExp(body, "i");
}

// 구글뉴스 검색어(회사명 키워드; 모르는 티커는 회사명 추정 또는 심볼).
export function queryKeywords(symbol, name) {
  const profile = profileFor(symbol);
  if (profile?.keywords?.length) return profile.keywords;
  const fromName = englishCompanyName(name);
  return fromName ? [fromName] : [String(symbol ?? "").toUpperCase()];
}

// 종목 name에서 영문 회사명만 뽑는다(한글/괄호/배수표기 제거). 예: "iShares 반도체 1x (SOXX)" → "iShares".
function englishCompanyName(name) {
  if (!name) return null;
  const cleaned = String(name)
    .replace(/\([^)]*\)/g, " ")
    .replace(/[0-9]+x/gi, " ")
    .replace(/[^A-Za-z .&-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned.length >= 2 ? cleaned : null;
}

// 뉴스/이벤트 관련성 판정기: (별칭/회사명 매칭) 또는 (섹터 키워드 매칭).
export function relevanceMatcher(symbol, name) {
  const alias = aliasMatcher(symbol, name);
  const profile = profileFor(symbol);
  const sector = profile?.sector ? SECTOR_KEYWORDS[profile.sector] : null;
  return (text) => alias.test(text) || (sector ? sector.test(text) : false);
}
