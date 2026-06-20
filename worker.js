const TELEGRAM_API = "https://api.telegram.org/bot";
const BYBIT_API = "https://api.bybit.com";
const COOLDOWN = 60;
const START_BALANCE = 100;
const TRADE_SIZE = 1;
const DAILY_TRADE_LIMIT = 8; // max 8 trades per day

//... keep getKlines, analyzeSymbol, calculateEMA, calculateRSI functions...

async function canTradeToday(env, chatId) {
  const today = new Date().toDateString();
  const countKey = `tradecount:${chatId}:${today}`;
  const count = parseInt(await env.PREDICTIONS.get(countKey) || "0");
  return count < DAILY_TRADE_LIMIT;
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
            if (trade.symbol === signal.symbol && trade.status === "OPEN") {
              trade.status = signal.status;
              const pnl = signal.status.includes("WIN")? TRADE_SIZE * 0.03 : -TRADE_SIZE * 0.015;
              const chatId = tkey.name.split(":")[1];
              const balKey = `balance:${chatId}`;
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

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(sendDailySummary(env));
  },

  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/signals") {
      ctx.waitUntil(updateWinrate(env));
      const list = await env.PREDICTIONS.list({ prefix: "signal:", limit: 30 });
      const signals = [];
      let wins = 0, losses = 0;

      for (const key of list.keys) {
        const val = await env.PREDICTIONS.get(key.name);
        if (val) {
          const s = JSON.parse(val);
          signals.push(s);
          if (s.status === "WIN TP") wins++;
          if (s.status === "LOSS SL") losses++;
        }
      }
      signals.sort((a,b) => b.time - a.time);
      const winrate = wins + losses > 0? ((wins / (wins + losses)) * 100).toFixed(1) : 0;

      return new Response(JSON.stringify({ signals, stats: { wins, losses, winrate } }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (request.method === "GET" && url.pathname === "/api/balance") {
      const chatId = url.searchParams.get("chatId");
      if (!chatId) return new Response(JSON.stringify({ balance: START_BALANCE }));
      const bal = await env.PREDICTIONS.get(`balance:${chatId}`);
      return new Response(JSON.stringify({ balance: parseFloat(bal || START_BALANCE).toFixed(2) }), {
        headers: { "Content-Type": "application/json" }
      });
    }

    if (request.method === "GET") {
      return new Response(HTML, { headers: { "Content-Type": "text/html" } });
    }

    if (request.method === "POST") {
      try {
        const update = await request.json();
        const message = update.message;
        if (!message ||!message.text) return new Response("OK");

        const chatId = message.chat.id;
        const symbol = message.text.trim().toUpperCase();
        const cooldownKey = `cd:${chatId}:${symbol}`;
        const balanceKey = `balance:${chatId}`;

        if (symbol === "START") {
          await env.PREDICTIONS.put(balanceKey, START_BALANCE.toString());
          await sendMessage(env.BOT_TOKEN, chatId,
            `📊 Bybit Bot v2 Paper Trading\nBalance: $${START_BALANCE}\nTrade size: $${TRADE_SIZE}\nTP: 3% | SL: 1.5% | Max 8 trades/day\nCooldown: 60s per symbol\nDaily summary: 9:00 AM Lagos\nSend: BTC, ETH, SOL\nDashboard: ${url.origin}?id=${chatId}`
          );
        }
        else if (/^[A-Z]{2,6}$/.test(symbol)) {
          const lastCall = await env.PREDICTIONS.get(cooldownKey);
          if (lastCall && Date.now() - parseInt(lastCall) < COOLDOWN * 1000) {
            const wait = Math.ceil((COOLDOWN * 1000 - (Date.now() - parseInt(lastCall))) / 1000);
            await sendMessage(env.BOT_TOKEN, chatId, `⏳ Cooldown: wait ${wait}s for ${symbol}`);
            return new Response("OK");
          }
          await env.PREDICTIONS.put(cooldownKey, Date.now().toString(), { expirationTtl: COOLDOWN });

          // Check daily limit before analyzing
          const canTrade = await canTradeToday(env, chatId);
          if (!canTrade) {
            await sendMessage(env.BOT_TOKEN, chatId, `⛔ Daily limit reached: ${DAILY_TRADE_LIMIT}/8 trades today. Try again tomorrow.`);
            return new Response("OK");
          }

          await sendMessage(env.BOT_TOKEN, chatId, `🔍 Scanning ${symbol}USDT...`);

          const analysis = await analyzeSymbol(symbol);
          if (analysis.error) {
            await sendMessage(env.BOT_TOKEN, chatId, `Error: ${analysis.error}`);
            return new Response("OK");
          }

          let tradeMsg = "";
          if (analysis.signal === "BUY" || analysis.signal === "SELL") {
            const tradeCount = await incrementTradeCount(env, chatId);
            let balance = parseFloat(await env.PREDICTIONS.get(balanceKey) || START_BALANCE);
            const trade = {
              symbol, signal: analysis.signal, entry: analysis.price.toFixed(2),
              tp: analysis.tp?.toFixed(2), sl: analysis.sl?.toFixed(2), size: TRADE_SIZE,
              time: Date.now(), status: "OPEN", chatId
            };
            await env.PREDICTIONS.put(`trade:${chatId}:${Date.now()}`, JSON.stringify(trade));
            tradeMsg = `\n💰 Paper trade: $${TRADE_SIZE} ${analysis.signal} @ $${analysis.price.toFixed(2)}\nTrades today: ${tradeCount}/8\nBalance: $${balance.toFixed(2)}`;
          }

          const signalData = {
            symbol, price: analysis.price.toFixed(2), signal: analysis.signal,
            tp: analysis.tp?.toFixed(2), sl: analysis.sl?.toFixed(2),
            reason: analysis.reason, status: "pending", time: Date.now()
          };
          await env.PREDICTIONS.put(`signal:${Date.now()}`, JSON.stringify(signalData));

          let msg = `📊 ${symbol}USDT\nPrice: $${signalData.price}\nSignal: ${analysis.signal}\n${analysis.reason}`;
          if (analysis.tp) msg += `\n🎯 TP: $${signalData.tp} | 🛑 SL: $${signalData.sl}`;
          msg += tradeMsg;
          msg += `\n\nDashboard: ${url.origin}?id=${chatId}`;

          await sendMessage(env.BOT_TOKEN, chatId, msg);
        }
        else {
          await sendMessage(env.BOT_TOKEN, chatId, "Send /start or symbol like BTC");
        }

        return new Response("OK");
      } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
      }
    }

    return new Response("Method not allowed", { status: 405 });
  }
}

