"""SQLite storage for accounts, orders, positions, trades and settings."""

from __future__ import annotations

import json
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

SCHEMA = """
CREATE TABLE IF NOT EXISTS accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'USD',
    starting_balance REAL NOT NULL,
    cash REAL NOT NULL,
    realized_pnl REAL NOT NULL DEFAULT 0,
    fees_paid REAL NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS positions (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    qty REAL NOT NULL,
    avg_price REAL NOT NULL,
    sl REAL,
    tp REAL,
    opened_at TEXT NOT NULL,
    PRIMARY KEY (account_id, symbol)
);

CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    type TEXT NOT NULL,
    qty REAL NOT NULL,
    limit_price REAL,
    stop_price REAL,
    sl REAL,
    tp REAL,
    status TEXT NOT NULL,
    reason TEXT,
    fill_price REAL,
    fee REAL,
    created_at TEXT NOT NULL,
    closed_at TEXT
);

CREATE TABLE IF NOT EXISTS trades (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    order_id INTEGER,
    symbol TEXT NOT NULL,
    side TEXT NOT NULL,
    qty REAL NOT NULL,
    price REAL NOT NULL,
    fee REAL NOT NULL,
    realized_pnl REAL NOT NULL,
    reason TEXT NOT NULL,
    ts TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS equity_snapshots (
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    ts INTEGER NOT NULL,
    equity REAL NOT NULL,
    PRIMARY KEY (account_id, ts)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS watchlist (
    symbol TEXT PRIMARY KEY,
    position INTEGER NOT NULL
);
"""

DEFAULT_SETTINGS: dict[str, Any] = {
    # "live" reads real prices; "practice" uses generated prices with no network.
    "data_mode": "live",
    "alpaca_key_id": "",
    "alpaca_secret_key": "",
    "crypto_fee_pct": 0.1,
    "stock_fee_per_share": 0.0,
    "slippage_bps": 2.0,
}

DEFAULT_WATCHLIST = [
    "BTCUSDT", "ETHUSDT", "SOLUSDT", "BNBUSDT", "XRPUSDT",
    "AAPL", "MSFT", "NVDA", "TSLA", "SPY",
]


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


class Database:
    """A single shared SQLite connection guarded by a lock.

    trdr is single-user and runs on one PC, so one connection is plenty and
    keeps writes strictly ordered.
    """

    def __init__(self, path: Path | str):
        self.conn = sqlite3.connect(str(path), check_same_thread=False)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA foreign_keys = ON")
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.lock = threading.RLock()
        with self.lock:
            self.conn.executescript(SCHEMA)
            self._seed()

    def _seed(self) -> None:
        for key, value in DEFAULT_SETTINGS.items():
            self.conn.execute(
                "INSERT OR IGNORE INTO settings(key, value) VALUES (?, ?)",
                (key, json.dumps(value)),
            )
        if not self.conn.execute("SELECT 1 FROM watchlist LIMIT 1").fetchone():
            self.conn.executemany(
                "INSERT INTO watchlist(symbol, position) VALUES (?, ?)",
                [(s, i) for i, s in enumerate(DEFAULT_WATCHLIST)],
            )
        if not self.conn.execute("SELECT 1 FROM accounts LIMIT 1").fetchone():
            self.conn.execute(
                "INSERT INTO accounts(name, starting_balance, cash, created_at) VALUES (?, ?, ?, ?)",
                ("Demo account 1", 10_000.0, 10_000.0, now_iso()),
            )
        self.conn.commit()

    def query(self, sql: str, params: tuple = ()) -> list[dict]:
        with self.lock:
            return [dict(r) for r in self.conn.execute(sql, params).fetchall()]

    def one(self, sql: str, params: tuple = ()) -> dict | None:
        with self.lock:
            row = self.conn.execute(sql, params).fetchone()
            return dict(row) if row else None

    def execute(self, sql: str, params: tuple = ()) -> int:
        with self.lock:
            cur = self.conn.execute(sql, params)
            self.conn.commit()
            return cur.lastrowid

    # Settings -----------------------------------------------------------

    def settings(self) -> dict[str, Any]:
        rows = self.query("SELECT key, value FROM settings")
        merged = dict(DEFAULT_SETTINGS)
        merged.update({r["key"]: json.loads(r["value"]) for r in rows})
        return merged

    def update_settings(self, values: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            for key, value in values.items():
                if key not in DEFAULT_SETTINGS:
                    continue
                self.conn.execute(
                    "INSERT INTO settings(key, value) VALUES (?, ?) "
                    "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (key, json.dumps(value)),
                )
            self.conn.commit()
        return self.settings()

    # Watchlist ----------------------------------------------------------

    def watchlist(self) -> list[str]:
        return [r["symbol"] for r in self.query("SELECT symbol FROM watchlist ORDER BY position")]

    def set_watchlist(self, symbols: list[str]) -> list[str]:
        with self.lock:
            self.conn.execute("DELETE FROM watchlist")
            seen: list[str] = []
            for s in symbols:
                s = s.strip().upper()
                if s and s not in seen:
                    seen.append(s)
            self.conn.executemany(
                "INSERT INTO watchlist(symbol, position) VALUES (?, ?)",
                [(s, i) for i, s in enumerate(seen)],
            )
            self.conn.commit()
        return self.watchlist()
