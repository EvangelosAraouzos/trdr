import { Card, type Tone } from "../components/Card";
import { useLive } from "../lib/live";

const TONES: Record<string, Tone> = { live: "good", error: "bad", connecting: "attention", starting: "attention", off: "attention", idle: "plain" };

export function DataPage() {
  const status = useLive((s) => s.status);
  const prices = useLive((s) => s.prices);
  return (
    <div className="page">
      <h1 className="page-title">Data</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {(["crypto", "stocks"] as const).map((m) => {
          const s = status[m];
          return (
            <Card key={m} title={m === "crypto" ? "Crypto feed" : "US stocks feed"} tone={s ? TONES[s.state] : "plain"}>
              <div style={{ fontSize: 16, marginBottom: 6 }}>{s?.state ?? "waiting"}</div>
              <div className="muted">{s?.message}</div>
              {s?.since && <div className="muted" style={{ fontSize: 12, marginTop: 6 }}>since {new Date(s.since * 1000).toLocaleTimeString()}</div>}
            </Card>
          );
        })}
      </div>
      <Card title="Prices received" bodyClass="">
        <table className="grid">
          <thead><tr><th>Symbol</th><th className="r">Last price</th></tr></thead>
          <tbody>
            {Object.entries(prices).sort().map(([sym, p]) => (
              <tr key={sym}><td>{sym}</td><td className="r num">{p.toLocaleString("en-US", { maximumFractionDigits: 8 })}</td></tr>
            ))}
          </tbody>
        </table>
        {!Object.keys(prices).length && <div className="empty">No prices yet.</div>}
      </Card>
      <Card title="Coming next" tone="plain">
        <span className="muted">Phase 2 adds stored price history (years of candles on this PC) for backtesting, with download progress shown here.</span>
      </Card>
    </div>
  );
}
