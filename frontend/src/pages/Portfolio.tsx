import { useState } from "react";
import { OrdersTable, TradesTable } from "../components/AccountTables";
import { Card, signTone } from "../components/Card";
import { Tabs } from "../components/Tabs";
import { remark, useAccounts, useActiveAccount } from "../lib/account";
import { api, type Account } from "../lib/api";
import { money, pct, signedMoney, tone } from "../lib/format";
import { useLive } from "../lib/live";
import { useAccountData } from "../lib/useAccountData";

type PortfolioTab = "accounts" | "orders" | "history";

export function Portfolio() {
  const [tab, setTab] = useState<PortfolioTab>("accounts");
  const acc = useActiveAccount();
  const { orders, trades } = useAccountData(acc?.id ?? null);
  return (
    <div className="page">
      <h1 className="page-title">Portfolio</h1>
      <Tabs<PortfolioTab>
        tabs={[{ id: "accounts", label: "Accounts" }, { id: "orders", label: "Orders" }, { id: "history", label: "History" }]}
        active={tab}
        onChange={setTab}
        right={acc && tab !== "accounts" ? <span className="muted">{acc.name}</span> : null}
      />
      {tab === "accounts" && <Accounts />}
      {tab === "orders" && <Card bodyClass=""><OrdersTable orders={orders} showCancel /></Card>}
      {tab === "history" && acc && <Card bodyClass=""><TradesTable trades={trades} currency={acc.currency} /></Card>}
    </div>
  );
}

function Accounts() {
  const { accounts, activeId, setActiveId, refresh } = useAccounts();
  const prices = useLive((s) => s.prices);
  const [name, setName] = useState("");
  const [balance, setBalance] = useState("10000");
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try { await fn(); await refresh(); } catch (e) { setError((e as Error).message); }
  };

  return (
    <>
      {error && <div className="error-text">{error}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: 16 }}>
        {accounts.map((raw) => {
          const a = remark(raw, prices);
          return <AccountCard key={a.id} account={a} active={a.id === activeId} onActivate={() => setActiveId(a.id)} run={run} />;
        })}
        <Card title="New demo account" tone="plain">
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <label className="field">Name<input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Swing trading" /></label>
            <label className="field">Starting balance (USD)<input className="input num" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} /></label>
            <button className="btn primary" onClick={() => run(async () => {
              const created = await api.createAccount(name || "Demo account", parseFloat(balance));
              setActiveId(created.id);
              setName("");
            })}>Create account</button>
          </div>
        </Card>
      </div>
    </>
  );
}

function AccountCard(props: { account: Account; active: boolean; onActivate: () => void; run: (fn: () => Promise<unknown>) => Promise<void> }) {
  const a = props.account;
  const [confirm, setConfirm] = useState<"reset" | "delete" | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState(a.name);
  return (
    <Card tone={signTone(a.total_pnl)} title={a.name} actions={props.active ? <span className="badge accent">ACTIVE</span> : <button className="btn small" onClick={props.onActivate}>Use this account</button>}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div><div className="muted" style={{ fontSize: 12 }}>Equity</div><div className="num" style={{ fontSize: 16 }}>{money(a.equity, a.currency)}</div></div>
        <div><div className="muted" style={{ fontSize: 12 }}>Total P&amp;L</div><div className={`num ${tone(a.total_pnl)}`} style={{ fontSize: 16 }}>{signedMoney(a.total_pnl, a.currency)} <span style={{ fontSize: 12 }}>{pct((a.total_pnl / a.starting_balance) * 100)}</span></div></div>
        <div><div className="muted" style={{ fontSize: 12 }}>Cash</div><div className="num">{money(a.cash, a.currency)}</div></div>
        <div><div className="muted" style={{ fontSize: 12 }}>Started with</div><div className="num">{money(a.starting_balance, a.currency)}</div></div>
        <div><div className="muted" style={{ fontSize: 12 }}>Realised</div><div className={`num ${tone(a.realized_pnl)}`}>{signedMoney(a.realized_pnl, a.currency)}</div></div>
        <div><div className="muted" style={{ fontSize: 12 }}>Fees paid</div><div className="num">{money(a.fees_paid, a.currency)}</div></div>
      </div>
      {renaming ? (
        <div style={{ display: "flex", gap: 6 }}>
          <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} />
          <button className="btn small primary" onClick={() => props.run(() => api.renameAccount(a.id, newName)).then(() => setRenaming(false))}>Save</button>
        </div>
      ) : confirm ? (
        <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
          <span className="warn" style={{ fontSize: 12, flex: 1 }}>{confirm === "reset" ? "Close everything and restore the starting balance?" : "Delete this account and its history?"}</span>
          <button className="btn small danger" onClick={() => props.run(() => (confirm === "reset" ? api.resetAccount(a.id) : api.deleteAccount(a.id))).then(() => setConfirm(null))}>Yes</button>
          <button className="btn small" onClick={() => setConfirm(null)}>No</button>
        </div>
      ) : (
        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn small" onClick={() => setRenaming(true)}>Rename</button>
          <button className="btn small" onClick={() => setConfirm("reset")}>Reset</button>
          <button className="btn small danger" onClick={() => setConfirm("delete")}>Delete</button>
        </div>
      )}
    </Card>
  );
}
