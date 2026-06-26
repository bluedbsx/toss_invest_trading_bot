# WORKLOG — 작업 기록 (교차 검증용)

이 문서는 AI 에이전트(Codex/Claude)와 사용자의 변경 이력을 시간순으로 남겨, 서로의 판단/수정을 검증하기 위한 것입니다. 규칙은 [`AGENTS.md`](AGENTS.md) 참고.

> 번호 표기: 아래 `#n`은 Claude가 수행한 "전반 코드/전략 검토"에서 매긴 항목 번호입니다(Codex가 매핑하기 쉽게 보존).

---

## 2026-06-25 ~ 2026-06-26 — Claude (Opus 4.8)

### 배경
사용자가 Claude에게 프로젝트 전반(코드/전략) 검토를 요청. Codex 작업과 섞이지 않도록 **클론(`toss_invest_claude`)을 만들어 거기서만 수정·검증**한 뒤, 2026-06-26 본 프로젝트(`toss_invest`)로 코드+데이터를 병합. 클론 git 커밋 해시를 각 항목에 표기.

원본은 git 커밋이 없는 상태였고, 클론 이후 Codex가 원본 소스를 수정하지 않았음을 확인(원본 소스 == 클론 baseline `34b7e13`)한 뒤 병합함.

---

### A. 사용자 최초 요청 5건

**A-1. 클론 생성** — Codex 작업과 충돌 방지를 위해 `toss_invest_claude`로 복제 후 그 안에서만 작업. (clone baseline `34b7e13`)

**A-2. `runAutomationIfDue` 구현** (clone `8e8cfa4`, `server.js`)
- 문제: "봇 자가판단" 패널 UI(안전설정/전체비중/종목전략/개선리포트 자동화 토글 + "지금 자가판단 실행")는 있는데, 서버 함수는 `"automation not implemented"`만 반환하는 빈 껍데기였음.
- 수정: UI 의도대로 구현. 검토 주기(`autoRecommendationIntervalMinutes`, 기본 360분) 게이팅 + `force`(수동 실행) 지원. 전체비중/안전설정은 추천값 계산 후 즉시 적용. **종목전략은 보유 중인 종목이면 적용하지 않고 추천만 보류**(`position.quantity > 1e-6` 판정), 미보유만 적용. 개선리포트 갱신. 결과를 `state.automation`에 기록.
- 검증: mock 모드 서버에서 강제 실행 → 비중/안전설정/리포트 적용 확인(에러 0). 보유 종목 보류 / 미보유 적용 / flag 전부 끄면 skip 동작 모두 확인.
- 가정/주의: autoWeight·autoSafety는 **사용자 확인 없이 자동 적용**됨(자동화 토글의 취지). 안전설정 적용 시에도 `LIVE_TRADING` 환경변수 없으면 실거래 토글은 강제 OFF 유지.

**A-3. dead code 제거** (clone `8e8cfa4`, `src/strategy.js`)
- `nearOptions`/`uniqueNumbers` 함수가 어디서도 호출되지 않음(이전 추천 방식 잔재로 판단) → 제거. `server.js`의 `summarizeStrategyReview`는 실제 사용 중이라 **건드리지 않음**(1차 의심했으나 오판이었음).

**A-4. 종목 카드 "적용 전략" 가독성** (clone `8e8cfa4`, `public/app.js` `renderTargetStrategy`, `public/styles.css`)
- `·`로 한 줄에 다 이어붙인 회색 문단을 **라벨(검증/성과/점수) + 방어 포함/미포함 칩** 구조로 재구성.

