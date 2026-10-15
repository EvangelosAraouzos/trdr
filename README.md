# trdr

A trading workstation for crypto and US stocks that runs on your own PC and opens in your browser.
Version 1 is simulation only: every account is a demo account and no order ever leaves your PC.
trdr reads live prices; it never connects to a broker or exchange to trade.

## Start it (Windows)

1. Install [Python 3.11 or newer](https://www.python.org/downloads/) and tick **Add python.exe to PATH** during setup.
2. Install [Node.js 20 or newer](https://nodejs.org/) (needed to build the web app the first time and after updates).
3. Double-click `start.bat`.

The first start installs packages and builds the web app, which takes a minute or two. After that trdr opens at
http://127.0.0.1:8765 in your browser. Close the black console window to stop it.
Your data (accounts, trades, settings) is saved in the `data` folder next to the code.

On macOS or Linux, run `./start.sh` instead.

## Prices

| Market | Source | Setup |
| --- | --- | --- |
| Crypto (BTCUSDT, ETHUSDT, ...) | Binance public market data (`data-api.binance.vision`) | None, no key needed |
| US stocks and ETFs (AAPL, SPY, ...) | Alpaca market data, free IEX feed (up to 30 live symbols) | Free Alpaca account, then paste the API keys in **Settings** |
| Practice | Generated prices, no internet needed | Pick **Practice prices** in **Settings** |

trdr only calls Alpaca's market data service, never its trading service.

## What Phase 1 includes

- **Demo accounts:** create several, pick a starting balance, reset or delete them.
- **Simulated broker:** market, limit and stop orders; stop-loss and take-profit; long and short positions with
  netting (one position per symbol); fees and slippage you set in Settings; orders that would exceed your equity are rejected.
- **Trade page:** watchlist, candlestick chart (1m to 1w) with SMA 20, SMA 50 and volume, entry, stop-loss, take-profit
  and pending-order lines, buy and sell markers, order ticket, and positions, orders and history tabs.
- **Dashboard:** equity, today's P&L, exposure, equity curve, open positions, watchlist and recent trades.
- **Markets, Portfolio, Data and Settings pages.** Robots, Backtest and Leaderboards arrive in later phases.

## Development

```sh
# API server (restart it after backend changes)
cd backend
python -m venv .venv && .venv/bin/pip install -r requirements-dev.txt   # Windows: .venv\Scripts\pip
python -m trdr --no-browser          # API on http://127.0.0.1:8765
python -m pytest                     # tests

# Web app with hot reload, proxying /api and /ws to the server above
cd frontend
npm install
npm run dev                          # http://localhost:5173
```

Layout:

- `backend/trdr/broker.py`: the simulated broker (accounts, orders, fills, positions).
- `backend/trdr/hub.py`: keeps price streams running, feeds the broker, pushes updates to the browser.
- `backend/trdr/marketdata/`: Binance, Alpaca and practice price providers.
- `backend/trdr/app.py`: HTTP and WebSocket API; also serves the built web app.
- `frontend/src/`: React + TypeScript web app; charts use TradingView Lightweight Charts.

Environment variables: `TRDR_PORT` (default 8765), `TRDR_HOST` (default 127.0.0.1), `TRDR_DATA_DIR` (default `./data`).
