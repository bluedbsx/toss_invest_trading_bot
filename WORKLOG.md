# WORKLOG — 작업 기록 (교차 검증용)

이 문서는 AI 에이전트(Codex/Claude)와 사용자의 변경 이력을 시간순으로 남겨, 서로의 판단/수정을 검증하기 위한 것입니다. 규칙은 [`AGENTS.md`](AGENTS.md) 참고.

> 번호 표기: 아래 `#n`은 Claude가 수행한 "전반 코드/전략 검토"에서 매긴 항목 번호입니다(Codex가 매핑하기 쉽게 보존).

### 2026-07-15 — 작성자: Codex (V2 단순 전략 후보 백테스트)
- 문제/목적:
  - 기존 레버리지·종목별 최적화 봇과 분리해, 미국 대형 우량주 유니버스에서 설명 가능한 단순 전략 6개를 같은 체결·비용·포트폴리오 한도로 비교하고 V2 연구 후보를 선별.
- 진단(근거):
  - 무료 공개 자료로 S&P 100의 장기간 일별 편입 이력을 완전하게 복원할 수 없어 현재 구성 종목 스냅샷에는 생존편향이 남음. 따라서 결과를 실전 확정이 아닌 후보 제거용으로 제한함.
  - 2017-05-01~2026-07-13 수정 일봉, 다음 날 시가 체결, 편도 0.1% 비용에서 RSI(2)는 CAGR -2.37%/Profit Factor 0.850, 볼린저는 승률 60.43%지만 검증구간 CAGR -0.91%로 `높은 승률 = 우수한 복리 성과` 가설을 통과하지 못함.
  - EMA20/100은 CAGR 4.89%/MDD 9.18%/PF 1.600, EMA50/200은 CAGR 4.87%/MDD 9.07%/PF 1.779로 인접 장기 주기에서도 안정적. Donchian 100/40은 CAGR 5.89%/MDD 10.98%였지만 다른 Donchian 주기와 격차가 있어 추가 검증 대상으로 분류.
  - 상대 모멘텀은 CAGR 10.64%로 가장 높았으나 장기 이력이 없는 GEV/HONA/PLTR/UBER를 제외하면 8.50%로 하락하고, 검증구간보다 최근 홀드아웃에 수익이 집중돼 생존편향 민감도가 큼.
- 수정 내용:
  - 현재 S&P 100 스냅샷에서 Alphabet 주식 종류 중복을 제거한 연구 유니버스 추가.
  - RSI(2), RSI(14), 볼린저 재진입, EMA 추세, Donchian 돌파, 12-1개월 상대 모멘텀을 공통 위험한도 아래 실행하는 독립 백테스트 도구 추가.
  - 비용 2배, 2017년 이전 이력 요구, EMA 10/50·20/100·50/200 및 Donchian 20/10·55/20·100/40 주기 민감도를 별도 실행하고 원자료 JSON과 연구 보고서 저장.
  - Wilder RSI 일치, Donchian 미래정보 누출 방지, 최대낙폭, 비용 증가 단조성, 핵심/민감도 EMA 결과 일치를 검증하는 자동 검사 추가.
- 건드린 파일/함수:
  - `research/v2-strategy-backtest.mjs`
  - `research/verify-v2-strategy-backtest.mjs`
  - `research/sp100-current-2026-07-15.json`
  - `research/results/*.json`
  - `research/README.md`
  - `package.json`
  - `WORKLOG.md`
- 검증 방법과 결과:
  - 핵심 후보·비용 2배·장기 이력 제한·주기 민감도 총 6회 실행, 요청 101심볼 모두 수집 성공. 기본 유니버스 99종목, 장기 이력 제한 96종목.
  - `pnpm run research:v2:verify` 통과. RSI는 기존 `src/indicators.js`의 Wilder 구현과 일치했고, Donchian은 당일 값을 제외함을 확인.
  - 편도 비용을 0.2%로 올려도 EMA20/100 CAGR 4.17%/MDD 10.10%, EMA50/200 CAGR 4.36%/MDD 9.65%로 양수를 유지.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 기존 서버·Toss 주문·운영 state·라이브 전략은 전혀 변경하지 않았으며 이 결과로 자동매매를 활성화하지 않음.
  - 현재 S&P 100 구성 종목을 과거 전체에 사용한 생존편향, 실적발표 필터·세금·현금 이자 미반영이 남아 있음. 이미 확인한 2024~2026 홀드아웃은 향후 최종 미사용 검증구간으로 재사용하지 말 것.
  - 다음 단계는 시점별 구성 데이터로 재검증하거나 앞으로 누적되는 미사용 데이터로 페이퍼 포워드 테스트하는 것. 현시점 실전 후보는 특정 설정이 아니라 EMA 장기 추세 계열로 한정.

### 2026-07-14 — 작성자: Codex (GitHub About 메타데이터)
- 문제/목적:
  - GitHub 저장소 About 영역의 description과 topics가 비어 있어 프로젝트 목적과 기술적 특징이 검색·포트폴리오 화면에서 드러나지 않았음.
- 진단(근거):
  - `gh repo view` 결과 description은 빈 문자열, repositoryTopics는 `null`, homepage는 빈 문자열이었음.
  - GitHub 실제 visibility는 `PUBLIC`인데 `AGENTS.md`에는 private로 적혀 있어 문서와 외부 상태가 불일치했음.
- 수정 내용:
  - description을 한글 프로젝트 설명 + 영문 핵심 역량(`explainable strategies`, risk controls, backtesting, bot-only ledger, responsive UI)으로 설정.
  - Toss Invest, algorithmic/automated/quant trading, backtesting, risk/portfolio management, paper trading, fintech, Node.js, responsive dashboard 등 20개 topics 추가.
  - 실제 배포 URL이 없으므로 homepage는 비워두고, visibility·Issues·Wiki 등 기존 저장소 설정은 변경하지 않음.
  - `AGENTS.md`의 원격 저장소 표기를 실제 상태인 public으로 정정.
- 건드린 파일/외부 상태:
  - GitHub repository About metadata(description, topics)
  - `AGENTS.md`
  - `WORKLOG.md`
- 검증 방법과 결과:
  - `gh repo view --json description,homepageUrl,repositoryTopics,visibility`로 description, 20 topics, `PUBLIC`, 빈 homepage를 재확인.
  - 전체 Git 이력에서 `tsck_`, `tssk_`, 실 `TOSS_CLIENT_SECRET` 패턴 검색 결과 없음.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 저장소가 public이므로 `.env`, `data/`, 계좌·IP·체결 캡처는 앞으로도 절대 커밋하지 않음.
  - 실제 서비스가 배포되면 About homepage에 인증된 대시보드 URL이 아니라 공개 포트폴리오/문서 URL을 넣는 편이 안전함.

### 2026-07-14 — 작성자: Codex (README 차트 이미지 정정)
- 문제/목적:
  - 사용자 확인 결과 README 스크린샷의 매끈한 합성 캔들이 실제 사이트에서 구현한 일봉 캔들 차트와 다르고, 보유 포지션이 없어 매수가·1차익절·최종익절·손절선도 보이지 않았음.
- 진단(근거):
  - 첫 문서 화면은 계좌정보 보호를 위해 `mockCandles`만 사용했으므로 실제 시장처럼 불규칙한 캔들 모양이 아니었음.
  - mock 보유량이 0이라 `chart.lines`가 `null`이었고, 사용자가 요청해 구현했던 네 개 가격선이 스크린샷에서 빠졌음.
- 수정 내용:
  - 운영 state에서 종목별 최근 60개 일봉 차트 데이터만 읽어 별도 임시 `DATA_DIR`에 복사하고, 계좌·체결·주문·수익·수동보유·IP 정보를 제거한 문서용 상태를 생성.
  - MU에 0.01주의 설명용 합성 포지션을 넣어 매수가·1차익절·최종익절·손절선과 실제 차트 라벨 배치가 보이도록 데스크톱·모바일 이미지를 재촬영.
  - README에 실제 계좌 데이터가 아닌 익명화 dry-run + 합성 포지션임을 명시.
- 건드린 파일/함수:
  - `README.md`
  - `docs/screenshots/dashboard-desktop.jpg`
  - `docs/screenshots/dashboard-mobile.jpg`
  - `WORKLOG.md`
- 검증 방법과 결과:
  - 문서 캡처 서버에서는 `Trader.prototype.start`를 임시로 비활성화해 운영 루프와 주문 경로를 완전히 차단.
  - 데스크톱 1440px: 활성 카드 3개, MU 합성 포지션·네 가격선 표시, 콘솔 error/warn 없음, 가로 overflow 없음.
  - 모바일 390px: MU 카드·가격선 표시, 콘솔 error/warn 없음, 가로 overflow 없음.
  - 실제 계좌 보유·체결·공인 IP가 이미지에 포함되지 않았음을 시각 검수.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 이미지의 캔들 형태는 운영 state에 저장된 실제 일봉이지만 가격 시점과 합성 보유 포지션은 제품 기능 설명용이며 투자 성과 증빙이 아님.
  - 이번 변경은 문서와 이미지에만 해당하며 실거래 엔진·운영 state는 변경하지 않음.

### 2026-07-14 — 작성자: Codex
- 문제/목적:
  - 원격 저장소가 최신인지 확인하고, 실제 서비스 화면·아키텍처·사용자의 문제 해결 과정을 GitHub README와 이력서용 문서로 정리.
- 진단(근거):
  - `git fetch origin main` 후 `HEAD...origin/main`이 `0 0`, 작업 트리가 깨끗해 로컬 `main`이 원격 최신 코드와 일치함을 확인.
  - 기존 README는 기능 설명은 있었지만 화면, 시스템 구조, 장부·동시성·점수 개선 같은 핵심 문제 해결 과정과 포트폴리오용 서사가 부족했음.
  - Oracle 배포 문서가 상태 백업을 "매 저장"으로 설명해 현재 10분 throttle 및 decision sample sidecar 구조와 어긋났음.
- 수정 내용:
  - 모의 Toss API, 별도 임시 `DATA_DIR`, `LIVE_TRADING=false`로 문서 전용 서버를 띄워 실제 계좌/IP를 노출하지 않는 데스크톱·모바일 스크린샷 생성.
  - 문서 화면 검수 중 `mockCandles`가 요청 개수에 비례해 마지막 가격까지 계속 상승해 mock 현재가와 불일치하고 차트 끝에 가짜 급락을 만들던 문제를 발견. 시작·종료 비율 기반 추세와 마지막 파동 보정으로 캔들이 항상 mock 현재가에서 끝나게 수정(실거래 경로 영향 없음).
  - README를 제품 목적, 화면, 기능, 아키텍처, 전략 검증, 장부, 안전한 실행·배포, 코드 구조 중심으로 전면 재작성.
  - `docs/portfolio-case-study.md`를 추가해 요구사항 진화, 실계좌에서 발견한 문제, 기술적 해결, 이력서 문장, 면접 포인트, 한계를 정리.
  - Oracle 배포 문서의 백업 주기와 decision sample 저장 구조를 현재 코드에 맞게 수정.
- 건드린 파일/함수:
  - `README.md`
  - `docs/portfolio-case-study.md`
  - `docs/screenshots/dashboard-desktop.jpg`
  - `docs/screenshots/dashboard-mobile.jpg`
  - `deploy/oracle/README.md`
  - `src/tossClient.js` (`mockCandles`)
  - `WORKLOG.md`
- 검증 방법과 결과:
  - 문서용 서버는 실 Toss 키 없이 mock 모드로 실행하고 `POST /api/run-once` 200 확인.
  - mock 캔들 80·260개 모두 마지막 종가가 각 심볼의 mock 현재가와 일치함을 확인.
  - 브라우저에서 데스크톱 1440px, 모바일 390px 렌더를 확인: 종목 카드 3개, 가로 overflow 없음, 콘솔 error/warn 없음.
  - 스크린샷에 실제 계좌 데이터와 공인 IP가 포함되지 않도록 재검증.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 스크린샷의 가격·점수·비중은 문서용 합성 데이터이며 실제 전략 성과가 아님.
  - 포트폴리오 문서는 수익 보장을 주장하지 않고 운영·회계·검증 문제 해결을 중심으로 작성함.

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

---

## 2026-06-26 (본 프로젝트 직접 작업) — Claude (Opus 4.8)

### H. 이른 새벽(KST) 정규장 오판 버그 — 매수 차단 (`src/trader.js` `isUsRegularMarketOpen`)
- 증상: 6/26 02:01~04:28 KST에 MUU·SOXL이 매수조건 충족인데 "소수점 거래 ON이라 정규장만 거래"로 HOLD(`isRegularMarket=false`). 그 시각은 ET 13:01~15:28로 **미국 정규장이 열려 있었음**(6월 EDT 정규장 = 22:30~05:00 KST).
- 진단: `health.lastError=null`(조회 실패 아님). 원인은 토스 캘린더 `result.today.regularMarket`의 "오늘"이 **한국 날짜 기준**이라, KST 00:00~05:00에는 아직 시작 안 한 "오늘(KST) 세션"(예: 당일 22:30 KST 시작)을 반환 → `now < startTime` → 닫힘으로 오판. 실제로는 전날 KST 22:30에 시작한 세션이 진행 중이었음. (22:43 KST 매수는 정상 체결됐는데 00:00 이후로 막힌 패턴이 이를 뒷받침.)
- 수정: `isUsRegularMarketOpen(calendar, now)`을 계층화. ① 캘린더 세션이 now를 포함하면 신뢰. ② **세션이 미래(`now < start`)면 KST 날짜 경계 가능성 → 시간 기반(ET 09:30~16:00 평일) 보정.** ③ 세션 종료 후면 false. ④ 캘린더 없음(조회 실패)이면 시간 기반 폴백(일시적 실패로 장을 닫힘 처리하지 않음). ⑤ 캘린더가 명시적으로 세션 없음(휴장)이면 false 신뢰. `isWithinRegularHoursET`는 `America/New_York` 기준이라 EDT/EST 자동 처리.
- 검증: 단위테스트 10케이스 PASS(버그 케이스, 폴백, 휴장, 주말, 프리마켓, 종료 후 등).
- 영향: KST 새벽 미국 정규장 시간대에 소수점 매수가 정상 실행됨(이전엔 놓침). 휴장일은 캘린더가 세션 없음으로 주면 그대로 차단; 캘린더 조회 실패+휴장이 겹치면 시간 기반이 열림으로 볼 수 있으나, 그 경우 거래소가 주문을 거절하므로 체결되진 않음.
- **재시작 필요**: 실행 중인 봇은 다음 재시작 때 이 수정을 반영함.

### I. UI: busy 버튼 라벨 세로 깨짐 수정 (`public/styles.css`)
- 증상(사용자 제보 스크린샷): 좁은 화면/처리 중 상태에서 아이콘 버튼(↻, API)이 "요청 중" 텍스트를 세로로("요/청/중") 줄바꿈해 깨져 보임.
- 원인: `.icon-button { width: 38px }` 고정폭인데 busy 상태에서 `setButtonBusy`가 "요청 중" 텍스트를 넣어 한글이 글자 단위로 세로 줄바꿈됨.
- 수정: `button { white-space: nowrap }`(버튼 라벨 줄바꿈 금지) + `.icon-button.is-busy { width: auto; padding: 0 12px }`(busy 시 가로로 펼침).
- 검증: 실제 화면(localhost:3000)을 데스크탑/모바일(390px)로 조회 후, busy 상태를 DOM으로 시뮬레이션해 "🔄 요청 중"이 가로 한 줄(93×38px)로 렌더됨을 스크린샷으로 확인.
- 그 외 UI: 데스크탑·모바일 레이아웃을 직접 점검한 결과 정렬·가독성 양호(이전에 개편한 "적용 전략" 칩 포함). 남은 선택 개선거리: ① 모바일 sticky 헤더가 화면을 많이 차지, ② 포지션 가격선이 좁은 가격대에 몰릴 때 차트(캔버스) 라벨이 겹침 — 둘 다 위험 대비 가치가 낮아 보류(요청 시 진행).

### J. 기능 전수 점검 (#4) — 코드 변경 없음(검증)
- mock 모드 + 임시데이터로 API 22개 전수 호출: 전부 200 OK, 서버 예외 0.
- 프런트엔드: 데스크탑/모바일 렌더 정상, 콘솔 에러 0.
- 핵심 전략 로직은 앞서 단위테스트 완료(평가 기본값/dust/정규장/백테스트/최적화). 발견된 실제 기능 버그는 정규장 오판(§H)뿐이며 이미 수정.
- 라이브 전용 경로(주문 체결, 토스 주문내역 복구/대조)는 라이브에서만 동작해 mock으로 미검증이나 이번 변경과 무관(정규장 함수만 §H에서 단위테스트).

### K. 매매기준 업데이트 판단 (#5) — 코드 변경 없음(근거 기반 "유지")
- 방법: 각 종목 현재 설정을 실데이터(Yahoo 5년 일봉)로 `robustBacktestTarget`, 그리고 과적합 가드 적용된 `optimizeTargetSettings`와 비교.
- 결과:
  - SOXL(3x): 현재 77/100 = 최적화 77 → 유지 권장(개선폭 5점 미만).
  - MUU(2x): 현재 62/100 = 최적화 62 → 유지 권장.
  - SNXX(2x): 일봉 104개로 데이터 부족 → 최적화 불가(null). 이미 비중 0%로 강등되어 신규 배정 안 됨(올바름).
