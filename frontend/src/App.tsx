import { useEffect, useState } from "react";
import { Icon } from "./components/Icon";
import { AccountProvider, useAccounts, useActiveAccount } from "./lib/account";
import type { FeedStatus } from "./lib/api";
import { signedMoney, money, tone } from "./lib/format";
import { useLive } from "./lib/live";
import { navigate, useRoute } from "./lib/router";
import { ComingSoon } from "./pages/ComingSoon";
import { Dashboard } from "./pages/Dashboard";
import { DataPage } from "./pages/DataPage";
import { Markets } from "./pages/Markets";
import { Portfolio } from "./pages/Portfolio";
import { SettingsPage } from "./pages/Settings";
import { Trade } from "./pages/Trade";

const NAV = [
  { id: "dashboard", label: "Dashboard" },
  { id: "trade", label: "Trade" },
  { id: "markets", label: "Markets" },
  { id: "robots", label: "Robots", soon: "Phase 3" },
  { id: "backtest", label: "Backtest", soon: "Phase 2" },
  { id: "leaderboards", label: "Leaderboards", soon: "Phase 3" },
  { id: "portfolio", label: "Portfolio" },
  { id: "data", label: "Data" },
];

export function App() {
  return (
    <AccountProvider>
      <Shell />
    </AccountProvider>
  );
}

function Shell() {
  const route = useRoute();
  return (
    <div className="shell">
      <TopBar />
      <nav className="sidebar" aria-label="Main">
        {NAV.map((item) => (
          <a key={item.id} href={`#/${item.id}`} className={`nav-item ${route.page === item.id ? "active" : ""}`} title={item.label}>
            <Icon name={item.id} />
            <span className="label">{item.label}</span>
            {item.soon && <span className="soon">{item.soon}</span>}
          </a>
        ))}
        <div className="nav-spacer" />
        <a href="#/settings" className={`nav-item ${route.page === "settings" ? "active" : ""}`} title="Settings">
          <Icon name="settings" />
          <span className="label">Settings</span>
        </a>
      </nav>
      <main className="main">
        <Page page={route.page} params={route.params} />
      </main>
      <StatusBar />
    </div>
  );
}

function Page({ page, params }: { page: string; params: URLSearchParams }) {
  switch (page) {
    case "dashboard": return <Dashboard />;
    case "trade": return <Trade initialSymbol={params.get("symbol")} />;
    case "markets": return <Markets />;
    case "portfolio": return <Portfolio />;
    case "data": return <DataPage />;
    case "settings": return <SettingsPage />;
    case "robots": return <ComingSoon title="Robots" phase="Phase 3" items={[
      "Create named robots like aida and rob with their own starting criteria",
      "Rule robots from visual blocks or Python",
      "AI robots that breed new generations and keep the best",
    ]} />;
    case "backtest": return <ComingSoon title="Backtest" phase="Phase 2" items={[
      "Replay any strategy or robot over historical candles",
      "Realistic fees, spread, slippage and fill delay",
      "Reports with equity, drawdown, trades and overfitting checks",
    ]} />;
    case "leaderboards": return <ComingSoon title="Leaderboards" phase="Phase 3" items={[
      "Best generation of each robot",
      "Global ranking across all robots",
      "Hall of fame for past champions",
    ]} />;
    default:
      navigate("dashboard");
      return null;
  }
}

function TopBar() {
  const { accounts, activeId, setActiveId } = useAccounts();
  const acc = useActiveAccount();
  return (
    <header className="topbar">
      <div className="logo">trdr</div>
      <select
        className="input"
        style={{ width: 200 }}
        value={activeId ?? ""}
        onChange={(e) => setActiveId(Number(e.target.value))}
        aria-label="Demo account"
      >
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      {acc && (
        <div style={{ display: "flex", gap: 20, alignItems: "baseline" }}>
          <span><span className="muted">Equity </span><span className="num">{money(acc.equity, acc.currency)}</span></span>
          <span><span className="muted">P&amp;L </span><span className={`num ${tone(acc.total_pnl)}`}>{signedMoney(acc.total_pnl, acc.currency)}</span></span>
          <span className="muted" style={{ fontSize: 12 }}>Free <span className="num">{money(acc.free_margin, acc.currency)}</span></span>
        </div>
      )}
      <div style={{ marginLeft: "auto" }}>
        <span className="badge warn" title="Simulated trading: no real money and no real orders">DEMO</span>
      </div>
    </header>
  );
}

const STATE_COLOR: Record<FeedStatus["state"], string> = {
  live: "var(--green)", connecting: "var(--yellow)", starting: "var(--yellow)",
  error: "var(--red)", off: "var(--muted)", idle: "var(--muted)",
};

function StatusBar() {
  const status = useLive((s) => s.status);
  const connected = useLive((s) => s.connected);
  const [clock, setClock] = useState(() => new Date());
  useEffect(() => {
    const t = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <footer className="statusbar">
      {!connected && <span style={{ color: "var(--red)" }}>Reconnecting to the trdr server...</span>}
      {(["crypto", "stocks"] as const).map((m) => {
        const s = status[m];
        return (
          <span key={m} title={s?.message}>
            <span className="dot" style={{ background: s ? STATE_COLOR[s.state] : "var(--muted)" }} />
            {m === "crypto" ? "Crypto" : "Stocks"}: {s?.state ?? "waiting"}
          </span>
        );
      })}
      <span>{usMarketOpen(clock) ? "US market open" : "US market closed"}</span>
      <span>Robots: none yet</span>
      <span style={{ marginLeft: "auto" }} className="num">{clock.toLocaleTimeString()}</span>
    </footer>
  );
}

/** Regular US session, 9:30 to 16:00 New York time, Monday to Friday (holidays not counted). */
function usMarketOpen(now: Date): boolean {
  const ny = new Date(now.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const day = ny.getDay();
  const mins = ny.getHours() * 60 + ny.getMinutes();
  return day >= 1 && day <= 5 && mins >= 570 && mins < 960;
}
