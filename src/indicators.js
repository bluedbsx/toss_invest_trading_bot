export function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((sum, value) => sum + value, 0) / period;
}

// Wilder RSI: 첫 period 변화량의 단순평균으로 시작한 뒤 Wilder 평활(RMA)로 전체 구간을 이어간다.
// 토스/트레이딩뷰 등 표준 RSI와 같은 값을 내도록 짧은 윈도우 단순평균 방식에서 교체.
export function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i += 1) {
    const change = values[i] - values[i - 1];
    if (change >= 0) avgGain += change;
    else avgLoss += -change;
  }
  avgGain /= period;
  avgLoss /= period;
  for (let i = period + 1; i < values.length; i += 1) {
    const change = values[i] - values[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// Wilder ATR: 첫 period True Range의 단순평균으로 시작한 뒤 Wilder 평활로 전체 구간을 이어간다.
export function atr(candles, period = 14) {
  if (candles.length <= period) return null;
  const trueRanges = [];
  for (let i = 1; i < candles.length; i += 1) {
    const current = candles[i];
    const previous = candles[i - 1];
    trueRanges.push(
      Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      )
    );
  }
  if (trueRanges.length < period) return null;
  let atrValue = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let i = period; i < trueRanges.length; i += 1) {
    atrValue = (atrValue * (period - 1) + trueRanges[i]) / period;
  }
  return atrValue;
}

export function normalizeCandles(rawCandles = []) {
  return rawCandles
    .map((item) => ({
      timestamp: item.timestamp,
      open: Number(item.open ?? item.openPrice),
      high: Number(item.high ?? item.highPrice),
      low: Number(item.low ?? item.lowPrice),
      close: Number(item.close ?? item.closePrice),
      volume: Number(item.volume ?? 0)
    }))
    .filter((item) => Number.isFinite(item.close))
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}
