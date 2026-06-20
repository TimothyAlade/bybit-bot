// ============================================================
// CONFIGURATION
// ============================================================
const CONFIG = {
    // Your Cloudflare Worker URL
    API_URL: 'https://bybitbot.aladetimothyolarewaju.workers.dev',
    
    COINS: [
        'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'ADA', 'AVAX', 'DOT', 'LINK',
        'MATIC', 'UNI', 'ATOM', 'LTC', 'BCH', 'NEAR', 'ALGO', 'VET', 'ICP', 'FIL',
        'FTM', 'EGLD', 'STX', 'XLM', 'HBAR', 'TRX', 'ETC', 'XMR', 'ARB', 'OP',
        'SUI', 'APT', 'INJ', 'TIA', 'WLD', 'RUNE', 'QNT', 'FLOW', 'SAND', 'MANA', 'CHZ'
    ],
    
    START_BALANCE: 10000,
    MAX_OPEN_TRADES: 5,
    DAILY_TRADE_LIMIT: 10,
    REFRESH_INTERVAL: 60000,
    HISTORY_LIMIT: 100
};

// ============================================================
// STATE
// ============================================================
let state = {
    marketData: [],
    signals: [],
    activeTrades: [],
    history: [],
    virtualBalance: CONFIG.START_BALANCE,
    totalPnL: 0,
    stats: { wins: 0, losses: 0, winRate: 0, totalTrades: 0 },
    isScanning: false,
    autoScan: false,
    chatId: localStorage.getItem('chatId') || 'web_' + Math.random().toString(36).substr(2, 9)
};
localStorage.setItem('chatId', state.chatId);

// ============================================================
// LOAD SAVED STATE
// ============================================================
function loadState() {
    try {
        const saved = localStorage.getItem('tradingState');
        if (saved) {
            const parsed = JSON.parse(saved);
            state.history = parsed.history || [];
            state.virtualBalance = parsed.virtualBalance || CONFIG.START_BALANCE;
            state.totalPnL = parsed.totalPnL || 0;
            state.stats = parsed.stats || { wins: 0, losses: 0, winRate: 0, totalTrades: 0 };
            state.activeTrades = parsed.activeTrades || [];
        }
    } catch (e) {}
}

function saveState() {
    try {
        localStorage.setItem('tradingState', JSON.stringify({
            history: state.history,
            virtualBalance: state.virtualBalance,
            totalPnL: state.totalPnL,
            stats: state.stats,
            activeTrades: state.activeTrades
        }));
    } catch (e) {}
}

// ============================================================
// API HELPER
// ============================================================
async function api(path, method = 'GET', body = null) {
    const baseUrl = CONFIG.API_URL || '';
    const opts = {
        method,
        headers: { 'Content-Type': 'application/json' }
    };
    if (body) opts.body = JSON.stringify(body);
    
    try {
        const res = await fetch(baseUrl + path, opts);
        
        // Check if response is OK
        if (!res.ok) {
            const text = await res.text();
            return { error: "HTTP " + res.status + ": " + text };
        }
        
        // Try to parse JSON
        const contentType = res.headers.get('content-type');
        if (!contentType || !contentType.includes('application/json')) {
            const text = await res.text();
            return { error: "Unexpected response type: " + text.substring(0, 100) };
        }
        
        return await res.json();
    } catch (e) {
        console.error('API error:', e);
        return { error: e.message };
    }
}

// ============================================================
// TOAST NOTIFICATIONS
// ============================================================
function showToast(message, type = 'info', duration = 4000) {
    const toast = document.getElementById('toast');
    toast.textContent = message;
    toast.className = 'toast ' + type + ' show';
    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
        toast.classList.remove('show');
    }, duration);
}

function updateStatus(text) {
    document.getElementById('scanStatus').textContent = text;
}

function getTimestamp() {
    return new Date().toLocaleTimeString();
}

// ============================================================
// LOAD BALANCE FROM BACKEND
// ============================================================
async function loadBalance() {
    try {
        const bal = await api('/api/balance?chatId=' + state.chatId);
        if (bal && !bal.error) {
            state.virtualBalance = parseFloat(bal.balance);
            state.tradesToday = bal.tradesToday || 0;
            updateUI();
        }
    } catch (e) {
        console.log('Backend not ready, using local mode');
    }
}

