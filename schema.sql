CREATE TABLE IF NOT EXISTS signals (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT,
    signal TEXT,
    confidence INTEGER,
    entry_price REAL,
    exit_price REAL,
    result TEXT,
    pnl REAL,
    created_at INTEGER,
    closed_at INTEGER
);

CREATE TABLE IF NOT EXISTS stats (
    id INTEGER PRIMARY KEY,
    wins INTEGER DEFAULT 0,
    losses INTEGER DEFAULT 0,
    total INTEGER DEFAULT 0,
    win_rate REAL DEFAULT 0
);