// Which demo account is active, and live views of it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api, type Account } from "./api";
import { useLive } from "./live";

interface AccountCtx {
  accounts: Account[];
  activeId: number | null;
  setActiveId: (id: number) => void;
  refresh: () => Promise<void>;
}

const Ctx = createContext<AccountCtx>({ accounts: [], activeId: null, setActiveId: () => {}, refresh: async () => {} });

function readStoredId(): number | null {
  try {
    const v = localStorage.getItem("trdr.account");
    return v ? Number(v) : null;
  } catch {
    return null;
  }
}

export function AccountProvider({ children }: { children: ReactNode }) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeId, setActive] = useState<number | null>(readStoredId);
  const versions = useLive((s) => s.accountVersion);

  const refresh = useCallback(async () => {
    const list = await api.accounts();
    setAccounts(list);
    setActive((cur) => (cur !== null && list.some((a) => a.id === cur) ? cur : list[0]?.id ?? null));
  }, []);

  useEffect(() => { refresh().catch(() => {}); }, [refresh, versions]);

  const setActiveId = useCallback((id: number) => {
    setActive(id);
    try { localStorage.setItem("trdr.account", String(id)); } catch { /* storage unavailable */ }
  }, []);

  const value = useMemo(() => ({ accounts, activeId, setActiveId, refresh }), [accounts, activeId, setActiveId, refresh]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAccounts() {
  return useContext(Ctx);
}

/** The active account with positions re-marked to the latest live prices. */
export function useActiveAccount(): Account | null {
  const { accounts, activeId } = useAccounts();
  const prices = useLive((s) => s.prices);
  const acc = accounts.find((a) => a.id === activeId) ?? null;
  return useMemo(() => (acc ? remark(acc, prices) : null), [acc, prices]);
}

export function remark(acc: Account, prices: Record<string, number>): Account {
  let value = 0;
  let gross = 0;
  let upnl = 0;
  const positions = acc.positions.map((p) => {
    const price = prices[p.symbol] ?? p.price;
    const u = (price - p.avg_price) * p.qty;
    value += p.qty * price;
    gross += Math.abs(p.qty) * price;
    upnl += u;
    return { ...p, price, unrealized_pnl: u };
  });
  const equity = acc.cash + value;
  return {
    ...acc, positions, equity, unrealized_pnl: upnl, exposure: gross,
    free_margin: equity - gross, total_pnl: equity - acc.starting_balance,
  };
}