**A-5. SOXL 유령 포지션 버그** (clone `8e8cfa4`, `src/trader.js` + `public/app.js`)
- 문제: 매수 0.03271 = 매도(0.014719+0.017991)로 전량 매도했는데 부동소수점 오차로 잔량이 `3.47e-18주` 남아 `quantity > 0` 필터를 통과 → "0주 · $0"로 계속 표시.
- 수정: `POSITION_DUST_EPSILON = 1e-6` 도입. `rebuildLiveBotPortfolio`에서 매도 후 잔량 ≤ epsilon이면 0으로 스냅 + 포지션 필터를 `> epsilon`으로 변경. dry-run(`updatePaperPosition`) 경로도 잔량 dust면 포지션 삭제. 프런트 보유 목록 필터도 epsilon 적용(이중 방어).
- 검증: 실제 거래기록 재구성 시뮬레이션 → SOXL 제거, SNXX(0.221391) 유지 확인. 라이브 봇은 다음 체결 동기화 시 자동 정리(self-heal)됨.

---

### B. 전반 모순/버그 검토 — 적용한 수정

**#1. 영속화 레이스 컨디션** (clone `0258984`, `src/store.js`, `src/trader.js`, `server.js`)
- 문제: 트레이더 틱은 `store.saveState()`를 **직접** 호출(직렬 큐 우회), API/자가판단은 `updateState()` 큐 사용. 긴 트레이더 틱 도중 사용자/자동화가 바꾼 설정·종목을 트레이더가 덮어쓸 수 있음(lost update).
- 수정: `saveTraderState()` 추가 — 같은 `updateQueue`로 직렬화하고, **사용자/다른 경로가 소유한 영역(settings/targets/news/automation + API측 learning)은 디스크 최신값을 보존**, 트레이더는 자기 소유 필드만 반영. 트레이더의 6개 저장 지점을 전부 이걸로 교체.
- 검증: 실서버 스모크에서 틱 도중 바꾼 `allocationUsd`가 트레이더 저장 후에도 보존됨 확인 + 단위테스트 PASS.
- 가정/주의: 트레이더 소유 설정 필드는 `["lastRunAt","dryRun","accountSeq"]`로 한정. 이 목록이 맞는지 Codex 검토 권장.

**#3. 라이브 평가 기본값 불일치** (clone `0258984`, `src/strategy.js` `evaluateTarget`)
- 문제: 라이브는 `takeProfitPct ?? 0`(값 없으면 본전 즉시 익절), 손절/트레일링은 default 없이 `NaN`(방어 무력화). 백테스트는 `?? 8/18/10`로 정상 → 라이브와 백테스트가 어긋남.
- 수정: 라이브도 `stopLoss 8 / takeProfit 18 / partial 10 / trailing 10 / takeProfitRsi 78`로 통일. 익절·1차익절·트레일링은 `0`이면 "끈 것"으로 처리(즉시매도 방지). 사유 문구도 해석된 값으로.
- 검증: 누락/0 케이스 단위테스트 PASS.

**#13. 파생필드 보호 충돌** (clone `0258984`, `src/store.js`)
- `protectPersistentHistory`가 `closedCycles`(체결이력에서 매번 재계산되는 파생값)의 축소를 막아 stale 사이클이 남을 수 있었음 → 보호 대상에서 제외.

**#9. README drift** (clone `0258984`, `README.md`)
- 전략명 `v0`→`v0.8 Dual-Backtest`, 고정 수치 서술→"종목별 조정 가능"으로 동기화.

**#6. RSI/ATR 표준화(Wilder)** (clone `fd86bc1`, `src/indicators.js`)
- 문제: RSI가 마지막 15개만 쓰는 단순평균, ATR도 단순평균 → 토스/트레이딩뷰 표준값과 다름.
- 수정: **Wilder 평활(RMA)** 방식으로 교체(첫 period 단순평균 시작 후 전체 구간 평활).
- 검증: 독립 작성한 Wilder 레퍼런스와 값 일치, 전상승=100/전하락=0 확인.
- **가정/주의(라이브 영향): 라이브 매수/매도 신호 값이 달라진다.** 임계값(minBuyRsi 45 / maxBuyRsi 72 / takeProfitRsi 78)은 그대로 두었으므로, 표준 RSI 기준 재튜닝이 필요할 수 있음. Codex/사용자 검토 권장.

