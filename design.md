---
name: 토스
slug: toss
category: finance
last_updated: "2026-05-29"
created_at: "2026-05-11"
sources:
  - https://toss.tech
  - https://toss.tech/article/toss-design-system
  - https://toss.tech/article/tds-color-system-update
  - https://toss.tech/article/tds-component-making
  - https://tossmini-docs.toss.im/tds-mobile/
  - https://developers-apps-in-toss.toss.im/design/miniapp-branding-guide.html
  - https://github.com/toss/tossface
  - https://toss.im/tossfeed/article/beginning-of-tps
  - https://developers-apps-in-toss.toss.im/design/components.html
  - https://toss.tech/article/introducing-toss-error-message-system
  - https://toss.im
related_services: []
lang: ko
logo: https://getdesign.kr/logos/toss.png
---

# 토스 (Toss) — design.md

> 비바리퍼블리카가 운영하는 한국 최대 핀테크 슈퍼앱. 송금·결제·은행·증권·보험·세금·부동산·자동차 관리 등 금융 전반을 단일 모바일 셸로 묶고, "Apps in Toss" 미니앱 플랫폼까지 같은 디자인 시스템 위에 얹는다 [src:2]. 본 문서는 Toss Design System 핸드오프 번들(`TDS_Mobile_for_Apps_in_Toss_(2602-3-2).fig` export → `toss-design-system/{README, chats/chat1, project/{README, SKILL, colors_and_type.css, preview/ 41 cards, ui_kits/mobile/{Components.jsx, Screens.jsx, Send-Money Flow.html, ios-frame.jsx}, assets/toss-logo.png}}`)을 1차 출처로 합성한 결과이며, 공개된 toss.tech 보고서와 toss.im 미니앱 가이드, TDS Mobile docs를 보조 출처로 사용했다.

## Brand & Style

토스는 자신을 **"은행에 다니는 유능한 친구"** 로 포지셔닝한다 — 조용히 일을 처리하고, 사용자의 시간을 낭비시키지 않는다는 어조다. 슬로건과 카피 곳곳에 "투자, 모두가 할 수 있도록", "수수료 걱정 없이"와 같이 진입 장벽을 제거하는 메시지가 반복되며, "토스가 알아서"라는 위임형 표현이 사용자 부담을 줄이는 톤으로 일관된다 [src:11]. 이는 단순한 마케팅 카피가 아니라 인터페이스 전반의 의사결정 기준이다 — 정보 밀도보다 가독성과 행동 유도를 우선하고, "한번에 볼 수 있어요" 같은 통합 뷰 패턴이 반복되는 이유다 [src:11].

대상 사용자는 일반 소비자 전 연령대이지만, 디자인 시스템(TDS) 자체는 약 **2,000명 규모의 메이커**가 단일 시스템 위에서 일한다는 전제로 설계되었다 [src:2]. 일관성과 확장성은 디자인 가이드라인 차원이 아니라 인프라 차원에서 다뤄지며, 컴포넌트는 "**레고 블록**"으로 비유된다 [src:2]. 새 컴포넌트 결정은 디자이너 직관이 아니라 A/B 테스트 결과로 검증된다 — 예를 들어 Menu 컴포넌트는 10일간의 A/B 테스트에서 Android item-click rate가 10% 더 높게 나온 뒤에야 정식 채택되었다 [src:4]. Apps-in-Toss 미니앱 플랫폼은 제3자가 TDS를 따르도록 강제해 "네이티브처럼 보이게" 하지만, 동시에 토스 자체의 하단 네비게이션을 복제하는 것은 금지한다 — "사용자가 당신의 브랜드를 토스와 혼동해서는 안 된다" [src:6].

