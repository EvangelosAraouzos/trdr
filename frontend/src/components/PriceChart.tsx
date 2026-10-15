import { useEffect, useRef, useState } from "react";
import {
  CandlestickSeries, HistogramSeries, LineSeries, createChart, createSeriesMarkers,
  type IChartApi, type IPriceLine, type ISeriesApi, type ISeriesMarkersPluginApi, type SeriesMarker, type Time, type UTCTimestamp,
} from "lightweight-charts";
import { api, TF_SECONDS, type Candle, type Order, type Position, type Timeframe, type Trade } from "../lib/api";
import { useLive } from "../lib/live";

const C = {
  bg: "#11151a", text: "#8a929c", grid: "#1e242c", green: "#22c55e", red: "#ef4444",
  orange: "#ff8a1f", yellow: "#ffc93c", textStrong: "#e6e8eb",
};

export interface Overlays { sma20: boolean; sma50: boolean; volume: boolean }

function sma(bars: Candle[], n: number) {
  const out: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;
  bars.forEach((b, i) => {
    sum += b.close;
    if (i >= n) sum -= bars[i - n].close;
    if (i >= n - 1) out.push({ time: b.time as UTCTimestamp, value: sum / n });
  });
  return out;
}

export function PriceChart(props: {
  symbol: string;
  timeframe: Timeframe;
  overlays: Overlays;
  position?: Position;
  openOrders: Order[];
  trades: Trade[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const candles = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volume = useRef<ISeriesApi<"Histogram"> | null>(null);
  const ma20 = useRef<ISeriesApi<"Line"> | null>(null);
  const ma50 = useRef<ISeriesApi<"Line"> | null>(null);
  const markers = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const bars = useRef<Candle[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const live = useLive((s) => s.prices[props.symbol]);

  // Create the chart once.
  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: { background: { color: C.bg }, textColor: C.text, fontFamily: "Inter, Segoe UI, sans-serif", attributionLogo: false, panes: { separatorColor: C.grid } },
      grid: { vertLines: { color: C.grid }, horzLines: { color: C.grid } },
      rightPriceScale: { borderColor: C.grid },
      timeScale: { borderColor: C.grid, timeVisible: true, secondsVisible: false },
      crosshair: { vertLine: { color: C.text, labelBackgroundColor: C.grid }, horzLine: { color: C.text, labelBackgroundColor: C.grid } },
    });
    candles.current = c.addSeries(CandlestickSeries, {
      upColor: C.green, downColor: C.red, borderUpColor: C.green, borderDownColor: C.red,
      wickUpColor: C.green, wickDownColor: C.red,
    });
    ma20.current = c.addSeries(LineSeries, { color: C.orange, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    ma50.current = c.addSeries(LineSeries, { color: C.yellow, lineWidth: 1, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false });
    volume.current = c.addSeries(HistogramSeries, { priceFormat: { type: "volume" }, priceLineVisible: false, lastValueVisible: false }, 1);
    c.panes()[1]?.setHeight(80);
    markers.current = createSeriesMarkers(candles.current, []);
    chart.current = c;
    return () => { c.remove(); chart.current = null; };
  }, []);

  // Load history whenever symbol or timeframe changes.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api.candles(props.symbol, props.timeframe, 500)
      .then((data) => {
        if (cancelled) return;
        bars.current = data;
        candles.current?.setData(data.map((b) => ({ ...b, time: b.time as UTCTimestamp })));
        volume.current?.setData(data.map((b) => ({
          time: b.time as UTCTimestamp, value: b.volume,
          color: b.close >= b.open ? "rgba(34,197,94,0.35)" : "rgba(239,68,68,0.35)",
        })));
        ma20.current?.setData(sma(data, 20));
        ma50.current?.setData(sma(data, 50));
        chart.current?.timeScale().fitContent();
        const bodies = data.slice(-100);
        const precision = bodies.length && bodies[bodies.length - 1].close < 1 ? 6 : bodies.length && bodies[bodies.length - 1].close < 10 ? 4 : 2;
        candles.current?.applyOptions({ priceFormat: { type: "price", precision, minMove: 1 / 10 ** precision } });
      })
      .catch((e: Error) => { if (!cancelled) { bars.current = []; candles.current?.setData([]); volume.current?.setData([]); setError(e.message); } })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [props.symbol, props.timeframe]);

  // Overlay visibility.
  useEffect(() => {
    ma20.current?.applyOptions({ visible: props.overlays.sma20 });
    ma50.current?.applyOptions({ visible: props.overlays.sma50 });
    volume.current?.applyOptions({ visible: props.overlays.volume });
  }, [props.overlays]);

  // Merge live prices into the latest candle.
  useEffect(() => {
    if (live === undefined || !bars.current.length || !candles.current) return;
    const step = TF_SECONDS[props.timeframe];
    const last = bars.current[bars.current.length - 1];
    const now = Math.floor(Date.now() / 1000);
    const slot = step < 86400 ? Math.floor(now / step) * step : last.time;
    if (slot > last.time) {
      const bar = { time: slot, open: last.close, high: Math.max(last.close, live), low: Math.min(last.close, live), close: live, volume: 0 };
      bars.current.push(bar);
      candles.current.update({ ...bar, time: slot as UTCTimestamp });
    } else {
      last.close = live;
      last.high = Math.max(last.high, live);
      last.low = Math.min(last.low, live);
      candles.current.update({ ...last, time: last.time as UTCTimestamp });
    }
  }, [live, props.timeframe]);

  // Entry, stop-loss, take-profit and pending orders as price lines; fills as markers.
  useEffect(() => {
    const series = candles.current;
    if (!series) return;
    lines.current.forEach((l) => series.removePriceLine(l));
    lines.current = [];
    const add = (price: number | null | undefined, color: string, title: string, dashed = true) => {
      if (!price) return;
      lines.current.push(series.createPriceLine({ price, color, lineWidth: 1, lineStyle: dashed ? 2 : 0, axisLabelVisible: true, title }));
    };
    const p = props.position;
    if (p) {
      add(p.avg_price, C.textStrong, `${p.side} ${Math.abs(p.qty)}`, false);
      add(p.sl, C.red, "SL");
      add(p.tp, C.green, "TP");
    }
    for (const o of props.openOrders) {
      add(o.limit_price ?? o.stop_price, C.yellow, `${o.side} ${o.type} ${o.qty}`);
    }
    const step = TF_SECONDS[props.timeframe];
    const m: SeriesMarker<Time>[] = props.trades
      .slice()
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .map((t) => {
        const ts = Math.floor(new Date(t.ts).getTime() / 1000);
        return {
          time: (Math.floor(ts / step) * step) as UTCTimestamp,
          position: t.side === "buy" ? "belowBar" : "aboveBar",
          shape: t.side === "buy" ? "arrowUp" : "arrowDown",
          color: t.side === "buy" ? C.green : C.red,
          text: t.reason === "manual" ? "" : t.reason,
        } as SeriesMarker<Time>;
      });
    markers.current?.setMarkers(m);
  }, [props.position, props.openOrders, props.trades, props.timeframe]);

  return (
    <div style={{ position: "relative", height: "100%", minHeight: 260 }}>
      <div ref={host} style={{ position: "absolute", inset: 0 }} />
      {(error || loading) && (
        <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", pointerEvents: "none" }}>
          <div className={error ? "card attention" : ""} style={{ padding: "10px 14px", maxWidth: 420, textAlign: "center", background: error ? C.bg : "transparent" }}>
            {error ? <span className="warn">{error}</span> : <span className="muted">Loading candles...</span>}
          </div>
        </div>
      )}
    </div>
  );
}
