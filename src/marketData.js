const cache = new Map();
const metaCache = new Map();

export async function getExternalDailyCandles(symbol, { range = "5y" } = {}) {
  const key = `${symbol}:${range}`;
  const cached = cache.get(key);
  if (cached && Date.now() - cached.createdAt < 30 * 60_000) return cached.candles;

  const data = await fetchYahooChart(symbol, { range, interval: "1d" });
  const result = data.chart?.result?.[0];
  if (!result?.timestamp?.length) {
    throw new Error(data.chart?.error?.description || `외부 가격 데이터를 가져오지 못했습니다: ${symbol}`);
  }

  const quote = result.indicators?.quote?.[0] ?? {};
  const adjusted = result.indicators?.adjclose?.[0]?.adjclose ?? [];
  const candles = result.timestamp
    .map((timestamp, index) => {
      const close = Number(adjusted[index] ?? quote.close?.[index]);
      const rawClose = Number(quote.close?.[index]);
      const adjustment = rawClose > 0 && close > 0 ? close / rawClose : 1;
      return {
        timestamp: new Date(timestamp * 1000).toISOString(),
        open: Number(quote.open?.[index]) * adjustment,
        high: Number(quote.high?.[index]) * adjustment,
        low: Number(quote.low?.[index]) * adjustment,
        close,
        volume: Number(quote.volume?.[index] ?? 0),
        source: "Yahoo Finance"
      };
    })
    .filter((item) => [item.open, item.high, item.low, item.close].every(Number.isFinite));

  cache.set(key, { createdAt: Date.now(), candles });
  return candles;
}

export async function getExternalSymbolMeta(symbol) {
  const normalized = String(symbol ?? "").trim().toUpperCase();
  if (!normalized) throw new Error("symbol is required");
  const cached = metaCache.get(normalized);
  if (cached && Date.now() - cached.createdAt < 24 * 60 * 60_000) return cached.meta;

  const data = await fetchYahooChart(normalized, { range: "5d", interval: "1d" });
  const meta = data.chart?.result?.[0]?.meta;
  if (!meta?.symbol) throw new Error(`외부 심볼 정보를 가져오지 못했습니다: ${normalized}`);
  const value = {
    symbol: String(meta.symbol ?? normalized).toUpperCase(),
    shortName: cleanName(meta.shortName),
    longName: cleanName(meta.longName),
    instrumentType: meta.instrumentType ?? null,
    exchangeName: meta.exchangeName ?? null,
    currency: meta.currency ?? null,
    regularMarketPrice: Number.isFinite(Number(meta.regularMarketPrice)) ? Number(meta.regularMarketPrice) : null,
    source: "Yahoo Finance"
  };
  metaCache.set(normalized, { createdAt: Date.now(), meta: value });
  return value;
}

async function fetchYahooChart(symbol, { range, interval }) {
  const url = new URL(`https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`);
  url.searchParams.set("range", range);
  url.searchParams.set("interval", interval);
  url.searchParams.set("events", "history");
  url.searchParams.set("includeAdjustedClose", "true");

  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Accept: "application/json,text/plain,*/*"
    },
    signal: AbortSignal.timeout(12_000)
  });
  const data = await response.json();
  if (!response.ok || data.chart?.error) {
    throw new Error(data.chart?.error?.description || `외부 가격 데이터를 가져오지 못했습니다: ${symbol}`);
  }
  return data;
}

function cleanName(value) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text || null;
}
