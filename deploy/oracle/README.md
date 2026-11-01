# Oracle Always Free VM 배포 — Codex 보안 보완

이 절차는 새 VM에 설치하고 실제 주문이 꺼진 상태에서 검증한다. 설치 스크립트는 서비스를 자동 시작하지 않는다. 기존 서비스를 업데이트할 때는 미체결 주문과 실행 중인 다른 인스턴스를 확인하고 먼저 중지한다.

## 1. VM 생성

Oracle Console에서 Compute → Instances → Create instance로 생성한다.

- 홈 리전에서 Always Free 대상 Ubuntu 24.04 LTS 이미지를 선택한다.
- 시작 구성: `VM.Standard.A1.Flex`, 1 OCPU / 6 GB, 기본 부트 볼륨 약 50 GB. 생성 화면에서 무료 한도와 기존 사용량을 확인한다. 자리가 없으면 다른 가용 도메인 또는 대기 후 재시도한다.
- 공개 서브넷·공인 IPv4를 사용하고 SSH 공개키를 등록한다. 개인키를 저장소나 채팅에 넣지 않는다.
- VCN 보안 목록/NSG의 TCP 22는 접속할 PC 공인 IP `/32`로 제한한다. 3000번 포트는 열지 않는다. SSH 소스 IP가 바뀌면 규칙도 갱신한다.
- VM 공인 IP를 Toss API 허용 IP에 등록한다. 공인 IP가 변경되면 다시 등록한다.

현재 Oracle 공식 문서는 A1 Always Free 총량을 2 OCPU / 12 GB(월 1,500 OCPU 시간 / 9,000 GB 시간), 부트·블록 볼륨 합계 200 GB로 안내한다. 계정의 실제 한도와 콘솔 표시가 우선이다. Idle VM은 회수될 수 있으므로 자동매매의 무중단 실행을 보장하지 않는다. VM 중단 시 봇의 방어매도도 동작하지 않는다.