**#4. 백테스트 현실화(수수료/슬리피지)** (clone `fd86bc1`, `src/strategy.js` `runBacktestSimulation`)
- 문제: 전액 올인 + 비용 0의 이상화 백테스트인데 그 점수가 "검증 점수"와 자동 전체비중을 좌우.
- 수정: `BACKTEST_COST_PER_SIDE = 0.001`(한쪽 0.1% ≈ 왕복 0.2%) 비용을 매수 체결가/매도 대금에 반영. `guardCoverage`를 정직하게 갱신(수수료·슬리피지 "포함(추정)"으로, **종목별 비중·레버리지 한도는 "미포함"으로 명시** — 단일종목 백테스트라 포트폴리오 한도는 반영 안 됨).
- **가정/주의: 비용 0.1%/측은 보수적 추정치.** 실제 토스 수수료/체결오차와 다를 수 있음. 점수와 자동비중이 약간 낮아짐. 실제 수수료를 알면 상수 교정 권장.

**#5. 추천 최적화 과적합 완화** (clone `fd86bc1`, `src/strategy.js` `optimizeTargetSettings`/`...Deep`)
- 문제: 수십 개 조합 중 최고 점수 1개 선택 = 검증구간에도 운 좋은 조합을 뽑는 선택편향.
- 수정: ① 점수가 비슷하면(±2점) **학습-검증 격차(gap)가 작은(과적합 적은) 조합**을 고름. ② 최고 조합이 **현재 설정보다 5점(`OPTIMIZE_IMPROVE_MARGIN`) 이상 높을 때만** 변경을 추천, 아니면 현재 설정 유지.
- 검증: 합성 데이터에서 구조/사유 정상, 개선폭 작을 때 "현재 설정 유지" 경로 동작 확인.
- 가정/주의: 마진 5점·tiebreak ±2점은 휴리스틱. 조정 가능.

---

### C. 검토했으나 "그대로 둔" 항목 (Codex가 다시 바꾸기 전에 사유 확인)

- **#2. 종목 자동매매 OFF여도 보유 중이면 자동 매도됨** — 사용자가 **의도한 동작**이라고 확인. (OFF인데 매도까지 막으면 손실이 무한정 커질 수 있으므로, 신규매수는 막되 방어 매도는 유지.) → 변경하지 않음.
- **#15. "정해둔 봇 자금만 사용"이 실현손익을 복리 반영** — 사용자 **의도**. 시작 시드 $100에서 봇이 번 만큼($150 등)으로 매매 규모가 커지는 구조를 일부러 관찰 중. → 변경하지 않음.
- **#11. 리버스 프록시 뒤 인증 우회 가능성** — 로컬에서만 돌릴 예정이라 사용자가 **불필요**하다고 함(Oracle VM 계획 취소). → 변경하지 않음. (외부 노출 시에는 `DASHBOARD_PASSWORD` 필수.)
- **#12. `confirmHighValueOrder: false` 하드코딩** — 재검토 결과 **자동매매에선 false가 정상**(주문이 확인 대기로 막히면 봇이 멈춤). → 변경하지 않음.
- **#7. 카드 점수 기준 차이**(틱 스냅샷=non-robust vs 추천=robust) — 가독성 개편에서 "현재 저장값/추천값 검토" 근거를 구분 표시해 혼동 완화. 점수 산식은 안전상 유지. → 변경하지 않음.
- **#8. "일봉 기준 N% 하락" 라벨** — 실제는 당일 캔들(시가) 대비 intraday move. 표현이 명백히 틀린 건 아니고 문자열 다수 수정 리스크가 있어 보류. → 변경하지 않음(원하면 "당일 시가 대비"로 라벨만 정리 가능).
- **#10. 서버/클라이언트 추천요약 함수 중복** — 동작 정상, 유지보수 부채. 없애려면 PATCH 응답 스키마 변경 필요해 보류. → 변경하지 않음.

---

### D. 데이터 병합 기록 (2026-06-26)

목적: Codex(원본)와 Claude(클론)가 각각 누적한 **기록 데이터를 시간순으로 합침**(덮어쓰기 아님).

