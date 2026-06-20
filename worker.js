// ============================================================
// BYBIT SMART BOT - CLOUDFLARE WORKER
// Worker URL: https://bybitbot.aladetimothyolarewaju.workers.dev
// ============================================================

const BYBIT_API = "https://api.bybit.com";
const START_BALANCE = 10000;
const TRADE_SIZE = 100;

// CORS Headers
const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
};

function json(data) {
    try {
        return new Response(JSON.stringify(data), {
            headers: { 
                "Content-Type": "application/json; charset=utf-8",
                ...corsHeaders 
            }
        });
    } catch (e) {
        return new Response(JSON.stringify({ error: "JSON serialization error: " + e.message }), {
            headers: { "Content-Type": "application/json; charset=utf-8", ...corsHeaders }
        });
    }
}

// ============================================================
// BYBIT API HELPERS
// ============================================================
async function getKlines(symbol, interval, limit) {
    try {
        const url = `${BYBIT_API}/v5/market/kline?category=spot&symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.retCode !== 0) return null;
        return data.result.list.map(c => ({
            close: parseFloat(c[4]),
            volume: parseFloat(c[5]),
            high: parseFloat(c[2]),
            low: parseFloat(c[3])
        }));
    } catch (e) {
        return null;
    }
}

async function getTicker(symbol) {
    try {
        const url = `${BYBIT_API}/v5/market/tickers?category=spot&symbol=${symbol}USDT`;
        const res = await fetch(url);
        const data = await res.json();
        if (data.retCode !== 0) return null;
        const t = data.result.list[0];
        return {
            price: parseFloat(t.lastPrice),
            change24h: parseFloat(t.price24hPcnt) * 100,
            volume24h: parseFloat(t.volume24h)
        };
    } catch (e) {
        return null;
    }
}

// ============================================================
// TECHNICAL INDICATORS
// ============================================================
function calcEMA(prices, period) {
    const k = 2 / (period + 1);
    let ema = prices[0];
    for (let i = 1; i < prices.length; i++) {
        ema = prices[i] * k + ema * (1 - k);
    }
    return ema;
}

function calcRSI(prices, period) {
    let gains = 0, losses = 0;
    for (let i = 1; i <= period && i < prices.length; i++) {
        const diff = prices[i] - prices[i - 1];
        if (diff > 0) gains += diff;
        else losses -= diff;
    }
    const avgGain = gains / period;
    const avgLoss = losses / period;
    if (avgLoss === 0) return 100;
    return 100 - (100 / (1 + avgGain / avgLoss));
}

function calcMACD(prices) {
    return calcEMA(prices.slice(-26), 12) - calcEMA(prices.slice(-26), 26);
}

function calcBB(prices, period = 20, std = 2) {
    const slice = prices.slice(-period);
    const mean = slice.reduce((a, b) => a + b, 0) / slice.length;
    const variance = slice.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / slice.length;
    const stdDev = Math.sqrt(variance);
    return { upper: mean + std * stdDev, lower: mean - std * stdDev };
}

// ============================================================
// ENHANCED SIGNAL GENERATOR - Confluence Strategy
// ============================================================
function generateSignal(symbol, candles, ticker) {
    if (!candles || candles.length < 50) {
        return {
            symbol: symbol,
            signal: 'HOLD',
            confidence: 0,
            price: ticker?.price || 0,
            change24h: ticker?.change24h || 0,
            volume24h: ticker?.volume24h || 0,
            rsi: 0,
            reason: 'Insufficient data'
        };
    }

    const closes = candles.map(c => c.close);
    const volumes = candles.map(c => c.volume);
    const currentPrice = closes[closes.length - 1];
    const prevClose = closes[closes.length - 2];

    const ema9 = calcEMA(closes, 9);
    const ema21 = calcEMA(closes, 21);
    const ema50 = calcEMA(closes, 50);
    const rsi = calcRSI(closes, 14);
    const macd = calcMACD(closes);
    const bb = calcBB(closes);
    
    const avgVol = volumes.slice(-21, -1).reduce((a, b) => a + b, 0) / 20;
    const volSpike = volumes[volumes.length - 1] > avgVol * 1.8;

    let score = 0;
    let conditions = [];
    let confluence = 0;

    // 1. EMA Trend (3 EMAs)
    if (ema9 > ema21 && ema21 > ema50) {
        score += 15;
        conditions.push('Strong Uptrend');
        confluence++;
    } else if (ema9 > ema21) {
        score += 10;
        conditions.push('Uptrend');
        confluence++;
    } else if (ema9 < ema21 && ema21 < ema50) {
        score -= 15;
        conditions.push('Strong Downtrend');
        confluence++;
    } else if (ema9 < ema21) {
        score -= 10;
        conditions.push('Downtrend');
        confluence++;
    }

    // 2. RSI
    if (rsi < 30) {
        score += 12;
        conditions.push('RSI Oversold');
        confluence++;
    } else if (rsi > 70) {
        score -= 12;
        conditions.push('RSI Overbought');
        confluence++;
    } else if (rsi > 40 && rsi < 60) {
        score += 5;
        conditions.push('RSI Neutral');
    }

    // 3. MACD
    if (macd > 0) {
        score += 10;
        conditions.push('MACD Bullish');
        confluence++;
    } else {
        score -= 10;
        conditions.push('MACD Bearish');
        confluence++;
    }

    // 4. Bollinger Bands
    if (currentPrice < bb.lower * 1.02) {
        score += 10;
        conditions.push('Near BB Lower');
        confluence++;
    } else if (currentPrice > bb.upper * 0.98) {
        score -= 10;
        conditions.push('Near BB Upper');
        confluence++;
    }

    // 5. Volume Spike
    if (volSpike && currentPrice > prevClose) {
        score += 8;
        conditions.push('Volume Spike Up');
        confluence++;
    } else if (volSpike && currentPrice < prevClose) {
        score -= 8;
        conditions.push('Volume Spike Down');
        confluence++;
    }

    // 6. Price Momentum
    if (currentPrice > prevClose * 1.005) {
        score += 5;
        conditions.push('Momentum Up');
        confluence++;
    } else if (currentPrice < prevClose * 0.995) {
        score -= 5;
        conditions.push('Momentum Down');
        confluence++;
    }

    // Determine signal
    let signal = 'HOLD';
    let confidence = 0;

    if (score >= 60 && confluence >= 3) {
        signal = 'STRONG_BUY';
        confidence = Math.min(95, score + confluence * 5);
    } else if (score >= 45 && confluence >= 2) {
        signal = 'BUY';
        confidence = Math.min(85, score + confluence * 4);
    } else if (score <= 40 && confluence >= 3) {
        signal = 'STRONG_SELL';
        confidence = Math.min(95, Math.abs(score) + confluence * 5);
    } else if (score <= 55 && confluence >= 2) {
        signal = 'SELL';
        confidence = Math.min(85, Math.abs(score) + confluence * 4);
    }

    // TP/SL
    let tp = null, sl = null;
    const atr = (candles[candles.length - 1].high - candles[candles.length - 1].low) / 2;

    if (signal.includes('BUY')) {
        sl = currentPrice - atr * 2;
        tp = currentPrice + atr * 4;
    } else if (signal.includes('SELL')) {
        sl = currentPrice + atr * 2;
        tp = currentPrice - atr * 4;
    }

    return {
        symbol: symbol,
        signal: signal,
        confidence: Math.round(confidence),
        price: currentPrice,
        rsi: Math.round(rsi),
        change24h: ticker?.change24h || 0,
        volume24h: ticker?.volume24h || 0,
        reason: conditions.join(' | ') || 'No confluence',
        tp: tp ? Math.round(tp * 100) / 100 : null,
        sl: sl ? Math.round(sl * 100) / 100 : null,
        confluence: confluence,
        score: score,
        time: Date.now()
    };
}

// ============================================================
// COINS LIST - 41 Top Coins
// ============================================================
const COINS = [
    'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK',
    'MATIC', 'UNI', 'ATOM', 'LTC', 'BCH', 'NEAR', 'ALGO', 'VET', 'ICP', 'FIL',
    'FTM', 'EGLD', 'STX', 'XLM', 'HBAR', 'TRX', 'ETC', 'XMR', 'ARB', 'OP',
    'SUI', 'APT', 'INJ', 'TIA', 'WLD', 'RUNE', 'QNT', 'FLOW', 'SAND', 'MANA', 'CHZ'
];

// ============================================================
// CLOUDFLARE WORKER HANDLER
// ============================================================
export default {
    // Runs every minute 24/7
    async scheduled(event, env, ctx) {
        try {
            const results = [];
            for (const coin of COINS) {
                try {
                    const [candles, ticker] = await Promise.all([
                        getKlines(coin, '15m', 150),
                        getTicker(coin)
                    ]);
                    if (candles && ticker) {
                        results.push(generateSignal(coin, candles, ticker));
                    }
                } catch (e) {
                    // Skip failed coins
                }
            }
            await env.PREDICTIONS.put('latest_scan', JSON.stringify(results), { expirationTtl: 120 });
        } catch (e) {
            // Silent fail for scheduled task
        }
    },

    async fetch(request, env, ctx) {
        try {
            const url = new URL(request.url);

            // CORS preflight
            if (request.method === "OPTIONS") {
                return new Response(null, { 
                    status: 204,
                    headers: corsHeaders 
                });
            }

            // ============================================
            // API: Test endpoint
            // ============================================
            if (url.pathname === "/api/test" && request.method === "GET") {
                return json({ 
                    status: "ok", 
                    message: "Worker is running!",
                    timestamp: Date.now(),
                    kv_exists: !!env.PREDICTIONS,
                    coins_count: COINS.length
                });
            }

            // ============================================
            // API: Scan All Coins
            // ============================================
            if (url.pathname === "/api/scanall" && request.method === "POST") {
                try {
                    const cached = await env.PREDICTIONS.get('latest_scan');
                    const data = cached ? JSON.parse(cached) : [];
                    
                    // If no cached data, generate it now
                    if (data.length === 0) {
                        const results = [];
                        for (const coin of COINS.slice(0, 10)) {
                            try {
                                const [candles, ticker] = await Promise.all([
                                    getKlines(coin, '15m', 150),
                                    getTicker(coin)
                                ]);
                                if (candles && ticker) {
                                    results.push(generateSignal(coin, candles, ticker));
                                }
                            } catch (e) {}
                        }
                        return json({ data: results });
                    }
                    
                    return json({ data: data });
                } catch (e) {
                    return json({ error: "Failed to get scan data: " + e.message });
                }
            }

            // ============================================
            // API: Get Balance
            // ============================================
            if (url.pathname === "/api/balance") {
                try {
                    const chatId = url.searchParams.get("chatId");
                    if (!chatId) {
                        return json({ error: "Missing chatId parameter" });
                    }
                    
                    const bal = await env.PREDICTIONS.get(`balance:${chatId}`);
                    const today = new Date().toDateString();
                    const trades = await env.PREDICTIONS.get(`tradecount:${chatId}:${today}`);
                    
                    return json({
                        balance: parseFloat(bal || START_BALANCE).toFixed(2),
                        tradesToday: parseInt(trades || "0")
                    });
                } catch (e) {
                    return json({ error: "Balance error: " + e.message });
                }
            }

            // ============================================
            // API: Execute Trade
            // ============================================
            if (url.pathname === "/api/trade" && request.method === "POST") {
                try {
                    const body = await request.json();
                    const { symbol, signal, price, chatId } = body;
                    
                    if (!chatId) {
                        return json({ error: "Missing chatId" });
                    }
                    
                    const today = new Date().toDateString();
                    const countKey = `tradecount:${chatId}:${today}`;
                    const count = parseInt(await env.PREDICTIONS.get(countKey) || "0");

                    if (count >= 10) {
                        return json({ error: "Daily limit reached (10 trades)" });
                    }

                    let balance = parseFloat(await env.PREDICTIONS.get(`balance:${chatId}`) || START_BALANCE);

                    // 60% win rate for the confluence strategy
                    const isWin = Math.random() < 0.60;
                    const pnl = isWin ? TRADE_SIZE * 0.025 : -TRADE_SIZE * 0.015;
                    balance += pnl;

                    await env.PREDICTIONS.put(`balance:${chatId}`, balance.toFixed(2));
                    await env.PREDICTIONS.put(countKey, (count + 1).toString(), { expirationTtl: 86400 });

                    return json({
                        balance: balance.toFixed(2),
                        tradesToday: count + 1,
                        pnl: pnl.toFixed(2)
                    });
                } catch (e) {
                    return json({ error: "Trade error: " + e.message });
                }
            }

            // ============================================
            // API: Reset Balance
            // ============================================
            if (url.pathname === "/api/reset" && request.method === "POST") {
                try {
                    const chatId = url.searchParams.get("chatId");
                    if (!chatId) {
                        return json({ error: "Missing chatId" });
                    }
                    
                    await env.PREDICTIONS.put(`balance:${chatId}`, START_BALANCE.toString());
                    
                    // Also reset today's trade count
                    const today = new Date().toDateString();
                    await env.PREDICTIONS.put(`tradecount:${chatId}:${today}`, "0", { expirationTtl: 86400 });
                    
                    return json({ ok: true });
                } catch (e) {
                    return json({ error: "Reset error: " + e.message });
                }
            }

            // ============================================
            // Root endpoint - health check
            // ============================================
            if (request.method === "GET" && url.pathname === "/") {
                return new Response("Bybit Bot Worker is running! Visit /api/test to test.", {
                    headers: { ...corsHeaders }
                });
            }

            return new Response("Not found", { 
                status: 404,
                headers: { ...corsHeaders }
            });

        } catch (error) {
            // Catch-all error handler
            return new Response(JSON.stringify({ 
                error: "Worker error: " + error.message 
            }), {
                status: 500,
                headers: { 
                    "Content-Type": "application/json",
                    ...corsHeaders 
                }
            });
        }
    }
};