- 판단: **매매기준 변경 근거 없음 → 현행 유지.** 라이브 임계값을 근거 없이 변경하지 않음.
- 부수 확인: 이 백테스트는 새 Wilder RSI(§G의 #6)로 수행됨 → 현재 RSI 임계값(45~72/과열 78)이 표준 RSI에서도 건강 → 이전 "RSI 재튜닝 필요" 우려 해소.
- 관찰(자동 변경 안 함, Codex/사용자 판단용): 백테스트상 장중 급락 가드(`intradayDropBlockPct`/`intradayPanicExitPct`)가 수익률을 크게 낮춤(레버리지 반등 놓침) 대신 낙폭 감소 — 위험/수익 트레이드오프. 더 공격적으로 운용하려면 이 두 값을 키우는(=덜 민감하게) 선택지가 있음.

### L. UI: 단계 헤더 정렬 통일 (`public/styles.css`)
- 증상(사용자 제보): "1단계 자동투자 대상"과 "2단계 자동투자 켜기"의 좌측 정렬이 다름.
- 진단: 브라우저로 모든 블록 헤더의 좌측 x 측정 → 패널 헤더는 전부 inset 17px인데 `.section-heading`("1단계")만 inset 2px(유일한 불일치).
- 수정: `.section-heading` 좌우 패딩 2px→16px로 패널 헤더와 정렬 일치. 재측정으로 1단계 x=52, 2단계 x=53(정렬됨) 확인.

### M. 백엔드: 결정 샘플 보관량 ↑ + 백업 churn ↓ (`src/learning.js`, `src/store.js`)
- 결정 샘플이 2000 고정이던 이유: `MAX_DECISION_SAMPLES=2000` 하드캡. 시간당 ~54개 생성 → 약 37시간마다 한 바퀴 돌아 오래된 게 버려짐.
- 수정1: 사이드카(`data/decision-samples.json`, state.json/백업 제외)라 보관 비용이 낮으므로 캡 2000→**5000**(약 4일치)로 상향 — 엔진 다음 버전 개발용 이력 확보.
- 수정2: `backupCurrentState`가 **매 저장(≈15초 틱)** 백업을 만들어 80개가 ~100분치만 커버하고 파일 생성/삭제 churn이 컸음 → **최소 10분 간격**으로 묶음(`BACKUP_MIN_INTERVAL_MS`). 같은 80개로 ~13시간 커버, I/O 대폭 감소.
- 검증: 연속 5회 저장→백업 1개(throttle 동작), 5200개 push→캡 5000 단위테스트 PASS.

### N. 엔진 v0.8 → v0.9 (`src/strategy.js`)
- 배경: 사용자가 누적 데이터로 엔진 다음 버전 요청. **실거래 왕복 5건은 재학습엔 여전히 부족**(시스템 자체 기준 ≥5 사이클·≥20 체결 미만)하여 실데이터 재학습은 하지 않음. 대신 ① 그간의 정합성/품질 개선을 v0.9로 반영하고 ② 백테스트로 검증된 1건의 논리 개선만 적용.
- 분석(5년 일봉, 3종목): 장중 급락 가드(guarded) vs 무가드(alpha) 비교 → **가드가 수익률을 크게 깎는데 낙폭 개선은 거의 없음**(SOXL 535%↔1008% 낙폭 동일 36.8%, SNXX는 가드가 낙폭을 오히려 키움). "추세확인 가드"는 무가드와 동일 결과 → 즉 가드의 유일한 효과는 *추세가 살아있는 건강한 눌림목까지 매수차단/매도*하는 것(추세이탈·손절·트레일링이 진짜 하락은 이미 방어).
- 변경:
  1) **장중 급락 매수차단(drop-block)을 추세확인으로 완화** — `dailyDropBlock`에 `(가격<단기선)` 조건 추가(라이브 `evaluateTarget` + 백테스트 `runBacktestSimulation` 동일). 하락추세 진입은 매수조건이 이미 막으므로 사실상 "건강한 눌림목 매수 허용".
  2) **패닉 매도(보유분 방어)는 그대로 유지** — 일봉 백테스트가 진짜 장중 급락을 못 보므로 다운사이드 보호는 보수적으로 둠.
  3) 이미 반영된 개선(표준 Wilder RSI/ATR, 수수료·과적합 백테스트, KST 정규장 정상화, dust 처리)을 엔진명/요약에 명시.
- 검증(v0.9 backtestTarget): SOXL 535→577%, MUU 422→979%(승률 67→72%), SNXX 83→168%(낙폭 32.6→26.8%) — 전 종목 수익·승률 개선, 위험조정도 개선. 전 엔드포인트 스모크 200 OK, 엔진명 "v0.9" 노출 확인.
- 주의: 엔진명이 바뀌어 기존 저장된 추천/검토는 일시적으로 "재계산 필요"로 표시됨(자가판단 자동화가 360분 주기에 갱신). **라이브 봇은 재시작해야 v0.9 반영.**
- 향후(데이터 누적 후): 패닉 매도 가드의 실효성은 라이브 장중 데이터로만 검증 가능 — 실거래·사이클이 더 쌓이면 재평가 권장.

### O. UI/UX 자가판단 노트 구조화 + 장중 급락 문구 정확화 (#3, #5) (`public/app.js`, `public/index.html`)
- #3: "봇 자가판단" 최근 기록(`#automationNote`)이 액션들을 공백으로만 이어붙여 한 덩어리였음 → 액션별 `· ` 줄바꿈으로 구조화(브라우저 확인 7줄). 토스트(`showProgress`)도 `· ` 구분.
- #5: v0.9에서 매수차단을 "추세 이탈 시에만"으로 바꿨는데 설정 문구는 옛 동작을 설명해 사실과 달랐음 → "당일 급락 매수대기" 설명을 "당일 시가 대비 N% 하락 + 단기 추세선 이탈이 겹칠 때만, 추세가 살아있는 눌림목은 매수"로 정정. "일봉 급락"→"당일 급락"(실제 당일 시가 대비 장중 변동이라 모호함 해소), "매도경고"→"방어매도".

### P. 결정 샘플 영구 아카이브 (#1) (`src/store.js`)
- 문제(사용자 지적): 결정 샘플이 롤링 캡(5000)이라 오래된 건 삭제 → 엔진 개발에 데이터 일부만 사용, 깊이 부족.
- 수정: working set(`decision-samples.json`, 5000)은 그대로 두고, **모든 샘플을 손실 없이 append-only NDJSON 아카이브**(`data/decision-samples-archive.ndjson`)에 영구 보관. 워터마크(`learning.archiveLastId`)로 매 저장 시 새 샘플만 추가(샘플 무변경 저장은 건너뜀, append라 I/O 저렴). 봇은 이 파일을 읽지 않으며(working set만 사용) 오프라인 분석/엔진 학습용. data/ 하위라 git/백업 제외.
- 검증: 시드/신규 append/무변경 유지/시간순/유효 JSON/워터마크 영속 단위테스트 PASS.
- 비고: 연 ~1.4GB 수준 증가 가능 — 필요 시 월별 분할/압축 권장(코드에 주석으로 표기). 이제 깊이 있는 이력이 쌓이면 향후 엔진(v1.0+) 재학습에 활용 가능.

### Q. 추천 로직 검토 + 안전설정 점수 가드 (#4) (`server.js`)
- 검토 결과: 안전설정/전체비중(`scoreTargetWeight`)/종목값(`optimizeTargetSettings`) **세 로직 모두 버그 없는 합리적 휴리스틱**. 셋 다 백테스트 점수를 입력으로 쓰므로 **v0.9 개선(비용 반영·과적합 억제·drop-block 완화)이 자동 전파**됨.
- 개선(적용): `recommendSafetySettings`가 `lastStrategyReview.score`를 쓸 때 **엔진 버전 체크가 없어** 버전 승급 후 옛 점수를 사용하던 문제 → 현재 엔진 리뷰만 신뢰하고 아니면 현재 스냅샷 백테스트로 폴백(전환기엔 더 보수적인 안전값 = 안전).
- 의도적으로 하지 않은 것(라이브 자동적용 경로라 위험): 가중치 산식/안전식의 구조적 재설계. 종목 3개가 모두 반도체 레버리지로 **상관관계가 높아** 단일종목 백테스트 기반 가중치는 진짜 분산효과가 제한적이지만, 포트폴리오(상관) 백테스트 프레임이 없어 근거 기반 변경 불가 → 보류.
- **Codex/사용자 판단 필요(수익/손실 레버)**: ① **당일 손실 force-sell 한도**가 $100 시드에서 사실상 ~5%인데(`maxDailyLossPct` + $5 noise floor), 3x ETF는 5% 일중 변동이 흔해 노출이 커지면 정상 변동에도 강제청산될 수 있음. ② 패닉 매도(§N)와 함께 *위험을 줄이지만 수익을 깎는* 서킷브레이커류 — 더 공격적 운용을 원하면 `maxDailyLossPct`/`intradayPanicExitPct`를 키우는 선택지. 둘 다 사용자 위험성향·실거래 데이터로 결정할 사안이라 자동 변경하지 않음.

### R. 유령 매도 실현손익 버그 — 봇 자산 +$24 과대계상 수정 (`src/trader.js` `rebuildLiveBotPortfolio`)
- 문제/목적: 봇 자산이 $114.24(+14%)로 표시됐으나, 실제 봇 전략 성과를 검증하니 **유령 거래로 부풀려진 값**이었음. 시드 추가(실제 돈) 결정의 전제라 정확화 필요.
- 진단(근거): `MUU 2026-06-24T13:41 MANUAL_SELL`(토스 직접 매도 복구분)이 실현 **+$24.11**로 잡혀 있었음. 그러나 MUU는 매수 합계 0.0409주인데 매도 합계 0.068주로 **0.0272주(=이 매뉴얼 매도 수량)를 보유한 적 없이 매도**. `rebuildLiveBotPortfolio`가 체결을 시간순 재생할 때 이 매도 시점엔 MUU 보유가 0이라 `costBasis=0` → 대금 전액이 실현이익이 됨. 독립 계산인 `closedCycles`(매수 lot 매칭)는 이 건을 매칭 못 해 제외 → 봇 전략 순손익 **−$10.46**으로 일관(교차검증). 즉 봇은 실제로 **−10% 손실 중**이고 +14%는 착시. (사용자 확인: 과거 dust 유령 *표시* 버그를 클론 `8e8cfa4`에서 수량/필터로 고쳤으나 손익 계산은 미수정 상태였음 — 이번이 그 손익 쪽.)
- 수정 내용: SELL 처리에서 **매도를 봇 장부 보유수량까지만 인정**(`effectiveQuantity = min(quantity, heldQuantity)`). 보유 초과분(유령)은 대금·실현·포지션 어디에도 반영하지 않고 `trade.unmatchedSellQuantity`로 표시. 보유분 내 정상 매도는 동작 불변.
- 건드린 파일/함수: `src/trader.js` `rebuildLiveBotPortfolio`(+ 테스트용 `export`).
- 검증 방법과 결과: 단위테스트 10건 PASS — ① 실데이터 회귀(실현 −10.46, MUU 0 종료, SNXX 유지, 유령 매도 realized=0, totalSell $85.14→$61.03, equity $114.24→$90.13) ② 정상 왕복 불변(+20) ③ 부분 유령(보유 1·매도 3 → 보유분만 +5, 대금 비례).
- 가정/주의(교차검증 요청):
  - **라이브 반영은 재시작 필요** — 실행 중 봇은 다음 `syncExecutedBotOrders`(재시작/체결동기화) 때 포지션·성과를 새 로직으로 재계산해 equity가 ~$90로 self-heal됨. equity는 `capitalBaseUsd`(매수 사이징 기준)라 봇 주문 규모가 그만큼 보수화됨(올바름).
  - **사용자 토스 확인 권장**: 06-24 MUU 매뉴얼 매도가 실제 무엇이었는지(봇이 산 적 없는 별도 보유분인지, 타임스탬프 역전인지) 토스 거래내역으로 최종 확인 필요. 어느 경우든 +$24 유령 이익은 부정확하므로 제외가 안전.
  - closedCycles는 이미 이 건을 제외하고 있어 별도 변경 없음.

### S. 검증 시스템 — 벤치마크 + 지표 + 증액 게이트 (`src/validation.js`, `server.js`, `src/trader.js`, `public/*`)
- 문제/목적: 사용자가 "실제로 돈을 불리며 시드를 계속 추가" 하길 원함. 그러려면 "봇이 단순 보유를 이기는가 / 시드를 더 넣어도 되는가"를 데이터로 판단할 잣대가 필요한데 없었음(승률만 표시).
- 구현(매매 로직 불변, 측정·표시 전용):
  1) **벤치마크** — 시드 투입(초기 + 일회성 추가)을 현금흐름으로 보고, "같은 돈을 그 시점에 SOXL 매수·보유했다면"의 현재 가치 vs 봇 자산. `buildCapitalFlows`가 `botStartedAt` 초기 시드 + `budget-add` 추천이벤트로 흐름 복원.
  2) **지표** — 승률·손익비(profit factor)·MDD·벤치 대비 초과수익. 손익비/승률은 `closedCycles`(FIFO 매칭) 우선 사용(유령 매도 제외돼 정확).
  3) **증액 게이트** — 왕복 사이클 ≥5 + 체결 ≥20 + 벤치 초과를 투명한 체크리스트로 판정(자동 변경 없음, 사용자 판단 보조). 기준은 `buildNextActions`(learning.js)와 일치시켜 교차검증.
  - 일별 자산 스냅샷(`recordEquitySnapshot`)을 트레이더 틱에서 `state.equityCurve`(최상위)에 하루 1개 적립(외부 호출 없음). MDD 계산용. `state.performance`는 rebuild/paper가 통째 교체하므로 최상위에 둠.
  - `/api/state`가 `computeValidation`(SOXL 캔들 30분 캐시 + 30초 결과 캐시)로 validation 블록 첨부. UI에 "검증 · 시드 증액 판단" 패널 추가.
- 건드린 파일/함수: 신규 `src/validation.js`; `server.js`(import, `computeValidation`, /api/state 첨부); `src/trader.js`(`recordEquitySnapshot` 호출); `public/index.html`(패널), `public/app.js`(`renderValidation`).
- 검증 방법과 결과: 검증모듈 단위테스트(자산곡선/MDD/지속성 4건 PASS) + 격리 mock 인스턴스(포트 3999, 크레덴셜 없음, 임시 DATA_DIR — 실계좌·실봇 무관) 종단 스모크: /api/state에 validation 첨부, 패널 렌더 확인. **§R 수정 적용(재시작) 후 실측: 봇 −9.9%($90.13) vs SOXL 보유 −11.2% → 초과 +1.35%p, 승률 40%·손익비 0.05, 게이트 = 보류(체결 11/20).**
- 가정/주의(교차검증 요청):
  - 벤치마크는 사용자가 지정한 **SOXL 단순보유** 1종(대표 3x). 비중가중 바스켓은 추후 옵션(`BENCHMARK_SYMBOL`).
  - **현 데이터 기준 결론: 시드 증액 보류.** 봇은 −10%로 단순보유를 겨우 이긴 수준이고 손익비 0.05(질 때 크게, 이길 때 조금)라 아직 알파 미증명. 표본(체결 20·사이클 5)과 벤치 초과가 쌓일 때 트랜치 증액 권장.
  - 게이트는 자동으로 아무것도 바꾸지 않음. equityCurve는 지금부터 적립 시작이라 MDD는 시간이 지나야 의미 생김.

### T. 추천 점수(scoreBacktest) 위험조정으로 개선 — 추천 과대낙관 제거 (`src/strategy.js`)
- 문제/목적: 사용자가 안전설정·전체비중·종목추천 로직을 재검토하고 "고수익·저손해" 목표로 개선 요청. 셋 다 `scoreBacktest`를 입력으로 쓰는데, 이 점수가 `수익률*0.38`로 수익에 지배돼 **고수익 레버리지 백테스트가 전부 100점으로 포화**(SOXL/MUU/SNXX 모두 100) → 낙폭(위험)을 구분 못 하고 추천을 과대낙관으로 만듦. 포화 100점은 안전설정에서 `weightedScore>=85` 조건을 충족시켜 maxPositionPct를 60으로, 레버리지 한도를 135로 **공격적으로 푸는** 부작용까지 있었음.
- 진단(근거): 5년 백테스트로 현재 점수 확인 — 수익 168%(SNXX)든 1283%(SOXL)든 130% 넘으면 `+수익*0.38`가 +49 이상이라 전부 상한 100에 붙음. 낙폭 37%여도 구분 불가.
- 수정 내용: 점수를 **위험조정·비포화**로 교체. `calmar = 수익/낙폭`을 `45*tanh(calmar/12)`로 압축해 쓰고, 낙폭은 별도 패널티(>22/30/40/50%), 승률·표본·데이터 패널티 유지. 엔진 행동(매수/매도)은 불변 — 점수 산식만.
- 건드린 파일/함수: `src/strategy.js` `scoreBacktest`.
- 검증 방법과 결과(5년 백테스트, 라이브 가드값):
  - 점수: SOXL 100→**80**, MUU 100→**85**, SNXX 64→**42**(robust 적용 시 66/71/39). 포화 해소 + 데이터 부족 종목 정확 강등.
  - 안전설정 weightedScore ≈ 100→**64** → maxPositionPct **45로 보수 유지**(옛 60 공격 제거), 레버리지 한도도 보수.
  - 전체비중: 위험조정 점수가 높은 MUU로 비중 이동(예 SOXL 27 / MUU 73 / SNXX 0). **주의: 집중↑** — 단, 실행 시 `maxPositionPct`(45%)가 종목당 노출을 캡하므로 73% "선호"가 그대로 체결되진 않음.
  - 최적화: 레버리지에 맞게 **더 넓은 손절/트레일**(SOXL 손절 15·트레일 20, MUU 13.4·19) 선호 → 잦은 휩쏘 손절 회피(전략 리뷰 §U와 일치).
- 가정/주의(교차검증 요청):
  - **근본 한계(자동 변경 불가, 사용자 인지 필요)**: 이 백테스트들은 5년 반도체 *상승장* 단일 레짐이라 점수가 구조적으로 낙관적. 점수식 개선은 위험 구분을 살릴 뿐 레짐 편향은 못 고침. 레짐이 바뀌면 실제 성과는 점수보다 훨씬 나쁠 수 있음.
  - **집중·상관 미반영(기존 한계 유지)**: 3종목 모두 반도체 레버리지라 비중 분산의 실효 분산효과가 작음. 포트폴리오(상관) 백테스트 프레임이 없어 비중식에 집중 패널티를 못 넣음 — `maxPositionPct` 캡으로만 방어.
  - tanh/계수(12, 45)는 휴리스틱. 엔진명은 안 바꿔서 기존 저장된 리뷰 점수는 다음 재계산(자가판단 360분) 때 새 점수로 갱신됨(그 전까지 일시 혼재 가능).

### U. 전체 전략 재검토 (코드 변경 없음 — 분석·권고) + 봇 일시정지
- 맥락: 봇이 실거래 −10.85%(§R 보정 후 self-heal 확인, equity $89.15). 사용자 요청으로 봇 monitoring OFF(일시정지)하고 전략 전수 재검토.
- 왜 잃었나(실거래 5사이클 근거):
  1) **레버리지 갭에 손절이 뚫림** — 실제 청산 SNXX −26%, MUU −21%인데 명목 손절은 8~10%. 2~3x 일일리셋 ETF는 일중/갭 급락이 빨라 일봉 전략이 손절선 근처에서 못 빠져나옴. 손절 %는 희망사항, 실손실은 2~3배.
  2) **평균회귀 상품에 모멘텀 진입 → 휩쏘** — SMA교차+모멘텀+RSI로 매수하면 변동성 큰 레버리지 ETF의 국지 고점 근처에서 사고 추세가 꺾여 손실 청산(5중 4사이클 손실).
  3) **집중·상관** — 3종목 모두 반도체 레버리지(상관 높음). 비중 분산의 실효 분산효과 작음. 반도체 조정 시 동시 타격.
  4) **백테스트 레짐 편향** — 추천을 떠받치는 5년 백테스트가 반도체 상승 단일 레짐. 라이브(조정 구간)와 정반대. §T 점수개선이 위험구분은 살렸으나 레짐편향은 못 고침.