async function sendDailySummary(env) {
  const users = await env.PREDICTIONS.list({ prefix: "balance:" });
  for (const key of users.keys) {
    const chatId = key.name.split(":")[1];
    const balance = parseFloat(await env.PREDICTIONS.get(key.name) || START_BALANCE);

    const trades = await env.PREDICTIONS.list({ prefix: `trade:${chatId}:` });
    let todayPnL = 0, todayWins = 0, todayLosses = 0;
    const today = new Date().toDateString();
    let tradesToday = 0;

    for (const tkey of trades.keys) {
      const tval = await env.PREDICTIONS.get(tkey.name);
      const trade = JSON.parse(tval);
      if (trade.exitTime && new Date(trade.exitTime).toDateString() === today && trade.pnl) {
        todayPnL += parseFloat(trade.pnl);
        if (trade.status.includes("WIN")) todayWins++;
        if (trade.status.includes("LOSS")) todayLosses++;
        tradesToday++;
      }
    }

    const totalTrades = todayWins + todayLosses;
    const dayWinrate = totalTrades > 0? ((todayWins / totalTrades) * 100).toFixed(1) : 0;
    const profit = (balance - START_BALANCE).toFixed(2);
    const profitPct = ((profit / START_BALANCE) * 100).toFixed(2);

    const msg = `📅 Daily Report - Lagos 9:00 AM\n` +
      `Balance: $${balance.toFixed(2)}\n` +
      `Today P&L: ${todayPnL >= 0? '+' : ''}$${todayPnL.toFixed(2)}\n` +
      `Total P&L: ${profit >= 0? '+' : ''}$${profit} (${profitPct}%)\n` +
      `Today: ${todayWins}W / ${todayLosses}L | ${dayWinrate}%\n` +
      `Trades used: ${tradesToday}/8\n` +
      `Day ${Math.ceil((Date.now() - parseInt(await env.PREDICTIONS.get(`lastreset:${chatId}`) || Date.now())) / 86400000)}/7`;

    await sendMessage(env.BOT_TOKEN, chatId, msg);
  }
}

