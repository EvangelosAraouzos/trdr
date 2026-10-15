import { useEffect, useMemo, useState } from "react";
import { TradesTable } from "../components/AccountTables";
import { Card, signTone } from "../components/Card";
import { EquityChart } from "../components/EquityChart";
import { useActiveAccount } from "../lib/account";
import { api, type WatchItem } from "../lib/api";
import { displaySymbol, money, pct, price, signedMoney, tone } from "../lib/format";
import { useLive } from "../lib/live";
import { navigate } from "../lib/router";
import { useAccountData } from "../lib/useAccountData";

const RANGES = [
  { id: "1D", seconds: 86400 },
  { id: "1W", seconds: 7 * 86400 },
  { id: "1M", seconds: 30 * 86400 },
  { id: "All", seconds: 0 },
];

export function Dashboard() {
  const acc = useActiveAccount();
  const { trades } = useAccountData(acc?.id ?? null);
  const [history, setHistory] = useState<{ ts: number; equity: number }[]>([]);
  const [range, setRange] = useState("1W");
  const [watch, setWatch] = useState<WatchItem[]>([]);
  const prices = useLive((s) => s.prices);
  const version = useLive((s) => (acc ? s.accountVersion[acc.id] ?? 0 : 0));

  useEffect(() => { api.watchlist().then(setWatch).catch(() => {}); }, []);
  useEffect(() => {
    if (!acc) return;
    api.equity(acc.id).then(setHistory).catch(() => {});
    const t = window.setInterval(() => api.equity(acc.id).then(setHistory).catch(() => {}), 60_000);
    return () => window.clearInterval(t);
  }, [acc?.id, version]);

  const startOfDay = useMemo(() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime() / 1000; }, []);
  if (!acc) return <div className="page"><div className="empty">Loading account...</div></div>;

  const now = Math.floor(Date.now() / 1000);
  const span = RANGES.find((r) => r.id === range)!.seconds;
  const points = [...history.filter((p) => !span || p.ts >= now - span), { ts: now, equity: acc.equity }]
    .filter((p, i, arr) => i === 0 || p.ts > arr[i - 1].ts);
  const dayStart = history.find((p) => p.ts >= startOfDay)?.equity ?? acc.starting_balance;
  const today = acc.equity - dayStart;

  return (
    <div className="page">
      <h1 className="page-title">Dashboard</h1>
      <div className="kpis">
        <Card tone="default"><div className="kpi">
          <div className="label">Equity</div>
          <div className="value num">{money(acc.equity, acc.currency)}</div>
          <div className={`sub num ${tone(acc.total_pnl)}`}>{signedMoney(acc.total_pnl, acc.currency)} ({pct((acc.total_pnl / acc.starting_balance) * 100)}) since start</div>
        </div></Card>
        <Card tone={signTone(today)}><div className="kpi">
          <div className="label">Today's P&amp;L</div>
          <div className={`value num ${tone(today)}`}>{signedMoney(today, acc.currency)}</div>
          <div className="sub muted">since midnight, your time</div>
        </div></Card>
        <Card tone="default"><div className="kpi">
          <div className="label">Open positions</div>
          <div className="value num">{acc.positions.length}</div>
          <div className="sub muted num">exposure {money(acc.exposure, acc.currency)}</div>
        </div></Card>
        <Card tone="attention"><div className="kpi">
          <div className="label">Robots running</div>
          <div className="value num">0</div>
          <div className="sub muted">robots arrive in Phase 3</div>
        </div></Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 2fr) minmax(0, 1fr)", gap: 16 }}>
        <Card title="Equity curve" bodyClass="" actions={
          <div style={{ display: "flex", gap: 2 }}>
            {RANGES.map((r) => <button key={r.id} className={`tab ${r.id === range ? "active" : ""}`} style={{ padding: "2px 8px" }} onClick={() => setRange(r.id)}>{r.id}</button>)}
          </div>
        }>
          <div style={{ height: 260, padding: 8 }}>
            {points.length > 1 ? <EquityChart points={points} base={acc.starting_balance} /> : <div className="empty">The curve fills in as trdr runs; a point is saved every minute.</div>}
          </div>
        </Card>
        <Card title="Open positions" bodyClass="">
          {acc.positions.length ? (
            <table className="grid"><tbody>
              {acc.positions.map((p) => (
                <tr key={p.symbol} className="clickable" onClick={() => navigate("trade", { symbol: p.symbol })}>
                  <td>{displaySymbol(p.symbol)} <span className={p.side === "long" ? "up" : "down"}>{p.side}</span></td>
                  <td className={`r num ${tone(p.unrealized_pnl)}`}>{signedMoney(p.unrealized_pnl, acc.currency)}</td>
                </tr>
              ))}
            </tbody></table>
          ) : <div className="empty">No open positions. <a href="#/trade">Open the Trade page</a>.</div>}
        </Card>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1fr) minmax(0, 2fr)", gap: 16 }}>
        <Card title="Watchlist" bodyClass="">
          <table className="grid"><tbody>
            {watch.map((w) => (
              <tr key={w.symbol} className="clickable" onClick={() => navigate("trade", { symbol: w.symbol })}>
                <td>{displaySymbol(w.symbol)}</td>
                <td className="muted">{w.market}</td>
                <td className="r num">{price(prices[w.symbol])}</td>
              </tr>
            ))}
          </tbody></table>
        </Card>
        <Card title="Recent trades" bodyClass="">
          <TradesTable trades={trades.slice(0, 8)} currency={acc.currency} />
        </Card>
      </div>
    </div>
  );
}
