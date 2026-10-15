// Typed wrappers around the local trdr server.

export type Market = "crypto" | "stocks";
export type Timeframe = "1m" | "5m" | "15m" | "1h" | "4h" | "1d" | "1w";
export const TIMEFRAMES: Timeframe[] = ["1m", "5m", "15m", "1h", "4h", "1d", "1w"];
export const TF_SECONDS: Record<Timeframe, number> = {
  "1m": 60, "5m": 300, "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400, "1w": 604800,
};

export interface Candle { time: number; open: number; high: number; low: number; close: number; volume: number }

export interface Position {
  account_id: number; symbol: string; qty: number; avg_price: number;
  sl: number | null; tp: number | null; opened_at: string;
  side: "long" | "short"; price: number; unrealized_pnl: number; market: Market;
}

export interface Account {
  id: number; name: string; currency: string; starting_balance: number; cash: number;
  realized_pnl: number; fees_paid: number; created_at: string;
  equity: number; unrealized_pnl: number; exposure: number; free_margin: number; total_pnl: number;
  positions: Position[];
}

export type OrderType = "market" | "limit" | "stop";
export type Side = "buy" | "sell";

export interface Order {
  id: number; account_id: number; symbol: string; side: Side; type: OrderType; qty: number;
  limit_price: number | null; stop_price: number | null; sl: number | null; tp: number | null;
  status: "open" | "filled" | "cancelled" | "rejected"; reason: string | null;
  fill_price: number | null; fee: number | null; created_at: string; closed_at: string | null;
}

export interface Trade {
  id: number; account_id: number; order_id: number; symbol: string; side: Side; qty: number;
  price: number; fee: number; realized_pnl: number; reason: string; ts: string;
}

export interface WatchItem { symbol: string; name: string; market: Market; price: number | null }

export interface Settings {
  data_mode: "live" | "practice";
  alpaca_key_id: string;
  alpaca_secret_key: string;
  crypto_fee_pct: number;
  stock_fee_per_share: number;
  slippage_bps: number;
}

export interface FeedStatus { state: "starting" | "connecting" | "live" | "error" | "off" | "idle"; message: string; since?: number }

export interface NewOrder {
  symbol: string; side: Side; type: OrderType; qty: number;
  limit_price?: number | null; stop_price?: number | null; sl?: number | null; tp?: number | null;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status} ${res.statusText}`;
    try {
      const data = await res.json();
      if (typeof data.detail === "string") detail = data.detail;
      else if (Array.isArray(data.detail)) detail = data.detail.map((d: { msg: string }) => d.msg).join("; ");
    } catch { /* keep the status text */ }
    throw new Error(detail);
  }
  return res.json() as Promise<T>;
}

export const api = {
  settings: () => request<Settings>("GET", "/api/settings"),
  saveSettings: (s: Partial<Settings>) => request<Settings>("PUT", "/api/settings", s),
  watchlist: () => request<WatchItem[]>("GET", "/api/watchlist"),
  saveWatchlist: (symbols: string[]) => request<WatchItem[]>("PUT", "/api/watchlist", { symbols }),
  search: (q: string) => request<{ symbol: string; name: string; market: Market }[]>("GET", `/api/symbols/search?q=${encodeURIComponent(q)}`),
  candles: (symbol: string, tf: Timeframe, limit = 500) =>
    request<Candle[]>("GET", `/api/candles?symbol=${encodeURIComponent(symbol)}&tf=${tf}&limit=${limit}`),
  accounts: () => request<Account[]>("GET", "/api/accounts"),
  account: (id: number) => request<Account>("GET", `/api/accounts/${id}`),
  createAccount: (name: string, balance: number) => request<Account>("POST", "/api/accounts", { name, balance }),
  renameAccount: (id: number, name: string) => request<Account>("PATCH", `/api/accounts/${id}`, { name }),
  resetAccount: (id: number, balance?: number) => request<Account>("POST", `/api/accounts/${id}/reset`, { balance: balance ?? null }),
  deleteAccount: (id: number) => request<{ ok: boolean }>("DELETE", `/api/accounts/${id}`),
  orders: (id: number, status?: string) => request<Order[]>("GET", `/api/accounts/${id}/orders${status ? `?status=${status}` : ""}`),
  trades: (id: number) => request<Trade[]>("GET", `/api/accounts/${id}/trades`),
  equity: (id: number, since = 0) => request<{ ts: number; equity: number }[]>("GET", `/api/accounts/${id}/equity?since=${since}`),
  placeOrder: (id: number, order: NewOrder) => request<Order>("POST", `/api/accounts/${id}/orders`, order),
  cancelOrder: (orderId: number) => request<Order>("DELETE", `/api/orders/${orderId}`),
  closePosition: (id: number, symbol: string) => request<Order>("POST", `/api/accounts/${id}/positions/${symbol}/close`),
  protect: (id: number, symbol: string, sl: number | null, tp: number | null) =>
    request<Account>("PUT", `/api/accounts/${id}/positions/${symbol}/protection`, { sl, tp }),
};
