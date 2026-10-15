"""HTTP and WebSocket API, plus the built web app."""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from . import __version__, config
from .broker import OrderError, SimBroker
from .db import Database
from .hub import MarketHub
from .marketdata.base import TIMEFRAMES, DataUnavailable
from .symbols import display_name, market_of

SECRET_KEYS = ("alpaca_secret_key",)


class OrderIn(BaseModel):
    symbol: str
    side: str
    type: str = "market"
    qty: float = Field(gt=0)
    limit_price: float | None = None
    stop_price: float | None = None
    sl: float | None = None
    tp: float | None = None


class AccountIn(BaseModel):
    name: str = "Demo account"
    balance: float = Field(default=10_000, gt=0)
    currency: str = "USD"


class ResetIn(BaseModel):
    balance: float | None = None


class RenameIn(BaseModel):
    name: str


class ProtectionIn(BaseModel):
    sl: float | None = None
    tp: float | None = None


class WatchlistIn(BaseModel):
    symbols: list[str]


def create_app(db_path: Path | str | None = None, start_hub: bool = True) -> FastAPI:
    db = Database(db_path or config.db_path())
    broker = SimBroker(db)
    hub = MarketHub(db, broker)

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        if start_hub:
            await hub.start()
        yield
        await hub.stop()

    app = FastAPI(title="trdr", version=__version__, lifespan=lifespan)
    app.state.db, app.state.broker, app.state.hub = db, broker, hub

    def bad_request(exc: Exception) -> HTTPException:
        return HTTPException(status_code=400, detail=str(exc))

    async def notify(account_id: int) -> None:
        await hub.broadcast({"type": "account", "account_id": account_id, "events": []})

    # System -------------------------------------------------------------

    @app.get("/api/health")
    async def health():
        return {"ok": True, "version": __version__, "mode": hub.mode, "feeds": hub.status}

    @app.get("/api/settings")
    async def get_settings():
        s = db.settings()
        for key in SECRET_KEYS:
            s[key] = "********" if s.get(key) else ""
        return s

    @app.put("/api/settings")
    async def put_settings(values: dict):
        for key in SECRET_KEYS:
            if values.get(key) == "********":
                values.pop(key)
        if "data_mode" in values and values["data_mode"] not in ("live", "practice"):
            raise HTTPException(400, "data_mode must be live or practice")
        db.update_settings(values)
        broker.prices.clear()
        hub.reload_settings()
        return await get_settings()

    # Market data --------------------------------------------------------

    @app.get("/api/watchlist")
    async def get_watchlist():
        return [
            {"symbol": s, "name": display_name(s), "market": market_of(s), "price": broker.prices.get(s)}
            for s in db.watchlist()
        ]

    @app.put("/api/watchlist")
    async def put_watchlist(body: WatchlistIn):
        db.set_watchlist(body.symbols)
        hub.symbols_changed()
        return await get_watchlist()

    @app.get("/api/symbols/search")
    async def search_symbols(q: str = ""):
        q = q.strip().upper()
        if not q:
            return []
        results: list[dict] = []
        try:
            crypto = await hub.binance.symbols() if hub.mode == "live" else ["BTCUSDT", "ETHUSDT", "SOLUSDT"]
            results += [{"symbol": s, "name": display_name(s), "market": "crypto"} for s in crypto if q in s][:15]
        except DataUnavailable:
            pass
        if q.isalpha() and len(q) <= 5 and not q.endswith("USDT"):
            results.insert(0, {"symbol": q, "name": q, "market": "stocks"})
        return results

    @app.get("/api/candles")
    async def candles(symbol: str, tf: str = "1h", limit: int = 500):
        if tf not in TIMEFRAMES:
            raise HTTPException(400, f"Timeframe must be one of {', '.join(TIMEFRAMES)}")
        try:
            return await hub.candles(symbol.upper(), tf, max(10, min(limit, 1000)))
        except DataUnavailable as exc:
            raise HTTPException(503, str(exc)) from exc

    # Accounts -----------------------------------------------------------

    @app.get("/api/accounts")
    async def accounts():
        return broker.list_accounts()

    @app.post("/api/accounts")
    async def create_account(body: AccountIn):
        try:
            return broker.create_account(body.name, body.balance, body.currency)
        except OrderError as exc:
            raise bad_request(exc) from exc

    @app.get("/api/accounts/{account_id}")
    async def account(account_id: int):
        try:
            return broker.summary(account_id)
        except OrderError as exc:
            raise HTTPException(404, str(exc)) from exc

    @app.patch("/api/accounts/{account_id}")
    async def rename_account(account_id: int, body: RenameIn):
        try:
            return broker.rename_account(account_id, body.name)
        except OrderError as exc:
            raise bad_request(exc) from exc

    @app.post("/api/accounts/{account_id}/reset")
    async def reset_account(account_id: int, body: ResetIn):
        try:
            result = broker.reset_account(account_id, body.balance)
        except OrderError as exc:
            raise bad_request(exc) from exc
        hub.symbols_changed()
        await notify(account_id)
        return result

    @app.delete("/api/accounts/{account_id}")
    async def delete_account(account_id: int):
        try:
            broker.delete_account(account_id)
        except OrderError as exc:
            raise bad_request(exc) from exc
        hub.symbols_changed()
        return {"ok": True}

    @app.get("/api/accounts/{account_id}/orders")
    async def orders(account_id: int, status: str | None = None):
        return broker.orders(account_id, status)

    @app.get("/api/accounts/{account_id}/trades")
    async def trades(account_id: int):
        return broker.trades(account_id)

    @app.get("/api/accounts/{account_id}/equity")
    async def equity(account_id: int, since: int = 0):
        return broker.equity_history(account_id, since)

    # Trading ------------------------------------------------------------

    @app.post("/api/accounts/{account_id}/orders")
    async def place_order(account_id: int, body: OrderIn):
        symbol = body.symbol.upper()
        try:
            if body.type == "market":
                await hub.ensure_price(symbol)
            order, events = broker.place_order(account_id, **{**body.model_dump(), "symbol": symbol})
        except (OrderError, DataUnavailable) as exc:
            raise bad_request(exc) from exc
        hub.symbols_changed()
        await hub.broadcast({"type": "account", "account_id": account_id, "events": events})
        return order

    @app.delete("/api/orders/{order_id}")
    async def cancel_order(order_id: int):
        try:
            order = broker.cancel_order(order_id)
        except OrderError as exc:
            raise bad_request(exc) from exc
        await notify(order["account_id"])
        return order

    @app.post("/api/accounts/{account_id}/positions/{symbol}/close")
    async def close_position(account_id: int, symbol: str):
        try:
            await hub.ensure_price(symbol)
            order, events = broker.close_position(account_id, symbol)
        except (OrderError, DataUnavailable) as exc:
            raise bad_request(exc) from exc
        await hub.broadcast({"type": "account", "account_id": account_id, "events": events})
        return order

    @app.put("/api/accounts/{account_id}/positions/{symbol}/protection")
    async def protect_position(account_id: int, symbol: str, body: ProtectionIn):
        try:
            result = broker.set_protection(account_id, symbol, body.sl, body.tp)
        except OrderError as exc:
            raise bad_request(exc) from exc
        await notify(account_id)
        return result

    # Live updates -------------------------------------------------------

    @app.websocket("/ws")
    async def ws_endpoint(ws: WebSocket):
        await hub.connect(ws)
        try:
            while True:
                msg = json.loads(await ws.receive_text())
                if msg.get("type") == "subscribe":
                    hub.subscribe(ws, list(msg.get("symbols", [])))
        except (WebSocketDisconnect, RuntimeError, ValueError):
            pass
        finally:
            hub.disconnect(ws)

    # Web app ------------------------------------------------------------

    if config.FRONTEND_DIST.exists():
        app.mount("/assets", StaticFiles(directory=config.FRONTEND_DIST / "assets"), name="assets")

        @app.get("/{path:path}", include_in_schema=False)
        async def spa(path: str):
            file = config.FRONTEND_DIST / path
            if path and file.is_file():
                return FileResponse(file)
            return FileResponse(config.FRONTEND_DIST / "index.html")

    return app
