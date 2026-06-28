import { appendFile, copyFile, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const DB_FILE = path.join(DATA_DIR, "state.json");
// learning.decisionSamples는 state.json 용량의 대부분(수 MB)을 차지하므로 사이드카 파일로 분리한다.
// 이렇게 하면 15초마다 쓰는 state.json과 저장마다 만드는 백업이 가벼워진다(백업은 state.json만 복사).
const SAMPLES_FILE = path.join(DATA_DIR, "decision-samples.json");
// 롤링 working set(SAMPLES_FILE, 5000개)과 별개로, 모든 결정 샘플을 손실 없이 영구 보관하는 append-only 아카이브.
// 엔진 다음 버전 개발/분석은 이 전체 이력을 사용한다(봇은 이 파일을 읽지 않음). 필요 시 월별 분할/압축 가능.
const SAMPLES_ARCHIVE = path.join(DATA_DIR, "decision-samples-archive.ndjson");
const BACKUP_DIR = path.join(DATA_DIR, "backups");
const MAX_BACKUPS = 80;
// 저장마다(≈15초 틱마다) 백업하면 80개가 ~100분치만 커버하고 파일 생성/삭제 churn이 크다.
// 최소 간격을 두어 백업을 묶으면 같은 80개로 훨씬 긴 기간(약 13시간)을 커버한다.
const BACKUP_MIN_INTERVAL_MS = 10 * 60_000;
let lastBackupAt = 0;
let updateQueue = Promise.resolve();

// 봇 운영 시작 기준 시각 단일 출처(검증 자본흐름·주문복구 기준). 초기화 스크립트가 현재로 갱신한다.
export const DEFAULT_BOT_STARTED_AT = "2026-06-21T00:00:00.000+09:00";

const defaultState = {
  settings: {
    monitoringEnabled: false,
    liveTradingEnabled: false,
    dryRun: true,
    allocationUsd: 100,
    cashBufferUsd: 20,
    useVirtualSeed: true,
    allowSeedTopUp: false,
    maxDailyLossPct: 4.5,
    maxPositionPct: 35,
    maxLeveragedExposurePct: 105,
    intradayDropBlockPct: 4.5,
    intradayPanicExitPct: 8,
    allowFractional: true,
    allowExtendedHoursTrading: false,
    allowExtendedHoursDefensiveSells: true,
    redistributeUnusedAllocation: true,
    allowAdditionalBuys: false,
    additionalBuyCooldownMinutes: 240,
    smallSeedNoiseFloorUsd: 5,
    autoSafetyRecommendations: true,
    autoWeightRecommendations: true,
    autoTargetRecommendations: false,
    autoLearningReports: true,
    autoRecommendationIntervalMinutes: 360,
    pollIntervalSec: 60,
    lastRunAt: null,
    accountSeq: "",
    botStartedAt: DEFAULT_BOT_STARTED_AT,
    modeNote: "LIVE_TRADING=false이면 실제 주문 대신 dry-run 로그만 남깁니다."
  },
  targets: [
    // 1x 반도체/메모리 단일주 코어(WORKLOG §JJ). 레버리지 ETF는 갭/휩쏘로 손절이 뚫려 제외, 추세가
    // 작동하는 1x로 전환. 파라미터는 optimizeTargetSettings 결과(신규 설치 기본값 — 런타임 state가 우선).
    {
      symbol: "MU",
      name: "Micron Technology (MU)",
      enabled: true,
      riskProfile: "growth",
      allocationPct: 36,
      leverage: "1x",
      stopLossPct: 8,
      fastSmaDays: 80,
      slowSmaDays: 200,
      momentumDays: 20,
      minBuyRsi: 35,
      maxBuyRsi: 65,
      partialTakeProfitPct: 9,
      partialTakeProfitSellPct: 40,
      takeProfitPct: 18,
      trailingStopPct: 10,
      takeProfitRsi: 78,
      maxAtrPct: 24,
      notes: "메모리 대표주. 80/200선 장기 추세 추종."
    },
    {
      symbol: "TSM",
      name: "TSMC ADR (TSM)",
      enabled: true,
      riskProfile: "growth",
      allocationPct: 28,
      leverage: "1x",
      stopLossPct: 8,
      fastSmaDays: 20,
      slowSmaDays: 100,
      momentumDays: 10,
      minBuyRsi: 42,
      maxBuyRsi: 70,
      partialTakeProfitPct: 9,
      partialTakeProfitSellPct: 40,
      takeProfitPct: 18,
      trailingStopPct: 10,
      takeProfitRsi: 78,
      maxAtrPct: 24,
      notes: "파운드리 1위. 20/100선 추세."
    },
    {
      symbol: "WDC",
      name: "Western Digital (WDC)",
      enabled: true,
      riskProfile: "growth",
      allocationPct: 36,
      leverage: "1x",
      stopLossPct: 8,
      fastSmaDays: 80,
      slowSmaDays: 200,
      momentumDays: 20,
      minBuyRsi: 35,
      maxBuyRsi: 65,
      partialTakeProfitPct: 9,
      partialTakeProfitSellPct: 40,
      takeProfitPct: 18,
      trailingStopPct: 10,
      takeProfitRsi: 78,
      maxAtrPct: 24,
      notes: "스토리지/낸드. 80/200선 장기 추세."
    }
  ],
  positions: {},
  performance: {
    realizedPnlUsd: 0,
    totalBuyAmountUsd: 0,
    totalSellAmountUsd: 0
  },
  paperSession: null,
  // 현재 장부 모드(paper=검증 종이장부 / live=실거래)와 지난 장부 구간 요약(append-only).
  ledgerMode: "paper",
  ledgerHistory: [],
  botBudget: null,
  externalTrackedHoldings: {},
  tradeHistory: [],
  orderEvents: [],
  marketSnapshots: {},
  riskGuard: null,
  news: [],
  economicCalendar: [],
  earningsEvents: [], // 자동 수집(Nasdaq) — 사용자 입력 아님
  automation: {
    lastRunAt: null,
    lastActions: [],
    lastError: null
  },
  learning: {
    version: "learning-v1",
    decisionSamples: [],
    recommendationEvents: [],
    closedCycles: [],
    reports: [],
    lastReport: null,
    updatedAt: null
  },
  health: {
    status: "idle",
    lastError: null,
    lastApiSyncAt: null,
    tossConnected: false,
    mockMode: true
  }
};

export async function loadState() {
  await mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await readFile(DB_FILE, "utf8");
    const parsed = JSON.parse(raw);
    const merged = mergeDefaults(parsed);
    merged.learning.decisionSamples = await loadSamples(parsed.learning?.decisionSamples);
    return merged;
  } catch {
    const recovered = await loadLatestBackup();
    if (recovered) {
      await saveState(recovered, { skipBackup: true });
      const merged = mergeDefaults(recovered);
      merged.learning.decisionSamples = await loadSamples(recovered.learning?.decisionSamples);
      return merged;
    }
    await saveState(defaultState, { skipBackup: true });
    return structuredClone(defaultState);
  }
}

