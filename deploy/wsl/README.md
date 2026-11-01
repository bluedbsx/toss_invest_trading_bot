# WSL 운영과 클라우드 이전 — Codex

## 구성

WSL2 + systemd 사용자 서비스를 사용한다. 소스는 기존 저장소에 두고, 비밀정보와 장부는 Windows 드라이브가 아닌 WSL Linux 홈에 저장한다.

| 항목 | 위치 |
| --- | --- |
| 비밀정보 | `~/.config/toss-invest/env` (600) |
| 운영 장부·판단 샘플·백업 | `~/.local/share/toss-invest/data/` (디렉터리 700, 파일 600) |
| 서비스 | `~/.config/systemd/user/toss-invest.service` |
| 이전용 전체 장부 snapshot | `~/.local/share/toss-invest/exports/` |

저장소 `.env`에는 외부 파일을 가리키는 TOSS_ENV_FILE 경로만 들어간다. 외부 파일은 repo-local 설정을 대체하며 이미 지정된 프로세스 환경변수가 우선한다. 같은 저장소에서 npm start를 실행해도 이 파일을 사용한다. 다른 클론에서 같은 계좌 봇을 실행하지 않는다.

## 설치 및 관리

기존 초기 장부가 있는 저장소에서 실행한다. 실행 중 서비스가 있거나 목적지에 별도 장부가 있으면 병합/덮어쓰기를 거절한다. 기존 장부가 없는 신규 설치는 `scripts/init-deployment.js`로 먼저 준비한다. 설치는 기존 원본 데이터를 삭제하지 않는다.

```bash
npm run setup:wsl
bash deploy/wsl/manage.sh start
bash deploy/wsl/manage.sh status
bash deploy/wsl/manage.sh logs
bash deploy/wsl/manage.sh stop
```

서비스는 시작 실패 시 재시작하며, 설치 시 Node 실행파일의 절대 경로를 기록한다. NVM으로 Node 경로를 변경하거나 저장소를 이동하면 서비스를 중지하고 설치를 다시 실행한다. 새 설치에서는 LIVE_TRADING=false로 시작하며 기존 비밀파일이 있으면 덮어쓰지 않는다.

## 키 입력과 연결 확인

```bash
nano ~/.config/toss-invest/env
```

TOSS_CLIENT_ID, TOSS_CLIENT_SECRET를 입력한다. TOSS_ACCOUNT_SEQ는 표시용 계좌번호가 아닌 계좌 API의 accountSeq이다. 모르면 우선 비워둔 채 연결 테스트로 계좌 식별자를 확인한 뒤 입력한다. DASHBOARD_PASSWORD는 설치 시 생성한 무작위 값을 사용하고 채팅이나 화면 캡처로 공유하지 않는다.

**LIVE_TRADING=false를 유지**하고 서비스 재시작 후 `http://localhost:3000`에 접속한다. Basic 인증 사용자명은 임의 문자열, 비밀번호는 env의 DASHBOARD_PASSWORD이다. Windows 브라우저의 localhost 접속을 사용하며 LAN·인터넷 포트를 열지 않는다.

```bash
bash deploy/wsl/manage.sh restart
```

Toss API 허용 IP에는 이 PC의 외부 통신 공인 IP를 등록한다. 공유기·통신사·VPN에 따라 달라질 수 있으므로 연결 실패 시 재확인한다. 키 입력 후 mock 표시가 사라졌다는 것만으로 성공으로 판단하지 말고 계좌·실제 시세·보유·주문 동기화까지 확인한다. 수동 보유를 봇 대상이나 초기 positions에 넣지 않는다.

## PC에서 계속 실행하기

키 연결 확인 후 모의 운영은 `LIVE_TRADING=false`와 웹 실제 주문 OFF를 유지하고 모니터링만 켠다. 실제 시세로 판단·모의 장부를 누적하며, 거래 조건이 충족되지 않거나 정규장이 아니면 HOLD가 정상이다. 화면의 키 연결 성공과 실제 주문 허용은 서로 다르다.