// ============================================================
// UPDATE UI
// ============================================================
function updateUI() {
    document.getElementById('virtualBalance').textContent = '$' + state.virtualBalance.toFixed(2);
    document.getElementById('totalPnL').textContent = (state.totalPnL >= 0 ? '+' : '') + state.totalPnL.toFixed(2);
    document.getElementById('winRate').textContent = state.stats.winRate.toFixed(1) + '%';
    document.getElementById('winLoss').textContent = state.stats.wins + ' / ' + state.stats.losses;
    document.getElementById('activeTrades').textContent = state.activeTrades.length;
    document.getElementById('totalTrades').textContent = state.stats.totalTrades;
    document.getElementById('activeCount').textContent = state.activeTrades.length;
    document.getElementById('lastUpdate').textContent = 'Last update: ' + getTimestamp();
}

// ============================================================
// SCAN ALL COINS
// ============================================================
async function scanAll() {
    if (state.isScanning) {
        showToast('Scan already in progress...', 'warning');
        return;
    }

    state.isScanning = true;
    updateStatus('🔄 Scanning ' + CONFIG.COINS.length + ' coins...');
    showToast('🔄 Scanning market...', 'info');

    const btn = document.querySelector('.btn-primary');
    if (btn) btn.disabled = true;

    try {
        const res = await api('/api/scanall', 'POST', { chatId: state.chatId });
        
        // Check for errors
        if (res.error) {
            showToast('Backend error: ' + res.error, 'error');
            updateStatus('❌ Error');
            state.isScanning = false;
            if (btn) btn.disabled = false;
            
            // Show the error in the table
            const tbody = document.getElementById('marketBody');
            tbody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align:center;padding:30px;color:#ff4444;">
                        ❌ Error: ${res.error}<br>
                        <span style="color:#666;font-size:12px;">Check console for details</span>
                    </td>
                </tr>
            `;
            return;
        }

        // Check if data exists
        if (!res.data || !Array.isArray(res.data)) {
            showToast('No data received from backend', 'warning');
            updateStatus('⚠️ No data');
            state.isScanning = false;
            if (btn) btn.disabled = false;
            return;
        }

        state.marketData = res.data;
        state.signals = state.marketData.filter(r => r.signal && r.signal !== 'HOLD');

        // Auto-trade high confidence signals
        for (const signal of state.signals) {
            if (signal.confidence >= 70 && state.activeTrades.length < CONFIG.MAX_OPEN_TRADES) {
                await executeTrade(signal);
            }
        }

        renderTable();
        renderActiveTrades();
        renderHistory();
        updateUI();
        
        showToast('✅ Scan complete! Found ' + state.signals.length + ' signals', 'success');
        updateStatus('✅ Done - ' + state.signals.length + ' signals found');

    } catch (e) {
        showToast('Error: ' + e.message, 'error');
        updateStatus('❌ Error');
        console.error('Scan error:', e);
    }

    state.isScanning = false;
    if (btn) btn.disabled = false;
}

// ============================================================
// EXECUTE TRADE
// ============================================================
async function executeTrade(signal) {
    // Check if already in a trade for this symbol
    const existing = state.activeTrades.find(t => t.symbol === signal.symbol);
    if (existing) return;

    // Check daily limit
    const today = new Date().toDateString();
    const dailyTrades = state.history.filter(h => 
        h.exitTime && new Date(h.exitTime).toDateString() === today
    ).length;
    if (dailyTrades >= CONFIG.DAILY_TRADE_LIMIT) {
        showToast('Daily trade limit reached (' + CONFIG.DAILY_TRADE_LIMIT + ')', 'warning');
        return;
    }

    const trade = {
        id: Date.now() + '_' + signal.symbol,
        symbol: signal.symbol,
        direction: signal.signal,
        entryPrice: signal.price,
        positionSize: 100,
        tp: signal.tp || null,
        sl: signal.sl || null,
        entryTime: Date.now(),
        status: 'OPEN',
        confidence: signal.confidence || 0,
        reason: signal.reason || '',
        pnl: 0,
        pnlPercent: 0,
        exitPrice: null,
        exitTime: null
    };

    state.activeTrades.push(trade);
    state.virtualBalance -= trade.positionSize;
    saveState();
    renderActiveTrades();
    updateUI();

    showToast('📈 ' + trade.direction + ' ' + trade.symbol + ' @ $' + trade.entryPrice.toFixed(2), 'success');
}

// ============================================================
// CLOSE TRADE
// ============================================================
async function closeTrade(tradeId, exitPrice) {
    const trade = state.activeTrades.find(t => t.id === tradeId);
    if (!trade) return;

    const pnl = (exitPrice - trade.entryPrice) * (trade.direction.includes('BUY') ? 1 : -1) * trade.positionSize / trade.entryPrice;
    const pnlPercent = (pnl / trade.positionSize) * 100;
    
    trade.exitPrice = exitPrice;
    trade.exitTime = Date.now();
    trade.status = pnl >= 0 ? 'WIN' : 'LOSS';
    trade.pnl = pnl;
    trade.pnlPercent = pnlPercent;

    // Update virtual balance
    state.virtualBalance += trade.positionSize + pnl;
    state.totalPnL += pnl;

    // Move to history
    state.history.push({ ...trade });
    state.activeTrades = state.activeTrades.filter(t => t.id !== tradeId);

    // Update stats
    if (trade.status === 'WIN') state.stats.wins++;
    else state.stats.losses++;
    state.stats.totalTrades++;
    state.stats.winRate = state.stats.totalTrades > 0 ? 
        (state.stats.wins / state.stats.totalTrades * 100) : 0;

    saveState();
    renderActiveTrades();
    renderHistory();
    updateUI();

    showToast((trade.status === 'WIN' ? '✅' : '❌') + ' ' + trade.symbol + ' ' + trade.direction + ' PnL: ' + (pnlPercent > 0 ? '+' : '') + pnlPercent.toFixed(2) + '%', 
        trade.status === 'WIN' ? 'success' : 'error');
}

function closeAllTrades() {
    if (state.activeTrades.length === 0) {
        showToast('No active trades to close', 'warning');
        return;
    }

    if (!confirm('Close all ' + state.activeTrades.length + ' active trades?')) return;

    for (const trade of state.activeTrades) {
        const exitPrice = trade.entryPrice * (1 + (Math.random() - 0.5) * 0.02);
        closeTrade(trade.id, exitPrice);
    }
}

// ============================================================
// RENDER FUNCTIONS
// ============================================================
function renderTable() {
    const tbody = document.getElementById('marketBody');
    const data = state.marketData;

    if (!data || data.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" class="loading-cell">
                    <div class="spinner"></div>
                    <p>Loading market data...</p>
                </td>
            </tr>
        `;
        return;
    }

    // Apply filters
    const searchTerm = document.getElementById('searchInput')?.value.toLowerCase() || '';
    const signalFilter = document.getElementById('signalFilter')?.value || 'all';

    const filtered = data.filter(item => {
        const matchSearch = item.symbol.toLowerCase().includes(searchTerm);
        const signalLower = (item.signal || 'HOLD').toLowerCase();
        const matchSignal = signalFilter === 'all' || 
            (signalFilter === 'buy' && (signalLower === 'buy' || signalLower === 'strong_buy')) ||
            (signalFilter === 'sell' && (signalLower === 'sell' || signalLower === 'strong_sell')) ||
            (signalFilter === 'strong_buy' && signalLower === 'strong_buy') ||
            (signalFilter === 'strong_sell' && signalLower === 'strong_sell') ||
            (signalFilter === 'hold' && signalLower === 'hold');
        return matchSearch && matchSignal;
    });

    if (filtered.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="8" style="text-align:center;padding:30px;color:#666;">
                    No matching coins found
                </td>
            </tr>
        `;
        return;
    }

    let html = '';
    filtered.forEach((item, index) => {
        const signalLower = (item.signal || 'HOLD').toLowerCase();
        const signalClass = signalLower.includes('buy') ? 'buy' :
            signalLower.includes('sell') ? 'sell' : 'hold';
        const signalDisplay = (item.signal || 'HOLD').replace('_', ' ');
        const isStrong = signalLower.includes('strong');
        const changeClass = item.change24h >= 0 ? 'green' : 'red';
        const changeArrow = item.change24h >= 0 ? '▲' : '▼';
        const confidenceColor = (item.confidence || 0) >= 70 ? 'high' : (item.confidence || 0) >= 50 ? 'medium' : 'low';

        const isActive = state.activeTrades.some(t => t.symbol === item.symbol);

        html += `
            <tr>
                <td style="color:#666;">${index + 1}</td>
                <td class="symbol-cell">${item.symbol} <small>USDT</small></td>
                <td class="price-cell">$${item.price ? item.price.toFixed(2) : 'N/A'}</td>
                <td class="change-cell ${changeClass}">${changeArrow} ${item.change24h ? item.change24h.toFixed(2) : '0'}%</td>
                <td>${item.rsi || '-'}</td>
                <td>
                    <span class="signal-badge ${isStrong ? 'strong-' : ''}${signalClass}">
                        ${signalDisplay}
                    </span>
                    ${isActive ? ' 🔒' : ''}
                </td>
                <td>
                    <div class="confidence-bar">
                        <div class="fill ${confidenceColor}" style="width:${item.confidence || 0}%"></div>
                    </div>
                    <span style="color:#666;font-size:11px;margin-left:6px;">${item.confidence || 0}%</span>
                </td>
                <td>
                    ${item.signal && item.signal !== 'HOLD' && !isActive ? 
                        `<button onclick="executeTradeFromTable('${item.symbol}')" 
                                 style="background:#f0b90b22;border:1px solid #f0b90b44;color:#f0b90b;padding:4px 14px;border-radius:4px;cursor:pointer;font-size:12px;">
                            Trade
                        </button>` : 
                        isActive ? 
                        `<span style="color:#666;font-size:11px;">Active</span>` :
                        `<span style="color:#666;font-size:11px;">-</span>`
                    }
                </td>
            </tr>
        `;
    });

    tbody.innerHTML = html;
}

function renderActiveTrades() {
    const container = document.getElementById('activeTradesList');

    if (state.activeTrades.length === 0) {
        container.innerHTML = '<div class="empty-state">No active trades. Signals will appear here.</div>';
        return;
    }

    let html = '';
    state.activeTrades.forEach(trade => {
        const directionClass = trade.direction.includes('BUY') ? 'green' : 'red';
        const currentPrice = state.marketData.find(m => m.symbol === trade.symbol)?.price || trade.entryPrice;
        const unrealizedPnl = (currentPrice - trade.entryPrice) * (trade.direction.includes('BUY') ? 1 : -1) * trade.positionSize / trade.entryPrice;
        const unrealizedPnlPercent = (unrealizedPnl / trade.positionSize) * 100;

        html += `
            <div class="trade-item">
                <div class="trade-info">
                    <span class="trade-symbol">${trade.symbol}</span>
                    <span class="signal-badge ${trade.direction.toLowerCase().replace('_', '-')}">${trade.direction}</span>
                    <span class="trade-price">Entry: $${trade.entryPrice.toFixed(2)}</span>
                    <span class="trade-price">Current: $${currentPrice.toFixed(2)}</span>
                    <span class="trade-pnl ${unrealizedPnl >= 0 ? 'positive' : 'negative'}">
                        ${unrealizedPnl >= 0 ? '+' : ''}${unrealizedPnlPercent.toFixed(2)}%
                    </span>
                    <span class="trade-status open">OPEN</span>
                </div>
                <div>
                    <button onclick="closeTrade('${trade.id}', ${currentPrice})" 
                            class="btn-small btn-danger">
                        Close
                    </button>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

function renderHistory() {
    const container = document.getElementById('historyList');

    if (state.history.length === 0) {
        container.innerHTML = '<div class="empty-state">No trade history yet.</div>';
        return;
    }

    let html = '';
    const recent = state.history.slice(-20).reverse();
    recent.forEach((item, index) => {
        const pnlClass = item.pnl >= 0 ? 'positive' : 'negative';
        const statusClass = item.status === 'WIN' ? 'win' : 'loss';

        html += `
            <div class="history-item">
                <div class="trade-info">
                    <span style="color:#666;font-size:11px;">#${state.history.length - index}</span>
                    <span class="trade-symbol">${item.symbol}</span>
                    <span class="signal-badge ${item.direction.toLowerCase().replace('_', '-')}">${item.direction}</span>
                    <span class="trade-price">Entry: $${item.entryPrice.toFixed(2)}</span>
                    <span class="trade-price">Exit: $${item.exitPrice ? item.exitPrice.toFixed(2) : 'N/A'}</span>
                    <span class="trade-pnl ${pnlClass}">${item.pnl >= 0 ? '+' : ''}${(item.pnlPercent || 0).toFixed(2)}%</span>
                </div>
                <div>
                    <span class="trade-status ${statusClass}">${item.status}</span>
                    <span class="trade-time">${item.exitTime ? new Date(item.exitTime).toLocaleTimeString() : ''}</span>
                </div>
            </div>
        `;
    });

    container.innerHTML = html;
}

// ============================================================
// UI ACTIONS
// ============================================================
function executeTradeFromTable(symbol) {
    const signal = state.marketData.find(m => m.symbol === symbol);
    if (!signal || signal.signal === 'HOLD') return;
    executeTrade(signal);
}

function resetBalance() {
    if (!confirm('Reset virtual balance to $10,000 and clear all trades?')) return;
    state.virtualBalance = CONFIG.START_BALANCE;
    state.totalPnL = 0;
    state.activeTrades = [];
    state.history = [];
    state.stats = { wins: 0, losses: 0, winRate: 0, totalTrades: 0 };
    saveState();
    renderActiveTrades();
    renderHistory();
    updateUI();
    showToast('💰 Balance reset to $10,000', 'success');
}

function clearHistory() {
    if (!confirm('Clear all trade history?')) return;
    state.history = [];
    saveState();
    renderHistory();
    showToast('History cleared', 'info');
}

function toggleAutoScan() {
    state.autoScan = document.getElementById('autoScan').checked;
    if (state.autoScan) {
        showToast('🔄 Auto-scan enabled (every 60s)', 'info');
        if (!state.isScanning) scanAll();
    } else {
        showToast('Auto-scan disabled', 'info');
    }
}

function scanTop() {
    const topSignals = state.marketData
        .filter(m => m.signal && m.signal !== 'HOLD')
        .sort((a, b) => (b.confidence || 0) - (a.confidence || 0))
        .slice(0, 5);
    
    if (topSignals.length === 0) {
        showToast('No signals found. Scan market first.', 'warning');
        return;
    }

    showToast('🔍 Found ' + topSignals.length + ' top signals', 'info');
    
    for (const signal of topSignals) {
        if (state.activeTrades.length < CONFIG.MAX_OPEN_TRADES) {
            executeTrade(signal);
        }
    }
}

function filterCoins() {
    renderTable();
}

// ============================================================
// AUTO-REFRESH
// ============================================================
let refreshInterval = null;

function startAutoRefresh() {
    if (refreshInterval) clearInterval(refreshInterval);
    refreshInterval = setInterval(() => {
        if (state.autoScan && !state.isScanning) {
            scanAll();
        }
        loadBalance();
        updateUI();
    }, CONFIG.REFRESH_INTERVAL);
}

// ============================================================
// INIT
// ============================================================
function init() {
    loadState();
    loadBalance();
    updateUI();
    renderActiveTrades();
    renderHistory();
    startAutoRefresh();
    
    // Initial scan
    setTimeout(() => scanAll(), 1000);
    
    showToast('🚀 Bybit Smart Bot Pro initialized', 'info');
    console.log('📊 Bybit Smart Bot Pro loaded!');
    console.log('🪙 Monitoring ' + CONFIG.COINS.length + ' coins');
    console.log('💰 Virtual Balance: $' + state.virtualBalance.toFixed(2));
    console.log('🌐 Worker URL: ' + CONFIG.API_URL);
}

// Start the app when DOM is ready
document.addEventListener('DOMContentLoaded', init);