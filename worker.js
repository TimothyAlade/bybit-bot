import { generateSignal } from "./strategy.js";

const BYBIT_API = "https://api.bybit.com";

const COINS = [
  "BTC",
  "ETH",
  "SOL",
  "BNB",
  "XRP",
  "DOGE",
  "ADA",
  "AVAX",
  "DOT",
  "LINK",
  "MATIC",
  "UNI",
  "ATOM",
  "LTC",
  "BCH",
  "NEAR",
  "ARB",
  "OP",
  "SUI",
  "APT"
];

/* =========================================
   JSON RESPONSE HELPER
========================================= */

function json(data, status = 200) {
  return new Response(
    JSON.stringify(data),
    {
      status,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      }
    }
  );
}

/* =========================================
   BYBIT HELPERS
========================================= */

async function getKlines(symbol) {

  const url =
    `${BYBIT_API}/v5/market/kline?category=spot&symbol=${symbol}USDT&interval=15&limit=150`;

  const res = await fetch(url);

  const data = await res.json();

  if (
    data.retCode !== 0 ||
    !data.result ||
    !data.result.list
  ) {
    return null;
  }

  return data.result.list
    .reverse()
    .map(candle => ({
      open: Number(candle[1]),
      high: Number(candle[2]),
      low: Number(candle[3]),
      close: Number(candle[4]),
      volume: Number(candle[5])
    }));
}

async function getCurrentPrice(symbol) {

  const url =
    `${BYBIT_API}/v5/market/tickers?category=spot&symbol=${symbol}USDT`;

  const res = await fetch(url);

  const data = await res.json();

  if (
    data.retCode !== 0 ||
    !data.result ||
    !data.result.list?.length
  ) {
    return null;
  }

  return Number(
    data.result.list[0].lastPrice
  );
}

/* =========================================
   SIGNAL RECORDER
========================================= */

async function saveSignal(
  env,
  symbol,
  signal,
  confidence,
  price
) {

  await env.DB.prepare(`
INSERT OR REPLACE INTO stats(
id,
wins,
losses,
total,
win_rate
)
VALUES(1,?,?,?,?)
`)
.bind(
wins.total,
losses.total,
total,
winRate
)
.run();
}

/* =========================================
   DUPLICATE CHECK
========================================= */

async function signalExists(
  env,
  symbol
) {

  const cutoff =
    Date.now() -
    (30 * 60 * 1000);

  const row =
    await env.DB.prepare(`
      SELECT id
      FROM signals
      WHERE symbol = ?
      AND result IS NULL
      AND created_at > ?
      LIMIT 1
    `)
    .bind(
      symbol,
      cutoff
    )
    .first();

  return !!row;
}

/* =========================================
   MARKET SCANNER
========================================= */

async function scanMarket(env) {

  const results = [];

  for (const symbol of COINS) {

    try {

      const candles =
        await getKlines(symbol);

      if (
        !candles ||
        candles.length < 100
      ) {
        continue;
      }

      const analysis =
        generateSignal(
          candles
        );

      const price =
        candles[
          candles.length - 1
        ].close;

      results.push({
        symbol,
        signal:
          analysis.signal,
        confidence:
          analysis.confidence,
        price
      });

      if (
        analysis.signal === "BUY"
      ) {

        const exists =
          await signalExists(
            env,
            symbol
          );

        if (!exists) {

          await saveSignal(
            env,
            symbol,
            analysis.signal,
            analysis.confidence,
            price
          );

          console.log(
            `BUY ${symbol} @ ${price}`
          );
        }
      }

    } catch (err) {

      console.log(
        `SCAN ERROR ${symbol}`,
        err.message
      );

    }
  }

  return results;
}
/* =========================================
   EVALUATE OLD SIGNALS
========================================= */

async function evaluateSignals(env) {

  const cutoff =
    Date.now() -
    (30 * 60 * 1000);

  const { results } =
    await env.DB.prepare(`
      SELECT *
      FROM signals
      WHERE result IS NULL
      AND created_at < ?
    `)
    .bind(cutoff)
    .all();

  for (const trade of results) {

    try {

      const currentPrice =
        await getCurrentPrice(
          trade.symbol
        );

      if (!currentPrice) {
        continue;
      }

      const win =
        currentPrice >
        trade.entry_price;

      const pnl =
        (
          (
            currentPrice -
            trade.entry_price
          ) /
          trade.entry_price
        ) * 100;

      await env.DB.prepare(`
        UPDATE signals
        SET
          exit_price = ?,
          pnl = ?,
          result = ?,
          closed_at = ?
        WHERE id = ?
      `)
      .bind(
        currentPrice,
        pnl,
        win ? "WIN" : "LOSS",
        Date.now(),
        trade.id
      )
      .run();

      console.log(
        `${trade.symbol} ${win ? "WIN" : "LOSS"} ${pnl.toFixed(2)}%`
      );

    } catch (err) {

      console.log(
        "EVALUATION ERROR",
        trade.symbol,
        err.message
      );

    }
  }
}
/* =========================================
   UPDATE STATISTICS
========================================= */

async function updateStats(env) {

  const wins =
    await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM signals
      WHERE result='WIN'
    `).first();

  const losses =
    await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM signals
      WHERE result='LOSS'
    `).first();

  const total =
    wins.total +
    losses.total;

  const winRate =
    total > 0
      ? (
          wins.total /
          total
        ) * 100
      : 0;

  await env.DB.prepare(`
    INSERT OR REPLACE INTO stats(
      id,
      wins,
      losses,
      total,
      win_rate
    )
    VALUES(1,?,?,?,?,?)
  `)
  .bind(
    wins.total,
    losses.total,
    total,
    winRate
  )
  .run();

  return {
    wins: wins.total,
    losses: losses.total,
    total,
    winRate
  };
}
/* =========================================
   CHECK EDGE
========================================= */

