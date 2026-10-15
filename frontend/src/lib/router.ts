// Tiny hash router: #/trade?symbol=BTCUSDT
import { useEffect, useState } from "react";

export interface Route { page: string; params: URLSearchParams }

function parse(): Route {
  const raw = location.hash.replace(/^#\/?/, "");
  const [page, query] = raw.split("?");
  return { page: page || "dashboard", params: new URLSearchParams(query ?? "") };
}

export function useRoute(): Route {
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function navigate(page: string, params?: Record<string, string>) {
  const q = params ? `?${new URLSearchParams(params).toString()}` : "";
  location.hash = `#/${page}${q}`;
}
