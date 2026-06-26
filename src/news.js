const FEEDS = [
  {
    source: "Federal Reserve",
    url: "https://www.federalreserve.gov/feeds/press_monetary.xml",
    category: "Fed"
  },
  {
    source: "Google News",
    url:
      "https://news.google.com/rss/search?q=(Federal%20Reserve%20OR%20FOMC%20OR%20semiconductor%20OR%20Micron%20OR%20Sandisk)%20-AAPL%20-Bitcoin%20-crypto%20when:7d&hl=ko&gl=KR&ceid=KR:ko",
    category: "Macro"
  },
  {
    source: "Yahoo Finance",
    url: "https://feeds.finance.yahoo.com/rss/2.0/headline?s=SOXL,MUU,SNXX&region=US&lang=en-US",
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

function enrichNews(item) {
  const text = `${item.title} ${item.summary}`.toLowerCase();
  const positiveHits = findHits(text, [
    ["rate cut", "금리 인하 기대"],
    ["cuts", "금리 인하 기대"],
    ["dovish", "완화적 연준"],
    ["soft landing", "경기 연착륙"],
    ["ai demand", "AI 수요"],
    ["strong demand", "수요 강세"],
    ["earnings beat", "실적 호조"],
    ["raises outlook", "전망 상향"],
    ["rally", "상승 흐름"],
    ["surge", "급등"],
    ["gain", "상승"]
  ]);
  const negativeHits = findHits(text, [
    ["rate hike", "금리 인상 우려"],
    ["higher for longer", "고금리 장기화"],
    ["hawkish", "매파적 연준"],
    ["inflation", "인플레이션 부담"],
    ["recession", "침체 우려"],
    ["slowdown", "둔화 우려"],
    ["export restriction", "수출 규제"],
    ["tariff", "관세 부담"],
    ["misses", "실적 부진"],
    ["cuts outlook", "전망 하향"],
    ["selloff", "매도세"],
    ["plunge", "급락"],
    ["drop", "하락"]
  ]);
  const score = positiveHits.length - negativeHits.length;
  const sentiment = score > 0 ? "positive" : score < 0 ? "negative" : "neutral";
  const signalLabel = sentiment === "positive" ? "호재 가능성" : sentiment === "negative" ? "악재 가능성" : "중립";
  const topic = detectTopic(text, item.category);
  const reasons = [...positiveHits, ...negativeHits].slice(0, 3);

  return {
    ...item,
    translatedTitle: koreanizeTitle(item.title),
    koreanSummary: buildKoreanSummary({ topic, signalLabel, reasons, item }),
    sentiment,
    signalLabel,
    signalScore: score,
    signalReasons: reasons
  };
}

function findHits(text, entries) {
  return entries.filter(([keyword]) => text.includes(keyword)).map(([, label]) => label);
}

function detectTopic(text, fallback) {
  if (text.includes("fed") || text.includes("fomc") || text.includes("rate")) return "연준/금리";
  if (text.includes("semiconductor") || text.includes("chip") || text.includes("ai")) return "반도체/AI";
  if (text.includes("micron") || text.includes("mu ")) return "Micron/MUU";
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
