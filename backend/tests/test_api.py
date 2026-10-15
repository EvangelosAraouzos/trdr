from fastapi.testclient import TestClient

from trdr.app import create_app


def client(tmp_path):
    app = create_app(tmp_path / "api.db", start_hub=False)
    return app, TestClient(app)


def test_settings_hide_secret(tmp_path):
    _, c = client(tmp_path)
    r = c.put("/api/settings", json={"alpaca_key_id": "abc", "alpaca_secret_key": "shh"})
    assert r.json()["alpaca_secret_key"] == "********"
    r = c.put("/api/settings", json={"alpaca_secret_key": "********", "slippage_bps": 5})
    assert r.json()["slippage_bps"] == 5
    assert c.app.state.db.settings()["alpaca_secret_key"] == "shh"


def test_order_flow_through_api(tmp_path):
    app, c = client(tmp_path)
    app.state.broker.on_price("BTCUSDT", 100)
    acc = c.get("/api/accounts").json()[0]
    r = c.post(f"/api/accounts/{acc['id']}/orders", json={"symbol": "btcusdt", "side": "buy", "qty": 2})
    assert r.status_code == 200 and r.json()["status"] == "filled"
    summary = c.get(f"/api/accounts/{acc['id']}").json()
    assert summary["positions"][0]["symbol"] == "BTCUSDT"
    r = c.post(f"/api/accounts/{acc['id']}/positions/BTCUSDT/close")
    assert r.status_code == 200
    assert len(c.get(f"/api/accounts/{acc['id']}/trades").json()) == 2


def test_bad_order_is_400(tmp_path):
    app, c = client(tmp_path)
    acc = c.get("/api/accounts").json()[0]
    r = c.post(f"/api/accounts/{acc['id']}/orders", json={"symbol": "ETHUSDT", "side": "buy", "type": "limit", "qty": 1})
    assert r.status_code == 400


def test_practice_candles(tmp_path):
    _, c = client(tmp_path)
    c.put("/api/settings", json={"data_mode": "practice"})
    bars = c.get("/api/candles", params={"symbol": "AAPL", "tf": "1h", "limit": 50}).json()
    assert len(bars) == 50 and bars[0]["time"] < bars[-1]["time"]


def test_watchlist_roundtrip(tmp_path):
    _, c = client(tmp_path)
    r = c.put("/api/watchlist", json={"symbols": ["ethusdt", "AAPL", "ETHUSDT"]})
    assert [w["symbol"] for w in r.json()] == ["ETHUSDT", "AAPL"]
    assert r.json()[0]["market"] == "crypto" and r.json()[1]["market"] == "stocks"
