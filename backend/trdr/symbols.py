"""Which market a symbol belongs to.

Crypto symbols are Binance spot pairs quoted in USDT (BTCUSDT); anything else
is treated as a US stock or ETF ticker (AAPL, SPY).
"""

from __future__ import annotations

CRYPTO_QUOTES = ("USDT", "USDC", "FDUSD")


def market_of(symbol: str) -> str:
    s = symbol.upper()
    return "crypto" if s.endswith(CRYPTO_QUOTES) and len(s) > 5 else "stocks"


def display_name(symbol: str) -> str:
    s = symbol.upper()
    for quote in CRYPTO_QUOTES:
        if s.endswith(quote) and len(s) > len(quote):
            return f"{s[: -len(quote)]}/{quote}"
    return s
