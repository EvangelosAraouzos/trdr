import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { Tabs } from "../components/Tabs";
import { api, type Market, type WatchItem } from "../lib/api";
import { displaySymbol, price } from "../lib/format";
import { useLive } from "../lib/live";
import { navigate } from "../lib/router";

export function Markets() {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [filter, setFilter] = useState<"all" | Market>("all");
  const prices = useLive((s) => s.prices);
  const prev = useLive((s) => s.prev);
  useEffect(() => { api.watchlist().then(setItems).catch(() => {}); }, []);
  const shown = items.filter((i) => filter === "all" || i.market === filter);
  return (
    <div className="page">
      <h1 className="page-title">Markets</h1>
      <Card title="Watchlist" bodyClass="" actions={<span className="muted" style={{ fontSize: 12 }}>Screener and heat map arrive in a later phase</span>}>
        <Tabs tabs={[{ id: "all", label: "All" }, { id: "crypto", label: "Crypto" }, { id: "stocks", label: "US stocks" }]} active={filter} onChange={setFilter} />
        <table className="grid">
          <thead><tr><th>Symbol</th><th>Market</th><th className="r">Last price</th><th /></tr></thead>
          <tbody>
            {shown.map((i) => {
              const p = prices[i.symbol];
              const dir = p !== undefined && prev[i.symbol] !== undefined ? Math.sign(p - prev[i.symbol]) : 0;
              return (
                <tr key={i.symbol} className="clickable" onClick={() => navigate("trade", { symbol: i.symbol })}>
                  <td>{displaySymbol(i.symbol)}</td>
                  <td className="muted">{i.market === "crypto" ? "Crypto" : "US stock"}</td>
                  <td className={`r num ${dir > 0 ? "up" : dir < 0 ? "down" : ""}`}>{price(p)}</td>
                  <td className="r"><button className="btn small primary">Trade</button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