async function sendMessage(token, chatId, text) {
  await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
}

//... keep getKlines, analyzeSymbol, calculateEMA, calculateRSI functions from previous version...

const HTML = `<!DOCTYPE html><html><head><title>Bybit Bot v2</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body{background:#0a0a0a;color:#eee;font-family:Arial;padding:20px;max-width:800px;margin:0 auto}
h1{color:#f0b90b;margin:0;font-size:24px}
.stats{display:flex;gap:12px;margin:15px 0;flex-wrap:wrap}
.stat{background:#1a1a1a;padding:12px 16px;border-radius:8px;border:1px solid #333}
.stat b{font-size:18px}
.signal{border:1px solid #333;padding:12px;margin:8px 0;border-radius:8px;background:#141414;font-size:14px}
.buy{border-left:4px solid #00ff88}
.sell{border-left:4px solid #ff4444}
.hold{border-left:4px solid #ffaa00}
.win{border-left:4px solid #00ff88;background:#0a1a0a}
.loss{border-left:4px solid #ff4444;background:#1a0a0a}
.row{display:flex;justify-content:space-between;margin:4px 0}
.small{font-size:12px;color:#888}
</style></head><body>
<h1>📊 Bybit Bot v2 Dashboard</h1>
<div class="small">EMA9/21 + RSI14 + Volume + 5m TF | Paper $1 | Max 8 trades/day | Daily 9AM</div>
<div id="stats" class="stats"></div>
<div id="signals">Loading...</div>
<script>
const params = new URLSearchParams(window.location.search);
const chatId = params.get('id') || 'demo';

async function load(){
const [sigRes, balRes] = await Promise.all([
fetch('/api/signals'),
fetch('/api/balance?chatId=' + chatId)
]);
const data = await sigRes.json();
const bal = await balRes.json();

document.getElementById('stats').innerHTML=\`
<div class="stat">Balance: <b>$\${bal.balance}</b></div>
<div class="stat">Wins: <b style="color:#0f0">\${data.stats.wins}</b></div>
<div class="stat">Loss: <b style="color:#f00">\${data.stats.losses}</b></div>
<div class="stat">Winrate: <b>\${data.stats.winrate}%</b></div>\`;

document.getElementById('signals').innerHTML=data.signals.length?data.signals.map(s=>\`
<div class="signal \${s.status.toLowerCase().includes('win')?'win':s.status.toLowerCase().includes('loss')?'loss':s.signal.toLowerCase()}">
<div class="row"><b>\${s.symbol}USDT</b> <span class="small">\${new Date(s.time).toLocaleTimeString()}</span></div>
<div class="row">Price: \$\${s.price} | <b>\${s.signal}</b></div>
\${s.tp?`<div class="row">TP: \$\${s.tp} | SL: \$\${s.sl}</div>`:''}
<div class="row small">\${s.reason}</div>
<div class="row small">Status: <b>\${s.status}</b></div>
</div>\`).join(''):'No signals yet. Send BTC to bot';
}
load();setInterval(load,5000);
</script></body></html>`;