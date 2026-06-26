const DEFAULT_LIMITS = {
  AUTH: 5,
  ACCOUNT: 1,
  ASSET: 5,
  STOCK: 5,
  MARKET_INFO: 3,
  MARKET_DATA: 10,
  MARKET_DATA_CHART: 5,
  ORDER: 6,
  ORDER_HISTORY: 5,
  ORDER_INFO: 6
};

const GROUP_LABELS = {
  AUTH: "인증",
  ACCOUNT: "계좌",
  ASSET: "보유자산",
  STOCK: "종목정보",
  MARKET_INFO: "시장정보",
  MARKET_DATA: "시세",
  MARKET_DATA_CHART: "차트",
  ORDER: "주문",
  ORDER_HISTORY: "주문내역",
  ORDER_INFO: "거래가능정보"
};

const ACTION_COSTS = {
  testConnection: {
    label: "토스 연결 확인",
    requests: [
      { group: "AUTH", count: 0, endpoint: "POST /oauth2/token", variable: true, variableLabel: "필요 시" },
      { group: "ACCOUNT", count: 1, endpoint: "GET /api/v1/accounts" }
    ]
  },
  runOnce: {
    label: "지금 한 번 실행",
    requests: [
      { group: "AUTH", count: 0, endpoint: "POST /oauth2/token", variable: true, variableLabel: "필요 시" },
      { group: "MARKET_DATA", count: 1, endpoint: "GET /api/v1/prices" },
      { group: "MARKET_INFO", count: 1, endpoint: "GET /api/v1/market-calendar/US" },
      { group: "ASSET", count: 1, endpoint: "GET /api/v1/holdings" },
      { group: "MARKET_DATA_CHART", count: 6, endpoint: "GET /api/v1/candles" },
      { group: "ORDER_HISTORY", count: 0, endpoint: "GET /api/v1/orders/{orderId}", variable: true, variableLabel: "미체결 주문이 있으면" },
      { group: "ORDER", count: 0, endpoint: "POST /api/v1/orders", variable: true, variableLabel: "매매 조건 충족 시" }
    ]
  },
  syncOrders: {
    label: "체결 동기화",
    requests: [
      { group: "AUTH", count: 0, endpoint: "POST /oauth2/token", variable: true, variableLabel: "필요 시" },
      { group: "ORDER_HISTORY", count: 0, endpoint: "GET /api/v1/orders/{orderId}", variable: true, variableLabel: "미체결 주문 수만큼" }
    ]
  },
  monitorTick: {
    label: "자동 모니터링 1회",
    requests: [
      { group: "AUTH", count: 0, endpoint: "POST /oauth2/token", variable: true, variableLabel: "필요 시" },
      { group: "MARKET_DATA", count: 1, endpoint: "GET /api/v1/prices" },
      { group: "MARKET_INFO", count: 1, endpoint: "GET /api/v1/market-calendar/US" },
      { group: "ASSET", count: 1, endpoint: "GET /api/v1/holdings" },
      { group: "MARKET_DATA_CHART", count: 6, endpoint: "GET /api/v1/candles" },
      { group: "ORDER_HISTORY", count: 0, endpoint: "GET /api/v1/orders/{orderId}", variable: true, variableLabel: "미체결 주문이 있으면" },
      { group: "ORDER", count: 0, endpoint: "POST /api/v1/orders", variable: true, variableLabel: "매매 조건 충족 시" }
    ]
  }
};

export class RateLimiter {
  constructor({ limits = DEFAULT_LIMITS, now = () => Date.now() } = {}) {
    this.now = now;
    this.groups = new Map(
      Object.entries(limits).map(([group, limit]) => [
        group,
        {
          group,
          label: GROUP_LABELS[group] ?? group,
          limit,
          remaining: limit,
          resetAt: this.now() + 1000,
          inWindow: 0,
          total: 0,
          waitingUntil: 0,
          lastEndpoint: null,
          lastStatus: null,
          lastRequestAt: null
        }
      ])
    );
  }

  async waitForSlot(group, endpoint) {
    const bucket = this.bucket(group);
    const now = this.now();
    if (now >= bucket.resetAt) this.resetBucket(bucket, now);

    const waitMs = Math.max(0, bucket.resetAt - now);
    if (bucket.remaining <= 0 && waitMs > 0) {
      bucket.waitingUntil = bucket.resetAt;
      await sleep(waitMs + 25);
      this.resetBucket(bucket, this.now());
    }

    bucket.remaining = Math.max(0, bucket.remaining - 1);
    bucket.inWindow += 1;
    bucket.total += 1;
    bucket.lastEndpoint = endpoint;
    bucket.lastRequestAt = new Date(this.now()).toISOString();
    bucket.lastStatus = "REQUESTED";
  }