export async function saveState(state, { skipBackup = false } = {}) {
  await mkdir(DATA_DIR, { recursive: true });
  const nextState = await protectPersistentHistory(mergeDefaults(state));
  if (!skipBackup) await backupCurrentState();
  // 무거운 decisionSamples는 사이드카로 따로 저장하고, state.json에는 비운 채 기록한다.
  await writeSamples(nextState.learning?.decisionSamples ?? []);
  // 롤링으로 사라지는 샘플까지 전부 영구 보관(append-only). 워터마크(archiveLastId)는 state.json에 함께 저장된다.
  await appendSampleArchive(nextState);
  const slimState = { ...nextState, learning: { ...nextState.learning, decisionSamples: [] } };
  const tempFile = `${DB_FILE}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tempFile, JSON.stringify(slimState, null, 2));
  await rename(tempFile, DB_FILE);
}

// 사이드카에서 decisionSamples를 읽고, 없으면 구버전 state.json 인라인 샘플에서 가져온다(자동 마이그레이션).
// 사이드카가 비었는데 인라인이 더 많으면(마이그레이션 직전 등) 더 긴 쪽을 채택해 데이터 유실을 막는다.
async function loadSamples(legacyInline) {
  const inline = Array.isArray(legacyInline) ? legacyInline : [];
  try {
    const raw = await readFile(SAMPLES_FILE, "utf8");
    const samples = JSON.parse(raw);
    if (Array.isArray(samples)) return samples.length >= inline.length ? samples : inline;
  } catch {
    // 사이드카 없음 — 구버전 인라인 샘플로 폴백.
  }
  return inline;
}

async function writeSamples(samples) {
  let next = Array.isArray(samples) ? samples : [];
  try {
    const raw = await readFile(SAMPLES_FILE, "utf8");
    const current = JSON.parse(raw);
    if (Array.isArray(current)) {
      if (next.length < current.length) {
        next = current; // 실수로 줄어드는 것 방지(append-only 로그)
      } else if (next.length === current.length && next[0]?.id === current[0]?.id) {
        return; // 변경 없음(설정 저장 등) — 6MB 재기록 생략
      }
    }
  } catch {
    // 사이드카 없음 — 새로 생성.
  }
  const tempFile = `${SAMPLES_FILE}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await writeFile(tempFile, JSON.stringify(next));
  await rename(tempFile, SAMPLES_FILE);
}

