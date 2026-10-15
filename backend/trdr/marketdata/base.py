"""Shared types for market data providers."""

from __future__ import annotations

from typing import Awaitable, Callable, Protocol, TypedDict

TIMEFRAMES = ("1m", "5m", "15m", "1h", "4h", "1d", "1w")

TF_SECONDS = {
    "1m": 60,
    "5m": 300,
    "15m": 900,
    "1h": 3600,
    "4h": 14_400,
    "1d": 86_400,
    "1w": 604_800,
}


class Candle(TypedDict):
    time: int  # bar open time, unix seconds (UTC)
    open: float
    high: float
    low: float
    close: float
    volume: float


TickHandler = Callable[[str, float, int], Awaitable[None]]


class DataUnavailable(RuntimeError):
    """The provider cannot serve this request (no keys, network down, unknown symbol)."""


class Provider(Protocol):
    name: str

    async def candles(self, symbol: str, timeframe: str, limit: int) -> list[Candle]: ...

    async def stream(self, symbols: list[str], on_tick: TickHandler) -> None:
        """Push (symbol, price, unix_ms) until cancelled. Raises on connection loss."""
        ...
