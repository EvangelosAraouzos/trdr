export function price(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  const abs = Math.abs(value);
  if (abs === 0) return "0.00";
  const digits = abs >= 1000 ? 2 : abs >= 1 ? 2 : abs >= 0.01 ? 4 : 6;
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function money(value: number | null | undefined, currency = "USD"): string {
  if (value === null || value === undefined || Number.isNaN(value)) return "-";
  return value.toLocaleString("en-US", { style: "currency", currency, minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Signed money with an explicit + so gains never rely on color alone. */
export function signedMoney(value: number, currency = "USD"): string {
  const s = money(Math.abs(value), currency);
  if (Math.abs(value) < 0.005) return s;
  return value > 0 ? `+${s}` : `-${s}`;
}

export function pct(value: number): string {
  const s = `${Math.abs(value).toFixed(2)}%`;
  if (Math.abs(value) < 0.005) return s;
  return value > 0 ? `+${s}` : `-${s}`;
}

export function qty(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: 8 });
}

export function tone(value: number): string {
  if (value > 0.0000001) return "up";
  if (value < -0.0000001) return "down";
  return "";
}

export function time(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function displaySymbol(symbol: string): string {
  for (const q of ["USDT", "USDC", "FDUSD"]) {
    if (symbol.endsWith(q) && symbol.length > q.length + 1) return `${symbol.slice(0, -q.length)}/${q}`;
  }
  return symbol;
}