전체 무드는 **차갑고 절제된, 거의 무채색에 가까운 화이트 캔버스 + 선명한 토스 블루 단일 강조색**으로 요약된다. 깊은 한기 어린 cool-blue 중성색(`grey-900`부터 `grey-100`까지)이 표면 전체를 차지하고, 채도가 높은 브랜드 블루(`blue-500`)는 화면당 하나의 가장 중요한 액션에만 예약된다. 모서리는 **공격적으로 둥글지만 결코 귀엽지 않다** — 버튼·카드·hero 블록에 16~32px 라운드, chips·primary CTA에 999px full pill을 쓰며, iOS류 squircle/blob 라운드는 `Templates/Squircle` 전용 페이지를 제외하면 명시적으로 회피된다. 배경은 평면이 기본이며, 그라디언트는 (1) bottom CTA 위쪽 `white → transparent` 보호 그라디언트, (2) 로딩 버튼 내부의 미세한 pressed-blue radial glow, (3) yellow→orange 일러스트 그라디언트 — 세 가지 문서화된 예외만 허용된다. 텍스처·노이즈·전면 사진은 chrome에 사용되지 않는다.

Voice는 **해요체(대화형 존댓말) + 위임형 + 일상어**로 요약된다 [src:10]. 종결어미 `-요`로 통일되며 격식체(~니다/~합니다)도, 방송 헤드라인의 단정형 `-다`도 사용하지 않는다 — 한 문장은 목적을 말하고, 다음 한 문장은 *언제 쓰는지*를 말하는 패턴이 표준이다. 토스가 잘못해 발생한 에러 화면에서조차 격식체가 아닌 해요체를 유지하며, 반복되는 시스템 상황은 Figma preset과 개발자 에러 메시지 라이브러리로 템플릿화되어 좋은 카피가 기본 선택지가 되도록 운영된다 [src:10]. 본 카탈로그 메타 문서는 토스 자체 카피와 달리 `~다` 평서체로 기술하며, 토스의 해요체 정책은 product surface 카피에 한해 적용되는 규칙임을 분리해 둔다.

## Colors

TDS 컬러 시스템은 **4계층 구조**로 운영된다 [src:3]:

1. **Target** — 토큰이 칠해지는 표면. `fill`, `text`, `border`.
2. **Role** — 의미 역할. `brand`, `neutral`, `primary`, `secondary`, `weak`, `alt`.
3. **Variant** — 강도 변형. `weak`, `alt`.
4. **Level** — 토큰의 추상화 단계. `base`(원시 팔레트) → `semantic`(역할 alias) → `component`(컴포넌트 전용 alias).

토스는 2025년 production 토큰을 HSL에서 OKLCH로 마이그레이션한다고 공식 발표했으며, 같은 numeric scale(50, 100, …, 900)이 모든 hue에서 동등한 perceived brightness를 갖도록 OKLCH 균질화를 도입한다 [src:3]. 핸드오프 번들 자체는 light 모드 카노니컬 hex 값으로 ship되며, 원본 hex는 `colors_and_type.css`에 정의되어 있다 — 본 문서는 catalog 규약에 따라 OKLCH로 변환해 표기한다.

### Brand

원본 hex는 `colors_and_type.css`에 정의되어 있으며, 본 문서는 OKLCH로 변환해 표기한다. 카노니컬 앵커 `oklch(0.624 0.176 254)`는 미니앱 브랜딩 가이드 `brand.primaryColor` 예시(공식 hex로 노출되는 값)와 일치한다 [src:6].

```yaml
blue-500: oklch(0.624 0.176 254)   # 카노니컬 Toss Blue (#3182F6), 화면당 하나의 primary CTA
blue-600: oklch(0.522 0.176 257)   # pressed-blue 단계
blue-700: oklch(0.476 0.174 259)   # pressed gradient stop
blue-50:  oklch(0.965 0.020 250)   # brand-weak background (#E8F3FF)
```

### Greyscale (cool-blue tinted neutrals)

`grey-900`은 순수 검정이 아니라 미세하게 차가운 navy 톤이며, `grey-100`은 거의 인지되지 않는 cool 그레이로 화면 보조 표면으로 사용된다. 카노니컬 hex(토스 공개 팔레트):

