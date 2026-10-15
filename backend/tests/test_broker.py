import pytest

from trdr.broker import OrderError, SimBroker
from trdr.db import Database


@pytest.fixture
def broker(tmp_path):
    db = Database(tmp_path / "t.db")
    db.update_settings({"crypto_fee_pct": 0.1, "stock_fee_per_share": 0.0, "slippage_bps": 0.0})
    return SimBroker(db)


def acct(broker):
    return broker.list_accounts()[0]["id"]


def test_seeded_demo_account(broker):
    a = broker.summary(acct(broker))
    assert a["cash"] == 10_000 and a["equity"] == 10_000 and a["positions"] == []


def test_market_buy_then_sell_realises_pnl_and_fees(broker):
    a = acct(broker)
    broker.on_price("BTCUSDT", 50_000)
    broker.place_order(a, "BTCUSDT", "buy", "market", 0.1)
    s = broker.summary(a)
    assert s["positions"][0]["qty"] == pytest.approx(0.1)
    assert s["cash"] == pytest.approx(10_000 - 5_000 - 5)  # 0.1% fee on 5,000
    broker.on_price("BTCUSDT", 51_000)
    assert broker.summary(a)["unrealized_pnl"] == pytest.approx(100)
    broker.close_position(a, "BTCUSDT")
    s = broker.summary(a)
    assert s["positions"] == []
    assert s["realized_pnl"] == pytest.approx(100)
    assert s["fees_paid"] == pytest.approx(5 + 5.1)
    assert s["equity"] == pytest.approx(10_000 + 100 - 10.1)


def test_stock_fee_per_share_and_slippage(broker):
    broker.db.update_settings({"stock_fee_per_share": 0.01, "slippage_bps": 10})
    a = acct(broker)
    broker.on_price("AAPL", 200)
    order, _ = broker.place_order(a, "AAPL", "buy", "market", 10)
    assert order["fill_price"] == pytest.approx(200.2)
    assert order["fee"] == pytest.approx(0.1)


def test_limit_order_waits_then_fills(broker):
    a = acct(broker)
    broker.on_price("ETHUSDT", 3_000)
    order, _ = broker.place_order(a, "ETHUSDT", "buy", "limit", 1, limit_price=2_900)
    assert order["status"] == "open"
    assert broker.on_price("ETHUSDT", 2_950) == []
    events = broker.on_price("ETHUSDT", 2_890)
    assert events[0]["type"] == "fill"
    assert broker.summary(a)["positions"][0]["avg_price"] == pytest.approx(2_890)


def test_stop_order_triggers(broker):
    a = acct(broker)
    broker.on_price("SOLUSDT", 100)
    order, _ = broker.place_order(a, "SOLUSDT", "buy", "stop", 5, stop_price=105)
    assert order["status"] == "open"
    broker.on_price("SOLUSDT", 106)
    assert broker.summary(a)["positions"][0]["qty"] == 5


def test_stop_loss_and_take_profit_close_positions(broker):
    a = acct(broker)
    broker.on_price("BTCUSDT", 100)
    broker.place_order(a, "BTCUSDT", "buy", "market", 10, sl=90, tp=120)
    broker.on_price("BTCUSDT", 95)
    assert broker.summary(a)["positions"]
    broker.on_price("BTCUSDT", 89)
    assert broker.summary(a)["positions"] == []
    assert broker.trades(a)[0]["reason"] == "stop-loss"

    broker.place_order(a, "BTCUSDT", "sell", "market", 10, tp=80)
    broker.on_price("BTCUSDT", 79)
    assert broker.summary(a)["positions"] == []
    assert broker.trades(a)[0]["reason"] == "take-profit"


def test_short_position_and_flip(broker):
    a = acct(broker)
    broker.on_price("AAPL", 100)
    broker.place_order(a, "AAPL", "sell", "market", 10)
    pos = broker.summary(a)["positions"][0]
    assert pos["side"] == "short" and pos["qty"] == -10
    broker.on_price("AAPL", 90)
    assert broker.summary(a)["unrealized_pnl"] == pytest.approx(100)
    broker.place_order(a, "AAPL", "buy", "market", 15)  # close 10, open 5 long
    s = broker.summary(a)
    assert s["realized_pnl"] == pytest.approx(100)
    assert s["positions"][0]["qty"] == 5 and s["positions"][0]["avg_price"] == 90


def test_insufficient_funds_rejected(broker):
    a = acct(broker)
    broker.on_price("BTCUSDT", 50_000)
    order, _ = broker.place_order(a, "BTCUSDT", "buy", "market", 1)
    assert order["status"] == "rejected"
    assert broker.summary(a)["cash"] == 10_000


def test_reducing_exposure_always_allowed(broker):
    a = acct(broker)
    broker.on_price("AAPL", 100)
    broker.place_order(a, "AAPL", "buy", "market", 99)
    broker.on_price("AAPL", 50)  # equity falls below exposure
    order, _ = broker.place_order(a, "AAPL", "sell", "market", 50)
    assert order["status"] == "filled"


def test_validation_errors(broker):
    a = acct(broker)
    with pytest.raises(OrderError):
        broker.place_order(a, "BTCUSDT", "buy", "market", 1)  # no price yet
    broker.on_price("BTCUSDT", 10)
    with pytest.raises(OrderError):
        broker.place_order(a, "BTCUSDT", "buy", "limit", 1)
    with pytest.raises(OrderError):
        broker.place_order(a, "BTCUSDT", "hold", "market", 1)
    with pytest.raises(OrderError):
        broker.place_order(999, "BTCUSDT", "buy", "market", 1)


def test_cancel_and_reset(broker):
    a = acct(broker)
    broker.on_price("ETHUSDT", 3_000)
    order, _ = broker.place_order(a, "ETHUSDT", "buy", "limit", 1, limit_price=1_000)
    assert broker.cancel_order(order["id"])["status"] == "cancelled"
    broker.place_order(a, "ETHUSDT", "buy", "market", 1)
    s = broker.reset_account(a, 5_000)
    assert s["cash"] == 5_000 and s["positions"] == [] and broker.trades(a) == []


def test_cannot_delete_last_account(broker):
    with pytest.raises(OrderError):
        broker.delete_account(acct(broker))
    second = broker.create_account("Second", 1_000)
    broker.delete_account(second["id"])