async function checkEdge(env) {

  const stats =
    await env.DB.prepare(`
      SELECT *
      FROM stats
      WHERE id = 1
    `).first();

  if (!stats) {
    return true;
  }

  if (stats.total < 50) {
    return true;
  }

  if (stats.win_rate < 45) {

    console.log(
      "EDGE LOST - BOT DISABLED"
    );

    return false;
  }

  return true;
}
/* =========================================
   BOT STATUS
========================================= */

async function setBotStatus(
  env,
  status
) {

  await env.DB.prepare(`
    CREATE TABLE IF NOT EXISTS bot_status (
      id INTEGER PRIMARY KEY,
      enabled INTEGER
    )
  `).run();

  await env.DB.prepare(`
    INSERT OR REPLACE INTO bot_status(
      id,
      enabled
    )
    VALUES(1,?)
  `)
  .bind(
    status ? 1 : 0
  )
  .run();
}
/* =========================================
   UPDATE EDGE STATUS
========================================= */

async function updateEdgeStatus(
  env
) {

  const edge =
    await checkEdge(env);

  await setBotStatus(
    env,
    edge
  );

  return edge;
}
/* =========================================
   PERFORMANCE REPORT
========================================= */

async function getPerformance(
  env
) {

  const stats =
    await env.DB.prepare(`
      SELECT *
      FROM stats
      WHERE id=1
    `).first();

  if (!stats) {

    return {
      wins:0,
      losses:0,
      total:0,
      win_rate:0,
      edge:false
    };
  }

  return {
    wins: stats.wins,
    losses: stats.losses,
    total: stats.total,
    win_rate: stats.win_rate,
    edge:
      stats.total < 50
        ? true
        : stats.win_rate >= 45
  };
}
/* =========================================
   API ROUTES
========================================= */

async function handleRequest(
  request,
  env
) {

  const url =
    new URL(request.url);

  if (
    request.method === "OPTIONS"
  ) {
    return new Response(null,{
      headers:{
        "Access-Control-Allow-Origin":"*",
        "Access-Control-Allow-Headers":"*",
        "Access-Control-Allow-Methods":"*"
      }
    });
  }

  /* ========================
     HEALTH
  ======================== */

  if (
    url.pathname === "/health"
  ) {

    return json({
      status:"online",
      timestamp:Date.now()
    });

  }

  /* ========================
     SIGNALS
  ======================== */

  if (
    url.pathname === "/signals"
  ) {

    const { results } =
      await env.DB.prepare(`
        SELECT *
        FROM signals
        ORDER BY id DESC
        LIMIT 100
      `).all();

    return json(results);
  }

  /* ========================
     STATS
  ======================== */

  if (
    url.pathname === "/stats"
  ) {

    const stats =
      await env.DB.prepare(`
        SELECT *
        FROM stats
        WHERE id=1
      `).first();

    return json(
      stats || {
        wins:0,
        losses:0,
        total:0,
        win_rate:0
      }
    );
  }

  /* ========================
     PERFORMANCE
  ======================== */

  if (
    url.pathname === "/performance"
  ) {

    const report =
      await getPerformance(
        env
      );

    return json(report);
  }

  /* ========================
     FORCE SCAN
  ======================== */

  if (
    url.pathname === "/scan"
  ) {

    const enabled =
      await checkEdge(env);

    if (!enabled) {

      return json({
        success:false,
        message:
          "Bot disabled. Edge lost."
      });

    }

    const results =
      await scanMarket(env);

    return json({
      success:true,
      scanned:
        results.length,
      results
    });
  }

  /* ========================
     RECENT WINS
  ======================== */

  if (
    url.pathname === "/wins"
  ) {

    const { results } =
      await env.DB.prepare(`
        SELECT *
        FROM signals
        WHERE result='WIN'
        ORDER BY id DESC
        LIMIT 50
      `).all();

    return json(results);
  }

  /* ========================
     RECENT LOSSES
  ======================== */

  if (
    url.pathname === "/losses"
  ) {

    const { results } =
      await env.DB.prepare(`
        SELECT *
        FROM signals
        WHERE result='LOSS'
        ORDER BY id DESC
        LIMIT 50
      `).all();

    return json(results);
  }

  /* ========================
     RESET STATS
  ======================== */

  if (
    url.pathname === "/reset"
  ) {

    await env.DB.prepare(`
      DELETE FROM signals
    `).run();

    await env.DB.prepare(`
      DELETE FROM stats
    `).run();

    return json({
      success:true,
      message:"Database reset"
    });
  }

  return json({
    error:"Not Found"
  },404);
}
/* =========================================
   CRON ENGINE
========================================= */

async function runBot(env) {

  const enabled =
    await checkEdge(env);

  if (!enabled) {

    console.log(
      "BOT DISABLED"
    );

    return;
  }

  console.log(
    "SCANNING MARKET"
  );

  await scanMarket(env);

  console.log(
    "EVALUATING SIGNALS"
  );

  await evaluateSignals(env);

  console.log(
    "UPDATING STATS"
  );

  await updateStats(env);

  await updateEdgeStatus(
    env
  );

  console.log(
    "CYCLE COMPLETE"
  );
}
/* =========================================
   EXPORT
========================================= */

export default {

  async fetch(
    request,
    env,
    ctx
  ) {

    try {

      return await handleRequest(
        request,
        env
      );

    } catch (err) {

      console.log(
        err
      );

      return json({
        success:false,
        error:
          err.message
      },500);

    }
  },

  async scheduled(
    event,
    env,
    ctx
  ) {

    try {

      await runBot(env);

    } catch (err) {

      console.log(
        "CRON ERROR",
        err.message
      );

    }
  }
};