- 권고(전략 레벨 — 라이브 자동적용 위험이라 사용자 결정용, 자동 변경 안 함):
  - **상품 선택이 최대 레버**: 2~3x 레버리지 단일종목/섹터 ETF는 이 전략으로 수익내기 매우 어려움. (a) 덜 극단적 상품(1x 또는 광범위 지수, 미니 사이즈) 전환, 또는 (b) 고변동 수용하되 매우 소액.
  - **넓은 손절 + 작은 사이즈** — §T 최적화도 같은 방향(휩쏘 회피). 3x에 타이트 손절은 휩쏘 손실 확정.
  - **시드 증액 보류 + 페이퍼(dry-run)로 사이클 축적** — 게이트 통과(체결≥20·벤치초과) 전까지 실돈 위험 없이 검증. 사용자가 원한 "검증 후 확대" 경로.
  - **패닉/당일손실 가드는 유지·강화 쪽** — 라이브 꼬리손실 증거상 이 상품엔 다운사이드 보호가 더 필요(일봉 백테스트가 못 보는 위험). §N "완화" 결론과 상충하는 라이브 근거.
- 결론: 현 전략·상품 조합은 알파 미증명(−10%, 손익비 0.05). 멈춘 상태 유지 + 상품/사이즈 재설계 + 페이퍼 검증을 권고. 실거래 재개·시드 증액은 게이트 통과 후.

### V. 상품/사이즈 재설계 적용 — 레버리지 제거(1x 반도체) + 페이퍼 모드 (`src/store.js` 기본값 + 라이브 state)
- 맥락: 사용자가 §U 권고 "전부 적용" 지시. 무엇을 거래할지는 투자 결정이라 후보 1x 상품 백테스트 근거 제시 후 사용자가 **SOXX+SMH(1x 반도체)** 선택.
- 백테스트 근거(5년, §T 위험조정 점수, optimizeTargetSettings): SOXX **167%/낙폭13.6%/61점**(최고 위험조정), SMH 154%/29%/68. QQQ 15%·SPY −7%(광범위 지수는 이 모멘텀 전략에 부적합). SOXL 3x 579%지만 낙폭 34%+갭위험.
- 적용 내용(라이브 state, API 경유):
  - **상품 교체**: SOXX(60%)·SMH(40%) 추가(최적화 파라미터: 50/120선·모멘텀10·RSI38~66, SOXX 손8/익18/트10, SMH 손8.4/익21.4/트12.2). 레버리지 3종(SOXL/MUU/SNXX) **비활성**(삭제 아님 — SNXX 실보유 추적 보존).
  - **사이즈 축소**: maxPositionPct 40→**35**.
  - **페이퍼 모드**: `liveTradingEnabled=false` → dryRun, 실주문 차단. monitoring ON → 페이퍼 매매로 사이클 축적.
  - **가드 유지**: maxDailyLossPct/intradayDropBlock/Panic 그대로(1x라 오발동도 줄어 더 적합).
  - 기본값 영구화: `src/store.js` defaultState.targets를 SOXX/SMH로, maxPositionPct 기본 35로.
- 검증: 강제 틱(run-once) → **토스가 SOXX(609.90)·SMH(621.12) 가격 정상 수신**(거래 지원 확인), health.lastError=null. dryRun=true, 양 종목 action HOLD(현 조건 미충족).
- 가정/주의(교차검증·사용자):
  - **실 SNXX 보유 $10**가 계좌에 남음 — dry-run이라 봇은 안 건드림. 깨끗한 페이퍼 검증 원하면 사용자가 토스에서 수동 청산 권장.
  - **회계 혼재 주의**: dry-run인데 과거 실거래 이력이 있어, `rebuildLiveBotPortfolio`(실거래 기준 재계산)와 `updatePaperPosition`(페이퍼 가산)이 섞여 검증패널 equity가 노이즈. **새 전략 성과는 tradeHistory의 dryRun 거래로 판단**하는 게 정확. 완전 클린 검증은 별도 DATA_DIR 페이퍼 인스턴스가 이상적(미적용).
  - **실거래 재개 경로**: 페이퍼로 게이트 통과(체결≥20·벤치초과) 확인 후 `liveTradingEnabled` ON. 그 전엔 실주문 안 나감.
  - SOXX·SMH는 상관 매우 높음(둘 다 1x 반도체) — 분산효과 제한, maxPositionPct로만 집중 방어.

### W. 비중 추천 UX 정합성 — 비활성 종목 0 + 종목추천에서 비중 분리 (`server.js`, `src/strategy.js`, `public/app.js`)
- 문제/목적(사용자 제보): ① 전체비중 추천이 **활성 종목만** 갱신해, 비활성 종목(SOXL 60·MUU 40·SNXX 16.8)이 옛 비중을 들고 있어 **비중 합계가 100을 초과해 보임**(마치 적용 안 된 것처럼). ② SOXX 카드에 "비중 49.9% → 60%"처럼 **종목별 추천(60)과 전체비중 추천(~50)이 충돌**.
- 진단: 적용은 정상 작동(SOXX 70→적용→50.9 재현 확인). 원인은 (a) 비활성 종목 비중이 0으로 안 떨어짐, (b) 종목별 추천이 비중(allocationPct)을 base값 그대로 메아리해 전체비중 추천과 어긋남. 비중은 전체비중 추천의 영역인데 종목별 추천이 침범.
- 수정 내용:
  1) 전체비중 추천 적용 시(수동 `/api/recommendations/weights/apply` + 자가판단 `runAutomationIfDue`) **비활성 종목 allocationPct=0**으로 설정 → 활성 종목 합 100 유지.
  2) 종목별 추천(`recommendedFromCandidate`, `recommendTargetSettings` 폴백)에서 **allocationPct 제거** → 종목 추천은 전략 파라미터만, 비중은 전체비중 추천만. 프런트(`renderRecommendationDiff` 라벨, `targetMatchesRecommendation`)도 비중 비교 제거.
  3) 실행 중 봇은 옛 코드라, 현재 state의 비활성 비중을 API로 즉시 0 보정(SOXL/MUU/SNXX→0).
- 건드린 파일/함수: `server.js`(weights/apply, runAutomationIfDue), `src/strategy.js`(recommendedFromCandidate, recommendTargetSettings), `public/app.js`(renderRecommendationDiff, targetMatchesRecommendation).
- 검증: 문법 OK 3파일. API 보정 후 비중 합 = SOXX 50.9 + SMH 49.1 = **100**, 비활성 전부 0.
- 가정/주의: 코드 변경분(자동 0 처리)은 **봇 재시작 후** 반영됨. 재시작 전까지는 이번 API 보정 상태가 유지됨. 종목 재활성화 시 비중 0에서 시작 → 전체비중 추천으로 재배정.

### X. 추천 라벨 검증·추가 + 후보 종목 스크리닝 (`public/index.html`)
- 요청1(자동투자 켜기 체크박스 추천 검증): 7개 모두 **타당 — 수정 없음**. useVirtualSeed 켜기(원금 보호)·allowSeedTopUp 끄기(손실 자동보충 차단)·allowFractional 켜기(소액 시드 필수)·장외 방어매도 켜기(손절/급락만 정수 매도, 보호 우선)·실거래 실전때만·몰아주기 켜기·추가매수 끄기(집중 회피). 전부 보수·안전 우선이라 "저손해" 목표와 정합. 동적 추천기(recommendSafetySettings)와도 일치(useVirtualSeed:true/allowSeedTopUp:false/allowAdditionalBuys 조건부).
- 요청3(봇 자가판단 체크박스 추천 라벨 추가): 4개에 자동투자 켜기와 동일 스타일 라벨 추가 — 안전설정 자동화 **켜기**, 전체비중 자동화 **켜기**, 종목전략 자동화 **끄기**(라이브 매매값을 자동 변경해 위험), 개선리포트 자동화 **켜기**(분석용). store.js 기본값(true/true/false/true)과 일치. 정적 파일이라 재시작 없이 새로고침 즉시 반영.
- 요청2(추가 후보 스크리닝, 코드 변경 없음 — 분석): 다양한 ETF/주식 13종을 optimizeTargetSettings(위험조정 점수)로 백테스트.
  - 결과(점수/수익%/낙폭%): SMH 64/123/29 · SOXX 61/167/14 · **GLD 51/65/10.3**(최저 낙폭+반도체 무상관) · MTUM 42/36/14 · IGV·QQQ·VGT·XLK 35~37(평범) · NVDA 31/88/37(단일주 고낙폭) · XLE·TLT 음수(부적합).
  - 권고: 반도체 외 **GLD(금)** 강력 추천(손해 최소+진짜 분산), **MTUM(모멘텀 팩터)** 2순위. 기술 섹터는 반도체보다 못함. 상품 추가는 사용자 투자 결정이라 자동 적용 안 함(요청 시 추가).

### Y. 고수익 재설계 — MUU+SOXL(레버리지) 채택 + 후보 재스크리닝 + README 거시문구 정정
- 맥락: 사용자가 "리스크 감당 가능, 고수익 원함"으로 방향 전환. 후보 재스크리닝 + 기존 레버리지 조율 가능성 + DRAM/RAM 티커 검토.
- 스크리닝(5년·최적화·위험조정 점수): **MU 75/641%/낙폭25**(전 종목 최고, 곧 DRAM 본진), MUU 67/713%/34, SOXL 61/515%/34, SOXX 61/167/14. 광범위 레버리지(TQQQ·UPRO·TECL·TNA)는 35점 이하/음수 — **레버리지는 반도체·메모리에서만 작동**. DRAM(58일)·RAM(1일) 티커는 신규라 백테스트 불가 → MU가 DRAM 대용.
- 사용자 질문 답변(기록):
  - SOXX vs SOXL은 **같은 반도체 지수, 배율만 다름** → 동시 보유 무의미(중복). 실제 베팅은 마이크론(MU/MUU)·반도체지수(SOXX/SOXL) 2종뿐, 각 배율 1개만 선택.
  - 거시/테마 차단 로직 **존재·작동**: eventRisk(CPI/FOMC/실적 전후 신규매수 HOLD 차단) + newsRisk(악재 시 매수예산 50%). 한계: 캘린더 하드코딩, 키워드 감성, 사이클 고점 예측 불가 → **진짜 베어 방어는 추세추종 매도**(추세 깨지면 현금화). README가 "표시만 한다"고 낡아서 정정.
- 적용(라이브 state, API, 페이퍼 유지): **MUU(2x) 52% + SOXL(3x) 48% 활성**, 최적화 파라미터(MUU 50/120선·손8.6·익20.1, SOXL 30/100선·손8·익18). SOXX/SMH 비활성·비중 0. 손실 주원인이던 **빠른 추세신호(20/50)를 느린(50/120·30/100)으로** 교체해 휩쏘 감소. 강제 틱 확인: MUU BUY 신호, SOXL HOLD, 가격 정상, 에러 0.
- 가정/주의: ① 갭위험·레버리지 decay·레짐편향은 파라미터로 못 고침 — 최대 집중+레버리지+무헤지 구성. ② store.js 기본값은 안전한 1x(SOXX/SMH) 유지(라이브만 레버리지) — fresh 시작은 보수적으로. ③ 페이퍼 게이트 통과 후 실거래 권장. ④ 옵션 제안(미구현): 반도체 종목은 지수(SOXX)가 장기선 위일 때만 매수하는 '섹터 추세 필터'.

### Z. ADX 추세강도 필터 + 뉴스 감성 고도화 (`src/indicators.js`, `src/strategy.js`, `src/news.js`, `server.js`)
- 맥락: 사용자 5문항 — 뉴스 키워드 고도화(1), 베어 방어 옵션(2), 갭위험(3), 횡보 decay 회피(4), 레짐편향(5).
- ADX 필터(요청 2·4·5): `adx()`(Wilder) 추가 + 신규매수에 `minAdx` 게이트(기본 0=꺼짐). evaluateTarget·runBacktestSimulation 동일 적용, metrics에 adx14 노출.
  - **백테스트로 효과 검증(중요)**: ADX 필터는 **횡보 상품에만 도움**(TQQQ 38%/30점 → minAdx20 129%/61점). **강한 추세 상품엔 해로움**(MUU 713%/84 → minAdx20 255%/66; SOXL도 하락). MUU/SOXL은 추세가 깨끗해 필터가 좋은 거래를 잘라냄.
  - **결론: MUU/SOXL엔 미적용(minAdx 0 유지).** 기능은 인프라로 보존(횡보 상품용). pickSettings에 minAdx 추가(API 설정 가능).
- 뉴스 감성(요청 1): 단순 개수 세기 → **가중 렉시콘**(강도별 가중치) + **메모리/반도체 사이클 용어**(memory glut/oversupply/inventory correction/price decline/HBM/memory shortage 등 — 이 포트폴리오 핵심 테마 악재·호재) + **부정어 처리**("no recession" 등 오탐 제거). 가중 임계값 ±1.5로 잡음 감소. getNewsRisk(악재 시 매수예산 50%)에 그대로 연결돼 더 정확한 신호.
- 검증: 문법 OK 4파일. 뉴스 샘플 3종 분류 정확. ADX 백테스트(위 표). 라이브 동작 불변(minAdx 0).
- 답변 기록(코드 변경 없음): ③ **갭위험은 일봉 봇이 세션간 거래 못 해 근본적으로 사용자 부담** — 다만 이벤트 차단(실적 보유 회피)·사이즈·패닉매도가 일부 완화. ⑤ **레짐편향** = 백테스트가 5년 상승장 한 레짐에 맞춰져 점수·파라미터가 낙관적인 것. 최선의 완화는 **추세추종 자체**(추세 깨지면 현금화 → 베어 레짐엔 미진입) + robust(train/val) 점수. 섹터/ADX 추가필터는 강한 추세 상품에선 오히려 수익을 깎아 미적용.

### AA. 종목별 ADX 필터 추천 + ADX를 종목별 설정으로 (`src/strategy.js`, `server.js`, `public/app.js`)
- 요청: 자동매매 켜거나 새 종목 추가 시 그 종목에 ADX 필터 켤지/끌지 추천해주는 기능.
- 구현: ① `minAdx`를 **종목별 설정**(target.minAdx)으로 — strategy가 target.minAdx 우선, 없으면 전역 폴백. ② `recommendMinAdx`: 선택된 파라미터 위에서 minAdx 0/18/22/26을 백테스트해, **끔 대비 +4점 이상일 때만 "켜기" 추천**(필터는 거래를 줄이므로 강한 추세엔 끄기 기본). `optimizeTargetSettings`/`...Deep` 결과의 recommended.minAdx + reason에 포함. ③ pickTarget/pickStrategyFields/편집기 입력/추천 diff에 minAdx 연결.
- 검증: MUU·SOXL → **끄기**(67/62점, 켬 개선 없음), SOXX → **켜기 26**(64→69), TQQQ → **켜기 26**(30→50). 의도대로 강한추세=끄기·횡보=켜기. 문법 OK 3파일.
- 가정/주의: recommendMinAdx가 optimize당 robustBacktest 4회 추가(추천 호출만, 라이브 틱 무관). 종목별 minAdx 미설정 시 0(끔)으로 동작. 라이브 반영은 재시작 후(현재 MUU/SOXL은 추천도 끄기라 변화 없음).

### BB. 뉴스 감성 — 폭락/투매 용어 보강 + 가중 트리거 (`src/news.js`, `src/eventRisk.js`)
- 맥락(사용자 운영 질문): 반도체/메모리 하방 압박이 뉴스에 안 걸린 건지, 걸렸는데 차단 수준이 아닌 건지.
- 라이브 진단: 실뉴스에 **"SOXL's 23% Single-Day Collapse", "Tech Rout — Leveraged ETFs Can Destroy Wealth"** 헤드라인이 실재. 그런데 (a) 렉시콘에 collapse/rout이 없어 중립 처리(놓침), (b) 이 헤드라인들은 **36시간 밖**(이미 지난 폭락)이라 getNewsRisk(최근 36h)가 안 봄, (c) 최근 36h 뉴스는 메모리 호재(Micron Q3 호실적·AI 메모리 크런치)라 종목 판정 "우호적"이 합당, (d) 뉴스는 소프트 신호. **폭락은 추세추종이 이미 처리**(SOXL SELL 30일선 이탈, MUU 변동성 예산 -50%).
- 수정: ① news.js 부정 렉시콘에 collapse/rout/meltdown/crater/tumble/slump/bear market/wipeout/destroy wealth 추가(실사례 누락 보강). ② eventRisk.js getNewsRisk를 **가중 합 기반**으로 — `weightedScore <= -3`이면 단일이라도 강한 악재에 매수예산 50% 축소(기존 개수 기준 보완).
- 검증: 보강 후 폭락 헤드라인 4건 악재 분류. 가중 트리거: 강한 악재 1건 → 0.5, 중립 → 1.0. 문법 OK.
- 가정/주의: 라이브 반영 재시작 후. 36h 윈도우는 유지(스윙 전략엔 적정, 오래된 폭락이 계속 매수를 막지 않게). 진짜 실시간 방어는 추세추종.

### CC. 자동 갱신 타이머·시각 표시 + 헤딩 정렬 1px + 버전업 판단 (`server.js`, `public/*`)
- 요청1(뉴스/개선리포트 자동 주기 + 마지막 실행 시각): 뉴스는 이미 30분 타이머(NEWS_REFRESH_MINUTES) — `refreshNews`에 `health.lastNewsRefreshAt` 기록 추가. 개선리포트는 **30분 자동 타이머 신설**(`refreshLearningReportIfEnabled`, autoLearningReports 켜짐 시, 외부호출 없는 분석이라 가벼움) + `learning.lastAutoReportAt` 기록. UI: 뉴스 패널·개선데이터 패널 헤더에 "자동 갱신 HH:MM · 30분 주기" 표시.
- 요청3(헤딩 정렬): §L이 패널 콘텐츠 들여쓰기를 16px로 봤으나 패널은 padding16+border1=**17px**라 1단계가 1px 왼쪽(x52 vs 53). `.section-heading` padding 16→**17px**로 픽셀 일치.
- 요청2(버전업 판단 — 코드변경 없음, 분석): 데이터품질 **100은 "수량" 지표**(샘플 2575·주문 68·사이클 6)지, 검증된 성과가 아님. 실제 **왕복 사이클 6건뿐 + 승률 33% + 실현 −$11**(여전히 손실). buyCount 61 vs sellCount 7은 **페이퍼 churn 인공물**(dryRun인데 syncExecutedBotOrders/rebuildLiveBotPortfolio가 실거래 기준으로 포지션을 매틱 덮어써 페이퍼 포지션이 지워지고 매틱 재매수 — §V "회계 혼재"가 발현). → **검증된 근거가 없어 v1.0 재학습 부적절.** 엔진은 이미 이번 세션에 다수 개선(v0.9 drop-block, 위험조정 점수, ADX 추천, 뉴스, 회계수정)됨 = 사실상의 버전업. 진짜 v1.0은 **깨끗한 페이퍼/실거래 사이클이 게이트를 통과**해야 가능. 권고: 별도 DATA_DIR 페이퍼 인스턴스로 churn 없는 검증 데이터 축적(미적용, 사용자 선택).