// 마지막으로 아카이브한 샘플 id(archiveLastId) 이후에 새로 생긴 샘플만 NDJSON으로 덧붙인다.
// decisionSamples는 최신순(newest-first)이므로 워터마크 위치 앞쪽이 새 샘플 → 시간순(오래된 것부터)으로 기록.
// 처음(워터마크 없음)에는 현재 working set 전체를 한 번 기록해 아카이브를 시드한다.
async function appendSampleArchive(state) {
  const learning = state.learning ?? {};
  const samples = Array.isArray(learning.decisionSamples) ? learning.decisionSamples : [];
  if (!samples.length) return;
  const lastId = learning.archiveLastId;
  const index = lastId ? samples.findIndex((sample) => sample.id === lastId) : -1;
  const fresh = index === -1 ? samples.slice() : samples.slice(0, index);
  if (!fresh.length) return;
  const lines = fresh
    .reverse()
    .map((sample) => JSON.stringify(sample))
    .join("\n");
  await appendFile(SAMPLES_ARCHIVE, lines + "\n");
  learning.archiveLastId = samples[0].id;
}

export function updateState(mutator) {
  const operation = updateQueue.then(async () => {
    const state = await loadState();
    const result = await mutator(state);
    await saveState(state);
    return result ?? state;
  });
  updateQueue = operation.catch(() => {});
  return operation;
}

// 트레이더 틱은 시작 시점의 상태로 길게 작업한 뒤 저장하므로, 그 사이 API/자가판단이 바꾼
// 사용자 설정·종목·뉴스·자동화 기록을 덮어쓸 수 있다(lost update).
// 저장을 같은 큐로 직렬화하고, 사용자/다른 경로가 소유하는 영역은 디스크 최신값을 우선해 보존한다.
// 트레이더가 소유하는 필드(포지션, 시세 스냅샷, 체결 이력, 결정 샘플 등)만 트레이더 결과로 반영한다.
const TRADER_OWNED_SETTINGS = ["lastRunAt", "dryRun", "accountSeq"];

export function saveTraderState(traderState) {
  const operation = updateQueue.then(async () => {
    const current = await loadState();
    const merged = {
      ...traderState,
      settings: {
        ...current.settings,
        ...Object.fromEntries(
          TRADER_OWNED_SETTINGS.map((key) => [key, traderState.settings?.[key]]).filter(([, value]) => value !== undefined)
        )
      },
      targets: current.targets,
      news: current.news,
      economicCalendar: current.economicCalendar,
      // earningsEvents도 서버 타이머(earnings.js 12h·종목변경 시)가 소유하는 필드라, 트레이더 틱이
      // 자기 스냅샷으로 되돌리지 않도록 디스크 최신값을 보존한다(news/economicCalendar와 동일 — lost update 방지).
      earningsEvents: current.earningsEvents,
      automation: current.automation,
      learning: {
        ...current.learning,
        decisionSamples: traderState.learning?.decisionSamples ?? current.learning?.decisionSamples ?? [],
        closedCycles: traderState.learning?.closedCycles ?? current.learning?.closedCycles ?? []
      }
    };
    await saveState(merged);
    return merged;
  });
  updateQueue = operation.catch(() => {});
  return operation;
}

