"""Generated practice prices for trading with no internet connection.

Each symbol gets its own deterministic random walk, so history looks the same
every time and live ticks continue smoothly from it. Selected in Settings as
"Practice data".
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import random
import time

from .base import TF_SECONDS, Candle, TickHandler

BASE_PRICES = {"BTCUSDT": 65_000.0, "ETHUSDT": 3_200.0, "SOLUSDT": 150.0, "AAPL": 220.0, "SPY": 560.0}


def _seed(symbol: str) -> int:
    return int(hashlib.sha256(symbol.encode()).hexdigest()[:8], 16)


def _base(symbol: str) -> float:
    return BASE_PRICES.get(symbol.upper(), 20 + _seed(symbol) % 480)


class PracticeProvider:
    name = "practice"

    def __init__(self) -> None:
        self.last: dict[str, float] = {}

    def _walk(self, symbol: str, timeframe: str, limit: int) -> list[Candle]:
        step = TF_SECONDS[timeframe]
        end = int(time.time()) // step * step
        rng = random.Random(_seed(symbol) ^ step)
        vol = 0.004 * math.sqrt(step / 60) ** 0.5
        price = _base(symbol)
        out: list[Candle] = []
        for i in range(limit):
            o = price
            c = max(0.01, o * (1 + rng.gauss(0.0002, vol)))
            h = max(o, c) * (1 + abs(rng.gauss(0, vol / 2)))
            low = min(o, c) * (1 - abs(rng.gauss(0, vol / 2)))
            out.append({
                "time": end - (limit - 1 - i) * step,
                "open": o, "high": h, "low": low, "close": c,
                "volume": abs(rng.gauss(1000, 300)),
            })
            price = c
        return out

    async def candles(self, symbol: str, timeframe: str, limit: int) -> list[Candle]:
        bars = self._walk(symbol.upper(), timeframe, limit)
        if symbol.upper() in self.last:
            bars[-1]["close"] = self.last[symbol.upper()]
            bars[-1]["high"] = max(bars[-1]["high"], bars[-1]["close"])
            bars[-1]["low"] = min(bars[-1]["low"], bars[-1]["close"])
        return bars

    async def stream(self, symbols: list[str], on_tick: TickHandler) -> None:
        rng = random.Random()
        for s in symbols:
            self.last.setdefault(s, self._walk(s, "1m", 1)[-1]["close"])
        while True:
            for s in symbols:
                self.last[s] *= 1 + rng.gauss(0, 0.0006)
                await on_tick(s, self.last[s], int(time.time() * 1000))
            await asyncio.sleep(1)
