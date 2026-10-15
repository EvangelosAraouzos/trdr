"""Parsing tests for the price providers, using recorded-shape responses (no network)."""

import asyncio

import httpx
import pytest

from trdr.marketdata.alpaca import AlpacaProvider
from trdr.marketdata.base import DataUnavailable
from trdr.marketdata.binance import BinanceProvider


def run(coro):
    return asyncio.run(coro)


def client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


def test_binance_klines_parsed():
    def handler(request: httpx.Request):
        assert request.url.host == "data-api.binance.vision"
        assert request.url.params["interval"] == "1h"
        return httpx.Response(200, json=[
            [1700000000000, "100.0", "110.0", "95.0", "105.0", "12.5", 1700003599999, "0", 10, "0", "0", "0"],
        ])

    bars = run(BinanceProvider(client(handler)).candles("btcusdt", "1h", 1))
    assert bars == [{"time": 1700000000, "open": 100.0, "high": 110.0, "low": 95.0, "close": 105.0, "volume": 12.5}]


def test_binance_error_becomes_data_unavailable():
    provider = BinanceProvider(client(lambda r: httpx.Response(451)))
    with pytest.raises(DataUnavailable):
        run(provider.candles("BTCUSDT", "1h", 10))


def test_alpaca_bars_parsed_oldest_first_with_keys():
    def handler(request: httpx.Request):
        assert request.url.host == "data.alpaca.markets"
        assert request.headers["APCA-API-KEY-ID"] == "id"
        assert request.url.params["feed"] == "iex"
        assert request.url.params["timeframe"] == "1Day"
        return httpx.Response(200, json={"bars": [
            {"t": "2026-10-14T04:00:00Z", "o": 2, "h": 3, "l": 1, "c": 2.5, "v": 200},
            {"t": "2026-10-13T04:00:00Z", "o": 1, "h": 2, "l": 1, "c": 2, "v": 100},
        ], "symbol": "AAPL", "next_page_token": None})

    bars = run(AlpacaProvider(client(handler), "id", "secret").candles("AAPL", "1d", 2))
    assert [b["close"] for b in bars] == [2, 2.5]
    assert bars[0]["time"] < bars[1]["time"]


def test_alpaca_without_keys_explains_what_to_do():
    provider = AlpacaProvider(client(lambda r: httpx.Response(200)), "", "")
    with pytest.raises(DataUnavailable, match="Settings"):
        run(provider.candles("AAPL", "1h", 10))


def test_alpaca_bad_keys():
    provider = AlpacaProvider(client(lambda r: httpx.Response(403)), "id", "bad")
    with pytest.raises(DataUnavailable, match="rejected"):
        run(provider.candles("AAPL", "1h", 10))