```yaml
grey-900: oklch(0.234 0.030 254)   # #191F28  primary text, never pure black
grey-800: oklch(0.342 0.030 253)   # #333D4B
grey-700: oklch(0.452 0.028 253)   # #4E5968  secondary text
grey-600: oklch(0.555 0.022 253)   # #6B7684
grey-500: oklch(0.652 0.020 252)   # #8B95A1
grey-400: oklch(0.752 0.016 251)   # #B0B8C1  disabled text, strong line
grey-300: oklch(0.840 0.012 248)   # #D1D6DB
grey-200: oklch(0.913 0.008 247)   # #E5E8EB  default divider/border
grey-150: oklch(0.918 0.007 247)   # #EAEDF0
grey-100: oklch(0.957 0.005 247)   # #F2F4F6  secondary surface
grey-50:  oklch(0.978 0.003 247)   # #F9FAFB  app canvas
white:    oklch(1.000 0.000 0)     # #FFFFFF  panel surface
```

### Toss yellow & orange (illustration warms)

Toss yellow는 표면 색이 아니라 일러스트/이모지 자산의 face 색이며, orange는 시맨틱 warning에 한정된다.

```yaml
yellow-500: oklch(0.853 0.156 86)   # illustration / emoji body
orange-500: oklch(0.748 0.183 56)   # semantic warning
```

### Semantic palette

```yaml
red-500:   oklch(0.628 0.218 22)   # #F04452  error / danger
green-500: oklch(0.493 0.143 154)  # success
navy-900:  oklch(0.155 0.060 261)  # text-shadow base, source of overlay rgba
```

### Semantic alias (product-facing — base 팔레트 직접 참조 금지)

```yaml
# Fill (배경·표면)
fill-brand:        blue-500
fill-primary:      grey-900
fill-secondary:    grey-100
fill-weak:         grey-50
fill-danger:       red-500
fill-success:      green-500
fill-warning:      orange-500

# Text
text-primary:      grey-900
text-secondary:    grey-700
text-tertiary:     navy-900 @ 58%
text-placeholder:  navy-900 @ 28%
text-alt:          white
text-brand:        blue-500
text-danger:       red-500

# Border
border-primary:    blue-500           # focused input (1.5px)
border-secondary:  grey-200           # default divider (1px hairline)
border-strong:     grey-400
border-subtle:     black @ 8%

# Overlay & state
overlay-scrim:     black @ 56%        # bottom-sheet scrim
overlay-press:     black @ 26%        # 보편 pressed-state tint
disabled-opacity:  0.30               # 컴포넌트 전체 노드에 적용
```

명도 대비 자동 보정 — 미니앱이 자체 brand 컬러를 등록할 때, 등록된 색이 명도 대비 기준을 통과하지 못하면 의도를 유지한 채 자동 보정된다 [src:6].

## Typography

본문/UI 서체는 **Toss Product Sans (TPS)**다 [src:8]. 외부 재배포 불가 라이선스라 host 앱은 **Pretendard**로 substitute한다 — 메트릭·한글 자형·tabular figure가 거의 1:1로 일치한다.

```yaml
font-family-sans: >
  "Pretendard Variable", Pretendard, -apple-system, BlinkMacSystemFont,
  "SF Pro Text", "SF Pro", "Apple SD Gothic Neo", "Noto Sans KR",
  Roboto, "Helvetica Neue", Arial, sans-serif
font-family-emoji: "Tossface"
```

### Type ramp

```yaml
display-1:  { size: 56, line-height: 1.30, tracking: -0.005em, weight: 700 }
display-2:  { size: 40, line-height: 1.20, tracking: -0.020em, weight: 700 }
h1:         { size: 28, line-height: 1.30, tracking: -0.020em, weight: 700 }
h2:         { size: 24, line-height: 1.30, tracking: -0.020em, weight: 700 }
h3:         { size: 22, line-height: 1.30, tracking: -0.015em, weight: 700 }
h4:         { size: 20, line-height: 1.35, tracking: -0.015em, weight: 700 }
title-1:    { size: 18, line-height: 1.45, tracking: -0.010em, weight: 600 }
title-2:    { size: 17, line-height: 1.45, tracking: -0.010em, weight: 600 }
body-1:     { size: 17, line-height: 1.50, tracking: -0.005em, weight: 400 }
body-2:     { size: 15, line-height: 1.50, tracking: -0.005em, weight: 400 }
body-3:     { size: 13, line-height: 1.50, tracking: 0,         weight: 400 }
label-l:    { size: 17, line-height: 1.25, tracking: -0.005em, weight: 700 }
label-m:    { size: 15, line-height: 1.25, tracking: -0.005em, weight: 600 }
label-s:    { size: 13, line-height: 1.25, tracking: 0,         weight: 600 }
caption:    { size: 12, line-height: 1.40, tracking: 0,         weight: 500 }
caption-s:  { size: 11, line-height: 1.40, tracking: 0,         weight: 500 }
```

