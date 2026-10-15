"""The simulated broker: demo accounts, orders, fills and positions.

Every order in trdr ends here. Nothing is ever sent to a real exchange or
broker; fills are computed from the latest price the market data hub has seen.

Accounting model (netting, 1x leverage):
- One position per symbol per account. qty > 0 is long, qty < 0 is short.
- cash moves by -qty * price - fee on every fill, so equity = cash + sum(qty * mark).
- A fill that increases exposure is rejected if gross exposure would exceed equity.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .db import Database, now_iso
from .symbols import market_of

SIDES = ("buy", "sell")
ORDER_TYPES = ("market", "limit", "stop")
EPS = 1e-12


class OrderError(ValueError):
    """An order the broker refuses outright (bad input, unknown account)."""


@dataclass
class CostModel:
    crypto_fee_pct: float = 0.1
    stock_fee_per_share: float = 0.0
    slippage_bps: float = 2.0

    @classmethod
    def from_settings(cls, s: dict[str, Any]) -> "CostModel":
        return cls(
            crypto_fee_pct=float(s.get("crypto_fee_pct", 0.1)),
            stock_fee_per_share=float(s.get("stock_fee_per_share", 0.0)),
            slippage_bps=float(s.get("slippage_bps", 2.0)),
        )

    def fee(self, symbol: str, qty: float, price: float) -> float:
        if market_of(symbol) == "crypto":
            return abs(qty) * price * self.crypto_fee_pct / 100.0
        return abs(qty) * self.stock_fee_per_share

    def slip(self, price: float, side: str) -> float:
        factor = self.slippage_bps / 10_000.0
        return price * (1 + factor) if side == "buy" else price * (1 - factor)


class SimBroker:
    def __init__(self, db: Database):
        self.db = db
        self.prices: dict[str, float] = {}

    # Helpers ------------------------------------------------------------

    def costs(self) -> CostModel:
        return CostModel.from_settings(self.db.settings())

    def _account(self, account_id: int) -> dict:
        acc = self.db.one("SELECT * FROM accounts WHERE id = ?", (account_id,))
        if not acc:
            raise OrderError(f"Account {account_id} does not exist")
        return acc

    def _positions(self, account_id: int) -> list[dict]:
        return self.db.query("SELECT * FROM positions WHERE account_id = ?", (account_id,))

    def _mark(self, symbol: str, fallback: float) -> float:
        return self.prices.get(symbol, fallback)

    # Accounts -----------------------------------------------------------

    def list_accounts(self) -> list[dict]:
        return [self.summary(a["id"]) for a in self.db.query("SELECT id FROM accounts ORDER BY id")]

    def create_account(self, name: str, balance: float, currency: str = "USD") -> dict:
        if balance <= 0:
            raise OrderError("Starting balance must be above zero")
        name = name.strip() or "Demo account"
        account_id = self.db.execute(
            "INSERT INTO accounts(name, currency, starting_balance, cash, created_at) VALUES (?, ?, ?, ?, ?)",
            (name, currency, balance, balance, now_iso()),
        )
        return self.summary(account_id)

    def reset_account(self, account_id: int, balance: float | None = None) -> dict:
        acc = self._account(account_id)
        start = balance if balance and balance > 0 else acc["starting_balance"]
        with self.db.lock:
            c = self.db.conn
            for table in ("positions", "orders", "trades", "equity_snapshots"):
                c.execute(f"DELETE FROM {table} WHERE account_id = ?", (account_id,))
            c.execute(
                "UPDATE accounts SET starting_balance = ?, cash = ?, realized_pnl = 0, fees_paid = 0 WHERE id = ?",
                (start, start, account_id),
            )
            c.commit()
        return self.summary(account_id)

    def rename_account(self, account_id: int, name: str) -> dict:
        self._account(account_id)
        self.db.execute("UPDATE accounts SET name = ? WHERE id = ?", (name.strip() or "Demo account", account_id))
        return self.summary(account_id)

    def delete_account(self, account_id: int) -> None:
        self._account(account_id)
        if len(self.db.query("SELECT id FROM accounts")) <= 1:
            raise OrderError("Keep at least one demo account")
        self.db.execute("DELETE FROM accounts WHERE id = ?", (account_id,))

    def summary(self, account_id: int) -> dict:
        acc = self._account(account_id)
        positions = []
        market_value = 0.0
        gross = 0.0
        unrealized = 0.0
        for p in self._positions(account_id):
            mark = self._mark(p["symbol"], p["avg_price"])
            upnl = (mark - p["avg_price"]) * p["qty"]
            market_value += p["qty"] * mark
            gross += abs(p["qty"]) * mark
            unrealized += upnl
            positions.append({
                **p,
                "side": "long" if p["qty"] > 0 else "short",
                "price": mark,
                "unrealized_pnl": upnl,
                "market": market_of(p["symbol"]),
            })
        equity = acc["cash"] + market_value
        return {
            **acc,
            "equity": equity,
            "unrealized_pnl": unrealized,
            "exposure": gross,
            "free_margin": equity - gross,
            "total_pnl": equity - acc["starting_balance"],
            "positions": positions,
        }

    # Orders -------------------------------------------------------------

    def place_order(
        self,
        account_id: int,
        symbol: str,
        side: str,
        type: str,
        qty: float,
        limit_price: float | None = None,
        stop_price: float | None = None,
        sl: float | None = None,
        tp: float | None = None,
        reason: str = "manual",
    ) -> tuple[dict, list[dict]]:
        symbol = symbol.strip().upper()
        if side not in SIDES:
            raise OrderError("Side must be buy or sell")
        if type not in ORDER_TYPES:
            raise OrderError("Order type must be market, limit or stop")
        if not qty or qty <= 0:
            raise OrderError("Quantity must be above zero")
        if type == "limit" and not (limit_price and limit_price > 0):
            raise OrderError("A limit order needs a limit price")
        if type == "stop" and not (stop_price and stop_price > 0):
            raise OrderError("A stop order needs a stop price")
        for label, value in (("Stop-loss", sl), ("Take-profit", tp)):
            if value is not None and value <= 0:
                raise OrderError(f"{label} must be above zero")
        if type == "market" and symbol not in self.prices:
            raise OrderError(f"No price for {symbol} yet; wait for the feed")
        self._account(account_id)

        with self.db.lock:
            order_id = self.db.execute(
                "INSERT INTO orders(account_id, symbol, side, type, qty, limit_price, stop_price, sl, tp, status, reason, created_at) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?)",
                (account_id, symbol, side, type, qty, limit_price, stop_price, sl, tp, reason, now_iso()),
            )
            order = self._order(order_id)
            events: list[dict] = []
            price = self.prices.get(symbol)
            if price is not None:
                events += self._check_order(order, price)
            if not events:
                events.append({"type": "order", "account_id": account_id, "order": self._order(order_id)})
            return self._order(order_id), events

    def _order(self, order_id: int) -> dict:
        order = self.db.one("SELECT * FROM orders WHERE id = ?", (order_id,))
        if not order:
            raise OrderError(f"Order {order_id} does not exist")
        return order

    def cancel_order(self, order_id: int) -> dict:
        order = self._order(order_id)
        if order["status"] != "open":
            raise OrderError("Only open orders can be cancelled")
        self.db.execute(
            "UPDATE orders SET status = 'cancelled', closed_at = ? WHERE id = ?", (now_iso(), order_id)
        )
        return self._order(order_id)

    def orders(self, account_id: int, status: str | None = None, limit: int = 200) -> list[dict]:
        if status:
            return self.db.query(
                "SELECT * FROM orders WHERE account_id = ? AND status = ? ORDER BY id DESC LIMIT ?",
                (account_id, status, limit),
            )
        return self.db.query(
            "SELECT * FROM orders WHERE account_id = ? ORDER BY id DESC LIMIT ?", (account_id, limit)
        )

    def trades(self, account_id: int, limit: int = 500) -> list[dict]:
        return self.db.query(
            "SELECT * FROM trades WHERE account_id = ? ORDER BY id DESC LIMIT ?", (account_id, limit)
        )

    def close_position(self, account_id: int, symbol: str, reason: str = "manual close") -> tuple[dict, list[dict]]:
        pos = self.db.one(
            "SELECT * FROM positions WHERE account_id = ? AND symbol = ?", (account_id, symbol.upper())
        )
        if not pos:
            raise OrderError(f"No open position in {symbol}")
        side = "sell" if pos["qty"] > 0 else "buy"
        return self.place_order(account_id, pos["symbol"], side, "market", abs(pos["qty"]), reason=reason)

    def set_protection(self, account_id: int, symbol: str, sl: float | None, tp: float | None) -> dict:
        pos = self.db.one(
            "SELECT * FROM positions WHERE account_id = ? AND symbol = ?", (account_id, symbol.upper())
        )
        if not pos:
            raise OrderError(f"No open position in {symbol}")
        self.db.execute(
            "UPDATE positions SET sl = ?, tp = ? WHERE account_id = ? AND symbol = ?",
            (sl or None, tp or None, account_id, pos["symbol"]),
        )
        return self.summary(account_id)

    # Price updates ------------------------------------------------------

    def on_price(self, symbol: str, price: float) -> list[dict]:
        """Record a new price and fill anything it triggers."""
        if price <= 0:
            return []
        symbol = symbol.upper()
        self.prices[symbol] = price
        events: list[dict] = []
        with self.db.lock:
            for order in self.db.query(
                "SELECT * FROM orders WHERE symbol = ? AND status = 'open' ORDER BY id", (symbol,)
            ):
                events += self._check_order(order, price)
            for pos in self.db.query("SELECT * FROM positions WHERE symbol = ?", (symbol,)):
                hit = self._protection_hit(pos, price)
                if hit:
                    _, ev = self.close_position(pos["account_id"], symbol, reason=hit)
                    events += ev
        return events

    @staticmethod
    def _protection_hit(pos: dict, price: float) -> str | None:
        long = pos["qty"] > 0
        if pos["sl"] is not None and (price <= pos["sl"] if long else price >= pos["sl"]):
            return "stop-loss"
        if pos["tp"] is not None and (price >= pos["tp"] if long else price <= pos["tp"]):
            return "take-profit"
        return None

    def _check_order(self, order: dict, price: float) -> list[dict]:
        side, kind = order["side"], order["type"]
        costs = self.costs()
        if kind == "market":
            return self._fill(order, costs.slip(price, side), costs)
        if kind == "limit":
            limit = order["limit_price"]
            if (side == "buy" and price <= limit) or (side == "sell" and price >= limit):
                return self._fill(order, price, costs)
            return []
        if kind == "stop":
            stop = order["stop_price"]
            if (side == "buy" and price >= stop) or (side == "sell" and price <= stop):
                return self._fill(order, costs.slip(price, side), costs)
        return []

    def _fill(self, order: dict, fill_price: float, costs: CostModel) -> list[dict]:
        account_id, symbol = order["account_id"], order["symbol"]
        acc = self._account(account_id)
        signed = order["qty"] if order["side"] == "buy" else -order["qty"]
        fee = costs.fee(symbol, order["qty"], fill_price)

        positions = {p["symbol"]: p for p in self._positions(account_id)}
        pos = positions.get(symbol)
        old_qty = pos["qty"] if pos else 0.0
        old_avg = pos["avg_price"] if pos else 0.0
        new_qty = old_qty + signed
        if abs(new_qty) < EPS:
            new_qty = 0.0

        # Buying power: gross exposure after the fill may not exceed equity.
        def gross_and_value(qty_for_symbol: float) -> tuple[float, float]:
            gross = value = 0.0
            for s, p in positions.items():
                q = qty_for_symbol if s == symbol else p["qty"]
                mark = fill_price if s == symbol else self._mark(s, p["avg_price"])
                gross += abs(q) * mark
                value += q * mark
            if symbol not in positions:
                gross += abs(qty_for_symbol) * fill_price
                value += qty_for_symbol * fill_price
            return gross, value

        gross_before, _ = gross_and_value(old_qty)
        gross_after, value_after = gross_and_value(new_qty)
        cash_after = acc["cash"] - signed * fill_price - fee
        equity_after = cash_after + value_after
        if gross_after > gross_before + EPS and gross_after > equity_after + EPS:
            self.db.execute(
                "UPDATE orders SET status = 'rejected', reason = ?, closed_at = ? WHERE id = ?",
                ("not enough free funds", now_iso(), order["id"]),
            )
            return [{"type": "order", "account_id": account_id, "order": self._order(order["id"])}]

        # Netting: realise P&L on the part that reduces the position.
        realized = 0.0
        if old_qty and (old_qty > 0) != (signed > 0):
            closed = min(abs(signed), abs(old_qty))
            realized = closed * (fill_price - old_avg) * (1 if old_qty > 0 else -1)

        if new_qty == 0:
            new_avg = 0.0
        elif old_qty == 0 or (old_qty > 0) == (signed > 0):
            new_avg = (old_qty * old_avg + signed * fill_price) / new_qty
        elif (old_qty > 0) != (new_qty > 0):
            new_avg = fill_price  # flipped direction: the remainder opened at this price
        else:
            new_avg = old_avg  # partial close keeps the entry price

        ts = now_iso()
        c = self.db.conn
        c.execute(
            "UPDATE accounts SET cash = ?, realized_pnl = realized_pnl + ?, fees_paid = fees_paid + ? WHERE id = ?",
            (cash_after, realized, fee, account_id),
        )
        if new_qty == 0:
            c.execute("DELETE FROM positions WHERE account_id = ? AND symbol = ?", (account_id, symbol))
        elif pos and (old_qty > 0) == (new_qty > 0):
            sl, tp = pos["sl"], pos["tp"]
            if order["sl"] is not None or order["tp"] is not None:
                sl = order["sl"] if order["sl"] is not None else sl
                tp = order["tp"] if order["tp"] is not None else tp
            c.execute(
                "UPDATE positions SET qty = ?, avg_price = ?, sl = ?, tp = ? WHERE account_id = ? AND symbol = ?",
                (new_qty, new_avg, sl, tp, account_id, symbol),
            )
        else:
            c.execute("DELETE FROM positions WHERE account_id = ? AND symbol = ?", (account_id, symbol))
            c.execute(
                "INSERT INTO positions(account_id, symbol, qty, avg_price, sl, tp, opened_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (account_id, symbol, new_qty, new_avg, order["sl"], order["tp"], ts),
            )
        c.execute(
            "UPDATE orders SET status = 'filled', fill_price = ?, fee = ?, closed_at = ? WHERE id = ?",
            (fill_price, fee, ts, order["id"]),
        )
        cur = c.execute(
            "INSERT INTO trades(account_id, order_id, symbol, side, qty, price, fee, realized_pnl, reason, ts) "
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (account_id, order["id"], symbol, order["side"], order["qty"], fill_price, fee, realized,
             order["reason"] or "manual", ts),
        )
        c.commit()
        trade = self.db.one("SELECT * FROM trades WHERE id = ?", (cur.lastrowid,))
        return [{"type": "fill", "account_id": account_id, "order": self._order(order["id"]), "trade": trade}]

    # Equity history -----------------------------------------------------

    def snapshot_equity(self, ts: int) -> None:
        for acc in self.db.query("SELECT id FROM accounts"):
            equity = self.summary(acc["id"])["equity"]
            self.db.execute(
                "INSERT OR REPLACE INTO equity_snapshots(account_id, ts, equity) VALUES (?, ?, ?)",
                (acc["id"], ts, equity),
            )

    def equity_history(self, account_id: int, since: int = 0) -> list[dict]:
        return self.db.query(
            "SELECT ts, equity FROM equity_snapshots WHERE account_id = ? AND ts >= ? ORDER BY ts",
            (account_id, since),
        )