- 방법: 각 로그 배열을 **id 합집합 → 타임스탬프 내림차순 정렬 → 앱과 동일한 상한으로 cap**. 공유 id는 원본(라이브 진실) 우선.
- 운영 상태(설정/종목/포지션/성과/봇예산)는 **클론(사용자가 최근 실행하던 현재 버전)을 베이스**로 사용. 포지션은 클론 기준이라 SOXL dust 없이 SNXX만 남음(원본은 dust가 남아 있었음 — 코드 수정으로 다음 동기화 시 자동 정리).
- 결과 카운트(클론 + 원본 → 병합):
  - tradeHistory: 11 + 11 → **11** (완전 동일, 분기 후 신규 실거래 없음 / 전부 LIVE)
  - orderEvents: 100 + 100 → **100** (합집합 116 중 최신 100)
  - decisionSamples: 2000 + 2000 → **2000** (합집합 2114 중 최신 2000, 범위 2026-06-24T01:32 ~ 06-25T23:46)
  - recommendationEvents: 77 + 60 → **73**
  - reports: 23 + 17 → **23**
  - closedCycles: 5 + 5 → **5**
- 저장 포맷: `data/state.json`(slim, 0.51MB) + `data/decision-samples.json`(사이드카, 5.64MB).
- 검증: 새 코드 `loadState()`로 정상 로드(샘플 2000 재부착, 중복 0, 시간순 정렬 확인).
- 병합 전 원본 전체 백업: `/Users/joyanggi/Documents/toss_invest-premerge-20260626-091810.tar.gz` (data/backups 제외).
- 병합된 운영 설정(클론 기준): `monitoring=true, live=true, autoTarget=true, allocationUsd=100`, 종목 비중 `SOXL 60 / MUU 40 / SNXX 0`(클론에서 자동화가 적용한 값). **원본의 직전 값은 SOXL 100 / MUU 0 / SNXX 0, cashBuffer 9, autoTarget false 등이었음** — 필요 시 백업/이 기록으로 복구 가능.

---

### E. 남은 권장 작업 / Codex 검토 요청
1. **Wilder RSI 전환에 맞춰 RSI 임계값 재튜닝**(#6) — 신호가 바뀌었으므로 백테스트로 45/72/78 재점검.
2. **백테스트 비용 상수(0.1%/측) 실제 수수료로 교정**(#4).
3. **사이드카 외 추가 용량 절감 여지** — `recommendationEvents`/`reports`도 커지면 분리 고려.
4. **#1 트레이더 소유 설정 목록**(`lastRunAt/dryRun/accountSeq`) 적정성 재검토.
5. 위 모든 항목은 Claude의 판단이며 **틀릴 수 있음** — Codex가 모순/실수를 발견하면 이 문서에 "검토 의견"으로 남길 것.

### F. 핸드오프 주의
- 병합은 원본(`toss_invest`)에 적용됨. 현재 **클론 봇이 실행 중**일 수 있으므로(같은 토스 계좌 공유), 원본을 실행하기 전 **클론 봇을 반드시 종료**할 것. 동시에 두 인스턴스를 돌리지 말 것.

### G. GitHub 연동 (2026-06-26) — Claude (Opus 4.8)
- 초기 커밋(`89c5d84`)을 private 레포 `https://github.com/Joyanggi/toss_invest_trading_bot.git`(`origin/main`)에 푸시. 원격에 있던 GitHub 자동 생성 stub 커밋은 `--force-with-lease`로 대체.
- 푸시 전 확인: `.env`, `data/`(state.json·decision-samples.json·backups·forensics)는 `.gitignore`로 제외됨 → 원격에 크레덴셜/운영데이터 없음(추적 파일 30개, 전부 소스/문서/템플릿).
- 규칙 추가([`AGENTS.md`](AGENTS.md) §0): **기능 단위 작업 완료 시 Codex·Claude 모두 작성자 명시하여 `origin/main`에 커밋·푸시.** 사용자가 매번 지시하지 않아도 됨.
