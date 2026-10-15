// One WebSocket to the local server: live prices, feed status and account changes.
import { useSyncExternalStore } from "react";
import type { FeedStatus } from "./api";

export interface LiveState {
  connected: boolean;
  prices: Record<string, number>;
  /** Previous price per symbol, to color ticks up or down. */
  prev: Record<string, number>;
  status: Record<string, FeedStatus>;
  /** Bumped whenever an account changes (fills, new orders, resets). */
  accountVersion: Record<number, number>;
  lastFill: { symbol: string; side: string; qty: number; price: number; reason: string; at: number } | null;
}

let state: LiveState = { connected: false, prices: {}, prev: {}, status: {}, accountVersion: {}, lastFill: null };
const listeners = new Set<() => void>();
let socket: WebSocket | null = null;
let subscribed: string[] = [];
let pending: Record<string, number> = {};
let flushTimer: number | null = null;

function set(next: Partial<LiveState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

function flushPrices() {
  flushTimer = null;
  const prev = { ...state.prev };
  for (const s of Object.keys(pending)) if (state.prices[s] !== undefined) prev[s] = state.prices[s];
  set({ prices: { ...state.prices, ...pending }, prev });
  pending = {};
}

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  socket = new WebSocket(`${proto}://${location.host}/ws`);
  socket.onopen = () => {
    set({ connected: true });
    if (subscribed.length) socket?.send(JSON.stringify({ type: "subscribe", symbols: subscribed }));
  };
  socket.onclose = () => {
    set({ connected: false });
    window.setTimeout(connect, 2000);
  };
  socket.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.type === "price") {
      pending[msg.symbol] = msg.price;
      if (flushTimer === null) flushTimer = window.setTimeout(flushPrices, 200);
    } else if (msg.type === "prices") {
      set({ prices: { ...state.prices, ...msg.prices } });
    } else if (msg.type === "status") {
      set({ status: msg.status });
    } else if (msg.type === "account") {
      const id = msg.account_id as number;
      const fill = (msg.events ?? []).find((e: { type: string }) => e.type === "fill");
      set({
        accountVersion: { ...state.accountVersion, [id]: (state.accountVersion[id] ?? 0) + 1 },
        lastFill: fill
          ? { symbol: fill.trade.symbol, side: fill.trade.side, qty: fill.trade.qty, price: fill.trade.price, reason: fill.trade.reason, at: Date.now() }
          : state.lastFill,
      });
    }
  };
}

export function startLive() {
  if (!socket) connect();
}

/** Ask the server to stream these symbols in addition to the watchlist. */
export function subscribeSymbols(symbols: string[]) {
  subscribed = symbols;
  if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "subscribe", symbols }));
}

export function useLive<T>(select: (s: LiveState) => T): T {
  return useSyncExternalStore(
    (cb) => { listeners.add(cb); return () => listeners.delete(cb); },
    () => select(state),
  );
}
