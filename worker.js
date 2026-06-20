const TELEGRAM_API = "https://api.telegram.org/bot";
const BYBIT_API = "https://api.bybit.com";
const COOLDOWN = 60;
const START_BALANCE = 100;
const TRADE_SIZE = 1;
const DAILY_TRADE_LIMIT = 8;

const HTML = `<!DOCTYPE html><html><head><title>Bybit Bot v2 Dashboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{background:#0a0a0a;color:#eee;font-family:Arial;padding:20px;max-width:900px;margin:0 auto}
h1{color:#f0b90b;margin:0 0 10px 0;font-size:26px}
.subtitle{color:#888;font-size:12px;margin-bottom:15px}
.stats{display:flex;gap:12px;margin:15px 0;flex-wrap:wrap}
.stat{background:#1a1a1a;padding:14px 18px;border-radius:8px;border:1px solid #333;min-width:100px}
.stat b{font-size:20px;display:block}
.buttons{display:flex;gap:8px;margin:15px 0;flex-wrap:wrap}
button{background:#f0b90b;border:none;color:#000;padding:12px 20px;border-radius:8px;font-weight:bold;cursor:pointer;font-size:14px}
button:disabled{background:#444;color:#888;cursor:not-allowed}
button:hover:not(:disabled){background:#ffd700}
.signal{border:1px solid #333;padding:14px;margin:8px 0;border-radius:8px;background:#141414;font-size:14px}
.buy{border-left:4px solid #00ff88}
.sell{border-left:4px solid #ff4444}
.hold{border-left:4px solid #ffaa00}
.win{border-left:4px solid #00ff88;background:#0a1a0a}
.loss{border-left:4px solid #ff4444;background:#1a0a0a}
.row{display:flex;justify-content:space-between;margin:5px 0}
.small{font-size:12px;color:#888}
#msg{margin:10px 0;padding:10px;border-radius:6px;background:#1a1a1a;display:none}
</style></head><body>
<h1>📊 Bybit Bot v2 Dashboard</h1>
<div class="subtitle">EMA9/21 + RSI14 + Volume + 5m TF | Paper $1 | Max 8 trades/day | Daily 9AM Lagos</div>

<div id="stats" class="stats">
  <div class="stat">Balance<br><b id="balance">$100.00</b></div>
  <div class="stat">Trades Today<br><b id="trades">0/8</b></div>
  <div class="stat">Wins<br><b id="wins" style="color:#0f0">0</b></div>
  <div class="stat">Loss<br><b id="losses" style="color:#f00">0</b></div>
  <div class="stat">Winrate<br><b id="winrate">0%</b></div>
</div>

<div class="buttons">
  <button onclick="scan('BTC')">BTC</button>
  <button onclick="scan('ETH')">ETH</button>
  <button onclick="scan('SOL')">SOL</button>
  <button onclick="scan('BNB')">BNB</button>
  <button onclick="scan('DOGE')">DOGE</button>
  <button onclick="resetDemo()">Reset $100</button>
</div>

<div id="msg"></div>
<div id="signals">Loading signals...</div>

<script>
const chatId = localStorage.getItem('chatId') || 'web_' + Math.random().toString(36).substr(2,9);
localStorage.setItem('chatId', chatId);

function showMsg(text, type='info') {
  const el = document.getElementById('msg');
  el.textContent = text;
  el.style.display = 'block';
  el.style.background = type === 'error' ? '#2a1a1a' : '#1a2a1a';
  setTimeout(() => el.style.display = 'none', 4000);
}

async function scan(symbol) {
  const btn = event.target;
  btn.disabled = true;
  showMsg('🔍 Scanning ' + symbol + 'USDT...');
  
  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({symbol, chatId})
    });
    const data = await res.json();
    
    if (data.error) showMsg('Error: ' + data.error, 'error');
    else if (data.message) showMsg(data.message);
    else if (data.signal) {
      showMsg(symbol + ': ' + data.signal + ' @ $' + data.price);
    }
  } catch(e) {
    showMsg('Network error', 'error');
  }
  btn.disabled = false;
  load();
}

async function resetDemo() {
  if(!confirm('Reset balance to $100?')) return;
  await fetch('/api/reset?chatId=' + chatId, {method: 'POST'});
  showMsg('Balance reset to $100');
  load();
}

async function load(){
  try {
    const [sigRes, balRes] = await Promise.all([
      fetch('/api/signals?chatId=' + chatId),
      fetch('/api/balance?chatId=' + chatId)
    ]);
    const data = await sigRes.json();
    const bal = await balRes.json();

    document.getElementById('balance').textContent = '$' + bal.balance;
    document.getElementById('wins').textContent = data.stats.wins;
    document.getElementById('losses').textContent = data.stats.losses;
    document.getElementById('winrate').textContent = data.stats.winrate + '%';
    document.getElementById('trades').textContent = bal.tradesToday + '/8';

    document.getElementById('signals').innerHTML = data.signals.length ? data.signals.map(s=>'
      <div class="signal ' + (s.status.toLowerCase().includes('win')?'win':s.status.toLowerCase().includes('loss')?'loss':s.signal.toLowerCase()) + '">
        <div class="row"><b>' + s.symbol + 'USDT</b> <span class="small">' + new Date(s.time).toLocaleTimeString() + '</span></div>
        <div class="row">Price: $' + s.price + ' | <b>' + s.signal + '</b></div>
        ' + (s.tp ? '<div class="row">TP: $' + s.tp + ' | SL: $' + s.sl + '</div>' : '') + '
        <div class="row small">' + s.reason + '</div>
        <div class="row small">Status: <b>' + s.status + '</b></div>
      </div>
    ').join('') : '<div class="small">No signals yet. Click a coin above to scan.</div>';
  } catch(e) {
    document.getElementById('signals').innerHTML = 'Error loading data';
  }
}

load();
setInterval(load, 5000);
</script>
</body></html>`;