### DD. 뉴스 콘텐츠 태그 + 인플레이션 렉시콘 복구 + 정적 문구 제거 (`src/news.js`, `public/*`)
- 요청: 정적 "연준 / 거시 / 종목" 문구 제거하고 뉴스별로 내용 파악해 태그(악재/호재처럼) + 종목 티커 태그. "자주 보지 않는 진단…" 문구 제거. 그리고 연준 금리/인플레가 매매에 반영되는지 확인.
- **버그 발견·수정**: §Z 렉시콘 재작성 때 **"inflation"이 누락**돼 인플레 뉴스가 감성에 안 잡히고 있었음 → 복구 + 강화. rising/hot/sticky/high inflation·surge(악재), cooling/eases/cools/disinflation/falls(호재), 일반 inflation(약한 악재 1). 검증: "rate hike + hot inflation"→악재(−5), "inflation cools + rate cut"→호재(+3), "hawkish sticky inflation"→악재(−4.5).
- 뉴스 태그(content-based): `TOPIC_TAGS`(연준/금리/인플레이션/거시/반도체/AI/메모리/무역/레버리지, 한글·영문 모두) + `TICKER_TAGS`(MU/SNDK/NVDA/SOXL/SOXX/SMH/INTC/AMD/TSM/AVGO/QQQ). `buildTags`로 뉴스당 최대 5개. enrichNews에 `tags` 추가. 검증: "SOXL 23% Collapse"→{반도체,레버리지,SOXL,SOXX,SMH}, "금리 오를까…연준 점도표"→{연준,금리}.
- UI: news-item에 태그 칩(.news-tag) 표시, 정적 category 메타 제거. "연준/거시/종목" → 자동갱신 시각. rate-panel "자주 보지 않는 진단…" 문구 삭제.
- **매매 반영 확인**: newsRisk.budgetMultiplier가 strategy.js의 min()→adjustedBudget 경로로 매수예산을 줄임(악재 클러스터 시 50%). + 예정 CPI/FOMC는 eventRisk가 신규매수 차단. 즉 금리/인플레 악재는 매매에 반영됨(이번 inflation 복구 후 비로소 인플레도 포함).
- 검증: 문법 OK 2파일. 라이브 반영 재시작 후.

### EE. 경제(증시) 캘린더 — 지표 일정·발표 호재/악재 자동 판단 + 매매 반영 (`src/calendar.js` 외)
- 요청: Toss 캘린더처럼 증시 지표 일정을 읽어 호재/악재 판단 + 자동 갱신(손 안 대도 관리) + 매매 반영.
- 소스: **TradingView 공개 경제캘린더**(무키, US, importance + actual/forecast/previous). 무료·무의존성(fetch만).
- 신규 `src/calendar.js`:
  - `fetchEconomicCalendar`: US 중·고중요도(importance≥0) 지표 60건 정규화.
  - **호재/악재 판단**(`judgeBias`): 발표 후 actual vs forecast + 지표 방향(성장·고용 높을수록 호재 / 인플레·실업 높을수록 악재 / 금리 인하 호재). 발표 전은 "예정". 미발표인데 actualRaw=0 오는 버그 → 표시 actual로 발표여부 판정해 수정. 검증: PCE 0.4<0.5→호재, GDP 2.1>1.6→호재, GDP물가 3.6>3.5→악재, NFP 미발표→예정.
  - **매매 반영**(`getCalendarRisk`, 거시는 전 종목 공통): 고영향 지표 **4시간 내 임박 → 신규매수 차단**, 최근 8h 발표 악재 → 예산 50%, 24h 내 예정 → 70%. evaluateTarget의 budgetMultiplier min()과 block에 연결(eventRisk·newsRisk와 함께).
- 배선: server.js 60분 자동 타이머 + `health.lastCalendarRefreshAt`. store.js `economicCalendar` 기본값 + saveTraderState 보존. trader.js가 틱마다 calendarRisk 계산해 evaluateTarget에 전달. UI "경제 캘린더" 패널(호재/악재 배지·중요도·발표값, 자동 갱신 시각).
- **부수 버그 수정(기존 잠재)**: 동시 저장 시 임시파일명(`pid-Date.now()`)이 같은 ms에 충돌해 rename ENOENT로 크래시 → 난수 suffix 추가. 학습 리포트 타이머도 loadState 분리 호출 제거하고 updateState 큐 안에서 처리(시작 동시성 race 완화).
- 검증: 격리 mock 인스턴스 종단 — 캘린더 60건 자동 수집, 호재/악재 판정, 패널 렌더, 에러 0. getCalendarRisk: 임박→차단, 악재→0.5 확인.
- 가정/주의: 라이브 반영 재시작 후. 단일종목(MU/SNDK) 실적은 TradingView 거시 캘린더 약하므로 기존 eventRisk 하드코딩 이벤트와 공존. 호재/악재 방향 규칙은 휴리스틱(고용 호조의 매파 양면성 등은 단순화).

### FF. 경제 캘린더 호재/악재 판단 정교화 (`src/calendar.js`, `server.js`, `public/app.js`, `public/styles.css`) — Claude (Opus 4.8)
- 출처/맥락: §EE의 단순 방향 규칙(성장·고용↑=호재, 인플레·실업↑=악재)을 정교화. `calendar.js`에 **미커밋 WIP(§FF 주석)**가 이미 있었고(서프라이즈 크기·지표별 가중치·biasScore·강도·`summarizeMacroTone`) — Claude가 이를 **완성·정교화·검증·커밋**. 사용자 요청: "고용 호조의 매파 양면성" 등을 더 정교화.
- 정교화 내용:
  1) **노동지표 양면성(핵심)**: 고용(NFP/ADP/JOLTS)·실업(실업률/청구)을 `twoSided`로 표시. 이 레버리지·금리민감 포트폴리오엔 강한 고용=성장 호재이나 금리인하 지연(매파), 약한 고용=둔화 우려이나 인하 기대(비둘기)로 **한 방향 단정이 부정확** → **"혼조"**(정보용)로 분류하고 점수를 0.3배로 약화. 이전엔 핫 NFP가 "호재", 약한 고용이 "악재"로 잘못 라벨됐음.
  2) **매크로 톤 연결**: `summarizeMacroTone`(최근 5일 biasScore 합산)이 §EE에선 export만 되고 미연결(죽은 코드)이었음 → `/api/state.macroTone`으로 첨부 + 캘린더 패널 상단에 "거시 기조 호재/악재 우위 + 주요 동인" 표시.
  3) **UI 강도 표기**: 배지를 `bias`(호재/악재) → `biasLabel`(강한/보통/약한 + 방향)로. 매수축소도 biasScore 강도 비례(−1.8↓=0.4, −0.9↓=0.6, 그 외 0.75)는 WIP 유지.
  4) 검증용 `judgeBias` export + `.macro-tone` CSS.
- **라이브 매매 영향(중요)**: getCalendarRisk의 예산축소는 `bias==="악재"`만 반영하므로, 노동지표를 "혼조"로 바꾸면 **약한 고용 발표 후 8h 매수예산 축소(과거 50%)가 사라짐**(노동은 정보용으로 강등). 인플레·금리·성장 악재의 축소와 고영향 임박 4h 차단은 그대로. 즉 "노동 데이터는 양면적이라 매수를 흔들지 않는다"로 변경 — 금리민감 포트폴리오엔 더 정직하나, 베어 신호 하나가 줄어드는 trade-off. (macroTone은 현재 디스플레이 전용 — 매수예산에 직접 반영 안 함. 원하면 추후 연결 가능.)
- 검증: judgeBias 11케이스(인플레 상회/하회, GDP, 금리 인하/인상, 핫 NFP→혼조, 청구급증→혼조, 예정/부합/강도라벨) + getCalendarRisk(임박 차단/강한악재 0.4/노동혼조 무영향) + macroTone 합산 = 14건 PASS. 격리 mock 부팅: `/api/state.macroTone` "호재 우위 +4(23건)", ADP→혼조 렌더, 에러 0.
- 주의: **라이브 반영 재시작 후**. 방향 규칙은 여전히 휴리스틱(레짐 의존 — 같은 지표도 시장 국면 따라 반응 다름). macroTone을 매매에 직접 연결할지는 사용자/Codex 판단.

### GG. 매크로 톤(거시 기조)을 매수예산에 연결 (`src/calendar.js`) — Claude (Opus 4.8)
- 요청: §FF에서 디스플레이 전용이던 `macroTone`(최근 5일 biasScore 합산)을 매매(매수예산)에 연결.
- 구현: `getCalendarRisk`가 `summarizeMacroTone`을 계산해 **toneMultiplier**(합 ≤ −5 → 0.6, ≤ −3 → 0.8, 그 외 1)를 만들고, 기존 이벤트 기반 축소(임박 차단/최근 단일악재 0.4~0.75/24h 예정 0.7)와 **`Math.min`으로 결합**. 단일 악재가 지나가도 5일 거시 기조가 강한 악재면 축소가 지속됨. **호재 기조여도 1 위로 증액하지 않음**(축소 전용 — 거시 낙관으로 사이즈 부풀리기 방지). 모든 분기 반환에 `macroTone` 첨부.
- 배선 확인: trader.js가 `getCalendarRisk(state.economicCalendar)` → evaluateTarget로 전달, strategy.js가 `budgetMultiplier = round(Math.min(event, news, calendar, volatility))`에 `calendarRisk.budgetMultiplier` 포함(strategy.js:202) + `calendarRisk.blocked` 시 매수 차단. 즉 거시 기조 축소가 실제 매수 사이징에 반영됨.
- 검증: getCalendarRisk 7케이스 PASS — 거시 합 −6→0.6(라벨 "거시 악재 기조")·−3.5→0.8·−1→1·호재 +6→1(증액 없음)·단일악재와 min(0.75+0.6→0.6, 0.4+0.6→0.4)·임박 차단 0.
- 라이브 영향(중요): 봇이 **최근 5일 거시 악재 기조가 강하면 매수 규모를 60~80%로 축소**(레버리지 포트폴리오 다운사이드 방어 강화). 재시작 후 반영. 임계(−3/−5)는 휴리스틱이라 데이터 쌓이며 재튜닝 가능.

### HH. 전면 감사 후 의도-정렬 수정 — 가드 재활성 + 당일손실 ET 경계 (`src/strategy.js`, `src/trader.js`) — Claude (Opus 4.8)
- 맥락: 전면 재검토(아래 감사 결과)에서 찾은 모순/약점을, 기록의 의도(§U 라이브 근거)와 사용자 목표("고수익 저손해" + 레버리지 SOXL 3x/MUU 2x)에 맞춰 수정. **이 항목은 다른 LLM이 의도를 다시 판단할 수 있도록 근거를 남긴다.**
- 감사 요약(코드 변경 없이 발견한 것): 문법/부팅/엔드포인트/백테스트/회계(§R)/store 병합/dead code 모두 이상 없음(크래시·NaN·미사용함수 0). 문제는 로직 모순/일관성에 있었음.
- 수정 1 — **장중 급락 매수차단(drop-block) 재활성**(strategy.js evaluateTarget + runBacktestSimulation):
  - 문제: v0.9(§N)가 drop-block에 `last<fastSma` 조건을 넣었는데 매수조건 `trendOk`(`last>fastSma`)와 상호배타라 **사실상 무효**였음. `intradayDropBlockPct` 설정·UI·안전설정 추천이 작동 안 하는 컨트롤을 가리킴.
  - **§N↔§U 모순 해소(→ §U 채택)**: §N(일봉 백테스트)은 "가드가 수익만 깎는다"고 봤으나, 일봉 백테스트는 §U가 라이브에서 확인한 레버리지 장중/갭 급락(꼬리손실)을 **못 본다**. 목표가 저손해+레버리지이므로 §U(가드 강화)가 의도에 맞음 → `last<fastSma` 조건 제거해 당일 급락 시 추세와 무관하게 신규매수 차단(낙하 칼날 회피, BUY-block만 — 강제청산 아님).
  - 검증(5년 백테스트, 현재 파라미터): 재활성 후 SOXL 수익 577→**457%**·낙폭 32.5→**28.7%**·점수 73→**78**, MUU 979→**429%**·낙폭 34.2→**27.4%**·점수 80→**82**. 즉 **수익(가시적 비용)은 줄지만 낙폭이 줄고 위험조정 점수는 오름** — "저손해" 부합. (게다가 백테스트가 못 보는 장중 급락 보호는 별도 이득.)
- 수정 2 — **당일 손실 가드를 미국 거래일(ET) 기준으로**(trader.js `localDayKey` Asia/Seoul→America/New_York):
  - 문제: KST 자정 기준이라 미국 정규장(KST 22:30~05:00) 한가운데(00:00 KST=ET 11:00)에서 손실 카운터가 리셋 → 한 세션 손실이 두 날로 쪼개져 $5/한도 가드가 약해짐. §H(정규장 ET 보정)와 어긋남.
  - 수정: ET 날짜 기준으로 한 세션=한 날. 검증: 같은 세션의 23:00·02:00 KST가 ET 동일 날짜로 묶임 확인. (validation.js의 별도 localDayKey(자산곡선 일별 스냅샷)는 MDD 샘플링용이라 미변경.)
- 수정 3 — 문구 통일: evaluateTarget의 매도/차단 사유 "일봉 기준"→"당일 시가 대비"(실제 계산과 일치, §O UI 라벨과도 일치). isDefensiveSellSignal은 "하락" 토큰으로 여전히 매칭돼 장외 방어매도 동작 불변.
- 엔진명: **v0.9 유지**(§CC 기준 — v1.0은 검증 게이트 통과 후). 저장된 리뷰 점수는 자가판단 360분 주기에 갱신.
- 미수정(경미, 의도 무관): `metrics.sma20/sma50` 레거시 중복 필드명(아무도 안 읽음), `judgeBias` 테스트용 export. 필요 시 정리 가능.
- 라이브 반영: **재시작 후**. 검증: 문법·격리 부팅 3엔드포인트 200·에러 0.
- 다른 LLM에게: 이 수정은 제 이전 §N(완화)을 **되돌린 것**입니다. 근거는 "일봉 백테스트가 못 보는 레버리지 장중 위험(§U 라이브) + 저손해 목표 + 재활성이 백테스트 낙폭/위험조정점수도 개선". 만약 페이퍼/실거래로 "drop-block이 좋은 진입을 너무 많이 잘라 수익을 해친다"가 증명되면 다시 완화를 검토할 것.

### II. 경미 정리(①) + 당일 급락 차단 임계값 튜닝(②) (`src/strategy.js`, 라이브 state) — Claude (Opus 4.8)
- ① 정리: `evaluateTarget` metrics에서 레거시 중복 필드 `sma20`/`sma50` 제거(아무도 안 읽음 — fastSma/slowSma가 실제 값을 담음, 이름이 20/50으로 고정돼 오해소지였음). UI·다른 모듈 영향 없음(grep 확인). `judgeBias` 테스트용 export는 무해+주석 있어 유지.
- ② 튜닝: §HH로 재활성된 `intradayDropBlockPct`(당일 급락 신규매수 차단 임계)를 SOXL/MUU 5년 백테스트로 스윕.
  - 결과(차단% → SOXL점수/낙폭 · MUU점수/낙폭 · 비중가중점수): 3→79/28.7·70/27.4·74.5 | 4.7→78/28.7·77/27.4·77.5 | **5.5→78/28.7·82/27.4·80.5** | 7→72/32.5·89/22.3·82.6 | 끔→73/32.5·80/34.2·76.5.
  - 선택: **5.5** — 두 종목 모두 낙폭 낮고(~28%) 점수 높은 균형 최적점("저손해" 부합). 라이브 직전값 5.3에서 5.5로 미세 상향(이미 거의 최적이었음 = 이전 튜닝이 좋았다는 확인). 라이브 state.json `settings.intradayDropBlockPct`에 적용(store.js 기본값 4.5는 보수적 1x 프레시스타트용이라 유지).
  - **사용자 판단 옵션(미적용)**: 더 공격적으로는 **7**이 비중가중 점수 최고(82.6, MUU 643%·낙폭 22%)이나 **SOXL 낙폭이 28.7→32.5%로 악화**되는 trade-off — 고수익 더 원하면 7, 저손해 우선이면 5.5. 전역 설정이라 한 값이 두 종목에 같이 적용됨.
- 검증: 문법 OK, 격리 부팅 3엔드포인트 200, metrics에서 sma20/sma50 사라짐 + intradayDropBlockPct 5.5 확인, 에러 0. 라이브 반영은 재시작 후(§HH 가드 재활성과 함께).

### JJ. (자율 결정) 1x 종목 구성 + 페이퍼 전환 + 벤치마크 QQQ + 듀얼엔진 보류 — Claude (Opus 4.8)
- 맥락: 사용자가 외출(주말, 모니터링 불가)하며 "네가 판단해서 모두 결정"을 위임. 목표 재확인: **(1) 지수(S&P500/나스닥100) 단순보유보다 확실히 높은 수익**, (2) 낙폭 **−30%까지 감수**, (3) 1x 전략적합 방향. 밤에 사용자가 검토·피드백 예정.
- **결정 1 — 자동매매 종목(1x, 데이터 선정):** 사용자 지정 **MU·TSM** + 내가 데이터로 추가한 **WDC·GOOGL**. 기준="깨끗한 강한 추세 + 관리 가능한 낙폭(≤30%) + 지수 상회". SOXX는 사용자가 제외. SOXL/MUU/SOXX/SMH/SNXX는 **비활성·설정 보존**(레버리지 구성 나중 재사용).
  - 종목별 optimizeTargetSettings(위험조정) 결과: **WDC 78점/426%/낙폭14%/승률67%, MU 76/568%/24%/64%, TSM 63/195%/16.5%/50%, GOOGL 52/138%/12%/48%**. 전부 낙폭≤30%, 지수(QQQ 5년 ~31%) 크게 상회. 파라미터는 각 종목 최적값 적용(=1x에 맞춘 엔진 파라미터).
  - 비중 점수가중: MU 28.3 / WDC 29 / TSM 23.4 / GOOGL 19.3.
