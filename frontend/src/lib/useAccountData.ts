import { useEffect, useState } from "react";
import { api, type Order, type Trade } from "./api";
import { useLive } from "./live";

/** Orders and trades for an account, refreshed whenever the account changes. */
export function useAccountData(accountId: number | null) {
  const version = useLive((s) => (accountId === null ? 0 : s.accountVersion[accountId] ?? 0));
  const [orders, setOrders] = useState<Order[]>([]);
  const [trades, setTrades] = useState<Trade[]>([]);
  useEffect(() => {
    if (accountId === null) return;
    let cancelled = false;
    Promise.all([api.orders(accountId), api.trades(accountId)])
      .then(([o, t]) => { if (!cancelled) { setOrders(o); setTrades(t); } })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [accountId, version]);
  return { orders, trades, openOrders: orders.filter((o) => o.status === "open") };
}
