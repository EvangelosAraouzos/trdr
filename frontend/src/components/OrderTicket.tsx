import { useEffect, useState } from "react";
import { api, type OrderType, type Side } from "../lib/api";
import { displaySymbol, money, price as fmtPrice, qty as fmtQty } from "../lib/format";
import { useLive } from "../lib/live";

function num(v: string): number | null {
  const n = parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

export function OrderTicket(props: { accountId: number | null; symbol: string; freeMargin: number; currency: string }) {
  const [side, setSide] = useState<Side>("buy");
  const [type, setType] = useState<OrderType>("market");
  const [qty, setQty] = useState("");
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const live = useLive((s) => s.prices[props.symbol]);

  useEffect(() => { setEntry(""); setSl(""); setTp(""); setMessage(null); }, [props.symbol]);

  const q = num(qty);
  const refPrice = type === "market" ? live : num(entry) ?? live;
  const notional = q && refPrice ? q * refPrice : null;

  const submit = async () => {
    if (!props.accountId || !q) return;
    setBusy(true);
    setMessage(null);
    try {
      const order = await api.placeOrder(props.accountId, {
        symbol: props.symbol, side, type, qty: q,
        limit_price: type === "limit" ? num(entry) : null,
        stop_price: type === "stop" ? num(entry) : null,
        sl: num(sl), tp: num(tp),
      });
      if (order.status === "rejected") setMessage({ kind: "error", text: `Rejected: ${order.reason}` });
      else if (order.status === "filled") setMessage({ kind: "ok", text: `Filled ${fmtQty(order.qty)} at ${fmtPrice(order.fill_price)}` });
      else setMessage({ kind: "ok", text: `${type === "limit" ? "Limit" : "Stop"} order placed` });
    } catch (e) {
      setMessage({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  /** Size the order so it uses a share of the free funds. */
  const sizeFor = (share: number) => {
    if (!refPrice || props.freeMargin <= 0) return;
    const raw = (props.freeMargin * share) / refPrice / 1.003;
    const decimals = refPrice > 1000 ? 5 : refPrice > 10 ? 3 : 1;
    setQty(String(Math.floor(raw * 10 ** decimals) / 10 ** decimals));
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
        <strong>{displaySymbol(props.symbol)}</strong>
        <span className="num" style={{ fontSize: 16 }}>{fmtPrice(live)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <button className={`btn buy ${side === "buy" ? "active" : ""}`} onClick={() => setSide("buy")}>Buy</button>
        <button className={`btn sell ${side === "sell" ? "active" : ""}`} onClick={() => setSide("sell")}>Sell</button>
      </div>
      <label className="field">Order type
        <select className="input" value={type} onChange={(e) => setType(e.target.value as OrderType)}>
          <option value="market">Market: fill now</option>
          <option value="limit">Limit: at this price or better</option>
          <option value="stop">Stop: when price reaches</option>
        </select>
      </label>
      {type !== "market" && (
        <label className="field">{type === "limit" ? "Limit price" : "Stop price"}
          <input className="input num" inputMode="decimal" value={entry} onChange={(e) => setEntry(e.target.value)} placeholder={fmtPrice(live)} />
        </label>
      )}
      <label className="field">Quantity
        <input className="input num" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} placeholder="0" />
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        {[0.1, 0.25, 0.5, 1].map((s) => (
          <button key={s} className="btn small" style={{ flex: 1 }} onClick={() => sizeFor(s)} title={`Use ${s * 100}% of free funds`}>{s * 100}%</button>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <label className="field">Stop-loss
          <input className="input num" inputMode="decimal" value={sl} onChange={(e) => setSl(e.target.value)} placeholder="optional" />
        </label>
        <label className="field">Take-profit
          <input className="input num" inputMode="decimal" value={tp} onChange={(e) => setTp(e.target.value)} placeholder="optional" />
        </label>
      </div>
      <div className="muted" style={{ fontSize: 12, display: "flex", justifyContent: "space-between" }}>
        <span>Value <span className="num">{notional ? money(notional, props.currency) : "-"}</span></span>
        <span>Free <span className="num">{money(props.freeMargin, props.currency)}</span></span>
      </div>
      <button className={`btn ${side}`} style={{ padding: "10px 12px" }} disabled={busy || !q || !props.accountId} onClick={submit}>
        {side === "buy" ? "Buy" : "Sell"} {q ? fmtQty(q) : ""} {displaySymbol(props.symbol)}
      </button>
      {message && <div className={message.kind === "error" ? "error-text" : "up"} style={{ fontSize: 12 }}>{message.text}</div>}
    </div>
  );
}
