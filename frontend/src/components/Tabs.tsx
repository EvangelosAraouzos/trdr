import type { ReactNode } from "react";

export function Tabs<T extends string>(props: {
  tabs: { id: T; label: ReactNode; count?: number }[];
  active: T;
  onChange: (id: T) => void;
  right?: ReactNode;
}) {
  return (
    <div className="tabs" role="tablist">
      {props.tabs.map((t) => (
        <button
          key={t.id}
          role="tab"
          aria-selected={t.id === props.active}
          className={`tab ${t.id === props.active ? "active" : ""}`}
          onClick={() => props.onChange(t.id)}
        >
          {t.label}
          {t.count ? <span className="count">{t.count}</span> : null}
        </button>
      ))}
      {props.right && <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>{props.right}</div>}
    </div>
  );
}
