"""Crypto prices from Binance's public market-data-only endpoints.

These hosts serve public data only and need no API key; trdr never uses
Binance's trading endpoints.
https://developers.binance.com/docs/binance-spot-api-docs/faqs/market_data_only
"""

from __future__ import annotations

import json

import httpx
import websockets

from .base import Candle, DataUnavailable, TickHandler

REST = "https://data-api.binance.vision/api/v3"
WS = "wss://data-stream.binance.vision/stream"

INTERVALS = {"1m": "1m", "5m": "5m", "15m": "15m", "1h": "1h", "4h": "4h", "1d": "1d", "1w": "1w"}


class BinanceProvider:
    name = "binance"

    def __init__(self, client: httpx.AsyncClient):
        self.client = client
        self._symbols: list[str] | None = None

    async def candles(self, symbol: str, timeframe: str, limit: int) -> list[Candle]:
        try:
            r = await self.client.get(
                f"{REST}/klines",
                params={"symbol": symbol.upper(), "interval": INTERVALS[timeframe], "limit": min(limit, 1000)},
            )
        except httpx.HTTPError as exc:
            raise DataUnavailable(f"Binance is unreachable: {exc}") from exc
        if r.status_code != 200:
            raise DataUnavailable(f"Binance returned {r.status_code} for {symbol}")
        return [
            {
                "time": int(k[0]) // 1000,
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
            }
            for k in r.json()
        ]

    async def symbols(self) -> list[str]:
        """All trading USDT spot pairs, cached for the session."""
        if self._symbols is None:
            try:
                r = await self.client.get(f"{REST}/exchangeInfo", params={"permissions": "SPOT"})
                r.raise_for_status()
            except httpx.HTTPError as exc:
                raise DataUnavailable(f"Binance is unreachable: {exc}") from exc
            self._symbols = sorted(
                s["symbol"]
                for s in r.json().get("symbols", [])
                if s.get("status") == "TRADING" and s.get("quoteAsset") == "USDT"
            )
        return self._symbols

    async def stream(self, symbols: list[str], on_tick: TickHandler) -> None:
        if not symbols:
            return
        streams = "/".join(f"{s.lower()}@miniTicker" for s in symbols)
        async with websockets.connect(f"{WS}?streams={streams}", ping_interval=20) as ws:
            async for raw in ws:
                data = json.loads(raw).get("data", {})
                if "s" in data and "c" in data:
                    await on_tick(data["s"], float(data["c"]), int(data.get("E", 0)))
