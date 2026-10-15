"""The market hub: keeps price streams running and fans prices out.

It decides which symbols need live prices (watchlist, open positions, open
orders and whatever the open pages are showing), runs one stream per market,
feeds every price into the simulated broker, and pushes prices and account
changes to the browser over a WebSocket.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

import httpx
from fastapi import WebSocket

from .broker import SimBroker
from .db import Database
from .marketdata.alpaca import MAX_STREAM_SYMBOLS, AlpacaProvider
from .marketdata.base import Candle, DataUnavailable
from .marketdata.binance import BinanceProvider
from .marketdata.practice import PracticeProvider
from .symbols import market_of

log = logging.getLogger("trdr.hub")

MARKETS = ("crypto", "stocks")
BROADCAST_INTERVAL = 0.25  # seconds between price pushes per symbol


class MarketHub:
    def __init__(self, db: Database, broker: SimBroker):
        self.db = db
        self.broker = broker
        self.client = httpx.AsyncClient(timeout=15)
        self.practice = PracticeProvider()
        self.binance = BinanceProvider(self.client)
        self.alpaca = AlpacaProvider(self.client, "", "")
        self.clients: set[WebSocket] = set()
        self.client_symbols: dict[WebSocket, set[str]] = {}
        self.status: dict[str, dict[str, Any]] = {m: {"state": "starting", "message": ""} for m in MARKETS}
        self._tasks: dict[str, asyncio.Task] = {}
        self._streaming: dict[str, list[str]] = {m: [] for m in MARKETS}
        self._last_push: dict[str, float] = {}
        self._changed = asyncio.Event()
        self._runner: asyncio.Task | None = None
        self._snapshots: asyncio.Task | None = None
        self.reload_settings()

    # Configuration ------------------------------------------------------

    def reload_settings(self) -> None:
        s = self.db.settings()
        self.mode = s["data_mode"]
        self.alpaca = AlpacaProvider(self.client, s["alpaca_key_id"], s["alpaca_secret_key"])
        # Restart every stream so a new data source or new keys take effect.
        for task in self._tasks.values():
            task.cancel()
        self._tasks.clear()
        self._changed.set()

    def provider(self, market: str):
        if self.mode == "practice":
            return self.practice
        return self.binance if market == "crypto" else self.alpaca

    # Symbols ------------------------------------------------------------

    def wanted_symbols(self) -> dict[str, list[str]]:
        wanted: list[str] = list(self.db.watchlist())
        for row in self.db.query("SELECT DISTINCT symbol FROM positions UNION SELECT DISTINCT symbol FROM orders WHERE status = 'open'"):
            wanted.append(row["symbol"])
        for extra in self.client_symbols.values():
            wanted.extend(extra)
        out: dict[str, list[str]] = {m: [] for m in MARKETS}
        for s in wanted:
            m = market_of(s)
            if s not in out[m]:
                out[m].append(s)
        if self.mode != "practice":
            out["stocks"] = out["stocks"][:MAX_STREAM_SYMBOLS]
        return out

    def symbols_changed(self) -> None:
        self._changed.set()

    # Lifecycle ----------------------------------------------------------

    async def start(self) -> None:
        self._runner = asyncio.create_task(self._supervise())
        self._snapshots = asyncio.create_task(self._snapshot_loop())

    async def stop(self) -> None:
        for task in [self._runner, self._snapshots, *self._tasks.values()]:
            if task:
                task.cancel()
        await self.client.aclose()

    async def _supervise(self) -> None:
        while True:
            wanted = self.wanted_symbols()
            for market in MARKETS:
                symbols = wanted[market]
                task = self._tasks.get(market)
                if task and not task.done() and symbols == self._streaming[market]:
                    continue
                if task:
                    task.cancel()
                self._streaming[market] = symbols
                self._tasks[market] = asyncio.create_task(self._run_stream(market, symbols))
            self._changed.clear()
            try:
                await asyncio.wait_for(self._changed.wait(), timeout=30)
            except asyncio.TimeoutError:
                pass

    async def _run_stream(self, market: str, symbols: list[str]) -> None:
        backoff = 2
        while True:
            provider = self.provider(market)
            if not symbols:
                self._set_status(market, "idle", "No symbols to watch")
                return
            if market == "stocks" and provider is self.alpaca and not self.alpaca.configured:
                self._set_status(market, "off", "Add your free Alpaca data keys in Settings")
                return
            self._set_status(market, "connecting", f"{provider.name}: {len(symbols)} symbols")
            try:
                await provider.stream(symbols, self._on_tick)
                raise DataUnavailable("stream closed")
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # network errors, auth errors, closed sockets
                log.warning("%s stream stopped: %s", market, exc)
                self._set_status(market, "error", f"{provider.name}: {exc}. Retrying in {backoff}s")
                await asyncio.sleep(backoff)
                backoff = min(backoff * 2, 60)

    def _set_status(self, market: str, state: str, message: str) -> None:
        self.status[market] = {"state": state, "message": message, "since": int(time.time())}
        asyncio.create_task(self.broadcast({"type": "status", "status": self.status}))

    async def _on_tick(self, symbol: str, price: float, ts_ms: int) -> None:
        market = market_of(symbol)
        if self.status[market]["state"] != "live":
            self._set_status(market, "live", f"{self.provider(market).name}: {len(self._streaming[market])} symbols")
        events = self.broker.on_price(symbol, price)
        for account_id in {e["account_id"] for e in events}:
            await self.broadcast({"type": "account", "account_id": account_id, "events": events})
        now = time.monotonic()
        if now - self._last_push.get(symbol, 0) >= BROADCAST_INTERVAL:
            self._last_push[symbol] = now
            await self.broadcast({"type": "price", "symbol": symbol, "price": price, "ts": ts_ms or int(time.time() * 1000)})

    async def _snapshot_loop(self) -> None:
        await asyncio.sleep(5)  # let the first prices arrive
        while True:
            try:
                self.broker.snapshot_equity(int(time.time()) // 60 * 60)
            except Exception:  # never let a snapshot failure stop the loop
                log.exception("equity snapshot failed")
            await asyncio.sleep(60)

    # Data access --------------------------------------------------------

    async def candles(self, symbol: str, timeframe: str, limit: int) -> list[Candle]:
        bars = await self.provider(market_of(symbol)).candles(symbol, timeframe, limit)
        if bars and symbol.upper() not in self.broker.prices:
            self.broker.prices[symbol.upper()] = bars[-1]["close"]
        return bars

    async def ensure_price(self, symbol: str) -> float:
        symbol = symbol.upper()
        if symbol not in self.broker.prices:
            bars = await self.candles(symbol, "1m", 2)
            if not bars:
                raise DataUnavailable(f"No price available for {symbol}")
        return self.broker.prices[symbol]

    # Browser connections ------------------------------------------------

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.add(ws)
        self.client_symbols[ws] = set()
        await ws.send_text(json.dumps({"type": "status", "status": self.status}))
        await ws.send_text(json.dumps({"type": "prices", "prices": self.broker.prices}))

    def disconnect(self, ws: WebSocket) -> None:
        self.clients.discard(ws)
        if self.client_symbols.pop(ws, None):
            self.symbols_changed()

    def subscribe(self, ws: WebSocket, symbols: list[str]) -> None:
        new = {s.upper() for s in symbols if s}
        if new != self.client_symbols.get(ws):
            self.client_symbols[ws] = new
            self.symbols_changed()

    async def broadcast(self, message: dict) -> None:
        if not self.clients:
            return
        text = json.dumps(message)
        for ws in list(self.clients):
            try:
                await ws.send_text(text)
            except Exception:
                self.disconnect(ws)
