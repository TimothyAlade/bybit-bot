export function generateSignal(candles) {

  if (!candles || candles.length < 200) {
    return {
      signal: "HOLD",
      confidence: 0,
      reasons: ["Not enough candles"]
    };
  }

  const closes = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const highs = candles.map(c => c.high);
  const lows = candles.map(c => c.low);

  const currentPrice = closes.at(-1);
  const currentVolume = volumes.at(-1);

  function sma(values, period) {
    const slice = values.slice(-period);
    return slice.reduce((a,b)=>a+b,0) / period;
  }

  const ema20 = sma(closes,20);
  const ema50 = sma(closes,50);
  const ema200 = sma(closes,200);

  function calculateRSI(period = 14) {

    let gains = 0;
    let losses = 0;

    const recent =
      closes.slice(-(period + 1));

    for(let i=1;i<recent.length;i++){

      const diff =
        recent[i] - recent[i-1];

      if(diff > 0){
        gains += diff;
      } else {
        losses += Math.abs(diff);
      }
    }

    if(losses === 0) return 100;

    const rs =
      gains / losses;

    return (
      100 -
      (100 / (1 + rs))
    );
  }

  const rsi = calculateRSI();

  const avgVolume =
    volumes
      .slice(-20)
      .reduce((a,b)=>a+b,0) / 20;

  const volumeSpike =
    currentVolume >
    avgVolume * 1.5;

  const recentHigh =
    highs.at(-1);

  const previousHigh =
    highs.at(-5);

  const recentLow =
    lows.at(-1);

  const previousLow =
    lows.at(-5);

  const higherHigh =
    recentHigh >
    previousHigh;

  const higherLow =
    recentLow >
    previousLow;

  let score = 0;

  const reasons = [];

  if (
    ema20 > ema50 &&
    ema50 > ema200
  ) {
    score += 30;
    reasons.push(
      "Strong Trend"
    );
  }

  if (
    currentPrice > ema20
  ) {
    score += 20;
    reasons.push(
      "Price Above EMA20"
    );
  }

  if (
    rsi > 50 &&
    rsi < 70
  ) {
    score += 20;
    reasons.push(
      `RSI ${rsi.toFixed(1)}`
    );
  }

  if (
    volumeSpike
  ) {
    score += 15;
    reasons.push(
      "Volume Spike"
    );
  }

  if (
    higherHigh &&
    higherLow
  ) {
    score += 15;
    reasons.push(
      "Market Structure"
    );
  }

  let signal = "HOLD";

  if(score >= 80){
    signal = "STRONG_BUY";
  }
  else if(score >= 60){
    signal = "BUY";
  }

  return {
    signal,
    confidence: score,
    price: currentPrice,
    rsi: Number(
      rsi.toFixed(2)
    ),
    reasons
  };
}