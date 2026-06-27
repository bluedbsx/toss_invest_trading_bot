const NEWS_SYMBOLS = ["MU", "TSM", "WDC", "GOOGL", "QQQ", "SOXL", "MUU", "SNXX", "SOXX", "SMH"];
const GOOGLE_NEWS_QUERY =
  "(Federal Reserve OR FOMC OR inflation OR semiconductor OR Micron OR TSMC OR \"Western Digital\" OR Alphabet OR Google OR AI) -Bitcoin -crypto when:7d";

const FEEDS = [
  {
    source: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_monetary.xml",
    category: "Fed"
  },
  {
    source: "Google News",
    url: `https://news.google.com/rss/search?q=${encodeURIComponent(GOOGLE_NEWS_QUERY)}&hl=ko&gl=KR&ceid=KR:ko`,
    category: "Macro"
  },
  {
    source: "Yahoo Finance",
    url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${NEWS_SYMBOLS.join(",")}&region=US&lang=en-US`,
    category: "Tickers"
  }
];

export async function fetchNews() {
  const batches = await Promise.allSettled(FEEDS.map(fetchFeed));
  return batches
    .flatMap((item) => (item.status === "fulfilled" ? item.value : []))
    .map(enrichNews)
    .sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0))
    .slice(0, 24);
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { "User-Agent": "toss-invest-terminal/0.1" }
  });
  if (!response.ok) throw new Error(`${feed.source} RSS ${response.status}`);
  const xml = await response.text();
  return parseItems(xml).map((item) => ({
    ...item,
    source: feed.source,
    category: feed.category
  }));
}

function parseItems(xml) {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].slice(0, 12);
  return items.map((match) => {
    const raw = match[0];
    return {
      title: decodeXml(pick(raw, "title")),
      url: decodeXml(pick(raw, "link")),
      publishedAt: decodeXml(pick(raw, "pubDate") || pick(raw, "dc:date")),
      summary: stripTags(decodeXml(pick(raw, "description"))).slice(0, 220)
    };
  });
}

function pick(raw, tag) {
  const escaped = tag.replace(":", "\\:");
  const match = raw.match(new RegExp(`<${escaped}[^>]*>([\\s\\S]*?)<\\/${escaped}>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim() ?? "";
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeXml(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

// 가중 렉시콘: [영문 키워드, 한글 라벨, 가중치]. 메모리/반도체 사이클 용어를 포함해
// 이 포트폴리오(반도체·메모리)의 진짜 테마 악재/호재를 더 잘 잡는다. 단순 개수 세기 → 강도 가중으로 고도화.
const POSITIVE_TERMS = [
  ["rate cut", "금리 인하 기대", 2], ["rate cuts", "금리 인하 기대", 2], ["dovish", "완화적 연준", 1.5],
  ["cooling inflation", "인플레이션 둔화", 2], ["inflation cools", "인플레이션 둔화", 2], ["inflation eases", "인플레이션 완화", 2],
  ["disinflation", "디스인플레이션", 1.5], ["inflation falls", "인플레이션 하락", 2],
  ["soft landing", "경기 연착륙", 1], ["ai demand", "AI 수요", 2], ["hbm", "HBM 강세", 2],
  ["data center", "데이터센터 수요", 1.5], ["strong demand", "수요 강세", 1.5], ["memory shortage", "메모리 공급부족", 2.5],
  ["undersupply", "공급 부족", 2], ["price increase", "메모리 가격 인상", 2.5], ["price hike", "가격 인상", 2],
  ["earnings beat", "실적 호조", 2], ["beats estimates", "실적 호조", 2], ["raises guidance", "가이던스 상향", 2.5],
  ["raises outlook", "전망 상향", 2], ["upgrade", "투자의견 상향", 1], ["rally", "상승 흐름", 1], ["surge", "급등", 1.5]
];
const NEGATIVE_TERMS = [
  ["rate hike", "금리 인상 우려", 2], ["higher for longer", "고금리 장기화", 1.5], ["hawkish", "매파적 연준", 1.5],
  ["rising inflation", "인플레이션 상승", 2], ["hot inflation", "인플레이션 과열", 2], ["sticky inflation", "끈적한 인플레이션", 2],
  ["inflation surge", "인플레이션 급등", 2], ["high inflation", "고인플레이션", 1.5], ["inflation", "인플레이션 부담", 1],
  ["recession", "침체 우려", 2.5], ["slowdown", "둔화 우려", 1.5], ["memory glut", "메모리 공급과잉", 2.5],
  ["oversupply", "공급 과잉", 2.5], ["inventory correction", "재고 조정", 2], ["price decline", "메모리 가격 하락", 2.5],
  ["price drop", "가격 하락", 2], ["demand weakness", "수요 약세", 2], ["weak demand", "수요 약세", 2],
  ["capex cut", "투자 축소", 2], ["guidance cut", "가이던스 하향", 2.5], ["cuts outlook", "전망 하향", 2.5],
  ["cuts guidance", "가이던스 하향", 2.5], ["downturn", "업황 둔화", 2], ["export restriction", "수출 규제", 2],
  ["export curb", "수출 규제", 2], ["tariff", "관세 부담", 1.5], ["misses", "실적 부진", 2],
  ["selloff", "매도세", 1.5], ["plunge", "급락", 2], ["crash", "폭락", 2.5], ["glut", "공급과잉", 2],
  // 급락/약세 표현 보강(실사례: "SOXL's 23% Single-Day Collapse", "Tech Rout"가 누락됐었음).
  ["collapse", "폭락", 2.5], ["rout", "투매", 2], ["meltdown", "붕괴", 2.5], ["crater", "폭락", 2],
  ["tumble", "급락", 1.5], ["slump", "급락", 1.5], ["bear market", "약세장", 2], ["sell-off", "매도세", 1.5],
  ["sinks", "급락", 1.5], ["wipeout", "손실 경고", 2], ["destroy wealth", "큰 손실 경고", 2]
];
// 부정어가 키워드 바로 앞에 오면 그 신호는 무시한다(예: "no recession", "rate cut unlikely"는 오탐).
const NEGATION = /\b(no|not|without|avoid|unlikely|despite|less|lower|eas\w*)\s+\S{0,14}$/;

// 뉴스 내용 기반 태그: 주제(연준/금리/인플레이션/반도체/메모리…) + 종목 티커. 화면에 칩으로 표시해
// "연준 / 거시 / 종목" 같은 정적 분류 대신 각 뉴스가 실제 무엇/어느 종목에 관한 건지 보여준다.
const TOPIC_TAGS = [
  [/\bfed\b|fomc|federal reserve|연준|powell|greenspan|warsh/, "연준"],
  [/rate (cut|hike|decision)|interest rate|monetary|금리/, "금리"],
  [/inflation|\bcpi\b|\bpce\b|인플레/, "인플레이션"],
  [/recession|\bgdp\b|jobs|unemployment|경기|침체/, "거시"],
  [/semiconductor|\bchips?\b|반도체/, "반도체"],
  [/\bai\b|artificial intelligence/, "AI"],
  [/\bmemory\b|\bdram\b|\bnand\b|\bhbm\b|메모리/, "메모리"],
  [/tariff|export (restriction|curb|control)|trade war|관세/, "무역"],
  [/leverage|leveraged etf|\b[23]x\b/, "레버리지"]
];
const TICKER_TAGS = [
  [/\bmicron\b|\bmuu?\b/, "MU"], [/\bsandisk\b|\bsndk\b|\bsnxx\b/, "SNDK"], [/\bnvidia\b|\bnvda\b/, "NVDA"],
  [/\bsoxl\b/, "SOXL"], [/\bsoxx\b/, "SOXX"], [/\bsmh\b/, "SMH"], [/\bintel\b|\bintc\b/, "INTC"],
  [/\bamd\b/, "AMD"], [/\btsmc\b|\btsm\b/, "TSM"], [/\bbroadcom\b|\bavgo\b/, "AVGO"], [/\bwestern digital\b|\bwdc\b/, "WDC"],
  [/\balphabet\b|\bgoogle\b|\bgoogl\b|\bgoog\b/, "GOOGL"], [/\bqqq\b|nasdaq 100/, "QQQ"]
];
function buildTags(text) {
  const topics = TOPIC_TAGS.filter(([re]) => re.test(text)).map(([, label]) => label);
  const tickers = TICKER_TAGS.filter(([re]) => re.test(text)).map(([, label]) => label);
  return [...new Set([...topics, ...tickers])].slice(0, 5);
}

function enrichNews(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const positive = weightedHits(text, POSITIVE_TERMS);
  const negative = weightedHits(text, NEGATIVE_TERMS);
  const score = Math.round((positive.weight - negative.weight) * 10) / 10;
  // 가중 임계값(±1.5)으로 미약한 신호를 중립 처리해 잡음을 줄인다.
  const sentiment = score >= 1.5 ? "positive" : score <= -1.5 ? "negative" : "neutral";
  const signalLabel = sentiment === "positive" ? "호재 가능성" : sentiment === "negative" ? "악재 가능성" : "중립";
  const topic = detectTopic(text, item.category);
  const reasons = [...negative.labels, ...positive.labels].slice(0, 3);

  return {
    ...item,
    translatedTitle: koreanizeTitle(item.title),
    koreanSummary: buildKoreanSummary({ topic, signalLabel, reasons, item }),
    tags: buildTags(text),
    sentiment,
    signalLabel,
    signalScore: score,
    signalReasons: reasons
  };
}

function weightedHits(text, terms) {
  const labels = [];
  let weight = 0;
  for (const [needle, label, value] of terms) {
    const index = text.indexOf(needle);
    if (index < 0) continue;
    if (NEGATION.test(text.slice(Math.max(0, index - 16), index))) continue; // 부정어 선행 → 무시
    labels.push(label);
    weight += value;
  }
  return { labels, weight };
}

function detectTopic(text, fallback) {
  if (text.includes("fed") || text.includes("fomc") || text.includes("rate")) return "연준/금리";
  if (text.includes("semiconductor") || text.includes("chip") || /\bai\b/.test(text)) return "반도체/AI";
  if (text.includes("micron") || text.includes("mu ")) return "Micron/MUU";
  if (text.includes("tsmc") || text.includes("tsm ")) return "TSMC/TSM";
  if (text.includes("western digital") || text.includes("wdc")) return "Western Digital/WDC";
  if (text.includes("alphabet") || text.includes("google")) return "Alphabet/GOOGL";
  if (text.includes("sandisk") || text.includes("sndk")) return "SanDisk/SNXX";
  return fallback === "Tickers" ? "종목 뉴스" : "거시 뉴스";
}

function buildKoreanSummary({ topic, signalLabel, reasons, item }) {
  const reasonText = reasons.length ? `감지된 이유: ${reasons.join(", ")}.` : "뚜렷한 호재/악재 키워드는 적습니다.";
  return `${topic} 관련 뉴스입니다. 현재 분류는 ${signalLabel}입니다. ${reasonText} 원문 제목을 함께 확인하세요: ${item.title}`;
}

function koreanizeTitle(title) {
  return title
    .replace(/\bFederal Reserve\b/gi, "연방준비제도")
    .replace(/\bFed\b/g, "연준")
    .replace(/\bFOMC\b/g, "FOMC")
    .replace(/\brate cuts?\b/gi, "금리 인하")
    .replace(/\brate hikes?\b/gi, "금리 인상")
    .replace(/\binflation\b/gi, "인플레이션")
    .replace(/\bsemiconductor(s)?\b/gi, "반도체")
    .replace(/\bchip(s)?\b/gi, "칩")
    .replace(/\bearnings\b/gi, "실적");
}
