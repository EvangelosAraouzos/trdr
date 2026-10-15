import { useState } from "react";
import { api, type Order, type Position, type Trade } from "../lib/api";
import { displaySymbol, money, price, qty, signedMoney, time, tone } from "../lib/format";

export function PositionsTable(props: { accountId: number; positions: Position[]; currency: string; onSelect?: (s: string) => void }) {
  const [editing, setEditing] = useState<string | null>(null);
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [error, setError] = useState<string | null>(null);

  if (!props.positions.length) return <div className="empty">No open positions. Place an order from the ticket.</div>;

  const startEdit = (p: Position) => { setEditing(p.symbol); setSl(p.sl ? String(p.sl) : ""); setTp(p.tp ? String(p.tp) : ""); setError(null); };
  const save = async (p: Position) => {
    try {
      await api.protect(props.accountId, p.symbol, parseFloat(sl) || null, parseFloat(tp) || null);
      setEditing(null);
    } catch (e) { setError((e as Error).message); }
  };
  const close = async (p: Position) => {
    try { await api.closePosition(props.accountId, p.symbol); } catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      {error && <div className="error-text" style={{ padding: "6px 10px" }}>{error}</div>}
      <table className="grid">
        <thead>
          <tr>
            <th>Symbol</th><th>Side</th><th className="r">Size</th><th className="r">Entry</th><th className="r">Price</th>
            <th className="r">P&amp;L</th><th className="r">Stop-loss</th><th className="r">Take-profit</th><th />
          </tr>
        </thead>
        <tbody>
          {props.positions.map((p) => (
            <tr key={p.symbol} className={props.onSelect ? "clickable" : ""} onClick={() => props.onSelect?.(p.symbol)}>
              <td>{displaySymbol(p.symbol)}</td>
              <td className={p.side === "long" ? "up" : "down"}>{p.side}</td>
              <td className="r num">{qty(Math.abs(p.qty))}</td>
              <td className="r num">{price(p.avg_price)}</td>
              <td className="r num">{price(p.price)}</td>
              <td className={`r num ${tone(p.unrealized_pnl)}`}>{signedMoney(p.unrealized_pnl, props.currency)}</td>
              {editing === p.symbol ? (
                <>
                  <td className="r" onClick={(e) => e.stopPropagation()}><input className="input num" style={{ width: 100 }} value={sl} onChange={(e) => setSl(e.target.value)} /></td>
                  <td className="r" onClick={(e) => e.stopPropagation()}><input className="input num" style={{ width: 100 }} value={tp} onChange={(e) => setTp(e.target.value)} /></td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <button className="btn small primary" onClick={() => save(p)}>Save</button>{" "}
                    <button className="btn small" onClick={() => setEditing(null)}>Cancel</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="r num down">{p.sl ? price(p.sl) : "-"}</td>
                  <td className="r num up">{p.tp ? price(p.tp) : "-"}</td>
                  <td className="r" onClick={(e) => e.stopPropagation()}>
                    <button className="btn small" onClick={() => startEdit(p)}>SL / TP</button>{" "}
                    <button className="btn small danger" onClick={() => close(p)}>Close</button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export function OrdersTable({ orders, showCancel }: { orders: Order[]; showCancel?: boolean }) {
  if (!orders.length) return <div className="empty">No orders.</div>;
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Time</th><th>Symbol</th><th>Side</th><th>Type</th><th className="r">Size</th><th className="r">Price</th>
          <th className="r">Fill</th><th>Status</th><th />
        </tr>
      </thead>
      <tbody>
        {orders.map((o) => (
          <tr key={o.id}>
            <td className="muted">{time(o.created_at)}</td>
            <td>{displaySymbol(o.symbol)}</td>
            <td className={o.side === "buy" ? "up" : "down"}>{o.side}</td>
            <td>{o.type}</td>
            <td className="r num">{qty(o.qty)}</td>
            <td className="r num">{price(o.limit_price ?? o.stop_price)}</td>
            <td className="r num">{price(o.fill_price)}</td>
            <td className={o.status === "open" ? "warn" : o.status === "rejected" ? "down" : "muted"} title={o.reason ?? ""}>
              {o.status}{o.status === "rejected" && o.reason ? `: ${o.reason}` : ""}
            </td>
            <td className="r">
              {showCancel && o.status === "open" && (
                <button className="btn small danger" onClick={() => api.cancelOrder(o.id).catch(() => {})}>Cancel</button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function TradesTable({ trades, currency }: { trades: Trade[]; currency: string }) {
  if (!trades.length) return <div className="empty">No trades yet.</div>;
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>Time</th><th>Symbol</th><th>Side</th><th className="r">Size</th><th className="r">Price</th>
          <th className="r">Fee</th><th className="r">Realised P&amp;L</th><th>Reason</th>
        </tr>
      </thead>
      <tbody>
        {trades.map((t) => (
          <tr key={t.id}>
            <td className="muted">{time(t.ts)}</td>
            <td>{displaySymbol(t.symbol)}</td>
            <td className={t.side === "buy" ? "up" : "down"}>{t.side}</td>
            <td className="r num">{qty(t.qty)}</td>
            <td className="r num">{price(t.price)}</td>
            <td className="r num muted">{money(t.fee, currency)}</td>
            <td className={`r num ${tone(t.realized_pnl)}`}>{t.realized_pnl ? signedMoney(t.realized_pnl, currency) : "-"}</td>
            <td className={t.reason === "stop-loss" ? "down" : t.reason === "take-profit" ? "up" : "muted"}>{t.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
