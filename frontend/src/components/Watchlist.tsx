import { useEffect, useState } from "react";
import { api, type Market, type WatchItem } from "../lib/api";
import { displaySymbol, price } from "../lib/format";
import { useLive } from "../lib/live";
import { Icon } from "./Icon";
import { Tabs } from "./Tabs";

export function Watchlist(props: { selected: string; onSelect: (symbol: string) => void }) {
  const [items, setItems] = useState<WatchItem[]>([]);
  const [filter, setFilter] = useState<"all" | Market>("all");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<{ symbol: string; market: Market }[]>([]);
  const prices = useLive((s) => s.prices);
  const prev = useLive((s) => s.prev);

  useEffect(() => { api.watchlist().then(setItems).catch(() => {}); }, []);

  useEffect(() => {
    if (!query.trim()) { setResults([]); return; }
    const t = window.setTimeout(() => api.search(query).then(setResults).catch(() => setResults([])), 250);
    return () => window.clearTimeout(t);
  }, [query]);

  const save = (symbols: string[]) => api.saveWatchlist(symbols).then(setItems);
  const add = (symbol: string) => {
    setQuery("");
    setResults([]);
    if (!items.some((i) => i.symbol === symbol)) save([...items.map((i) => i.symbol), symbol]);
    props.onSelect(symbol);
  };
  const remove = (symbol: string) => save(items.filter((i) => i.symbol !== symbol).map((i) => i.symbol));

  const shown = items.filter((i) => filter === "all" || i.market === filter);
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%" }}>
      <div style={{ padding: 8, position: "relative" }}>
        <input className="input" placeholder="Add symbol (BTCUSDT, AAPL)" value={query} onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && results[0]) add(results[0].symbol); }} aria-label="Add symbol" />
        {results.length > 0 && (
          <div className="card plain" style={{ position: "absolute", left: 8, right: 8, top: 42, zIndex: 5, maxHeight: 260, overflowY: "auto" }}>
            {results.map((r) => (
              <button key={r.symbol} className="nav-item" style={{ width: "100%" }} onClick={() => add(r.symbol)}>
                <span>{displaySymbol(r.symbol)}</span>
                <span className="soon">{r.market}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      <Tabs tabs={[{ id: "all", label: "All" }, { id: "crypto", label: "Crypto" }, { id: "stocks", label: "Stocks" }]} active={filter} onChange={setFilter} />
      <div style={{ overflowY: "auto", flex: 1 }}>
        <table className="grid">
          <tbody>
            {shown.map((i) => {
              const p = prices[i.symbol];
              const dir = p !== undefined && prev[i.symbol] !== undefined ? Math.sign(p - prev[i.symbol]) : 0;
              return (
                <tr key={i.symbol} className={`clickable ${i.symbol === props.selected ? "selected" : ""}`} onClick={() => props.onSelect(i.symbol)}>
                  <td>{displaySymbol(i.symbol)}</td>
                  <td className={`r num ${dir > 0 ? "up" : dir < 0 ? "down" : ""}`}>{price(p)}</td>
                  <td style={{ width: 24, padding: "0 6px" }}>
                    <button className="btn small" style={{ border: "none", padding: 2 }} title={`Remove ${i.symbol}`}
                      onClick={(e) => { e.stopPropagation(); remove(i.symbol); }}>
                      <Icon name="x" size={12} />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && <div className="empty">No symbols here yet.</div>}
      </div>
    </div>
  );
}
