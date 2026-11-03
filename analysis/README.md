# analysis/ — 종목 분석 공간

| 경로 | 내용 |
|---|---|
| `universe.json` | **종목 list 관리 파일.** 코어/후보/벤치마크 종목, 종목별 파라미터, 분석 구간, 비교 비중안 |
| `reports/` | 분석 결과 문서(`.md`)와 원자료(`.json`). 날짜별로 쌓인다 |
| `.cache/` | Yahoo 일봉 캐시 (gitignore) |

## 실행

```bash
npm run analysis:regime                                   # 캐시 사용
node scripts/regime-rotation-analysis.mjs --refresh       # 가격 재수집
node scripts/regime-rotation-analysis.mjs --universe analysis/my-list.json --out analysis/reports
```

- 시뮬레이션은 라이브 봇과 같은 `src/strategy.js` 로직(`simulateBacktestTrace`)을 쓴다. 별도 복제 로직은 없다.
- 종목 추가는 `universe.json`의 `symbols`에 `{ "symbol", "name", "role", "group", "thesis" }`를 추가한다. `params`를 비우면 신규 종목 기본값을 쓴다.
- 결과 문서의 판정은 규칙 기반 1차 분류다. 실매매 편입은 사람/에이전트 검토와 paper 검증을 거친다(AGENTS.md §4).
