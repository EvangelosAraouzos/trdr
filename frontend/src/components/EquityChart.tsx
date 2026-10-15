import { useEffect, useRef } from "react";
import { BaselineSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from "lightweight-charts";

export function EquityChart({ points, base }: { points: { ts: number; equity: number }[]; base: number }) {
  const host = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Baseline"> | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const c = createChart(host.current, {
      autoSize: true,
      layout: { background: { color: "#11151a" }, textColor: "#8a929c", attributionLogo: false },
      grid: { vertLines: { color: "#1e242c" }, horzLines: { color: "#1e242c" } },
      rightPriceScale: { borderColor: "#1e242c" },
      timeScale: { borderColor: "#1e242c", timeVisible: true },
      handleScroll: false,
      handleScale: false,
    });
    series.current = c.addSeries(BaselineSeries, {
      topLineColor: "#22c55e", bottomLineColor: "#ef4444",
      topFillColor1: "rgba(0,0,0,0)", topFillColor2: "rgba(0,0,0,0)",
      bottomFillColor1: "rgba(0,0,0,0)", bottomFillColor2: "rgba(0,0,0,0)",
      lineWidth: 2,
    });
    chart.current = c;
    return () => c.remove();
  }, []);

  useEffect(() => {
    series.current?.applyOptions({ baseValue: { type: "price", price: base } });
    series.current?.setData(points.map((p) => ({ time: p.ts as UTCTimestamp, value: p.equity })));
    chart.current?.timeScale().fitContent();
  }, [points, base]);

  return <div ref={host} style={{ height: "100%", minHeight: 220 }} />;
}
