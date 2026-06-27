import { RateLimiter, groupForTossPath } from "./rateLimiter.js";

export class TossClient {
  constructor() {
    this.clientId = process.env.TOSS_CLIENT_ID;
    this.clientSecret = process.env.TOSS_CLIENT_SECRET;
    this.accountSeq = process.env.TOSS_ACCOUNT_SEQ;
    this.baseUrl = process.env.TOSS_BASE_URL || "https://openapi.tossinvest.com";
    this.token = null;
    this.tokenExpiresAt = 0;
    this.rateLimiter = new RateLimiter();
  }

  isMockMode() {
    return !this.clientId || !this.clientSecret;
  }

  async issueToken() {
    if (this.isMockMode()) return "mock-token";
    if (this.token && Date.now() < this.tokenExpiresAt - 30_000) return this.token;

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret
    });

    const response = await fetchWithRateLimit({
      limiter: this.rateLimiter,
      group: "AUTH",
      endpoint: "POST /oauth2/token",
      url: `${this.baseUrl}/oauth2/token`,
      options: {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body
      }
    });
    const data = await parseResponse(response);
    this.token = data.access_token ?? data.result?.accessToken ?? data.result?.access_token;
    const expiresIn = Number(data.expires_in ?? data.result?.expiresIn ?? 3600);
    this.tokenExpiresAt = Date.now() + expiresIn * 1000;
    return this.token;
  }

  async request(path, { method = "GET", query, body, accountRequired = false } = {}) {
    if (this.isMockMode()) return mockResponse(path, query, body);
    const token = await this.issueToken();
    const url = new URL(path, this.baseUrl);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
    }
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/json"
    };
    if (body) headers["Content-Type"] = "application/json";
    if (accountRequired) {
      const accountSeq = process.env.TOSS_ACCOUNT_SEQ;
      if (!accountSeq) throw new Error("TOSS_ACCOUNT_SEQ is required for account/order APIs.");
      headers["X-Tossinvest-Account"] = String(accountSeq);
    }

    const group = groupForTossPath(path, method);
    const endpoint = `${method} ${path}`;
    const response = await fetchWithRateLimit({
      limiter: this.rateLimiter,
      group,
      endpoint,
      url,
      options: {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined
      }
    });
    try {
      return await parseResponse(response);
    } catch (error) {
      this.rateLimiter.recordError(group, endpoint, error);
      throw error;
    }
  }

  getRateLimitSnapshot() {
    return this.rateLimiter.snapshot();
  }

  getPrices(symbols) {
    return this.request("/api/v1/prices", { query: { symbols: symbols.join(",") } });
  }

  getCandles(symbol, interval = "1d", count = 80) {
    return this.request("/api/v1/candles", { query: { symbol, interval, count, adjusted: true } });
  }

  getUsCalendar() {
    return this.request("/api/v1/market-calendar/US");
  }

  getAccounts() {
    return this.request("/api/v1/accounts");
  }

  getHoldings(symbol) {
    return this.request("/api/v1/holdings", { accountRequired: true, query: { symbol } });
  }

  getOrders(status = "CLOSED", limit = 50) {
    return this.request("/api/v1/orders", { accountRequired: true, query: { status, limit } });
  }

  getOrder(orderId) {
    return this.request(`/api/v1/orders/${encodeURIComponent(orderId)}`, { accountRequired: true });
  }

  getSellableQuantity(symbol) {
    return this.request("/api/v1/sellable-quantity", {
      accountRequired: true,
      query: { symbol }
    });
  }

  createOrder(order) {
    return this.request("/api/v1/orders", {
      method: "POST",
      accountRequired: true,
      body: order
    });
  }
}

async function parseResponse(response) {
  const text = await response.text();
  const data = text ? JSON.parse(text) : {};
  if (!response.ok) {
    const message = data?.error?.message ?? `${response.status} ${response.statusText}`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function fetchWithRateLimit({ limiter, group, endpoint, url, options }) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await limiter.waitForSlot(group, endpoint);
    const response = await fetch(url, options);
    limiter.recordResponse(group, endpoint, response);
    if (response.status !== 429 || attempt === 1) return response;
    const retryAfter = Number(response.headers.get("Retry-After"));
    await sleep((Number.isFinite(retryAfter) ? retryAfter : 1) * 1000 + 100);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function mockResponse(path, query, body) {
  if (path === "/api/v1/prices") {
    const symbols = String(query?.symbols ?? "SOXL,MUU,SNXX").split(",");
    return {
      result: symbols.map((symbol) => ({
        symbol,
        timestamp: new Date().toISOString(),
        lastPrice: mockPrice(symbol),
        currency: "USD"
      }))
    };
  }

  if (path === "/api/v1/candles") {
    return { result: { candles: mockCandles(query?.symbol ?? "SOXL", Number(query?.count ?? 80)), nextBefore: null } };
  }

  if (path === "/api/v1/market-calendar/US") {
    const now = new Date();
    const start = new Date(now);
    start.setUTCHours(13, 30, 0, 0);
    const end = new Date(now);
    end.setUTCHours(20, 0, 0, 0);
    return {
      result: {
        today: {
          date: now.toISOString().slice(0, 10),
          regularMarket: { startTime: start.toISOString(), endTime: end.toISOString() }
        }
      }
    };
  }

  if (path === "/api/v1/accounts") {
    return { result: [{ accountNo: "mock-account", accountSeq: 1, accountType: "BROKERAGE" }] };
  }

  if (path === "/api/v1/holdings") {
    return {
      result: {
        marketValue: { amount: { usd: "0" } },
        profitLoss: { amount: { usd: "0" }, rate: "0" },
        items: []
      }
    };
  }

  if (path === "/api/v1/orders") {
    if (body) {
      return {
        result: {
          orderId: `mock-${Date.now()}`,
          status: "DRY_RUN_ACCEPTED",
          ...body
        }
      };
    }
    return { result: { orders: [], nextCursor: null } };
  }

  if (path === "/api/v1/sellable-quantity") {
    return { result: { sellableQuantity: "0" } };
  }

  return { result: null };
}

function mockPrice(symbol) {
  const prices = {
    MU: 141.2,
    TSM: 224.4,
    WDC: 74.8,
    GOOGL: 178.6,
    QQQ: 540.5,
    SOXL: 279.29,
    MUU: 1080.08,
    SNXX: 42.78,
    SOXX: 609.9,
    SMH: 621.12
  };
  return String(prices[symbol] ?? 100);
}

function mockCandles(symbol, count = 80) {
  const base = Number(mockPrice(symbol));
  return Array.from({ length: count }, (_, index) => {
    const t = index / 8;
    const trend = base * (0.72 + index * 0.004);
    const wave = Math.sin(t) * base * 0.04;
    const close = trend + wave;
    const open = close * (1 + Math.sin(t + 1) * 0.01);
    const high = Math.max(open, close) * 1.025;
    const low = Math.min(open, close) * 0.975;
    const date = new Date(Date.now() - (count - 1 - index) * 86_400_000);
    return {
      timestamp: date.toISOString(),
      openPrice: open.toFixed(2),
      highPrice: high.toFixed(2),
      lowPrice: low.toFixed(2),
      closePrice: close.toFixed(2),
      volume: String(1_000_000 + index * 5000),
      currency: "USD"
    };
  });
}
