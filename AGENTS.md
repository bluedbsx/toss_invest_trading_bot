# AGENTS.md — AI 에이전트 협업 규칙

이 저장소는 사용자(Joyanggi)와 여러 AI 에이전트(**Codex**, **Claude**)가 함께 개발합니다.
서로의 작업을 교차 검증(cross-check)할 수 있도록 아래 규칙을 지킵니다.

- **원격 저장소(public):** https://github.com/Joyanggi/toss_invest_trading_bot.git (`origin`, 기본 브랜치 `main`)

## 0. 기능 단위 작업이 끝나면 커밋·푸시한다 (Codex·Claude 공통)
- **기능 추가, 버그 수정, 리팩터 등 "한 단위"의 작업이 완료되면, 그때마다 알아서 `origin/main`에 커밋·푸시한다.** 사용자가 매번 지시하지 않아도 된다.
- 커밋 메시지에 **작성 주체를 명시**한다.
  - Claude: 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>` 트레일러.
  - Codex: 메시지에 `Co-Authored-By: Codex <codex@openai.com>`(또는 본인 식별자) 트레일러를 남겨 누가 했는지 드러낸다.
- 같은 커밋(또는 직후)에 [`WORKLOG.md`](WORKLOG.md) 항목을 추가한다(아래 규칙 1).
- **절대 커밋하면 안 되는 것:** `.env`(실 크레덴셜), `data/` 내 운영 데이터(`state.json`, `decision-samples.json`, `backups/`, `forensics/`). 모두 `.gitignore`로 제외돼 있으니 `git add -f`로 강제 추가하지 말 것. 푸시 전 `git status`로 민감 파일이 안 들어갔는지 확인한다.
- 미완성/실험 중인 변경은 푸시하지 않는다(논리적 완료 시점에만).

## 1. 모든 기능 변경은 WORKLOG.md에 남긴다
- 위치: [`WORKLOG.md`](WORKLOG.md)
- 작업을 시작하기 전에 **반드시 WORKLOG.md를 먼저 읽는다.** 직전 작업자가 무엇을, 왜, 어떻게 바꿨는지 파악하고 이어서 작업한다.
- 변경 후 항목을 추가한다. 형식:
  ```
  ### YYYY-MM-DD — <작성자: Codex | Claude(모델명)>
  - 문제/목적:
  - 진단(근거):
  - 수정 내용:
  - 건드린 파일/함수:
  - 검증 방법과 결과:
  - 가정/주의(다른 에이전트가 검토해야 할 점):
  ```

## 2. 누가 했는지 항상 명시한다
- 코드/커밋/문서에 작성 주체를 남긴다. (Claude는 커밋에 `Co-Authored-By: Claude` 트레일러 사용.)
- Codex도 본인이 개발/수정/추가한 것은 **Codex가 했다고** WORKLOG.md와 커밋에 남긴다.

## 3. 교차 검증을 전제로 쓴다
- 한 에이전트의 판단/수정에 **모순·실수·에러가 있을 수 있다.** 상대 에이전트와 사용자가 검토할 수 있도록, 결정의 *근거와 가정*을 함께 적는다.
- 다른 에이전트의 작업에서 모순을 발견하면 WORKLOG.md에 "검토 의견" 항목으로 남기고, 라이브 매매에 영향이 있으면 사용자 확인을 받는다.

## 4. 라이브 봇 안전 수칙
- 이 앱은 **실제 토스증권 계좌**로 자동매매한다. 같은 계좌를 공유하므로 **봇 인스턴스는 동시에 하나만** 실행한다(원본 `toss_invest` 또는 클론 중 하나).
- 실제 주문은 이중 잠금: `.env`의 `LIVE_TRADING=true` **그리고** 웹 토글 `실제 주문 허용`. 둘 중 하나라도 꺼지면 dry-run.
- 매매 신호/점수/한도 로직을 바꾸는 변경은 클론에서 먼저 검증하고, WORKLOG.md에 행동 변화 영향을 명시한다.

## 5. 데이터 포맷 주의
- `learning.decisionSamples`(수 MB)는 **`data/decision-samples.json` 사이드카**로 분리되어 있다. `data/state.json`에는 비운 채(`[]`) 저장된다. 인라인으로 되돌리지 말 것(상세는 WORKLOG.md의 사이드카 항목 참고).
- `data/state.json`은 15초마다, 저장마다 백업된다. 무거운 데이터를 다시 인라인에 넣으면 백업이 비대해진다.