독립적인 매수·손절 매도 경로 검사는 `npm run test:dry-run`으로 실행한다. 네트워크를 금지한 합성 시세와 메모리 장부를 사용하며, 환경/웹 이중 잠금 중 어느 하나라도 꺼져 있으면 주문 API를 호출하지 않는지 확인한다. 합성 테스트의 거래는 운영 화면에 들어가지 않으며 실전 체결 품질·수익성을 검증하는 시험도 아니다.

WSL systemd 서비스만으로 WSL 자체가 계속 살아 있는 것은 아니다. 별도 WSL 터미널에서 아래 명령을 실행하고 열어 둔다.

```bash
bash deploy/wsl/manage.sh keepalive
```

Windows PowerShell에서도 실행할 수 있다. 배포판 이름은 `wsl -l -q`로 확인한다.

```powershell
wsl -d YOUR_DISTRO -- bash -lc 'systemctl --user start toss-invest.service && exec sleep infinity'
```

Windows 재부팅/로그인 뒤에는 WSL을 다시 시작하고 서비스 상태를 확인한다. PC 절전·최대절전·종료 또는 `wsl --shutdown` 중에는 자동매매와 방어매도도 멈춘다. Windows 절전 및 로그인 자동실행 설정은 이 설치가 변경하지 않는다. user service의 enable은 Windows 부팅 자동실행을 의미하지 않는다.

출처: [Microsoft WSL systemd 수명주기](https://learn.microsoft.com/en-us/windows/wsl/systemd), [Windows에서 WSL localhost 접속](https://learn.microsoft.com/en-us/windows/wsl/networking).

## 전체 장부 백업과 클라우드 이전

state.json만 복사하면 판단 샘플 sidecar와 아카이브가 빠진다. 모든 봇 프로세스가 중지된 상태에서 data 디렉터리 전체를 이동한다. snapshot에는 계좌정보가 담기므로 공개 Git·채팅·공유 링크로 전달하지 않는다. 비밀파일은 snapshot에 포함하지 않는다.

```bash
bash deploy/wsl/manage.sh stop
bash deploy/wsl/manage.sh backup
# 출력된 ~/.local/share/toss-invest/exports/ledger-*.tar.gz 파일을 사용한다.
```

복사 후에도 WSL을 계속 사용할 경우에만 서비스를 다시 시작한다. export 스크립트 직접 실행 시에는 서비스/수동 프로세스 중지를 호출자가 보장해야 한다.

클라우드가 준비되면 다음 순서로 이전한다.

1. [Oracle 설치 절차](../oracle/README.md)로 코드만 설치한다. 서비스는 아직 시작하지 않는다.
2. WSL 모니터링·실제 주문을 끄고 서비스와 keepalive를 중지한다. 미체결 주문을 Toss에서 확인한다.
3. 최종 전체 snapshot을 만들고 SSH/SCP로 VM에 전송한다. WSL에서 서비스가 재시작되지 않도록 `systemctl --user disable toss-invest.service`도 실행한다.
4. 새 VM의 비어 있는 `/opt/toss-invest/data`에 압축을 해제한다. 신규 장부 초기화 도구를 다시 실행하지 않는다. 소유자를 tossinvest로 바꾸고 디렉터리/파일 권한을 제한한다.
5. 비밀정보는 VM에서 따로 입력하고 DATA_DIR을 VM 경로로 지정한다. Toss 허용 IP도 VM 공인 IP로 변경한다.
6. VM은 LIVE_TRADING=false로 시작해 포지션·주문·장부를 검증한다. 이 중에는 WSL 봇을 켜지 않는다. 이전이 확인된 뒤 실거래 잠금을 해제한다.

이전 중에는 봇이 동작하지 않는 시간이 있다. 서비스 중지는 기존에 접수한 주문을 취소하지 않는다. 복귀 시에도 양쪽을 먼저 중지하고 최신 장부 하나를 기준으로 복구한다.
