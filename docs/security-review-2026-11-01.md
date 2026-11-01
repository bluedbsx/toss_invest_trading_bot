# 보안 점검 — Codex, 2026-11-01

대상: 로컬 HEAD `a8218e6` 및 로컬에서 접근 가능한 Git 이력 60개 커밋. 봇·서버·주문을 실행하지 않고 소스 검토 및 합성 입력으로 검사했다. 운영 코드 변경 없음.

## 결론

원작성자에게 개인정보를 전송하는 명시적 백도어·텔레메트리는 검토한 코드에서 발견하지 못했다. 그러나 안전하다고 확정할 수 없다. 대시보드 접근 제어, 외부 콘텐츠 렌더링, API 주소 검증에 취약점이 있다. 특히 계좌 상태와 주문 제어가 같은 인증 경계에 있으므로 대시보드 침해는 정보 노출과 거래 조작으로 이어질 수 있다.

이 사본에는 `.env`, `data/state.json`, `data/decision-samples.json`이 없다. 운영 서버 설정·방화벽·HTTPS·로그·실제 네트워크 트래픽과 과거 유출은 검사하지 못했다. 원격의 삭제된 이력, 다른 브랜치/포크, GitHub 캐시도 검사 범위 밖이다.

## 발견 사항

### 높음: 로컬 프록시 경유 시 비밀번호 없는 인증 우회

근거: `src/auth.js:29-45`, `server.js:51-64`, `server.js:233-260`.

비밀번호가 없으면 소켓 상대 주소가 loopback인 모든 요청을 허용한다. 같은 머신의 nginx/터널이 외부 요청을 전달하면 외부 사용자도 로컬 요청으로 취급될 수 있다. `DASHBOARD_AUTH_DISABLED=true`는 비밀번호 유무와 관계없이 인증을 끈다. `listen(port)`는 loopback으로 제한하지 않는다. 직접 원격 요청은 비밀번호 미설정 시 503으로 거절하므로 모든 배포가 무조건 공개되는 것은 아니다.

합성 request/response로 loopback + 임의 Host 요청이 인증 없이 허용되고 직접 원격은 503인 것을 assert로 확인했다. 실제 서버는 실행하지 않았다.

조치: 로컬 전용 기본 바인딩, 모든 요청에 비밀번호 요구, 인증 비활성화 옵션 제한. 외부 접근은 검증된 인증 프록시/VPN 경계로 제한하고 운영 설정을 별도로 확인한다. 기존 WORKLOG의 로컬 사용 전제는 프록시·터널 사용 시 성립하지 않는다는 검토 의견이다.

### 높음: RSS URL의 저장형 HTML/스크립트 삽입 가능

근거: `src/news.js:80-104`, `public/app.js:1318-1336`.

RSS link를 XML 디코딩한 후 `href="${item.url}"`에 이스케이프 및 URL scheme 검증 없이 innerHTML로 넣는다. 악성 링크가 들어오면 속성 탈출로 HTML을 삽입하거나 javascript: 링크를 만들 수 있다. 악성 피드 응답의 유입/피드 변조가 필요한 조건부 취약점이며, 현재 피드가 악성이라는 증거는 없다. 현재 HTTPS 피드를 사용한다.

대시보드에서 실행되는 스크립트는 같은 origin의 계좌 상태를 읽어 외부로 전송하거나 API를 호출할 수 있다. Content-Security-Policy도 설정하지 않는다. RSS 응답에 악성 내용을 주입하는 실제 브라우저 검증은 수행하지 않았다.

조치: DOM API로 textContent 및 href를 설정하고 http/https URL만 허용. CSP로 외부 전송·인라인 스크립트를 제한한다.

### 높음(설정 오염 시): 임의 API 서버로 비밀키 전송

근거: `src/tossClient.js:4-35`, `src/tossClient.js:46-69`.

TOSS_BASE_URL을 검증 없이 사용하며 http와 임의 외부 호스트를 허용한다. 잘못된 배포 환경변수나 변조된 .env가 있으면 client_id/client_secret이 해당 서버로 전송된다. 이후 Bearer 토큰과 계좌 식별자도 설정된 서버에 전달한다. 기본값 자체는 https://openapi.tossinvest.com 이다.

fetch를 완전히 대체한 합성 테스트에서 http://untrusted.invalid 주소로 합성 secret이 전달되는 것을 확인했다. 외부 네트워크 호출·실제 키 사용 없음.

조치: 실키 사용 시 정확한 HTTPS origin 허용목록 검사, redirect 거절, 테스트 주소는 명시적인 mock 전용으로 분리.

### 중간: HTTP Basic 인증·CSRF/Host 방어 부재

근거: `src/auth.js:13-26`, `server.js:51-64`, `server.js:298-304`, `server.js:550-575`, `server.js:635-645`.