본문은 15px Regular + 1.5 line-height(한글 가독성 표준). 버튼은 XL/L에서 Bold 700 17px, M/S에서 Semibold 15~13px. 카드 타이틀은 `title-1`(18/600), 카드 본문은 `body-2`(15/400).

### 숫자/기호 처리

실시간 금융 데이터(주가·환율·잔액)는 tabular figure, 강조 시 proportional figure [src:8]:

```yaml
font-feature-numeric-tabular:      "tabular-nums"
font-feature-numeric-proportional: "proportional-nums"
```

## Spacing

베이스 단위 4px, 토큰 사다리 4~80px 12단계:

```yaml
space-1: 4   space-2: 8   space-3: 12  space-4: 16  space-5: 20  space-6: 24
space-7: 28  space-8: 32  space-10: 40 space-12: 48 space-16: 64 space-20: 80
```

룰 오브 섬: **24px** 화면 outer padding, **16px** list-row 간 간격, **8px** 밀접 결합 요소(label + input) 사이.

## Rounded

라운드 토큰 4~32px 8단계 + `full`(999px). "프로덕션에서 가장 둥근 모바일 시스템 중 하나".

```yaml
radius-xs:   4     radius-s:   8     radius-m:  12     radius-l:  14
radius-xl:  16     radius-2xl: 20    radius-3xl: 24    radius-4xl: 32
radius-full: 999   # chips, pills, capsules
```

버튼 라운드는 사이즈와 페어: XL 16 / L 14 / M 12 / S 10. iOS류 squircle/blob 라운드 회피.

## Elevation & Depth

평면이 기본, 그림자는 floating/modal 표면에만. 색은 모두 navy-900 베이스 낮은 알파(0.04~0.16).

```yaml
shadow-1:     0 1px 2px navy-900/0.04, 0 1px 1px navy-900/0.04        # menu
shadow-2:     0 4px 12px navy-900/0.06, 0 1px 2px navy-900/0.04       # tooltip
shadow-3:     0 12px 32px navy-900/0.10, 0 2px 6px navy-900/0.06      # dialog
shadow-toast: 0 8px 24px navy-900/0.16                               # toast
```

pressed state는 `press-overlay`(검정 26%)를 resting fill 위에 얹는다 — 그림자가 아니라 overlay. inner-shadow 없음.

### Motion

```yaml
ease:     cubic-bezier(0.22, 0.61, 0.36, 1)   # 기본 ease-out-expo
ease-out: cubic-bezier(0.16, 1,    0.3,  1)   # snappy, sheet 진입
dur-fast: 120   # button press
dur-base: 200   # toggle, hover
dur-slow: 320   # sheet, dialog
```

바운스 오버슈트 없음, 320ms 초과 fade 없음, parallax 없음, skeleton shimmer 없음 — 3-dot loader 사용.

## Shapes

**공격적 라운드 + 평면 표면 + 헤어라인 보더**. 화이트 캔버스 위 16~32px 라운드 카드/버튼, chips·primary CTA에 999px full pill. 기본 보더는 **1px grey-200 헤어라인**, focused input은 1.5px blue-500. 2px 장식용 보더·컬러 left-rail accent 카드 미사용.

**Iconography** — 아웃라인(`*-mono`) + 필드(`*-fill`), kebab-case, 16/20/24/32. 24px 워크호스, stroke 1.5~1.67px. 필드 변형은 active tab-bar에만. 모든 아이콘 `currentColor` 상속 — 외부 컬러 직접 주입 금지.

## Do's and Don'ts (요약)