  recordResponse(group, endpoint, response) {
    const bucket = this.bucket(group);
    const limit = Number(response.headers.get("X-RateLimit-Limit"));
    const remaining = Number(response.headers.get("X-RateLimit-Remaining"));
    const resetSec = Number(response.headers.get("X-RateLimit-Reset"));
    const retryAfter = Number(response.headers.get("Retry-After"));
    const now = this.now();

    if (Number.isFinite(limit) && limit > 0) bucket.limit = limit;
    if (Number.isFinite(remaining) && remaining >= 0) bucket.remaining = remaining;
    if (Number.isFinite(resetSec) && resetSec >= 0) bucket.resetAt = now + resetSec * 1000;
    if (response.status === 429 && Number.isFinite(retryAfter)) bucket.waitingUntil = now + retryAfter * 1000;
    bucket.lastEndpoint = endpoint;
    bucket.lastStatus = response.status;
    bucket.lastRequestAt = new Date(now).toISOString();
  }

  recordError(group, endpoint, error) {
    const bucket = this.bucket(group);
    bucket.lastEndpoint = endpoint;
    bucket.lastStatus = error?.status ?? "ERROR";
    bucket.lastRequestAt = new Date(this.now()).toISOString();
  }

  snapshot() {
    const now = this.now();
    return {
      generatedAt: new Date(now).toISOString(),
      groups: Object.fromEntries(
        [...this.groups.entries()].map(([group, bucket]) => {
          if (now >= bucket.resetAt) this.resetBucket(bucket, now);
          return [
            group,
            {
              label: bucket.label,
              limit: bucket.limit,
              remaining: bucket.remaining,
              usedInWindow: Math.max(0, bucket.limit - bucket.remaining),
              resetInSec: Math.max(0, Math.ceil((bucket.resetAt - now) / 1000)),
              blockedForSec: Math.max(0, Math.ceil((bucket.waitingUntil - now) / 1000)),
              total: bucket.total,
              lastEndpoint: bucket.lastEndpoint,
              lastStatus: bucket.lastStatus,
              lastRequestAt: bucket.lastRequestAt
            }
          ];
        })
      ),
      actions: ACTION_COSTS
    };
  }

  bucket(group) {
    if (!this.groups.has(group)) {
      this.groups.set(group, {
        group,
        label: GROUP_LABELS[group] ?? group,
        limit: 1,
        remaining: 1,
        resetAt: this.now() + 1000,
        inWindow: 0,
        total: 0,
        waitingUntil: 0,
        lastEndpoint: null,
        lastStatus: null,
        lastRequestAt: null
      });
    }
    return this.groups.get(group);
  }

  resetBucket(bucket, now) {
    bucket.remaining = bucket.limit;
    bucket.inWindow = 0;
    bucket.resetAt = now + 1000;
    if (bucket.waitingUntil <= now) bucket.waitingUntil = 0;
  }
}

export function groupForTossPath(path, method = "GET") {
  if (path === "/oauth2/token") return "AUTH";
  if (path === "/api/v1/accounts") return "ACCOUNT";
  if (path === "/api/v1/holdings") return "ASSET";
  if (path.startsWith("/api/v1/stocks")) return "STOCK";
  if (path === "/api/v1/exchange-rate" || path.startsWith("/api/v1/market-calendar")) return "MARKET_INFO";
  if (path === "/api/v1/candles") return "MARKET_DATA_CHART";
  if (["/api/v1/prices", "/api/v1/orderbook", "/api/v1/trades", "/api/v1/price-limits"].includes(path)) return "MARKET_DATA";
  if (path === "/api/v1/orders" && method === "POST") return "ORDER";
  if (path === "/api/v1/orders" || /^\/api\/v1\/orders\/[^/]+$/.test(path)) return "ORDER_HISTORY";
  if (path === "/api/v1/buying-power" || path === "/api/v1/sellable-quantity" || path === "/api/v1/commissions") {
    return "ORDER_INFO";
  }
  return "MARKET_DATA";
}

export function actionCostsForTargets(enabledTargetCount = 3) {
  const costs = structuredClone(ACTION_COSTS);
  const chartCount = Math.max(0, Number(enabledTargetCount));
  for (const key of ["runOnce", "syncOrders", "monitorTick"]) {
    for (const request of costs[key].requests) {
      if (request.group === "MARKET_DATA_CHART") request.count = chartCount;
    }
  }
  return costs;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