- **결정 2 — 실거래 OFF(페이퍼/dryRun), monitoring 유지:** 내가 종목을 자동선정했고 사용자가 모니터링 못 하므로, 실돈을 무방비로 넣지 않기 위해 dry-run으로 둠(사용자가 "불안하면 꺼도 된다" 명시 허용). 주말이라 어차피 장 마감. **사용자가 밤에 검토 후 `실제 주문 허용`을 켜면 라이브.** 주말 동안 페이퍼로 검증 데이터 축적(§S 게이트 진행).
  - **주의(실보유 처리):** 기존 SOXL/MUU **실제 보유분**은 계좌에 남아있고 페이퍼 모드에선 봇이 건드리지 않음. 라이브 켜면 비활성 레버리지 보유분은 전략상 청산되거나, 사용자가 수동 청산. 밤에 결정 필요.
- **결정 3 — 벤치마크 SOXL→QQQ(나스닥100):** 봇 목표가 "지수 상회"이므로 검증 패널이 QQQ 단순보유 대비 초과수익을 측정하도록 변경(이전 SOXL 3x 비교는 부적절). validation.js BENCHMARK_SYMBOL.
- **결정 4 — 듀얼 엔진(레버리지용/1x용 선택 로직): 지금 만들지 않음(자율 범위 초과 → 보류).** 이유: 무감독 상태에서 매매 엔진 구조를 새로 쓰는 건 위험. **현 구조가 이미 부분적으로 이 역할**을 함 — 전략 로직은 동일하고, `target.leverage`가 buildRiskProfiles에서 손절/트레일 폭을 조정하며 종목별 optimizeTargetSettings가 1x/레버리지에 맞는 파라미터를 따로 뽑음. 즉 "종목 추가 시 그 상품(1x/레버리지)에 맞는 파라미터 엔진"은 이미 작동. **명시적 '엔진 선택기' 추가는 사용자 승인 후** 진행 권장(설계: targets에 engineProfile 필드 + 레버리지/1x 프리셋 + UI 토글).
- 검증: 문법 OK, 격리 부팅 — 활성 MU/TSM/WDC/GOOGL·live=false·벤치마크 QQQ 작동·run-once 정상·에러 0.
- store.js 기본값: **SOXX/SMH(보수적 1x) 폴백 유지**(데이터 손실 시 안전 복구용). 실제 운영 타깃은 state.json(위 4종).
- **사용자 밤 검토 항목:** ① 종목/비중 승인 ② 실거래 ON 여부 ③ 실제 SOXL/MUU 보유분 처리 ④ 듀얼엔진 선택기 구현 여부. **코드 변경(§HH/§II/§FF/§GG/§JJ)은 봇 재시작 후 반영.**
- 캐비엇: 5년 단일 상승레짐 백테스트라 낙관 편향, 단일주 개별 악재 리스크, 과거≠미래. 페이퍼 검증 통과 전 실증액 보류 권장.

### 2026-06-27 — Codex
- 문제/목적:
  - Claude §HH~§JJ 이후 현재 코드/문서/검증 경로를 교차검토. 실제 로직과 화면/문서 설명이 어긋난 부분, 새 1x 종목 구성(MU·TSM·WDC·GOOGL)으로 바뀐 뒤에도 옛 SOXL/MUU/SNXX 중심으로 남은 리스크 경로, 그리고 dry-run 페이퍼 검증이 과거 실거래/옛 페이퍼 churn과 섞이는 문제를 정리.
- 진단(근거):
  - `strategySummary`와 UI 설명은 아직 "당일 급락 차단=추세이탈 시에만"이라고 설명했지만, §HH 코드가 이미 추세 조건 없이 당일 급락 시 신규매수를 차단하도록 되돌려 실제 동작과 불일치.
  - 검증 모듈은 벤치마크를 QQQ로 바꿨는데 UI/README 일부가 SOXL buy-and-hold로 표시.
  - `src/eventRisk.js`, `src/news.js`가 SOXL/MUU/SNXX 중심이라 새 활성 종목(MU/TSM/WDC/GOOGL)에 정적 거시 이벤트·뉴스 피드/관련도 판단이 충분히 적용되지 않음. 특히 `ai` 부분문자열이 `raises` 같은 단어에도 매칭되는 잡음 확인.
  - `runOnce`가 dry-run이어도 실계좌 동기화 후 `rebuildLiveBotPortfolio`로 `state.positions/performance`를 라이브 장부로 덮어써, §CC에서 기록된 페이퍼 churn(반복 dry BUY)과 §JJ의 "주말 페이퍼 검증" 목적이 충돌.
  - `targetMatchesRecommendation`/학습 스냅샷/신규 종목 생성 경로에서 `minAdx`가 일부 빠져 ADX 추천값 저장 여부와 사후 분석이 어긋날 수 있음.
- 수정 내용:
  - 전략/검증/README/설정 설명을 현재 로직(당일 시가 대비 급락 시 신규매수 대기, QQQ 벤치마크, ADX 선택 필터, 경제 캘린더 반영)과 맞춤.
  - 정적 매크로 이벤트는 모든 종목에 적용되도록 `symbols:["*"]` 처리, Micron 이벤트는 MU/MUU 모두 적용. 뉴스 피드는 MU/TSM/WDC/GOOGL/QQQ까지 확장하고, 종목별 관련도 정규식을 현재 구성에 맞게 보강.
  - dry-run 전용 `paperSession`을 도입. dry-run 시작 또는 활성 종목/주요 안전설정 변경 시 종이 장부를 새로 시작하고, dry-run 중에는 라이브 체결 동기화가 paper `positions/performance`를 덮어쓰지 않게 함. 실거래 복귀 시 paper 장부를 먼저 비우고 실제 체결 이력으로 라이브 장부를 재구성.
  - 검증 지표와 개선 리포트가 현재 모드에 맞춰 paper 세션 이후 dry-run 거래 또는 live 현재 활성 종목 체결만 집계하도록 스코프 분리.
  - `minAdx`를 신규 종목 생성, 추천 저장 판정, 학습 target snapshot에 포함. mock 가격표도 현재 종목을 인식하도록 갱신.
- 건드린 파일/함수:
  - `src/trader.js`: `runOnce`, `syncOrdersOnly`, `syncExecutedBotOrders`, `ensureDryRunPaperSession`, `markPaperSessionInactive`, `paperTargetSignature`
  - `src/validation.js`: `BENCHMARK_SYMBOL`, `computeBotTradeMetrics`, `tradeMetricScope`
  - `src/learning.js`: `buildLearningReport`, scoped sample/trade/cycle helpers, `pickTargetSnapshot`
  - `src/eventRisk.js`: macro 이벤트 전체 종목 적용, 현재 종목 뉴스 관련도
  - `src/news.js`: RSS 티커/검색어 확장, 태그/토픽 보강
  - `src/strategy.js`, `public/app.js`, `public/index.html`, `README.md`, `server.js`, `src/store.js`, `src/tossClient.js`
- 검증 방법과 결과:
  - `/Users/joyanggi/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node --check server.js && for f in src/*.js public/app.js; do ... --check "$f"; done` PASS.
  - `git diff --check` PASS.
  - 단위성 스크립트 확인: MU/TSM도 CPI 정적 이벤트 차단 적용, GOOGL은 `raises` 안의 `ai`에 오탐하지 않고 Fed rate 악재에는 예산 50% 축소, paper 검증 지표는 세션 이후/활성종목 dry-run 거래만 집계.
  - 격리 mock 서버(`DATA_DIR=/tmp/...`, `PORT=3999`, 토스 키 공란)로 `/api/state`, `/api/run-once`, `/api/recommendations/weights`, `/api/learning/report` 200 OK. `paperSession.active=true`, validation basis=`paper`, benchmark=`QQQ` 확인.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - `paperSession`은 코드 배포 후 다음 트레이더 틱에서 운영 `state.json`에 생성된다. 데이터 파일은 커밋하지 않았음.
  - 실거래를 다시 켜면 paper 장부를 비우고 라이브 체결 이력에서 장부를 재구성한다. 실제 계좌에 남은 SOXL/MUU 보유분은 사용자가 수동 처리하거나, 라이브 전환 시 봇 대상/보유 정책을 다시 확인해야 한다.
  - 정적 실적 이벤트는 여전히 수동 갱신이 필요하다. 이번 수정은 매크로 이벤트 전체 종목 적용과 MU 보강까지이며, TSM/WDC/GOOGL의 향후 실적일 자동 수집은 별도 과제.

### 2026-06-27 — Codex
- 문제/목적:
  - 현재 운영 종목이 MU·TSM·WDC·GOOGL 1x 구성인데, 전략명과 일부 UI/문서가 여전히 "레버리지" 중심으로 보여 사용자가 실제 동작을 오해할 수 있는 문제를 정리.
- 진단(근거):
  - `strategySummary.name`과 README가 `Leveraged Momentum Guard v0.9 Dual-Backtest`를 표시.
  - 안전설정 화면의 `레버리지 총노출 한도`/`레버리지한도` 문구는 1x 종목 운용 상태에서는 과하게 좁은 표현.
  - mock Toss 기본 티커가 SOXL/MUU/SNXX라 격리 테스트 기본값도 현재 운영 구성과 어긋남.
- 수정 내용:
  - 표시 전략명을 `Adaptive Momentum Guard v0.9 Dual-Backtest`로 변경하고, 이전 `Leveraged...` 이름은 alias로 남겨 저장된 추천/검토가 이름 변경만으로 무효 처리되지 않게 함.
  - 서버와 프런트의 엔진 버전 비교가 alias를 인식하도록 보강.
  - README/설정 화면/추천 안내 문구를 1x와 레버리지 모두에 맞는 "배율", "총 위험노출" 중심 표현으로 수정.
  - mock 기본 티커를 현재 1x 운영 구성(MU/TSM/WDC/GOOGL)으로 변경.
- 건드린 파일/함수:
  - `src/strategy.js`: `strategySummary`, `isCurrentStrategyEngine`, 당일 급락 가드 설명
  - `server.js`: 엔진 버전 호환 비교
  - `public/app.js`: 엔진 버전 호환 비교, 추천 안내 문구
  - `public/index.html`, `README.md`, `src/indicators.js`, `src/tossClient.js`
- 검증 방법과 결과:
  - `rg`로 사용자 노출 `Leveraged Momentum Guard`, `레버리지 총노출`, `레버리지한도` 잔존 여부 확인. 남은 `Leveraged...`는 호환 alias뿐.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 이번 변경은 표시/호환성 정리이며 매수·매도 판단 로직 자체는 바꾸지 않음.
  - 고위험/레버리지 전용 엔진은 별도 설계가 필요한 큰 변경이라 이번 커밋에는 넣지 않음.

### 2026-06-27 — Codex
- 문제/목적:
  - 데스크톱 UI QA. 사용자가 지적한 `1단계` 정렬, 비활성 종목 카드 과다 노출, 종목 설정 버튼 과밀, 고위험 엔진 진행상태 부재, 토스 요청한도 카드 불필요, 로딩 스피너 찌그러짐, 그리고 paperSession 도입 후 봇 포트폴리오/검증/개선 데이터가 사라진 것처럼 보이는 문제를 정리.
- 진단(근거):
  - `paperSession` 시작 시 `state.positions/performance/botBudget`을 0으로 초기화해, 거래 이력과 백업은 남아 있는데 대시보드의 봇 포트폴리오와 검증 기준 자산이 비어 보였음.
  - `data/decision-samples.json` 사이드카에는 4,594개 샘플이 남아 있었고, 최신 백업(`data/backups/state-2026-06-27T12-13-42-713Z.json`)에는 MUU/SOXL 장부, 성과, 6개 closed cycle이 보존되어 있었음.
  - 자동투자 대상은 활성/비활성 종목을 한 화면에 모두 보여 정보량이 많았고, 종목 설정은 추천값/정밀추천/내 저장값/저장 버튼이 함께 있어 데스크톱에서도 버튼 밀도가 높았음.
- 수정 내용:
  - dry-run paperSession 생성/종료 시 기존 봇 장부를 지우지 않도록 `src/trader.js`를 수정. 검증/학습의 paper 스코프는 `paperSession.startedAt` 기준으로 유지.
  - 운영 `data/state.json`은 최신 백업에서 장부/성과/closed cycle만 복구하고, 현재 설정/종목 ON-OFF는 보존. 데이터 파일은 커밋하지 않음.
  - `1단계` 섹션 좌측 정렬 고정, 활성 종목만 먼저 노출, 자동매매 OFF 종목은 기본 접힘 영역으로 이동.
  - 종목 설정을 카드형 자동저장 UI로 변경. `추천값`, `내 저장값`, `저장` 버튼 제거, `정밀추천`과 `삭제`만 유지. 입력 변경 시 debounce 후 자동 저장.
  - 고위험 엔진 실험실 카드를 추가해 레버리지 후보, paper/live 기록, 왕복 손익, 실거래 승격 조건을 표시.
  - 토스 요청한도 카드는 화면에서 제거하되, 버튼 요청한도 보호 로직은 유지.
  - 모바일 접속 카드 제거, 판단 목록에서 꺼진 종목 반복 표시 축소, 종목 카드의 세부 전략 설명은 기본 접힘으로 변경, 전체비중 추천 문구와 안전/자동화 설명을 축약.
  - `.spinner`를 inline-block 정사각형으로 고정해 로딩 애니메이션 찌그러짐을 방지.
- 건드린 파일/함수:
  - `src/trader.js`: `ensureDryRunPaperSession`, `markPaperSessionInactive`
  - `public/app.js`: `renderTargets`, `appendTargetCard`, `renderHighRiskEngine`, `renderEditor`, `scheduleTargetAutoSave`, `renderSignals`, rate-limit UI guard, 검증/추천 문구
  - `public/index.html`: 고위험 엔진 카드, 비활성 target area, 종목 설정/자동화 문구, 요청한도 카드 제거
  - `public/styles.css`: target 접힘 UI, 카드형 editor, 고위험 카드, compact strategy details, spinner
  - `README.md`: 종목 설정 정밀추천/자동저장 설명
- 검증 방법과 결과:
  - 문법/정적 검사: `node --check server.js`, `for f in src/*.js public/app.js; do node --check "$f"; done`, `git diff --check` PASS.
  - API 확인: `/api/state`에서 positions `MUU,SOXL`, equity `$85.67`, validation attached, basis `paper`, learning report present 확인. `/api/learning/report` POST 정상.
  - 브라우저 QA: localhost 새 코드 로드, 콘솔 error/warn 없음, 가로 overflow 없음, `1단계`/h2 left 동일 x좌표, 비활성 카드 기본 접힘, 요청한도/모바일 카드 제거, editor 버튼 `정밀추천/삭제`만 표시, 자동저장 상태 `저장됨` 확인.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 현재 검증 카드의 수익률은 복구된 현재 봇 장부 기준이고, 승률/손익비 표본은 이번 paper 세션 이후 거래만 본다. UI에 이 기준을 명시함.
  - 고위험 엔진 카드는 진행상태 표시용이며, 실제 레버리지 전용 엔진 분리/별도 paper 장부 구현은 다음 기능 단위로 남김.

### 2026-06-27 (밤) — Claude (Opus 4.8)
- 문제/목적:
  - Codex 검토 결과 발견한 모순: `f86375a`가 36분 전 자기 커밋 `ac382b1`의 페이퍼 장부 초기화(clean-slate) 로직을 되돌려, 페이퍼 검증이 과거 레버리지 시대 −$14 손실과 MUU/SOXL 잔여 포지션으로 오염됨. 검증 카드 수익률(botBudget 기준)과 승률/손익비(세션 스코프)가 서로 다른 기간을 측정.
  - 사용자 요청: ① 장부 전부 초기화 후 처음부터 + 페이퍼/실거래 장부 체계적 관리 ② 떨어지는 칼날 방어 점검(데이터 분석) ③ 자동매매 OFF 시 비중 자동 0 ④ 전체 UI/UX 개선.
- 진단(근거):
  - 실거래 closed cycle 6건 분석: 최악 −26.4%(SNXX 2x), −21.7%(MUU 2x)는 명목 손절 ~11~14%가 갭/슬리피지로 뚫려 실현 손실이 2배. MUU −10.6%는 진입일 이미 −1.55%인 2x를 모멘텀(+72%/5d) 추격 → 11분 만에 급락 패닉청산. 즉 레버리지에서는 손절이 "트리거"일 뿐 체결 보장이 안 되고, 당일급락 차단은 진입 후 붕괴를 못 막음. 1x 전환이 구조적 해법(손절 신뢰도↑)이며, 현 6개 cycle은 모두 구엔진(v0.6~v0.8)이라 현 설정 방어력 데이터가 0 → 깨끗한 페이퍼 누적이 필요.
- 수정 내용:
  - `src/trader.js`: `ensureDryRunPaperSession`/`markPaperSessionInactive`에 봇 장부 초기화(`wipeBotBook`) 복원 — `ac382b1`의 일관된 clean-slate 모델로 회귀(`f86375a` 회귀 수정). 장부 한 구간 종료 시 요약을 `ledgerHistory`(append-only, 최대 20)에 남기는 `archiveLedgerEpoch` 추가 → "데이터 사라짐" 우려를 장부 오염 없이 해결. `runOnce`에 `state.ledgerMode`(paper/live) 기록.
  - `src/store.js`: defaultState에 `ledgerMode`/`ledgerHistory` 추가 + mergeDefaults 정규화.
  - `server.js`: 종목 PATCH에서 `enabled===false`면 `allocationPct=0` 자동 적용(요청 ③).
  - `scripts/reset-ledger.js`: 장부 초기화 스크립트 신규. 서버 정지 상태에서 state.json 직접 기록(saveState 축소 보호 가드 우회), 직전 상태 백업, `botStartedAt`을 현재로 이동(실거래 켜도 과거 토스 주문 재복구 방지), decisionSamples 사이드카 비우되 NDJSON 아카이브는 보존.
- 검증: `node --check` 전부 PASS. mock 런 스모크 테스트 — 스테일 MUU 포지션+−$11.38이 페이퍼 세션 시작 시 빈 장부로 초기화, ledgerHistory에 요약 1건 보존, tradeHistory(감사 추적)는 유지 확인.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 초기화는 사용자가 서버 정지 후 `node scripts/reset-ledger.js` 실행(데이터는 gitignore, 커밋 안 함). 실거래 토글은 검증 후 사용자 판단으로 켠다.
  - 매수 과열 추격 차단(진입 전 과확장 가드)은 전략 행동 변경이라 별도 승인 후 적용 예정(이번엔 미적용).

