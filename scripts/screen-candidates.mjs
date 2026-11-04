// Codex: read-only candidate screening; never imports the trader or operating ledger.
import fs from 'node:fs/promises';
import { getExternalDailyCandles } from '../src/marketData.js';
import { robustBacktestTarget } from '../src/strategy.js';

const universe = JSON.parse(await fs.readFile(new URL('../analysis/universe.json', import.meta.url), 'utf8'));
const symbols = [...new Set([...universe.symbols.map(x => x.symbol), ...'SPY DIA IWM XLK XLF XLV XLI XLP XLU XLY XLC XLRE XLB NVDA MSFT AAPL AMZN GOOGL META AVGO AMD COST JPM V MA UNH CAT GE'.split(' ')])];
const results = [];
let next = 0;
async function worker() {
  while (next < symbols.length) {
    const symbol = symbols[next++];
    try {
      const candles = (await getExternalDailyCandles(symbol)).filter(c => c.timestamp.slice(0, 10) < new Date().toISOString().slice(0, 10));
      const target = { ...universe.defaults.candidateParams, symbol };
      const b = robustBacktestTarget({ target, candles, settings: universe.defaults.settings });
      results.push({ symbol, available: b.available, score: b.score, days: candles.length, lastDate: candles.at(-1)?.timestamp, returnPct: b.totalReturnPct, drawdownPct: b.maxDrawdownPct, trades: b.trades, validation: b.validation, summary: b.summary });
      console.log(symbol, b.score, candles.at(-1)?.timestamp);
    } catch (e) { results.push({ symbol, error: e.message }); console.log(symbol, e.message); }
  }
}
await Promise.all(Array.from({ length: 3 }, worker));
results.sort((a, b) => (b.score ?? -1) - (a.score ?? -1));
await fs.mkdir(new URL('../analysis/reports/', import.meta.url), { recursive: true });
const output = { generatedAt: new Date().toISOString(), parameters: universe.defaults, note: 'Fixed common parameters, not optimized. Latest partial UTC day excluded. Daily data is not an executable live signal. Verify data freshness and broker eligibility.', results };
await fs.writeFile(new URL('../analysis/reports/candidate-screen-latest.json', import.meta.url), JSON.stringify(output, null, 2));
console.log(JSON.stringify(results.map(({symbol, score, lastDate, returnPct, drawdownPct, trades, error}) => ({symbol, score, lastDate, returnPct, drawdownPct, trades, error})), null, 2));