출처: [Always Free 자원](https://docs.oracle.com/en-us/iaas/Content/FreeTier/freetier_topic-Always_Free_Resources.htm), [Linux VM 생성 절차](https://docs.oracle.com/en-us/iaas/Content/Compute/tutorials/first-linux-instance/overview.htm).

## 2. Ubuntu 설치 준비

Ubuntu의 SSH 사용자는 일반적으로 `ubuntu`이다.

```bash
ssh -i /path/to/private-key ubuntu@VM_PUBLIC_IP
sudo apt-get update
sudo apt-get install -y git rsync curl ca-certificates
curl -fsSL https://deb.nodesource.com/setup_24.x -o /tmp/nodesource-setup.sh
# 실행 전에 다운로드한 설치 스크립트를 확인한다.
sudo bash /tmp/nodesource-setup.sh
sudo apt-get install -y nodejs
node --version
```

자신의 fork를 VM에 clone한 뒤 해당 저장소 디렉터리에서 실행한다.

```bash
sudo bash deploy/oracle/install.sh
sudo nano /etc/toss-invest/toss-invest.env
```

## 3. 비밀정보 입력

설치 시 무작위 DASHBOARD_PASSWORD가 만들어진다. 비밀번호와 키는 VM 안에서 확인·입력하고 화면 캡처·Git·채팅에 공유하지 않는다.

```dotenv
PORT=3000
HOST=127.0.0.1
DATA_DIR=/opt/toss-invest/data
LIVE_TRADING=false
NEWS_REFRESH_MINUTES=30
DASHBOARD_PASSWORD=설치시생성된값유지
TOSS_CLIENT_ID=발급받은값
TOSS_CLIENT_SECRET=발급받은값
TOSS_ACCOUNT_SEQ=계좌조회에서확인한accountSeq
TOSS_BASE_URL=https://openapi.tossinvest.com
```

ACCOUNT_SEQ는 표시용 계좌번호가 아니라 `/api/v1/accounts`의 accountSeq 값이다. 모르면 우선 비워두고, dry-run 대시보드의 API 연결 테스트로 계좌를 확인한 뒤 입력한다. 미입력 상태의 보유·주문 조회 실패를 정상 연결로 간주하지 않는다.

## 4. 새 운용 장부 초기화

서비스를 시작하기 전에 운용 금액(USD)과 종목을 인자로 전달한다. 아래 숫자/종목은 사용법 예시이며 실제 운용 지시가 아니다.

```bash
sudo -u tossinvest env DATA_DIR=/opt/toss-invest/data LIVE_TRADING=false \
  node /opt/toss-invest/app/scripts/init-deployment.js 500 AAA,BBB,CCC
# 서로 다른 비중 예시: 마지막 인자로 40,30,30을 추가한다.
```

이 도구는 state.json이 존재하면 덮어쓰지 않고 실패한다. 기존 운영 데이터를 초기화하려고 지우지 않는다. 개인 운용 정보는 data에만 저장하며 커밋하지 않는다.

초기 상태: 운용 금액 고정 시드, 원금 보충 OFF, 종목 균등 비중(별도 지정 가능), 실제 주문/모니터링/자동 비중·안전설정 변경 OFF. 종목 전략은 새 종목 추가 시와 같은 일반 기본값으로, 해당 종목에 대해 검증된 전략이 아니다. 현금 버퍼·위험 한도·미사용 비중 재분배는 기존 기본값을 유지하므로 목표 비중은 고정 체결 비중이 아니며 운용 금액 전액이 즉시 투자되는 것도 아니다. 수익의 복리 재투자로 자산이 초기 시드를 넘을 수 있다.

수동 보유 종목을 봇 대상·초기 positions에 넣지 않는다. 이 봇이 만든 주문 식별자(`ti-`)가 있는 과거 주문은 복구 대상이 될 수 있으므로 같은 계좌에서 다른 봇/기존 인스턴스를 함께 실행하지 않는다. 대시보드는 계좌 전체 정보를 조회할 수 있으나 수동 보유를 봇 자산으로 편입하지 않는다.

## 5. 서비스와 SSH 터널

```bash
sudo systemctl enable --now toss-invest
sudo systemctl status toss-invest --no-pager
sudo journalctl -u toss-invest -n 50 --no-pager
```

개인 PC의 별도 터미널에서 다음 연결을 유지한다.

```bash
ssh -i /path/to/private-key -N -L 3000:127.0.0.1:3000 ubuntu@VM_PUBLIC_IP
```

브라우저에서 `http://localhost:3000`에 접속한다. Basic 인증 사용자명은 임의 값, 비밀번호는 DASHBOARD_PASSWORD이다. SSH가 원격 전송 구간을 암호화한다. 로컬 3000 포트를 변경한다면 VM 환경의 DASHBOARD_ALLOWED_HOSTS에도 브라우저가 사용하는 `localhost:변경포트`를 추가한다. loopback에 바인딩하므로 Tailscale IP 직접 접속은 별도 바인딩/Host 설정이 필요하다.

## 6. 실거래 전 검증

1. 환경 LIVE_TRADING=false 및 웹 실제 주문 OFF를 확인한다.
2. API 연결 테스트가 mock이 아닌지 확인하고 계좌 accountSeq를 입력한다.
3. 실제 시세·보유·주문 동기화가 성공하는지 확인한다. 계좌 수동 보유가 봇 장부에 들어가지 않았는지 확인한다.
4. 종목/비중/금액/현금 버퍼/위험 한도/장외 매도/페이퍼 성과를 검토한다. 금액 외 위험 설정은 사용자가 확인해야 한다.
5. 실거래를 켤 때는 서비스 중지 후 `LIVE_TRADING=true`로 바꾸고 재시작한다. 웹 실제 주문과 모니터링도 각각 켜야 한다. 페이퍼 장부에서 라이브 장부로 전환된 것을 확인한다.
6. 긴급 중지는 웹 모니터링·실제 주문 OFF 또는 `sudo systemctl stop toss-invest`이다. 서버를 중지해도 이미 접수된 주문은 취소되지 않으므로 Toss에서 미체결 주문을 확인한다.

## 데이터·검증

운영 데이터는 `/opt/toss-invest/data/`에만 저장한다. state 백업은 최대 10분마다 생성되고, 판단 샘플은 decision-samples.json 및 decision-samples-archive.ndjson으로 분리된다. 저장 디렉터리와 비밀정보는 접근 권한을 제한한다. VM 외부 백업 시 계좌정보가 담긴 평문임을 고려한다.

```bash
node --test tests/*.test.js
sudo DATA_DIR=/opt/toss-invest/data bash /opt/toss-invest/app/deploy/oracle/backup-state.sh
```

점검 테스트는 합성 정보·임시 디렉터리를 사용하며 실제 주문이나 Toss API에 접속하지 않는다.