### 2026-06-27 (밤) UI — Claude (Opus 4.8)
- 목적: 사용자 요청 ④ 전체 UI/UX 가독성·사용성 개선(빽빽함/비정상 여백/정렬/카드 순서/종목설정 인풋 2줄/IP 카드).
- 수정 내용:
  - `public/index.html`: 상단 IP 카드(connection-panel) 제거 → 헤더 status-strip에 `허용 IP` 칩으로 축약(복사/새로고침 포함). 봇 포트폴리오 패널에 장부 모드 배지(`#ledgerModeBadge`)+상태(`#ledgerStatus`) 추가. 카드 재배치: 고위험 엔진 실험실을 검증↔자동투자 켜기 사이(자리 부족)에서 하단 참고영역으로 이동+collapsible 전환. 개선 데이터(learning)를 종목설정↔자가판단 사이에서 자가판단 아래로 이동(설정 패널 연속 배치). 종목 설정 카드의 인풋을 `비중·위험관리` / `추세·신호` 두 그룹으로 묶고 중복 종목 인풋 제거.
  - `public/app.js`: `renderLedger()` 추가(장부 모드/시작시각/지난 장부 기록 ledgerHistory 표시, 구 백엔드에선 dryRun으로 폴백). `renderEditor` 그룹형 재구성. `renderPublicIp` 헤더 칩 title 반영 + null 가드.
  - `public/styles.css`: 여백 완화(shell gap 16→22, panel padding 16→18/20, panel-head 14→16, choice/control/market/workspace gap 상향). 헤더 IP 칩/장부 상태/에디터 그룹 스타일 신규. section-heading 좌측 정렬 패널 콘텐츠(19px)와 픽셀 일치. 모바일 미디어쿼리에서 editor-fields 1열·IP칩 풀폭.
- 검증: `node --check public/app.js` PASS, section/details 태그 균형(8/8·5/5), 필요한 DOM id 전부 존재, 정적 자산 localhost:3000 정상 서빙, 구 백엔드 /api/state로도 UI 비파괴(ledger 폴백). 시각 확인은 사용자 브라우저 새로고침으로 진행.

### 2026-06-27 (밤) 뉴스 — Claude (Opus 4.8)
- 목적: 종목을 추가하면 그 티커/회사 뉴스를 시장뉴스에 자동 반영(요청).
- 수정 내용:
  - `src/news.js`: 하드코딩 `NEWS_SYMBOLS`/`GOOGLE_NEWS_QUERY`/`TICKER_TAGS` 제거. `fetchNews(targets)`가 활성 종목으로 야후 종목 피드(`s=`), 구글뉴스 검색어, 태깅을 동적 구성. `TICKER_PROFILES`(회사명 keywords + 본문 alias 정규식) + 미등록 티커는 심볼 토큰(`symbolTokenRe`)로 폴백. `CONTEXT_TICKERS`(NVDA/AVGO/INTC/AMD)는 보유 안 해도 맥락 태그. `BASE_SYMBOLS=[QQQ]` 항상 포함.
  - `server.js`: `refreshNews`가 현재 targets를 로드해 `fetchNews(targets)` 호출. 종목 추가(POST /api/targets) 직후 `refreshNews()` 1회 트리거(응답 비차단)로 즉시 반영.
- 검증: `node --check` PASS. mock fetch 단위테스트 — 야후 심볼 `QQQ,MU,AAPL,PLTR`(비활성 SOXL 제외), 구글 검색어에 Apple/PLTR/Micron 포함·SOXL 제외, 새 티커(PLTR) 뉴스가 태그 `["AI","PLTR"]`로 자동 분류됨 확인. 적용엔 서버 재시작 필요.

