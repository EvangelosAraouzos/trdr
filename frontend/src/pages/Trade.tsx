import { useEffect, useMemo, useState } from "react";
import { OrdersTable, PositionsTable, TradesTable } from "../components/AccountTables";
import { OrderTicket } from "../components/OrderTicket";
import { PriceChart, type Overlays } from "../components/PriceChart";
import { Tabs } from "../components/Tabs";
import { Watchlist } from "../components/Watchlist";
import { useActiveAccount } from "../lib/account";
import { TIMEFRAMES, type Timeframe } from "../lib/api";
import { subscribeSymbols } from "../lib/live";
import { useAccountData } from "../lib/useAccountData";

function stored<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}
function store(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

type BottomTab = "positions" | "orders" | "history";

export function Trade({ initialSymbol }: { initialSymbol: string | null }) {
  const [symbol, setSymbol] = useState<string>(() => initialSymbol ?? stored("trdr.symbol", "BTCUSDT"));
  const [tf, setTf] = useState<Timeframe>(() => stored("trdr.tf", "1h"));
  const [overlays, setOverlays] = useState<Overlays>(() => stored("trdr.overlays", { sma20: true, sma50: false, volume: true }));
  const [tab, setTab] = useState<BottomTab>("positions");
  const account = useActiveAccount();
  const { orders, openOrders, trades } = useAccountData(account?.id ?? null);

  useEffect(() => { if (initialSymbol) setSymbol(initialSymbol); }, [initialSymbol]);
  useEffect(() => { store("trdr.symbol", symbol); subscribeSymbols([symbol]); }, [symbol]);
  useEffect(() => { store("trdr.tf", tf); }, [tf]);
  useEffect(() => { store("trdr.overlays", overlays); }, [overlays]);

  const position = account?.positions.find((p) => p.symbol === symbol);
  const symbolOrders = useMemo(() => openOrders.filter((o) => o.symbol === symbol), [openOrders, symbol]);
  const symbolTrades = useMemo(() => trades.filter((t) => t.symbol === symbol), [trades, symbol]);
  const toggle = (k: keyof Overlays) => setOverlays((o) => ({ ...o, [k]: !o[k] }));

  return (
    <div style={{
      display: "grid", gap: 12, padding: 12, height: "100%", minHeight: 640,
      gridTemplateColumns: "240px minmax(0, 1fr) 280px", gridTemplateRows: "minmax(320px, 1fr) 260px",
    }}>
      <section className="card" style={{ gridRow: "1 / 2", overflow: "hidden" }}>
        <header className="card-head"><span className="card-title">Watchlist</span></header>
        <div style={{ height: "calc(100% - 41px)" }}>
          <Watchlist selected={symbol} onSelect={setSymbol} />
        </div>
      </section>

      <section className="card" style={{ display: "flex", flexDirection: "column", overflow: "hidden" }}>
        <div className="card-head" style={{ padding: "6px 8px" }}>
          <div style={{ display: "flex", gap: 2 }}>
            {TIMEFRAMES.map((t) => (
              <button key={t} className={`tab ${t === tf ? "active" : ""}`} style={{ padding: "4px 8px" }} onClick={() => setTf(t)}>{t}</button>
            ))}
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className={`btn small ${overlays.sma20 ? "primary" : ""}`} onClick={() => toggle("sma20")}>SMA 20</button>
            <button className={`btn small ${overlays.sma50 ? "primary" : ""}`} onClick={() => toggle("sma50")} style={overlays.sma50 ? { borderColor: "var(--yellow)", color: "var(--yellow)" } : undefined}>SMA 50</button>
            <button className={`btn small ${overlays.volume ? "primary" : ""}`} onClick={() => toggle("volume")}>Volume</button>
          </div>
        </div>
        <div style={{ flex: 1, minHeight: 0 }}>
          <PriceChart symbol={symbol} timeframe={tf} overlays={overlays} position={position} openOrders={symbolOrders} trades={symbolTrades} />
        </div>
      </section>

      <section className="card" style={{ overflowY: "auto" }}>
        <header className="card-head"><span className="card-title">Order ticket</span></header>
        <div className="card-body">
          <OrderTicket accountId={account?.id ?? null} symbol={symbol} freeMargin={account?.free_margin ?? 0} currency={account?.currency ?? "USD"} />
        </div>
      </section>

      <section className="card" style={{ gridColumn: "1 / 4", overflow: "hidden", display: "flex", flexDirection: "column" }}>
        <Tabs<BottomTab>
          tabs={[
            { id: "positions", label: "Positions", count: account?.positions.length },
            { id: "orders", label: "Orders", count: openOrders.length },
            { id: "history", label: "History" },
          ]}
          active={tab}
          onChange={setTab}
        />
        <div style={{ overflow: "auto", flex: 1 }}>
          {account && tab === "positions" && <PositionsTable accountId={account.id} positions={account.positions} currency={account.currency} onSelect={setSymbol} />}
          {tab === "orders" && <OrdersTable orders={orders} showCancel />}
          {account && tab === "history" && <TradesTable trades={trades} currency={account.currency} />}
        </div>
      </section>
    </div>
  );
}