앱 자체는 HTTP를 제공한다. HTTPS 종료 프록시/VPN이 없는 원격 접속에서는 Basic 인증정보와 계좌 응답이 전송 구간에서 보호되지 않는다. Origin/Host 검사와 CSRF 토큰이 없고, JSON 본문을 Content-Type에 관계없이 읽는다. 일부 POST 작업은 본문조차 필요 없다. 악성 웹페이지에서 브라우저의 인증 재사용·로컬 네트워크 접근 조건이 맞으면 상태 변경 요청을 유도할 가능성이 있다. CORS가 없다는 것만으로 요청 실행이 방지되지는 않는다. DNS rebinding에도 앱 수준의 Host 제한이 없다. 최신 브라우저의 로컬 네트워크 제한 등 때문에 실제 성공 여부는 환경별 검증이 필요하다.

조치: HTTPS 또는 보호된 터널 사용, 변경 요청 Origin 검사·CSRF 토큰·application/json 강제, Host 허용목록.

### 중간: 계좌 상태·오류·네트워크 정보 과다 반환 및 평문 보관

근거: `server.js:233-260`, `server.js:579-602`, `server.js:60`, `src/trader.js:223-230`, `src/store.js:183-197`.

/api/state는 decisionSamples를 제외한 거의 전체 state와 공인 IP·로컬 인터페이스 정보를 반환한다. 연결 테스트는 계좌 목록을 반환하고 일부 오류는 원본 API error.data를 응답/거래기록에 남긴다. 계좌 식별자·보유·체결·오류 데이터의 노출 범위가 넓다. state/백업은 평문이며 writeFile에 0600 권한이 명시되지 않아 OS umask와 디렉터리 권한에 의존한다.

조치: 응답 필드 최소화, 계좌번호/오류 마스킹, Cache-Control: no-store, 사용자 전용 저장 디렉터리 및 파일 권한, 백업 접근 제한·보존 정책. Oracle 설치 스크립트의 env 0600/data 750은 긍정적이나 로컬 실행에는 자동 적용되지 않는다.

### 낮음~중간: 자원 고갈 방어 부족

근거: `server.js:635-639`, `src/auth.js`, `src/tossClient.js:145-150`.

요청 본문 크기 제한·인증 실패 횟수 제한이 없으며 Toss fetch에는 명시적 timeout이 없다. 외부 공개 시 메모리 고갈, 비밀번호 대입, 작업 지연 위험이 있다. src/rateLimiter.js는 외부 API 사용량 제어로 대시보드 인증 시도 제한과 다르다.

## 외부 전송 경로

| 수신처 | 코드상 전달 내용 |
|---|---|
| 설정된 Toss API 서버 | client_id/secret, Bearer 토큰, 계좌 식별자, 주문·조회 데이터 |
| Yahoo Finance | 조회 종목·기간·관심 종목 RSS 요청, 서버 IP |
| Google News | 관심 종목/회사명·거시 뉴스 검색어, 서버 IP |
| Nasdaq | 조회 종목, 서버 IP |
| TradingView 경제 캘린더 | 일정 조회 조건, 서버 IP |
| Federal Reserve RSS | RSS 요청, 서버 IP |
| api.ipify.org | 공인 IP 확인 요청; 서비스는 서버 IP를 관측 |

검토한 경로에서 Toss 외 서비스로 계좌번호·잔고·API 비밀키를 첨부하는 코드는 발견하지 못했다. 관심 종목 조회는 외부 서비스에 드러난다. 화면의 번역/학습은 로컬 코드이며 외부 LLM 호출을 발견하지 못했다. 외부 JS/CDN은 index.html에서 발견하지 못했다.

## Git·의존성 확인

- .env 및 운영 data는 .gitignore, Docker 빌드에서도 제외됨. 추적 중인 data 파일은 .gitkeep뿐.
- 접근 가능한 60개 Git 커밋에서 tsck_/tssk_ 및 비어 있지 않은 TOSS_CLIENT_SECRET 할당 패턴 검사: 일치 파일 없음. 모든 형태의 개인정보·비밀정보 부재를 증명하는 완전한 스캔은 아님.
- package.json에 외부 npm 의존성 및 설치 hook 없음. 따라서 npm 의존성 취약점 검사 대상은 없지만 Node 런타임과 Docker 베이스 이미지 취약성은 별도 확인 필요. 현재 설치 Node의 보안 패치 상태는 이 점검에서 평가하지 않음.

## 권고 우선순위

1. 운영 대시보드의 비밀번호·인증 비활성화 옵션·외부 접속 경로를 확인하고, 접근 경계를 제한한다.
2. RSS URL 렌더링, API origin 검증, 인증·CSRF 방어를 격리 환경에서 수정·검증한다.
3. 운영 파일/백업 권한과 계좌 응답 최소화를 적용한다.
4. 공개 접속이나 키 노출이 확인되면 Toss 키를 폐기·재발급하고 주문 이력을 확인한다. 현재 조사만으로 유출이 있었다고 단정하거나 재발급이 반드시 필요하다고 판단하지 않는다.

라이브 동작에 영향을 줄 수 있는 기존 판단의 수정은 사용자 확인 후 진행한다. 이번 점검에서는 운영 로직·설정·계좌 데이터에 손대지 않았다.
