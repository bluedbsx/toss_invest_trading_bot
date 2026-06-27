#!/usr/bin/env node
// 장부 초기화 스크립트 — 페이퍼/실거래 장부를 깨끗이 비우고 처음부터 다시 쌓게 한다.
//
// 안전 규칙:
//  - 반드시 봇 서버가 꺼진 상태에서 실행한다(실행 중이면 저장이 충돌하거나 되돌려질 수 있다).
//  - state.json에 직접 쓴다(store.js의 saveState는 tradeHistory 축소를 막는 보호 가드가 있어 초기화가 되돌려짐).
//  - 영구 분석용 아카이브(decision-samples-archive.ndjson)는 절대 지우지 않는다.
//  - 초기화 직전 상태는 data/backups/pre-ledger-reset-<시각>.json 으로 백업한다.
//
// 사용법:  node scripts/reset-ledger.js
import { copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const DATA_DIR = path.resolve(process.env.DATA_DIR || "data");
const STATE_FILE = path.join(DATA_DIR, "state.json");
const SAMPLES_FILE = path.join(DATA_DIR, "decision-samples.json");
const BACKUP_DIR = path.join(DATA_DIR, "backups");

async function main() {
  let raw;
  try {
    raw = await readFile(STATE_FILE, "utf8");
  } catch {
    console.error(`state.json을 찾을 수 없습니다: ${STATE_FILE}`);
    process.exit(1);
  }
  const state = JSON.parse(raw);

  // 1) 초기화 직전 상태 백업
  await mkdir(BACKUP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const backupPath = path.join(BACKUP_DIR, `pre-ledger-reset-${stamp}.json`);
  await copyFile(STATE_FILE, backupPath);

  // 초기화 전 요약(로그용)
  const before = {
    positions: Object.keys(state.positions ?? {}),
    trades: (state.tradeHistory ?? []).length,
    cycles: (state.learning?.closedCycles ?? []).length,
    samples: (state.learning?.decisionSamples ?? []).length,
    equityUsd: state.botBudget?.equityUsd ?? null,
    botStartedAt: state.settings?.botStartedAt ?? null
  };

  const now = new Date().toISOString();

  // 2) 장부 관련 필드 전부 초기화
  state.positions = {};
  state.performance = { realizedPnlUsd: 0, totalBuyAmountUsd: 0, totalSellAmountUsd: 0 };
  state.botBudget = null;
  state.externalTrackedHoldings = {};
  state.tradeHistory = [];
  state.orderEvents = [];
  state.marketSnapshots = {};
  state.riskGuard = null;
  state.equityCurve = [];
  state.paperSession = null;
  state.ledgerMode = "paper";
  state.ledgerHistory = [];
  state.account = null;

  // 학습 working set 초기화(영구 아카이브 NDJSON은 그대로 보존)
  state.learning = state.learning ?? {};
  state.learning.decisionSamples = [];
  state.learning.closedCycles = [];
  state.learning.recommendationEvents = [];
  state.learning.reports = [];
  state.learning.lastReport = null;
  delete state.learning.archiveLastId; // 다음 샘플부터 새로 시드

  // 3) 복구 기준 시각을 지금으로 옮긴다 → 실거래를 켜도 이 시각 이전 토스 주문은 다시 끌어오지 않는다.
  state.settings = state.settings ?? {};
  state.settings.botStartedAt = now;

  // 4) 꺼진 종목의 배정 비중은 0으로 정리(켜진 종목만 시드 비중을 차지)
  for (const target of state.targets ?? []) {
    if (target.enabled === false) target.allocationPct = 0;
  }

  // 5) state.json에 직접 원자적 기록(saveState 보호 가드 우회)
  const tmp = `${STATE_FILE}.reset-tmp-${Date.now()}`;
  await writeFile(tmp, JSON.stringify(state, null, 2));
  await rename(tmp, STATE_FILE);

  // 6) decisionSamples 사이드카도 비운다(아카이브 NDJSON은 보존)
  await writeFile(SAMPLES_FILE, JSON.stringify([]));

  console.log("=== 장부 초기화 완료 ===");
  console.log("백업:", backupPath);
  console.log("초기화 전:", JSON.stringify(before));
  console.log("새 botStartedAt:", now);
  console.log("활성 종목:", (state.targets ?? []).filter((t) => t.enabled !== false).map((t) => `${t.symbol}(${t.allocationPct}%)`).join(", ") || "(없음)");
  console.log("이제 봇 서버를 다시 켜면 페이퍼 모드에서 깨끗한 장부로 처음부터 쌓습니다.");
}

main().catch((error) => {
  console.error("초기화 실패:", error);
  process.exit(1);
});