function mergeDefaults(state) {
  return {
    ...structuredClone(defaultState),
    ...state,
    settings: { ...defaultState.settings, ...(state.settings ?? {}) },
    health: { ...defaultState.health, ...(state.health ?? {}) },
    targets: mergeTargets(state.targets),
    positions: state.positions ?? {},
    performance: { ...defaultState.performance, ...(state.performance ?? {}) },
    paperSession: state.paperSession ?? null,
    ledgerMode: state.ledgerMode ?? defaultState.ledgerMode,
    ledgerHistory: Array.isArray(state.ledgerHistory) ? state.ledgerHistory : [],
    botBudget: state.botBudget ?? null,
    externalTrackedHoldings: state.externalTrackedHoldings ?? {},
    tradeHistory: state.tradeHistory ?? [],
    orderEvents: state.orderEvents ?? [],
    marketSnapshots: state.marketSnapshots ?? {},
    riskGuard: state.riskGuard ?? null,
    news: state.news ?? [],
    earningsEvents: Array.isArray(state.earningsEvents) ? state.earningsEvents : [],
    automation: { ...defaultState.automation, ...(state.automation ?? {}) },
    learning: {
      ...defaultState.learning,
      ...(state.learning ?? {}),
      decisionSamples: state.learning?.decisionSamples ?? [],
      recommendationEvents: state.learning?.recommendationEvents ?? [],
      closedCycles: state.learning?.closedCycles ?? [],
      reports: state.learning?.reports ?? []
    }
  };
}

async function protectPersistentHistory(nextState) {
  try {
    const raw = await readFile(DB_FILE, "utf8");
    const current = mergeDefaults(JSON.parse(raw));
    if ((nextState.tradeHistory?.length ?? 0) < (current.tradeHistory?.length ?? 0)) {
      nextState.tradeHistory = current.tradeHistory;
    }
    if ((nextState.orderEvents?.length ?? 0) < (current.orderEvents?.length ?? 0)) {
      nextState.orderEvents = current.orderEvents;
    }
    // decisionSamples는 사이드카(decision-samples.json)에서 자체 축소 방지 처리되므로 여기서는 다루지 않는다.
    if ((nextState.learning?.recommendationEvents?.length ?? 0) < (current.learning?.recommendationEvents?.length ?? 0)) {
      nextState.learning.recommendationEvents = current.learning.recommendationEvents;
    }
    // closedCycles는 체결 이력에서 매번 재계산되는 파생 데이터라 길이 보호 대상에서 제외한다.
    // (보호하면 재계산으로 줄어든 결과를 막아 positions와 어긋난 stale 사이클이 남는다.)
  } catch {
    // No prior state to protect.
  }
  return nextState;
}

async function backupCurrentState() {
  // 최소 간격 내 중복 백업은 건너뛴다(매 저장 churn 방지).
  const now = Date.now();
  if (now - lastBackupAt < BACKUP_MIN_INTERVAL_MS) return;
  try {
    const raw = await readFile(DB_FILE, "utf8");
    JSON.parse(raw);
    await mkdir(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
    await copyFile(DB_FILE, path.join(BACKUP_DIR, `state-${stamp}.json`));
    lastBackupAt = now;
    await pruneBackups();
  } catch {
    // If current state is missing or corrupted, skip backup and let recovery use older snapshots.
  }
}

async function loadLatestBackup() {
  try {
    const files = (await readdir(BACKUP_DIR))
      .filter((file) => file.startsWith("state-") && file.endsWith(".json"))
      .sort()
      .reverse();
    for (const file of files) {
      try {
        const raw = await readFile(path.join(BACKUP_DIR, file), "utf8");
        return JSON.parse(raw);
      } catch {
        // Try the next backup.
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function pruneBackups() {
  const files = (await readdir(BACKUP_DIR))
    .filter((file) => file.startsWith("state-") && file.endsWith(".json"))
    .sort()
    .reverse();
  await Promise.all(files.slice(MAX_BACKUPS).map((file) => rm(path.join(BACKUP_DIR, file), { force: true })));
}

function mergeTargets(targets) {
  if (!Array.isArray(targets)) return defaultState.targets;
  return targets.map((target) => {
    const defaultTarget = defaultState.targets.find((item) => item.symbol === target.symbol) ?? {};
    return { ...defaultTarget, ...target };
  });
}