**Do**
- product 색은 시맨틱/컴포넌트 alias로만 호출, base 팔레트는 새 role 만들 때만.
- 화면당 단일 강조색 — primary는 `fill-brand` 하나, 보조는 `fill-secondary`/ghost.
- 실시간 금융 데이터는 `tabular-nums`, 강조 숫자는 `proportional-nums`.
- 본문 `body-2`(15px/1.5). product 카피는 **해요체**.
- 금액은 한국식 `1,000원`(공백 없음), 퍼센트 `12%`.
- 아이콘 `currentColor` 상속. pressed=검정 26% overlay, disabled=노드 전체 0.30.

**Don't**
- 챗봇 톤/마케팅 과장/격식체/단정형 `-다`를 product 카피에.
- 한 화면 강조색 2개 이상. chrome에 그라디언트(3 예외만). squircle/blob.
- 2px 장식 보더·컬러 left-rail. skeleton shimmer. 320ms 초과 fade·바운스·parallax. inner shadow.
- 이모지 inline. ALL CAPS·헤딩 `!`·문장 중간 em-dash·"여기를 눌러주세요"류 라벨.
- 토스 금융 도메인 개념 이식 — 차용할 것은 **시각 언어**(단일 강조색 규율·라운드 ladder·해요체·tabular 숫자)이지 금융 서비스 개념이 아니다.

## Responsive Behavior

**mobile-first** 슈퍼앱. 데스크톱 surface는 부수적. multi-column 거의 미사용.

| Name | Width | Key Changes |
|---|---|---|
| Mobile | ≤ 640px | 기본 — bottom-cta, bottom-sheet(dialog 대체) |
| Tablet | 641–1023px | 단일 컬럼 유지 권장 |
| Desktop | ≥ 1024px | 부수적 surface, 별도 위계 재설계 |

Touch target 최소 44×44px. Dialog→BottomSheet, Menu over BottomSheet(시각 거리 최적화), 단일 컬럼 권장.

## 이 프로젝트(toss_invest 대시보드) 적용 메모

이 레포는 토스 미니앱이 아니라 **개인 자동매매 모니터링 데스크톱 대시보드**다. TDS에서 차용하는 것은 위 Don't 절대로 명시된 대로 **시각 언어**에 한정한다:
- 화이트 캔버스(grey-50) + 단일 토스 블루(#3182F6) 강조색. 강조색은 화면당 핵심 액션/활성 상태에만.
- grey-900(#191F28) 본문 텍스트, grey-700(#4E5968) 보조, 1px grey-200(#E5E8EB) 헤어라인 보더.
- 라운드 ladder(카드 16~24, 칩/pill 999), 평면 표면 + 낮은 알파 navy 그림자(floating만).
- 잔액/수익률/가격/지표 등 숫자는 `tabular-nums`.
- Pretendard 폰트 스택. 카피는 해요체.
- 데스크톱이지만 multi-column은 카드 그룹 단위로만, 정보 위계는 단일 강조색으로.

## References

1. https://toss.tech — Toss Tech 블로그 인덱스.
2. https://toss.tech/article/toss-design-system — TDS 개요. LEGO-block, 2,000 메이커, 3-pillar.
3. https://toss.tech/article/tds-color-system-update — OKLCH 마이그레이션, 4계층 토큰(Target/Role/Variant/Level).
4. https://toss.tech/article/tds-component-making — 컴포넌트 설계, Menu 10일 A/B 테스트.
5. https://tossmini-docs.toss.im/tds-mobile/ — TDS Mobile foundation, 훅.
6. https://developers-apps-in-toss.toss.im/design/miniapp-branding-guide.html — 미니앱 브랜딩, `brand.primaryColor: #3182F6`, 명도 대비 자동 보정.
7. https://github.com/toss/tossface — Tossface 이모지 폰트.
8. https://toss.im/tossfeed/article/beginning-of-tps — Toss Product Sans, tabular/proportional 분리.
9. https://developers-apps-in-toss.toss.im/design/components.html — 앱인토스 TDS 컴포넌트 목록.
10. https://toss.tech/article/introducing-toss-error-message-system — Navigating error 원칙, 해요체.
11. https://toss.im — 토스 공식 홈페이지, 슬로건·카피·톤.
