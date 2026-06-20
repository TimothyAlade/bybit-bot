const TELEGRAM_API = "https://api.telegram.org/bot";

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    
    // 1. Browser test - shows bot is live
    if (request.method === "GET") {
      return new Response("Bot is running ✅ Send /start on Telegram", {
        headers: { "Content-Type": "text/plain" }
      });
    }
    
    // 2. Telegram webhook hits here
    if (request.method === "POST") {
      try {
        const update = await request.json();
        const message = update.message;
        
        if (!message || !message.text) {
          return new Response("OK", { status: 200 });
        }
        
        const chatId = message.chat.id;
        const text = message.text.trim();
        
        // Handle /start
        if (text === "/start") {
          await sendMessage(env.BOT_TOKEN, chatId, 
            "👋 Welcome to BybitBot!\n\nSend me a crypto symbol like BTC, ETH, SOL\nI’ll reply with live price + prediction"
          );
        }
        // Handle crypto symbols
        else if (/^[A-Z]{2,5}$/.test(text.toUpperCase())) {
          await sendMessage(env.BOT_TOKEN, chatId, 
            `⏳ Checking ${text.toUpperCase()}...\nPrice + prediction coming in 3s...`
          );
          // We’ll add real price API next
        }
        // Unknown command
        else {
          await sendMessage(env.BOT_TOKEN, chatId, 
            "Send /start to begin\nOr send a crypto symbol like BTC"
          );
        }
        
        return new Response("OK", { status: 200 });
      } catch (e) {
        return new Response("Error: " + e.message, { status: 500 });
      }
    }
    
    return new Response("Method not allowed", { status: 405 });
  }
}

async function sendMessage(token, chatId, text) {
  const res = await fetch(`${TELEGRAM_API}${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text })
  });
  return res.json();
}