// Helper functions
async function getKlines(symbol, interval, limit) {
  const url = `${BYBIT_API}/v5/market/kline?category=linear&symbol=${symbol}USDT&interval=${interval}&limit=${limit}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.retCode !== 0) return null;
  return data.result.list.reverse().map(c => ({
    close: parseFloat(c[4]),
    volume: parseFloat(c[5])
  }));
}

function calculateEMA(prices, period) {
  const k = 2 / (period + 1);
  let ema = prices[0];
  for (let i = 1; i < prices.length; i++) ema = prices[i] * k + ema * (1 - k);
  return ema;
}

function calculateRSI(prices, period = 14) {
  let gains = 0, losses = 0;
  for (let i = 1; i <= period && i < prices.length; i++) {
    const diff = prices[i] - prices[i-1];
    if (diff > 0) gains += diff; 
    else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + avgGain/avgLoss));
}

async function analyzeSymbol(symbol) {
  try {
    const candles1m = await getKlines(symbol, "1", 100);
    const candles5m = await getKlines(symbol, "5", 50);
    if (!candles1m || !candles5m) return { error: "No data" };

    const closes1m = candles1m.map(c => c.close);
    const closes5m = candles5m.map(c => c.close);
    const volumes1m = candles1m.map(c => c.volume);
    const currentPrice = closes1m[closes1m.length - 1];

    const ema9_1m = calculateEMA(closes1m, 9);
    const ema21_1m = calculateEMA(closes1m, 21);
    const ema9_5m = calculateEMA(closes5m, 9);
    const rsi = calculateRSI(closes1m, 14);

    const avgVol = volumes1m.slice(-21, -1).reduce((a,b) => a+b, 0) / 20;
    const currentVol = volumes1m[volumes1m.length - 1];
    const volFilter = currentVol > avgVol * 1.5;
    const tfConfirm = (ema9_1m > ema21_1m && ema9_5m > ema9_1m) ||
                      (ema9_1m < ema21_1m && ema9_5m < ema9_1m);

    let signal = "HOLD";
    let tp = null, sl = null, reason = [];

    if (ema9_1m > ema21_1m && rsi > 50 && rsi < 70 && volFilter && tfConfirm) {
      signal = "BUY";
      sl = currentPrice * 0.985;
      tp = currentPrice * 1.03;
      reason.push("Bullish EMA | RSI " + rsi.toFixed(1));
    }
    else if (ema9_1m < ema21_1m && rsi < 50 && rsi > 30 && volFilter && tfConfirm) {
      signal = "SELL";
      sl = currentPrice * 1.015;
      tp = currentPrice * 0.97;
      reason.push("Bearish EMA | RSI " + rsi.toFixed(1));
    }
    else {
      if (!volFilter) reason.push("Low volume");
      if (!tfConfirm) reason.push("5m not confirming");
    }

    return { price: currentPrice, signal, tp, sl, reason: reason.join(" | "), rsi: rsi.toFixed(1) };
  } catch (e) {
    return { error: e.message };
  }
}

async function canTradeToday(env, chatId) {
  const today = new Date().toDateString();
  const countKey = `tradecount:${chatId}:${today}`;
  const count = parseInt(await env.PREDICTIONS.get(countKey) || "0");
  return { can: count < DAILY_TRADE_LIMIT, count };
}

async function incrementTradeCount(env, chatId) {
  const today = new Date().toDateString();
  const countKey = `tradecount:${chatId}:${today}`;
  const count = parseInt(await env.PREDICTIONS.get(countKey) || "0");
  await env.PREDICTIONS.put(countKey, (count + 1).toString(), { expirationTtl: 86400 });
  return count + 1;
}

async function updateWinrate(env) {
  const signals = await env.PREDICTIONS.list({ prefix: "signal:", limit: 50 });
  for (const key of signals.keys) {
    const val = await env.PREDICTIONS.get(key.name);
    if (!val) continue;
    const signal = JSON.parse(val);

    if (signal.status === "pending" && signal.tp && signal.sl) {
      const data = await analyzeSymbol(signal.symbol);
      if (data.price) {
        let closed = false;
        if (signal.signal === "BUY") {
          if (data.price >= signal.tp) { signal.status = "WIN TP"; closed = true; }
          else if (data.price <= signal.sl) { signal.status = "LOSS SL"; closed = true; }
        } else if (signal.signal === "SELL") {
          if (data.price <= signal.tp) { signal.status = "WIN TP"; closed = true; }
          else if (data.price >= signal.sl) { signal.status = "LOSS SL"; closed = true; }
        }
        await env.PREDICTIONS.put(key.name, JSON.stringify(signal));

        if (closed) {
          const trades = await env.PREDICTIONS.list({ prefix: "trade:" });
          for (const tkey of trades.keys) {
            const tval = await env.PREDICTIONS.get(tkey.name);
            const trade = JSON.parse(tval);
            if (trade.symbol === signal.symbol && trade.status === "OPEN" && trade.chatId === signal.chatId) {
              trade.status = signal.status;
              const pnl = signal.status.includes("WIN") ? TRADE_SIZE * 0.03 : -TRADE_SIZE * 0.015;
              const balKey = `balance:${trade.chatId}`;
              let balance = parseFloat(await env.PREDICTIONS.get(balKey) || START_BALANCE);
              balance += pnl;
              await env.PREDICTIONS.put(balKey, balance.toFixed(2));
              trade.pnl = pnl.toFixed(2);
              trade.exit = data.price.toFixed(2);
              trade.exitTime = Date.now();
              await env.PREDICTIONS.put(tkey.name, JSON.stringify(trade));
            }
          }
        }
      }
    }
  }
}

async function sendDailySummary(env) {
  const users = await env.PREDICTIONS.list({ prefix: "balance:" });
  for (const key of users.keys) {
    const chatId = key.name.split(":")[1];
    if (!chatId || !chatId.startsWith('web_')) continue;
    const balance = parseFloat(await env.PREDICTIONS.get(key.name) || START_BALANCE);
    const profit = (balance - START_BALANCE).toFixed(2);
    const profitPct = ((profit / START_BALANCE) * 100).toFixed(2);
    console.log(`Daily summary for ${chatId}: $${balance} | ${profitPct}%`);
  }
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDailySummary(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // API: scan coin - called by trade buttons
    if (request.method === "POST" && url.pathname === "/api/scan") {
      const body = await request.json();
      const {symbol, chatId} = body;
      const cooldownKey = `cd:${chatId}:${symbol}`;
      
      const lastCall = await env.PREDICTIONS.get(cooldownKey);
      if (lastCall && Date.now() - parseInt(lastCall) < COOLDOWN * 1000) {
        const wait = Math.ceil((COOLDOWN * 1000 - (Date.now() - parseInt(lastCall))) / 1000);
        return new Response(JSON.stringify({message: `Cooldown: wait ${wait}s`}));
      }
      await env.PREDICTIONS.put(cooldownKey, Date.now().toString(), { expirationTtl: COOLDOWN });

      const tradeCheck = await canTradeToday(env, chatId);
      if (!tradeCheck.can) {
        return new Response(JSON.stringify({message: `Daily limit reached: 8/8 trades`}));
      }

      const analysis = await analyzeSymbol(symbol);
      if (analysis.error) {
        return new Response(JSON.stringify({error: analysis.error}));
      }

      let message = "";
      if (analysis.signal === "BUY" || analysis.signal === "SELL") {
        const tradeCount = await incrementTradeCount(env, chatId);
        const balance = parseFloat(await env.PREDICTIONS.get(`balance:${chatId}`) || START_BALANCE);
        const trade = {
          symbol, signal: analysis.signal, entry: analysis.price.toFixed(2),
          tp: analysis.tp?.toFixed(2), sl: analysis.sl?.toFixed(2), size: TRADE_SIZE,
          time: Date.now(), status: "OPEN", chatId
        };
        await env.PREDICTIONS.put(`trade:${chatId}:${Date.now()}`, JSON.stringify(trade));
        message = `Paper trade: $1 ${analysis.signal} @ $${analysis.price.toFixed(2)}. Trades: ${tradeCount}/8`;
      }

      const signalData = {
        symbol, price: analysis.price.toFixed(2), signal: analysis.signal,
        tp: analysis.tp?.toFixed(2), sl: analysis.sl?.toFixed(2),
        reason: analysis.reason, status: "pending", time: Date.now(), chatId
      };
      await env.PREDICTIONS.put(`signal:${Date.now()}`, JSON.stringify(signalData));

      return new Response(JSON.stringify({signal: analysis.signal, price: analysis.price.toFixed(2), message}));
    }

    // API: signals
    if (request.method === "GET" && url.pathname === "/api/signals") {
      ctx.waitUntil(updateWinrate(env));
      const chatId = url.searchParams.get("chatId");
      const list = await env.PREDICTIONS.list({ prefix: "signal:", limit: 30 });
      const signals = [];
      let wins = 0, losses = 0;

      for (const key of list.keys) {
        const val = await env.PREDICTIONS.get(key.name);
        if (val) {
          const s = JSON.parse(val);
          if (!chatId || s.chatId === chatId) {
            signals.push(s);
            if (s.status === "WIN TP") wins++;
            if (s.status === "LOSS SL") losses++;
          }
        }
      }
      signals.sort((a,b) => b.time - a.time);
      const winrate = wins + losses > 0 ? ((wins / (wins + losses)) * 100).toFixed(1) : 0;

      return new Response(JSON.stringify({ signals, stats: { wins, losses, winrate } }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    // API: balance
    if (request.method === "GET" && url.pathname === "/api/balance") {
      const chatId = url.searchParams.get("chatId");
      const bal = await env.PREDICTIONS.get(`balance:${chatId}`);
      const today = new Date().toDateString();
      const tradesToday = await env.PREDICTIONS.get(`tradecount:${chatId}:${today}`);
      return new Response(JSON.stringify({ 
        balance: parseFloat(bal || START_BALANCE).toFixed(2),
        tradesToday: parseInt(tradesToday || "0")
      }), { headers: { "Content-Type": "application/json" } });
    }

    // API: reset balance
    if (request.method === "POST" && url.pathname === "/api/reset") {
      const chatId = url.searchParams.get("chatId");
      await env.PREDICTIONS.put(`balance:${chatId}`, START_BALANCE.toString());
      return new Response(JSON.stringify({ok: true}));
    }

    // Dashboard HTML
    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "")) {
      return new Response(HTML, { 
        headers: { "Content-Type": "text/html" } 
      });
    }

    // Catch-all for any other routes
    return new Response("Not found", { status: 404 });
  }
}