"""US stock prices from Alpaca's market data API (free IEX feed).

trdr only calls Alpaca's data service (data.alpaca.markets and
stream.data.alpaca.markets), never its trading service. The free plan streams
the IEX exchange for up to 30 symbols and serves history back to 2016.
https://docs.alpaca.markets/us/docs/about-market-data-api
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone

import httpx
import websockets

from .base import TF_SECONDS, Candle, DataUnavailable, TickHandler

REST = "https://data.alpaca.markets/v2/stocks"
WS = "wss://stream.data.alpaca.markets/v2/iex"
MAX_STREAM_SYMBOLS = 30

TIMEFRAMES = {"1m": "1Min", "5m": "5Min", "15m": "15Min", "1h": "1Hour", "4h": "4Hour", "1d": "1Day", "1w": "1Week"}


def _ts(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())


class AlpacaProvider:
    name = "alpaca"

    def __init__(self, client: httpx.AsyncClient, key_id: str, secret: str):
        self.client = client
        self.key_id = key_id
        self.secret = secret

    @property
    def configured(self) -> bool:
        return bool(self.key_id and self.secret)

    def _headers(self) -> dict[str, str]:
        if not self.configured:
            raise DataUnavailable("Add your free Alpaca data keys in Settings to see US stocks")
        return {"APCA-API-KEY-ID": self.key_id, "APCA-API-SECRET-KEY": self.secret}

    async def candles(self, symbol: str, timeframe: str, limit: int) -> list[Candle]:
        headers = self._headers()
        # Stocks trade about 6.5 hours a day, 5 days a week, so look back far
        # enough in calendar time to collect `limit` bars, then keep the latest.
        lookback = TF_SECONDS[timeframe] * limit * (6 if timeframe not in ("1d", "1w") else 2)
        start = datetime.fromtimestamp(time.time() - lookback, tz=timezone.utc)
        params = {
            "timeframe": TIMEFRAMES[timeframe],
            "start": start.isoformat().replace("+00:00", "Z"),
            "limit": min(limit, 10_000),
            "feed": "iex",
            "adjustment": "split",
            "sort": "desc",
        }
        try:
            r = await self.client.get(f"{REST}/{symbol.upper()}/bars", params=params, headers=headers)
        except httpx.HTTPError as exc:
            raise DataUnavailable(f"Alpaca is unreachable: {exc}") from exc
        if r.status_code in (401, 403):
            raise DataUnavailable("Alpaca rejected the data keys; check them in Settings")
        if r.status_code != 200:
            raise DataUnavailable(f"Alpaca returned {r.status_code} for {symbol}")
        bars = r.json().get("bars") or []
        return [
            {
                "time": _ts(b["t"]),
                "open": float(b["o"]),
                "high": float(b["h"]),
                "low": float(b["l"]),
                "close": float(b["c"]),
                "volume": float(b["v"]),
            }
            for b in reversed(bars)
        ]

    async def stream(self, symbols: list[str], on_tick: TickHandler) -> None:
        if not symbols or not self.configured:
            return
        async with websockets.connect(WS, ping_interval=20) as ws:
            await ws.send(json.dumps({"action": "auth", "key": self.key_id, "secret": self.secret}))
            await ws.send(json.dumps({"action": "subscribe", "trades": symbols[:MAX_STREAM_SYMBOLS]}))
            async for raw in ws:
                for msg in json.loads(raw):
                    kind = msg.get("T")
                    if kind == "t":
                        await on_tick(msg["S"], float(msg["p"]), _ts(msg["t"]) * 1000)
                    elif kind == "error":
                        raise DataUnavailable(f"Alpaca stream error: {msg.get('msg')}")
