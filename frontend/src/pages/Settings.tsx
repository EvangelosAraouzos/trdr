import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { api, type Settings } from "../lib/api";

export function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { api.settings().then(setS).catch((e) => setError(e.message)); }, []);
  if (!s) return <div className="page">{error ? <div className="error-text">{error}</div> : <div className="empty">Loading...</div>}</div>;

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => { setS({ ...s, [k]: v }); setSaved(null); };
  const save = async () => {
    setError(null);
    try { setS(await api.saveSettings(s)); setSaved("Saved"); } catch (e) { setError((e as Error).message); }
  };

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1 className="page-title">Settings</h1>

      <Card title="Price data">
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="radio" checked={s.data_mode === "live"} onChange={() => set("data_mode", "live")} />
            <span><strong>Live prices</strong><br /><span className="muted">Crypto from Binance's public data feed (no key needed). US stocks from Alpaca's free data feed (needs keys below). trdr only reads prices; it never places real orders.</span></span>
          </label>
          <label style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
            <input type="radio" checked={s.data_mode === "practice"} onChange={() => set("data_mode", "practice")} />
            <span><strong>Practice prices</strong><br /><span className="muted">Generated prices that work with no internet connection. Good for learning the screens.</span></span>
          </label>
        </div>
      </Card>

      <Card title="Alpaca data keys (US stocks)" tone={s.alpaca_key_id ? "default" : "attention"}>
        <p className="muted" style={{ marginTop: 0 }}>
          Create a free account at <a href="https://alpaca.markets" target="_blank" rel="noreferrer">alpaca.markets</a>, open the Paper trading dashboard and generate API keys.
          trdr uses them only for Alpaca's market data service. The free plan streams the IEX exchange for up to 30 stocks.
        </p>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <label className="field">API key ID<input className="input num" value={s.alpaca_key_id} onChange={(e) => set("alpaca_key_id", e.target.value.trim())} autoComplete="off" /></label>
          <label className="field">Secret key<input className="input num" type="password" value={s.alpaca_secret_key} onChange={(e) => set("alpaca_secret_key", e.target.value.trim())} autoComplete="off" /></label>
        </div>
        <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>Keys are stored only in trdr's database on this PC.</p>
      </Card>

      <Card title="Trading costs">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <label className="field">Crypto fee (% of value)<input className="input num" inputMode="decimal" value={s.crypto_fee_pct} onChange={(e) => set("crypto_fee_pct", parseFloat(e.target.value) || 0)} /></label>
          <label className="field">Stock fee (USD per share)<input className="input num" inputMode="decimal" value={s.stock_fee_per_share} onChange={(e) => set("stock_fee_per_share", parseFloat(e.target.value) || 0)} /></label>
          <label className="field">Slippage (basis points)<input className="input num" inputMode="decimal" value={s.slippage_bps} onChange={(e) => set("slippage_bps", parseFloat(e.target.value) || 0)} /></label>
        </div>
        <p className="muted" style={{ marginBottom: 0, fontSize: 12 }}>Market and stop orders fill this many basis points worse than the last price (2 = 0.02%). Limit orders fill at the market price once it reaches the limit.</p>
      </Card>

      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <button className="btn primary" onClick={save}>Save settings</button>
        {saved && <span className="up">{saved}</span>}
        {error && <span className="error-text">{error}</span>}
      </div>
    </div>
  );
}