### 2026-06-28 — Claude (Opus 4.8) : 토스 디자인 시스템 적용
- 목적: 사용자 제공 TDS(토스 디자인 시스템) 문서를 `design.md`로 보관하고, 대시보드를 TDS 시각 언어로 재테마. 라이트(화이트 캔버스)가 기본, 헤더 토글로 다크 근사 전환.
- 수정 내용:
  - `design.md` 신규: TDS 토큰(컬러 4계층/타입 ramp/spacing/radius/elevation/motion) + Do/Don't + 본 프로젝트 적용 메모(시각 언어만 차용, 금융 도메인 개념 이식 금지).
  - `public/styles.css`: `:root`를 TDS 라이트 토큰으로 재정의(grey-50 캔버스, white 카드, grey-900 텍스트, grey-700 보조, 1px grey-200 헤어라인, blue #3182F6 단일 강조), `:root[data-theme="dark"]`에 다크 근사 토큰. 컴포넌트의 하드코딩 다크 hex(#0d131a/#0b1118/#111923/버튼색/강조 텍스트 #6ee7b7·#9fc6ff·#ff9bae·#ffd58f 등)를 전부 CSS 변수로 치환 → 토글이 실제 동작. 토스트는 두 테마 모두 grey-900 다크 표면(TDS)이라 라벨 고정 밝게. 금융 수치 `tabular-nums`.
  - `public/index.html`: `<head>`에 첫 페인트 전 테마 적용 스크립트(깜빡임 방지, 라이트 기본). 헤더에 테마 토글 버튼(`#themeToggle`).
  - `public/app.js`: 토글 핸들러(localStorage `tds-theme` 저장) + `syncThemeToggle` 라벨 동기화.
- 검증: `node --check public/app.js` PASS. 컴포넌트 규칙에 남은 소문자 다크 hex 0개(전부 변수화), 다크 토큰 정의 보존(대문자/rgb로 replace_all 충돌 회피), 정적 자산 서빙 200. 적용은 브라우저 하드 리프레시(서버 재시작 불요 — 정적 파일).

### 2026-06-28 — Claude (Opus 4.8) : 하드코딩 동적화 + 기능 유기적 연결
- 목적: 코드 전반의 하드코딩을 종목/상태에 따라 유동적으로 바꾸고, 기능들을 유기적으로 연결(예: 종목 추가→뉴스 반영).
- 수정 내용:
  - `src/tickers.js` 신규: 티커 "정체성" 단일 출처(회사명 키워드·본문 별칭·섹터). `news.js`(검색어/태깅)·`eventRisk.js`(뉴스/이벤트 관련성)가 공유. 프로필 없는 티커는 name에서 별칭 추정(`nameAliases`) + 심볼 토큰으로 자동 동작. 섹터 키워드로 동종업계 뉴스도 관련성 인정. → 종목 한 곳만 추가하면 검색·태깅·관련성·예산영향이 한꺼번에 반영.
  - `src/news.js`: 중복 프로필표 제거하고 tickers.js 사용. 검색어는 회사명(없으면 name 추정/심볼). 태깅·관련성 name 인지(`nameMap`).
  - `src/eventRisk.js`: 하드코딩 EVENTS(고정 날짜·옛 티커, 일부 이미 과거) 제거 → `state.customEvents`로 주입받는 state-driven. 거시(CPI/FOMC)는 calendar.js가 동적 처리하므로 중복 제거. 과거 이벤트 자동 만료. 종목 관련성 if-체인 → 공유 `relevanceMatcher`로 대체.
  - `src/store.js`: defaultState 기본 종목 SOXX/SMH→MU/TSM/WDC, allocationUsd 1000→100, `customEvents:[]` 추가. `DEFAULT_BOT_STARTED_AT` 상수 export(3곳 중복 리터럴 통합, #6).
  - `src/validation.js`·`src/trader.js`: `DEFAULT_BOT_STARTED_AT` 사용. trader가 `state.customEvents`·`target.name`을 eventRisk/newsRisk에 전달.
- 검증: `node --check` 전부 PASS, import 체인(validation↔store, trader↔store) 정상. 단위테스트 — 미등록 티커 PLTR이 회사명("Palantir")으로 뉴스 관련성·태깅·예산영향 인정, 오탐 없음(Apple 뉴스엔 PLTR 매칭 안 됨). 섹터 뉴스(semiconductor→TSM, DRAM→MU) 관련성 인정. state-driven 이벤트 과거 자동 숨김·실적 전후 차단 동작 확인. 적용엔 서버 재시작 필요.

### 2026-06-28 (2) — Claude (Opus 4.8) : 종목 이벤트 UI + 캘린더/설정 동적화
- 수정 내용:
  - `server.js`: `POST /api/events`(종목 이벤트 추가, 심볼·일시 검증, 기본 전24h/후12h)·`DELETE /api/events/:id` 추가. pickSettings 허용목록에 `smallSeedNoiseFloorUsd` 추가.
  - `public/index.html`·`app.js`·`styles.css`: "종목 이벤트" 패널(폼+목록+삭제, `renderCustomEvents`/`addCustomEvent`). state.customEvents를 사용자가 직접 추가/삭제 → 실적 전후 신규매수 자동 차단(eventRisk와 연결). datetime-local→ISO 변환.
  - `src/calendar.js`(#5): 대상 국가 `CALENDAR_COUNTRIES` 환경변수화(기본 US), 레버리지 시절 주석 정정.
  - `src/trader.js`+`src/store.js`(#7): 소액 시드 노이즈 바닥값 `smallSeedNoiseFloorUsd`를 설정값으로(기본 5, 상수 폴백). $100 시드에서 당일손실 한도 민감도 조절 가능.
- 검증: 격리 mock 서버(:3099)에서 이벤트 생성/조회/삭제/검증 동작 확인(심볼 대문자화·ISO 변환·기본값·삭제·에러 메시지), settings.smallSeedNoiseFloorUsd 노출 확인. `node --check` 전부 PASS. 적용엔 서버 재시작 필요(이벤트 UI는 정적이라 새로고침이면 표시되나 API는 재시작 후 동작).
- 남긴 것(낮은 가치/내부값): BACKTEST_COST_PER_SIDE(백테스트 표시용 가정)·캡/주기 상수(이미 env 또는 무해)는 상수 유지.

### 2026-06-28 (3) — Claude (Opus 4.8) : 종목 이벤트 수동입력 → 자동 수집 전환
- 문제/지적: 실적 등 종목 이벤트를 사용자가 직접 입력하면 오입력 위험. 봇이 자동으로 불러와야 함.
- 진단: Yahoo quoteSummary/v7 quote는 crumb 요구로 401(차단). Nasdaq `api/analyst/{SYM}/earnings-date`는 키 없이 200·실제 날짜 제공(TSM Jul16/WDC Jul29/AAPL Jul30 확인, 미제공은 빈값).
- 수정 내용:
  - `src/earnings.js` 신규: `fetchEarningsEvents(symbols)` — Nasdaq에서 활성 종목 실적일 수집(6h 캐시). 날짜만 제공되므로 20:00 UTC(마감 후) 가정 + 전후 18h 차단창. 실패 시 빈 배열(잘못된 차단 방지).
  - `server.js`: `refreshEarningsEvents()`(활성 종목 대상, state.earningsEvents+eventCalendar 갱신) 추가, 시작 시 1회 + 12h 주기 + 종목 추가/켜기/끄기/삭제 시 트리거. 수동 `POST/DELETE /api/events` 제거, `POST /api/events/refresh`(지금 수집) 추가.
  - `src/store.js`: `customEvents` → `earningsEvents`(자동 수집). `src/trader.js`: getEventRisk/listEventCalendar에 `state.earningsEvents` 전달. `eventRisk.js`: 주석 정정.
  - `public/index.html`·`app.js`·`styles.css`: 종목 이벤트 패널을 수동 입력 폼 → 자동 수집 읽기전용 목록 + "지금 수집" 버튼 + 마지막 수집 시각 표시로 교체. `renderEvents`/`collectEarningsNow`.
- 검증: 격리 mock 서버(:3097)에서 POST /api/events/refresh가 기본 종목(MU/TSM/WDC)의 실적 TSM(7/16)·WDC(7/29) 자동 수집·eventCalendar 반영, lastEarningsRefreshAt 기록 확인. 옛 수동 POST /api/events는 404. `node --check` 전부 PASS. 잔여 수동 참조 0(주석 정정). 적용엔 서버 재시작 필요.
- 가정/주의: Nasdaq 엔드포인트가 지역/차단으로 실패하면 earningsEvents 빈 채로 안전 동작(이벤트 차단 없음). 실적 시각은 마감 후 가정(estimated).

### 2026-06-28 — Codex
- 문제/목적:
  - Claude의 UI/동적 뉴스·이벤트/장부 변경을 교차검증하고, Toss 증권 화면을 참고해 로컬 대시보드의 첫 화면 가독성과 현재 상태 인지를 개선.
  - `enabled=true`인데 `allocationPct=0`인 MU가 켜진 종목 카드에 남아 있어 사용자가 자동매매 ON으로 오해할 수 있는 모순을 정리.
- 진단(근거):
  - `/api/state`에서 MU는 `enabled=true`, `allocationPct=0`인데 기존 전략 평가는 매수 조건 통과 사유를 먼저 보여줄 수 있었고, 실제 주문 단계에서야 예산 0으로 스킵되는 구조였음.
  - Claude가 OFF 시 비중 0 자동 적용을 추가했지만, OFF 직전 비중을 보존하지 않아 다시 켤 때 0%가 그대로 남을 수 있었음.
  - 종목 설정 카드의 버튼은 정리됐지만, 백테스트 점수/변경 비교/추천 이유가 항상 펼쳐져 데스크톱에서도 텍스트 밀도가 높았음.
  - 서버 시작 시 뉴스/캘린더/실적/학습 자동 갱신 호출은 내부에서 대부분 에러를 잡지만, 저장 실패 같은 2차 오류는 미처리 Promise로 남을 수 있었음.
- 수정 내용:
  - 상단에 `현재 운영 요약` 패널 추가: 주문 잠금, 장부 모드, 실제 배정 종목, 검증 상태, 다음 확인 액션을 한 줄 대시보드로 표시.
  - 켜져 있지만 비중 0%인 종목은 요약 경고와 종목 카드에서 `관찰 전용`으로 표시하고, 전략 평가도 `배정 비중 0% — 새 매수 제외` 사유의 HOLD로 내려가게 수정.
  - 종목 OFF 시 이전 비중을 `pausedAllocationPct`로 보존하고, 다시 켤 때 사용자가 직접 0%를 저장한 경우가 아니면 직전 비중(없으면 10%)을 복구.
  - 종목 설정의 긴 추천 상세는 기본 접힘(`변경/이유 보기`, `검증 상세 보기`)으로 바꿔 화면 밀도를 낮춤.
  - 서버 시작 시 자동 갱신 호출에 `.catch(() => {})`를 붙여 초기 비동기 실패가 프로세스에 새 오류를 만들지 않게 함.
  - `package.json` 설명을 레버리지 ETF 전용 표현에서 adaptive US stock/ETF 전략으로 정정.
- 건드린 파일/함수:
  - `server.js`: startup refresh calls, `PATCH /api/targets/:symbol`
  - `src/strategy.js`: `evaluateTarget`
  - `public/index.html`: overview panel
  - `public/app.js`: `renderOperationSummary`, `appendTargetCard`, `renderTargetRecommendationNote`
  - `public/styles.css`: overview/no-allocation/recommendation-details styles
  - `package.json`
- 검증 방법과 결과:
  - `node --check server.js`, `for f in src/*.js public/app.js scripts/*.js; do node --check "$f"; done`, `git diff --check` PASS.
  - 단위성 스크립트: `allocationPct=0`인 활성 종목이 `HOLD`와 `배정 비중 0% — 새 매수 제외`를 반환함 확인.
  - 서버 단일 인스턴스 재시작 후 `/api/state`: Toss API connected, paper ledger alive, botBudget `$100`, validation basis `paper`, learning report present, MU signal HOLD/0% 사유 확인.
  - `POST /api/events/refresh` 200 — TSM/WDC 실적 일정 자동 수집 유지. `POST /api/learning/report` 200 — 현재 paper 세션 스코프 리포트 생성 확인.
  - Chrome QA: localhost 새 코드 로드, 콘솔 error/warn 없음, 가로 overflow 없음, 비활성 종목 접힘 유지, 요청한도 카드 없음, editor 버튼은 `정밀추천`/`삭제`만 존재, 추천 상세 기본 접힘.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 현재 MU의 0% 비중은 운영 데이터에서 임의로 복구하지 않았음. 실제 매수 배정에 넣으려면 전체비중 추천 적용 또는 직접 비중 수정이 필요함.
  - `pausedAllocationPct`는 이후 OFF→ON 토글부터 효과가 있다. 과거에 이미 0%가 된 종목은 이전 비중 정보가 없으면 ON 복구 시 10% 폴백을 쓴다.

### 2026-06-28 — Codex
- 문제/목적:
  - 하드코딩 또는 느슨하게만 연결된 기능을 재점검. 특히 "종목 추가 → 회사명/뉴스/태그/이벤트/전략 기본값" 흐름이 실제로 유기적으로 이어지는지 확인.
- 진단(근거):
  - `src/news.js`는 태그 생성은 `tickers.js` 공유 matcher를 쓰지만, `detectTopic`은 MU/TSM/WDC/GOOGL/SNDK if-chain으로 남아 있어 새 종목 뉴스 요약 주제가 "종목 뉴스"로 뭉개질 수 있었음.
  - `POST /api/targets`는 심볼만 저장해 미등록 티커의 회사명 기반 뉴스 검색/별칭 매칭이 약했음. `tickers.js`는 name에서 별칭을 추정하지만, name 자체가 심볼이면 효과가 제한됨.
  - 새 종목 추가 기본값에서 `allocationPct: Number(body.allocationPct || 10)`처럼 falsy 기본값을 써서 사용자가 0% 관찰용 종목을 명시해도 10%로 바뀔 수 있었음.
  - 뉴스 기본 심볼/맥락 티커/거시 검색어는 코드 상수로만 조정 가능했음.
- 수정 내용:
  - `src/marketData.js`에 `getExternalSymbolMeta(symbol)` 추가. Yahoo Finance chart meta에서 `longName/shortName/instrumentType/exchangeName`을 24시간 캐시로 가져옴. 기존 일봉 조회도 같은 Yahoo chart helper를 쓰도록 정리하고 12초 timeout 적용.
  - `POST /api/targets`가 티커 추가 전 외부 메타를 조회해 `Apple Inc. (AAPL)` 같은 표시명을 자동 저장하고, 메타 출처를 notes에 남김. 메타 실패 시 기존처럼 심볼만 저장해 기능은 막지 않음.
  - `src/tickers.js`에 `displayNameFor`, `inferLeverage`, `contextTickers` 추가. MUU/SNXX/SOXL 프로필과 배율 힌트를 보강해 레버리지 후보도 같은 프로필 경로를 타게 함.
  - `src/news.js`의 topic 분류를 하드코딩 if-chain에서 태그/추적 심볼/프로필 기반으로 전환. 종목 태그를 일반 주제 태그보다 먼저 보존해 새 종목 관련 기사가 "종목 뉴스"로 뭉개지지 않게 하고, 계산된 `topic`도 `state.news`에 저장되도록 함. `NEWS_BASE_SYMBOLS`, `NEWS_CONTEXT_TICKERS`, `NEWS_MACRO_QUERY_TERMS` 환경변수로 기본 뉴스 범위를 조정 가능하게 함.
  - 새 종목 숫자 기본값은 `numberWithDefault`로 바꿔 0을 명시한 경우 보존.
  - README에 종목 추가 자동 연결과 뉴스 관련 env 설정을 문서화.
- 건드린 파일/함수:
  - `src/marketData.js`: `getExternalSymbolMeta`, `fetchYahooChart`
  - `src/tickers.js`: `contextTickers`, `displayNameFor`, `inferLeverage`, MUU/SNXX/SOXL profiles
  - `src/news.js`: env-driven base/context terms, tag-based `detectTopic`
  - `server.js`: `POST /api/targets`, target display/meta helpers, numeric defaults
  - `README.md`
- 검증 방법과 결과:
  - `node --check server.js`, `for f in src/*.js public/app.js scripts/*.js; do node --check "$f"; done`, `git diff --check` PASS.
  - 모듈 검증: `getExternalSymbolMeta("PLTR")`가 `Palantir Technologies Inc.`를 반환, `queryKeywords`/`displayNameFor`가 회사명 기반으로 동작, `inferLeverage("TQQQ", "ProShares UltraPro QQQ") → 3x`, `inferLeverage("SSO", "ProShares Ultra S&P500") → 2x` 확인.
  - 격리 mock 서버(`DATA_DIR=/tmp/...`, `PORT=3998`, Toss 키 공란)에서 `POST /api/targets {symbol:"AAPL", allocationPct:0}` 결과: `name="Apple Inc. (AAPL)"`, `allocationPct=0`, `leverage="1x"`, `notes="Yahoo Finance · EQUITY · NMS"` 확인.
  - 최신 서버에서 `POST /api/sync-news` 후 뉴스 태그/주제가 활성 종목·프로필 기반으로 붙는지 확인.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - Yahoo 메타 조회가 실패하면 종목 추가는 막지 않고 기존처럼 심볼 기반으로 진행한다. 이 경우 뉴스 검색은 심볼 중심으로만 동작한다.
  - 섹터 분류는 여전히 `TICKER_PROFILES`에 없는 새 티커의 경우 자동으로 알 수 없으므로, 깊은 업종별 뉴스 관련도까지 원하면 추후 Yahoo quoteSummary/별도 프로필 소스 연결이 필요하다.

### 2026-06-28 (4) — Claude (Opus 4.8) : 안전설정 패널 자동저장 + 저장버튼 제거
- 목적: 종목설정 카드처럼, 안전설정/자동투자 켜기 패널도 필드·체크박스 변경 시 자동 저장하고 "설정 저장" 버튼을 없앤다. "안전설정 추천"은 한 번 누르면 계산→입력칸 반영→자동 저장(확인창 없음).
- 수정 내용:
  - `public/app.js`: `#saveSettings` 리스너/함수 제거. `.control-panel .control-grid input`은 input(debounce 800ms)+change(즉시), `.control-panel .choice-grid input`(체크박스)은 change 즉시로 `scheduleSettingsAutoSave` 연결(PATCH /api/settings → refresh, 저장 상태 표시). `recommendSafetySettings`를 confirm 제거하고 `/api/recommendations/safety/apply` 한 번으로 적용·저장. 죽은 `applySafetyInputs` 제거.
  - `public/index.html`: `설정 저장` 버튼 제거, `#settingsSaveStatus`(자동 저장 상태 칩) 추가, 버튼 라벨 `안전설정 추천·적용`, 패널 설명에 자동저장 명시. 모니터링 토글은 별도(영향 없음).
- 검증: `node --check public/app.js` PASS. 정적 파일 서빙 확인(scheduleSettingsAutoSave 존재, #saveSettings 없음, #settingsSaveStatus 존재), 죽은 참조 0. 프런트 전용이라 서버 재시작 불요(브라우저 하드 리프레시).

### 2026-06-28 — Codex
- 문제/목적:
  - Claude의 안전설정 자동저장 변경을 교차검증하고, 저장 버튼 제거 후 입력 중 값 유실/요청 경합/브라우저 콘솔 오류가 없는지 확인.
- 진단(근거):
  - 자동저장 PATCH가 동시에 여러 번 날아갈 수 있어 늦게 처리된 이전 입력이 최신 값을 덮을 가능성이 있었음.
  - 숫자 input을 잠깐 비우면 `Number("") === 0` 때문에 임시 입력값이 0으로 저장될 수 있었음.
  - 주기적 `refresh()`가 사용자가 입력 중인 폼 값을 서버 값으로 다시 덮을 수 있었음.
  - PATCH `/api/settings` 응답은 `/api/state`처럼 `runtime`이 보강된 상태가 아니므로, 저장 응답을 바로 렌더링하면 `runtime.mockMode` 참조 오류가 날 수 있었음.
  - `/favicon.ico` 미존재가 정적 파일 예외로 처리되어 브라우저 콘솔에 500 오류가 남았음.
- 수정 내용:
  - 안전설정 자동저장을 직렬화하고, 저장 중 추가 변경은 최신 폼 값으로 한 번 더 저장하도록 큐 처리.
  - 숫자 input이 비었거나 HTML min/max/step 검증을 통과하지 못하면 자동저장을 보내지 않고 `입력 확인` 상태만 표시.
  - 저장 대기/진행 중이고 해당 패널에 포커스가 있을 때는 `renderSettings()`가 input 값을 덮어쓰지 않도록 보존.
  - 저장 완료 후에는 PATCH 응답을 직접 렌더링하지 않고 `/api/state`를 다시 읽어 runtime/validation이 포함된 상태로 렌더링.
  - `/favicon.ico`는 204로 조용히 응답하고, 없는 정적 파일은 500이 아니라 404로 응답.
- 건드린 파일/함수:
  - `public/app.js`: settings auto-save queue, settings form validation/preservation, `renderCurrentState`, `renderSettings`
  - `server.js`: `serveStatic`
- 검증 방법과 결과:
  - `node --check public/app.js`, 전체 JS `node --check`, `git diff --check` PASS.
  - Headless Chrome(시스템 Chrome)으로 localhost 로드: 설정값 렌더링, 저장 버튼 없음, 가로 overflow 없음 확인.
  - `cashBufferUsd`를 빈 값으로 만들면 상태가 `입력 확인`이고 서버 값은 20 유지. 다시 20 입력 시 `저장됨` 및 서버 값 20 유지 확인.
  - 서버 재시작 후 `/favicon.ico` 204, Headless Chrome 콘솔/네트워크 오류 없음 확인.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 자동저장 검증은 운영 값과 같은 `cashBufferUsd=20`으로 복원 저장하는 방식으로 진행했으며, 설정 의미는 바꾸지 않았음.

### 2026-06-28 — Claude (Opus 4.8) : 전면 교차감사 + 발견 버그 2건 수정
- 목적: 사용자 요청 — 원격 레포와 로컬 코드/문서를 전수 검토하고, 수정된 것들이 의도대로 올바른지 판단하고 모순·실수를 모두 찾아냄.
- 감사 범위/결과(이상 없음 확인): calendar.js(twoSided→"혼조" 0.3배·biasLabel·macroTone §FF/§GG 일관), strategy.js evaluateTarget(drop-block 재활성 §HH·calendarRisk·비중0→HOLD·레거시 metrics 제거 §II 정상), eventRisk.js(하드코딩 제거→state-driven·relevanceMatcher 공유), trader.js runOnce(페이퍼: `syncExecutedBotOrders({updatePortfolio:liveTradingAllowed})`로 실장부가 페이퍼 장부를 안 덮음 — 과거 churn 해결·페이퍼세션 clean-slate+ledgerHistory 일관), earnings.js(이벤트 형태 eventRisk와 완전 호환·postBlockHours 있음), server.js PATCH targets(pausedAllocationPct 보존/복원·enabled→0 정상), validation.js(BENCHMARK QQQ·tradeMetricScope 페이퍼 스코프), news.js(`\bai\b` 단어경계라 raises 오탐 없음), UI 엔진버전 비교(isCurrentEngineResult가 alias 인식), customEvents→earningsEvents 리네임 완결(코드 잔존 0). 격리 mock 부팅: 3엔드포인트 200·엔진 "Adaptive Momentum Guard v0.9"·벤치 QQQ·ledgerMode paper·paperSession active·earningsEvents 자동수집·macroTone "호재 우위"·에러 0.
- **발견·수정 버그 1 — `saveTraderState`가 `earningsEvents`를 보존하지 않음(`src/store.js`)**: news/economicCalendar는 `current`(디스크 최신)에서 보존하는데 earningsEvents는 누락 → 서버 타이머(earnings.js 12h·종목 변경 시)가 갱신한 실적 이벤트를 트레이더 틱이 자기 stale 스냅샷으로 되돌릴 수 있었음(lost update — 이 함수가 막으려던 부류 그대로, 실적 차단이 최대 12h 누락 가능). 수정: `earningsEvents: current.earningsEvents` 추가(news/economicCalendar와 동일 패턴).
- **발견·수정 버그 2 — 검증 MDD가 페이퍼 세션 스코프가 아님(`src/validation.js` buildValidation)**: 승률·손익비는 paperSession 스코프인데 MDD는 전체 `equityCurve`로 계산. `wipeBotBook`(페이퍼 재시작)이 equityCurve를 안 비워서, 상품 변경(레버리지→1x) 후에도 옛 에폭의 큰 낙폭이 MDD에 남아 현 전략 위험을 과대표시. 수정: 페이퍼 세션 활성 시 `paperSession.startedAt` 이후 자산곡선만 MDD 계산(승률·손익비와 기간 일치). 단위검증: 옛 −40%+현 −5% 혼합 곡선 → 스코프 후 5%만 반영. (디스플레이 전용 — 매매 로직 무영향.)
- 검증: `node --check` PASS, 격리 부팅 정상, Fix#1 보존 라인 확인, Fix#2 단위테스트 5% 확인.
- 가정/주의: 두 수정 모두 저위험(필드 보존/디스플레이 스코프)·기존 패턴 일치. 라이브 반영은 재시작 후. 추가 관찰: macroTone은 server.js(디스플레이)와 getCalendarRisk(예산) 두 곳에서 같은 함수로 각각 계산(중복이나 동일 입력이라 불일치 아님 — 비용 무시 가능, 미수정).
- **발견·수정 버그 3(후속) — 벤치마크 현금흐름이 페이퍼 세션 기간과 불일치(`src/validation.js` buildCapitalFlows)**: 봇 수익률(botReturnPct)·MDD·승률은 페이퍼 세션 스코프인데, 벤치마크 현금흐름은 `botStartedAt`+옛 budget-add 기준이라 **봇과 벤치마크가 다른 기간을 비교**(초과수익이 무의미해질 수 있음). 페이퍼 세션 시작과 botStartedAt이 갈리면(상품 변경 시 paperSession.startedAt만 갱신) 봇은 짧은 페이퍼 기간, 벤치마크는 긴 기간이 됨. 수정: 페이퍼 세션 활성 시 현금흐름을 **`paperSession.startedAt`에 현재 시드 단일 투입**으로(옛 botStartedAt·budget-add 제외) → 봇·벤치마크 같은 기간 비교. 라이브 모드는 기존 botStartedAt+budget-add 로직 유지. 단위검증: 페이퍼 06-27 시작·시드 100 → 벤치 QQQ를 06-27 종가 기준으로 계산(06-21 아님), 봇 10% vs 벤치 5% = 초과 +5%p 동일기간.

### 2026-06-28 — Codex
- 문제/목적:
  - 사용자가 다른 LLM과 토론할 수 있도록, 반도체 추세 이탈 시 봇에 추가할 레짐 로테이션 후보(XLE/GLD/LMT 등)의 추천·근거·반례를 문서화.
- 진단(근거):
  - 현재 봇은 MU/WDC/TSM 중심이라 반도체/메모리 추세가 꺾이면 대부분 쉬는 구조.
  - 현재 봇 로직 기준 재검증 결과, XLE/GLD 추가 방향은 타당하지만 "2022년에 56% 날 롱" 같은 표현은 재현되지 않음. 2022년 단일 후보 롱 노출은 XLE 13.4%, GLD 7.0%, LMT 8.0%.
  - `redistributeUnusedAllocation` 관점에서는 2022년에 반도체 신호가 꺼진 날이 많고, XLE/GLD가 전체 거래일의 34.3%에서 대체 예산을 가져갈 수 있어 전략적 의미가 있음.
- 수정 내용:
  - `docs/regime-rotation-candidates.md` 신규 작성.
  - 문서에 최종 추천(`MU 28 / WDC 20 / TSM 16 / XLE 20 / GLD 16`), LMT paper 관찰안, XOM/RTX 보류, SH/PSQ 고위험 paper 분리 판단을 정리.
  - 2022 bear, 2024 AI bull, 2025-26, 10y-ish 구간의 봇 전략 수익/롱 노출/재분배 효과/상관 근거와 다른 LLM 토론 질문 포함.
- 건드린 파일/함수:
  - `docs/regime-rotation-candidates.md`
- 검증 방법과 결과:
  - 공식 링크 응답 확인: XLE(State Street) 200, GLD(SPDR) 200, PSQ(ProShares) 200, Lockheed annual reports 200, Exxon investor site 200, RTX company info 200.
  - 문서 내용 수동 검토 완료.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 문서의 백테스트 수치는 일봉 기반이며 실전 체결/환율/수수료/장중 갭을 완전히 반영하지 않는다.
  - XLE/GLD/LMT/RTX/XOM 후보는 현 신규 후보 기본 파라미터 기준이므로, 종목별 정밀추천을 적용하면 결과가 달라질 수 있다.

### 2026-06-28 — Claude (Codex 레짐 로테이션 문서 반론·보완)
- 문제/목적:
  - 사용자 요청: Codex의 `docs/regime-rotation-candidates.md`를 검토하고, Claude의 추천·근거를 작성해 둘이 토론 → 최종 후보 목록을 결정.
- 진단(근거 — 봇 실제 로직 `backtestTarget`로 독립 재현):
  - **Codex 2022 주장 재현 성공**: XLE +20.0%(Codex +27.6%), GLD +4.3%(+4.0%), LMT −1.2%(−2.0%) — 방향 일치. XOM만 +34.7%↔−8.6%로 갈림(워밍업 윈도우 민감 = 단일주 노이즈 근거).
  - **핵심 신규 발견(3-레짐 확장)**: Codex가 2022 위주로 본 것을 2022/2024/2025-26 전부 돌리니 우선순위가 바뀜.
    - GLD: +4.3 / +9.2 / +48.0 → **세 레짐 전부 플러스, 전천후**.
    - XLE: +20.0 / **−22.4 / −10.4** → 2022 전용, 유가 횡보(24~25)엔 휩쏘 출혈.
    - RTX: +6.7 / +26.9 / +39.7 → 최근 두 레짐 비반도체 최강(Codex는 보류였음).
    - LMT: −1.2 / +0.6 / +7.2 → 전 구간 약함.
- 합의(Codex 수용): 롱 56% 표현 철회(프록시 오류, 실제 ~13%), XLE>XOM, LMT paper ≤5%, SH/PSQ 분리, GOOGL·채권 제외.
- 반론(Codex와 차이): ① **GLD 1순위/XLE 2순위로 역전**(GLD 전천후, XLE 2022 의존). ② XLE 항상-켜기는 강세장 출혈 → **SOXX 레짐게이트 또는 비중 축소(≤12%)**. ③ **RTX 보류→paper 승격**(최근 최강·보완재). ④ 비중 슬리브 내부 `GLD≥XLE`로(Codex `XLE20/GLD16`→`GLD20/XLE16`).
- 최종 제안 비중: `MU 28 / WDC 20 / TSM 16 / GLD 20 / XLE 16`(또는 XLE 축소형 `…/GLD 20/XLE 12`). 다음 작업 권고: **SOXX/SMH 장기선 아래일 때만 XLE/GLD 헤지 슬리브 활성화하는 레짐 게이트** 도입(XLE 강세장 출혈 구조 제거). paper 우선·검증 게이트 후 실매매.
- 건드린 파일: `docs/regime-rotation-candidates.md`(## Claude 반론·보완 섹션 추가). 코드 변경 없음(분석·문서 단계).
- 검증: `backtestTarget` 3-레짐 재현 스크립트 실행(scratchpad), 2022 수치 Codex와 대조 일치 확인.
- 가정/주의: 재현 슬라이스는 워밍업 210일 포함이라 Codex의 연도-격리와 경계값 차이 가능(방향성 신뢰). 후보는 신규-후보 기본 파라미터 기준 — 종목별 정밀추천 적용 시 수치 달라질 수 있음. 실매매 편입은 사용자 결정(자동 적용 안 함).

### 2026-06-29 — Claude (QQQ 기준 2차 검증 · PPA 재현 불가 발견)
- 문제/목적:
  - 사용자 새 기준: "반도체 하락기에 봇이 대체종목으로 버는 수익이 QQQ 단순보유보다 높아야(데이터상)". Codex가 이 기준으로 재검증해 XLE/GLD 상시편입 보류·PPA를 paper 1순위로 올림. 사용자가 Claude에게 Codex 의견 확인 + 재검증 요청.
- 방법: 봇 `runBacktestSimulation`을 일별 자산곡선까지 충실 포팅(scratchpad). 워밍업은 창 이전 데이터로만, 수익은 SOXX 200일선 하회창(2018/2022/2025 3개) 기간만, 같은 날짜 QQQ 단순보유와 비교(Codex 워밍업-슬라이스 비판 수용). 파라미터 3세트 견고성 교차.
- 핵심 발견:
  - **PPA 재현 불가**: Codex +1.2%·3/3 플러스(새 1순위) ↔ Claude −6.1%·0/3(중기), 그리고 단기 −1.6%·장기 −6.4%로 **3파라미터 전부 마이너스**. Codex 결과가 어떤 파라미터에서도 안 나옴 → PPA 1순위 승격 보류 권고.
  - **GLD는 강등 금지**: 3파라미터 전부 평균 플러스(+2.5/+0.5/+0.9)인 유일한 비인버스 롱. Codex의 −1.6% 강등과 반대.
  - **XLE 견고하게 약함**(3세트 −3.0/−5.0/−2.4) — 둘 다 합의. 상시 X, 게이트/소액만.
  - **SH(인버스) 파라미터에 부호 뒤집힘**(+6.9→−2.8→−3.2) — "하락창 최강"은 우연. 고위험 paper 전용.
  - **재프레이밍**: "하락창에서 QQQ 초과"는 QQQ가 빠지는 구간이라 현금만 들고도 충족(약한 잣대). 진짜 "플러스로 번다"를 견고히 만족하는 비인버스 롱은 GLD 하나뿐, 그마저 소폭. → 데이터는 "하락기에 QQQ 이기며 버는 엔진"을 보장 못 함. 봇 강점은 현금 회피(이미 QQQ 이김)+GLD 소폭 보탬.
- 최종 제안: paper 1순위 GLD(PPA는 재현 원인 규명 먼저), XLE는 SOXX 게이트/소액, SH/PSQ 별도 고위험 paper, PPA/XOM/RTX/LMT/채권/GOOGL 제외. 대체 슬리브 기대치 = 수익엔진 아닌 방어+소폭 스무더.
- 건드린 파일: `docs/regime-rotation-candidates.md`(## Claude 2차 검증 섹션 추가). 코드 변경 없음.
- 검증: 충실 포팅 windowed 백테스트 + 파라미터 3세트 교차(scratchpad). 2022 XLE/GLD는 Codex와 근사 → 포팅 신뢰. PPA/SH는 갈림 → Codex에 재현 원인(파라미터·측정법·배당처리·창정렬) 규명 요청 기록.
- 가정/주의: 일봉·실전갭/수수료 미반영. 파라미터 민감 — 단일 결과 신뢰 금지가 핵심 교훈. 실매매 편입은 사용자 결정·검증 게이트 후.

### 2026-06-29 — Claude (오늘 토론 요약 문서화, Codex 검토 요청)
- 목적: 사용자 요청 — 오늘 대화(요구사항+Claude 의견)를 토론문서에 정리해 Codex 검토 받기.
- 내용: `docs/regime-rotation-candidates.md`에 "## 사용자 요구사항 + Claude 종합 의견 (2026-06-29)" 섹션 추가.
  - 사용자 요구 진화: 섹터 발굴 → 반도체 공백기 수익 → **QQQ 초과 기준** → GOOGL 제외 → "항상 버는 봇" → **최종 직감: 멀티엔진보다 모멘텀+GLD+현금**.
  - Claude 결론: ① 엔진은 모멘텀(쉬는 게 정상), ② 홀리그레일 없음(항상-버는-듯한 전략이 더 위험), ③ 멀티엔진은 판별지연+전환휩쏘로 어려움, ④ 검증상 GLD만 견고·PPA 미재현·SH 취약, ⑤ "하락창 QQQ초과"는 약한 잣대(현금만으로 충족), ⑥ **사용자 직감 옳음 — 단순 모멘텀+GLD+현금이 베스트**(레짐 판별기 불필요, redistributeUnusedAllocation이 자동 로테이션).
  - 제안: paper `MU 32 / WDC 24 / TSM 20 / GLD 24`, GLD 상시 종목, 검증 후 소액 실거래. Codex 검토질문 5개 기록.
- 건드린 파일: `docs/regime-rotation-candidates.md`. 코드 변경 없음(아직 GLD 미등록 — 사용자 확인 대기).

### 2026-06-28 — Codex (QQQ 벤치마크 기준 레짐 후보 재검증)
- 문제/목적:
  - Claude의 GLD 1순위/XLE 축소/RTX paper 승격 의견을 재검증하되, 사용자가 추가한 기준인 "반도체 하락 시 대체 종목을 매매하더라도 QQQ 단순 보유보다 데이터상 나아야 한다"를 최우선 비교 기준으로 반영.
- 진단(근거):
  - Claude의 3-레짐 수치는 단일 후보 `backtestTarget`에 워밍업 210일 슬라이스를 포함해 돌린 방식이라, 지표 계산용 워밍업 기간의 거래 수익이 비교 구간 성과에 섞일 수 있음. QQQ와 공정하게 비교하려면 지표는 과거 데이터를 쓰되 성과 계산은 시작일 이후로 고정해야 함.
  - 현재 봇 안전설정($100 시드, $20 현금버퍼, 종목별 최대 35%, `redistributeUnusedAllocation=true`)과 `evaluateTarget` 조건으로 포트폴리오 형태를 다시 시뮬레이션한 결과, `GLD20/XLE16` 조합은 2022년엔 QQQ를 크게 이기지만 2024년 QQQ 강세장과 10년 누적 구간에서는 QQQ 미달. 2025-26 초과수익은 대체 후보가 아니라 MU/WDC/TSM 반도체 코어가 만든 효과.
  - SOXX가 200일선 아래였던 3개 하락창(2018-10~2019-02, 2022-03~2022-12, 2025-02~2025-05)만 따로 보면 Claude `GLD/XLE` 조합은 2025 하락창에서 -6.9%로 QQQ -3.3%보다 나빴음. 즉 사용자 기준상 그대로 채택 불가.
  - 후보 스크리닝에서 `PPA`는 세 하락창 모두 작게 플러스, `IEF`는 2/3 플러스, `SH`는 3/3 플러스였으나 SH/PSQ는 인버스 구조라 고위험 paper 전용으로 분리해야 함.
- 수정 내용:
  - `docs/regime-rotation-candidates.md` 상단에 최신 재검증 업데이트를 추가해 기존 `XLE+GLD` 즉시 실매매 결론보다 하단 QQQ 벤치마크 재검증 섹션을 우선하도록 명시.
  - 문서 하단에 `Codex QQQ 벤치마크 재검증` 섹션 추가: 포트폴리오별 QQQ 비교, SOXX 200일선 하회 구간 비교, 후보 스크리닝 요약, 최신 결론과 paper 후보안 정리.
  - 최신 판단을 `XLE20/GLD16` 실매매 편입에서 `PPA/IEF paper 검증 + XLE 축소/게이트 + SH/PSQ 고위험 paper 분리`로 변경.
- 건드린 파일/함수:
  - `docs/regime-rotation-candidates.md`
  - `WORKLOG.md`
- 검증 방법과 결과:
  - Yahoo Finance adjusted daily chart 데이터(2016-06-27~2026-06-26)를 `src/marketData.js` 경로로 수집.
  - 현재 `evaluateTarget` 조건, 편도 비용 0.1%, 현재 안전설정 기반 포트폴리오 시뮬레이션 실행.
  - `git diff --check` PASS.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 이번 변경은 문서/판단 정정이며 실제 종목 편입이나 매매 로직 변경은 하지 않았음.
  - `PPA`/`IEF`는 표본 수가 작고 수익폭이 낮아 실매매가 아니라 paper 후보로만 봐야 함.
  - `SH`/`PSQ`는 데이터상 하락창 성과가 좋아도 일반 롱 엔진에 섞으면 의도치 않은 인버스 베팅이 되므로 반드시 고위험 paper 엔진에서 분리 검증해야 함.

### 2026-06-30 — Codex
- 문제/목적:
  - 사용자 제보: MU 티커 비중이 자꾸 0%로 바뀜. 이유가 있는 자동 조정이면 화면에 사유가 보여야 하고, 사유 없는 변경이면 버그인지 확인 필요.
- 진단(근거):
  - `data/state.json`의 최근 `learning.recommendationEvents`와 `automation.lastActions`에 `전체비중 추천 적용: MU 0%, TSM 35.4%, WDC 64.6%` 기록이 남아 있었음.
  - 해당 추천 사유는 `MU: ... 백테스트 부족 ... 새 비중 0%`. 즉 사용자가 직접 바꾼 것이 아니라 `autoWeightRecommendations`가 외부 백테스트 데이터 실패/부족을 실제 전략 제외 신호처럼 해석해 0%를 적용한 것.
  - `buildBacktests`가 외부 데이터 조회 실패를 `{available:false, score:0}`으로 넘기고, `recommendPortfolioWeights`가 이를 snapshot/lastStrategyReview보다 우선해 기존 배정 종목도 `canAllocate=false`로 만드는 구조였음. 이는 정상 투자 판단이 아니라 일시 데이터 실패 처리 버그.
- 수정 내용:
  - `src/strategy.js`: 전체비중 추천에서 외부 백테스트가 실패해도 사용 가능한 snapshot backtest 또는 `lastStrategyReview`를 먼저 폴백. 기존 비중이 있는 종목의 백테스트 데이터가 부족하면 추천을 `dataBlocked=true`, `grade="데이터 대기"`로 두고 기존 비중을 보존하도록 변경.
  - `server.js`: 전체비중 추천 적용 경로를 `applyPortfolioWeightRecommendation`으로 통합하고, 실제 비중이 바뀔 때 target별 `lastAllocationChange`에 출처/이전값/이후값/사유/추천점수를 기록. 종목 토글·수동 비중 편집도 같은 기록을 남김.
  - `public/index.html`·`public/app.js`·`public/styles.css`: 종목 카드에 최근 비중 변경 사유(`allocation-note`) 표시. 자동추천/수동변경/OFF/복구 출처를 한국어 라벨로 표시.
  - 운영 state 복구(gitignore): MU 0% 오류 상태를 최근 정상 균형 비중 `MU 41.4 / TSM 21.5 / WDC 37.1`로 복구하고, 각 종목 `lastAllocationChange` 및 `automation.lastActions`에 복구 사유 기록.
- 건드린 파일/함수:
  - `src/strategy.js`: `recommendPortfolioWeights`, `scoreTargetWeight`, `normalizeExistingWeights`
  - `server.js`: weight apply paths, target PATCH allocation history helpers
  - `public/index.html`: target card allocation note
  - `public/app.js`: `formatAllocationChange`, target card rendering
  - `public/styles.css`: `.allocation-note`
  - `WORKLOG.md`
- 검증 방법과 결과:
  - `node --check server.js`, `node --check public/app.js`, `for f in src/*.js; do node --check "$f"; done`, `git diff --check` PASS.
  - 모듈 테스트: 기존 비중 `MU 42.3%`인 상태에서 MU 백테스트 실패를 주입하면 추천이 `dataBlocked=true`로 나오고 `MU 42.3%`를 보존함 확인.
  - `/api/state` 확인: 복구 후 `MU 41.4 / TSM 21.5 / WDC 37.1` 및 `lastAllocationChange` 기록 확인.
  - 새 코드로 서버 포그라운드 실행 후 `/api/recommendations/weights`: `MU 36.9 / TSM 21.7 / WDC 41.3`, `dataBlocked` 없음, MU 백테스트 75/100으로 정상 계산 확인.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 이번 변경은 자동추천이 "데이터 부족"만으로 기존 배정 종목을 0%로 만들지 못하게 하는 방어다. 실제 전략 점수가 충분히 낮거나 이벤트가 막는 경우에는 여전히 비중 축소/0% 추천이 가능하며, 그 경우 카드의 비중 변경 사유에 표시된다.
  - 백그라운드 `nohup` 실행은 현재 Codex 실행 환경에서 즉시 종료되어, 서버 지속 실행 검증은 포그라운드 프로세스로 수행했다.

### 2026-06-30 — Codex (MU 백테스트 부족 문구 정정)
- 문제/목적:
  - 사용자 추가 지적: MU가 오래된 대형 종목인데 "백테스트 부족"이 뜨는 것은 이상함. 실제로 데이터가 부족한지, 아니면 다른 실패가 잘못 표시된 것인지 확인.
- 진단(근거):
  - 현재 `getExternalDailyCandles("MU", {range:"5y"})` 결과는 1,254개 일봉(2021-06-30~2026-06-29)으로 충분했고, `robustBacktestTarget`도 `available=true`, 점수 75/100으로 정상.
  - 과거 추천 이벤트를 보면 같은 MU가 `백테스트 75/100`과 `백테스트 부족`을 몇 시간 간격으로 오갔음. 이는 실제 데이터 부족이 아니라 Yahoo 일봉 조회 timeout/실패 또는 추천 계산 실패가 `백테스트 부족`으로 뭉뚱그려 표시된 것.
- 수정 내용:
  - `src/strategy.js`: 백테스트 unavailable 사유를 `describeBacktestIssue`로 정리해 `외부 데이터 조회 실패: Operation timed out`처럼 원인을 표시. 기존 배정 종목은 "백테스트 대기(...; 기존 비중 보존)"으로 보여 실제 데이터 부족/일시 조회 실패를 구분.
- 검증 방법과 결과:
  - MU 외부 조회 실패를 강제로 주입한 추천 테스트에서 `MU 41.4%` 기존 비중 보존 + `외부 데이터 조회 실패: Operation timed out` 사유 표시 확인.
  - 실제 MU 5년 일봉 1,254개 및 백테스트 점수 75/100 확인.
- 가정/주의(다른 에이전트가 검토해야 할 점):
  - 과거 이벤트에는 원문 에러가 저장되지 않아 당시 정확한 네트워크 에러 문자열은 복구 불가. 다만 정상/부족이 교대로 나타난 패턴과 현재 데이터 충분성상 "진짜 부족"은 아님.

### 2026-11-01 — 작성자: Codex (개인정보·계좌 보안 점검)
- 문제/목적: fork 코드의 개인정보·계좌정보 외부 유출 경로와 접근 제어 점검.
- 진단(근거): 명시적 원작성자 전송 코드는 발견하지 못함. loopback 프록시 인증 우회 조건, RSS URL 미검증 innerHTML, 임의 TOSS_BASE_URL 비밀키 전송, CSRF/HTTP/평문 데이터 보관 위험 확인.
- 수정 내용: 보안 점검 보고서 작성. 운영 코드·설정 변경 없음.
- 건드린 파일/함수: docs/security-review-2026-11-01.md, WORKLOG.md.
- 검증 방법과 결과: 합성 request/response 인증 assert 및 fetch 대체 합성 비밀키 전송 assert 통과. Git 60개 커밋에서 지정 키 패턴 일치 없음. 외부 npm 의존성 없음. 실제 서버·봇·주문 실행 없음.
- 가정/주의(다른 에이전트가 검토해야 할 점): 운영 .env/data가 이 사본에 없어 운영 노출·과거 유출은 판단 불가. 검토 의견: 기존 로컬 전제의 인증 보류 판단은 프록시/터널 사용 시 성립하지 않음. 라이브 관련 수정은 사용자 확인 후 진행.

### 2026-11-01 — 작성자: Codex (Oracle 신규 배포 준비·접근 경계 보완)
- 문제/목적: 사용자 fork의 Oracle Always Free 신규 설치를 준비하고, 직전 보안 점검의 주요 유출 경로를 보완.
- 진단(근거): loopback 프록시가 비밀번호 없는 요청을 허용하고, RSS 링크가 검증 없이 innerHTML에 들어갔으며, 임의 API 주소가 비밀키를 수신할 수 있었음. `.env` 로드 전에 store 모듈의 DATA_DIR이 결정되어 로컬 경로 설정이 무시될 수도 있었음. 설치 스크립트는 설정 완료 전에 서비스를 자동 시작했음.
- 수정 내용: 기본 loopback 바인딩·항상 비밀번호 요구·Host/Origin 검사·보안 헤더/CSP·JSON 요청 크기/타입 제한·RSS URL scheme/속성 처리. Toss HTTPS origin 고정·redirect 차단·timeout. env 모듈 선행 로드와 umask 0077. 포트 바인딩 성공 후 트레이더 시작. 신규 장부 전용 초기화 도구(기존 장부 덮어쓰기 금지), 자동시작 없는 설치 및 SSH 터널 배포 문서.
- 건드린 파일/함수: server.js, src/auth.js, src/env.js, src/tossClient.js, src/store.js, public/{app.js,index.html,theme.js,safeUrl.js}, scripts/init-deployment.js, tests/*.test.js, deploy/oracle/*, .env.example, README.md, package.json.
- 검증 방법과 결과: 합성 인증/Origin/API origin/RSS/redirect/초기화 검증 및 격리 HTTP 통합 검사 통과. 테스트에서 외부 API·트레이더 시작을 차단하고 임시 DATA_DIR만 사용. Node 구문 검사·bash -n·git diff --check 통과. 실제 계좌 연결·주문·클라우드 자원 생성 없음. 개인 운용 설정은 gitignore된 로컬 데이터에만 생성.
- 가정/주의(다른 에이전트가 검토해야 할 점): 매매 신호/점수/한도 로직 변경 없음. 신규 초기화는 기존 API 종목 추가 기본 전략값을 사용하며 해당 종목의 수익성 검증이 아님. 초기 모니터링·실거래·자동 비중/안전 변경 OFF. 기존의 인증 생략 옵션은 더 이상 동작하지 않고 원격 접속은 터널/허용 Host 설정 필요. Oracle 인증과 VM이 없어 원격 배포는 미완료. 계좌 상태 응답 최소화·인증 시도 제한 등 직전 보고서의 나머지 개선은 별도 작업이며 모든 보안 문제가 해결됐다는 뜻은 아님.

### 2026-11-01 — 작성자: Codex (WSL 우선 운영·클라우드 이전 준비)
- 문제/목적: Oracle 가입 지연으로 사용자 PC WSL에서 먼저 구성하고, 추후 클라우드로 전체 장부를 옮길 수 있도록 준비.
- 진단(근거): WSL2 systemd와 user manager 정상. 저장소가 /mnt/c에 있어 .env/data가 Linux 권한상 777로 표시됨. 키 미입력 상태이며 기존 초기 장부는 실제 주문/모니터링 OFF.
- 수정 내용: 외부 TOSS_ENV_FILE 선택 및 repo-local 비밀 없는 포인터 지원. WSL 홈 config 700/env 600, data 디렉터리 700/파일 600으로 복사 후 user service 설치·활성화. 시작/중지/로그/keepalive/중지 후 전체 장부 export 도구 추가. 기존 원본 장부는 삭제하지 않으며 목적지 별도 장부 병합을 거절. WSL 수명주기와 Windows 절전 영향, 클라우드 이사 절차 문서화. 개인 키·운용정보는 공개 코드/커밋에 포함하지 않음.
- 건드린 파일/함수: src/env.js, scripts/install-wsl.js, scripts/export-data.js, deploy/wsl/{manage.sh,README.md}, tests/env-file.test.js, package.json, README.md.
- 검증 방법과 결과: 보안 검사 8개 통과. systemd unit 검증 및 실제 user service active, loopback 3000만 수신 확인. 인증 없는 요청 401, 인증 후 HTML/모듈/state 200. 기존 시드/대상 보존, mock=true·live=false·monitoring=false 확인. 서비스 실행 중 backup 거절, 중지 후 전체 snapshot 생성 및 임시 복원 파일별 SHA-256 일치 확인. 비밀파일 snapshot 미포함, archive 600 확인.
- 가정/주의(다른 에이전트가 검토해야 할 점): 실제 Toss 키·계좌 연결은 사용자 입력 대기. 실거래 OFF 유지. Windows 로그인 자동실행/전원 정책은 변경하지 않음. user service만으로 WSL 생존을 보장하지 않으므로 keepalive 터미널이 필요하고 PC 중단 시 방어매도도 중단됨. 이사할 때 원본/목적지 봇 동시 실행 금지 및 최종 snapshot 사용. 매매 신호/점수/한도 로직 변경 없음.
