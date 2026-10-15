import type { ReactNode } from "react";

export type Tone = "default" | "good" | "bad" | "attention" | "plain";

export function Card(props: {
  title?: ReactNode;
  actions?: ReactNode;
  tone?: Tone;
  children: ReactNode;
  className?: string;
  bodyClass?: string;
  style?: React.CSSProperties;
}) {
  const tone = props.tone && props.tone !== "default" ? props.tone : "";
  return (
    <section className={`card ${tone} ${props.className ?? ""}`} style={props.style}>
      {(props.title || props.actions) && (
        <header className="card-head">
          <span className="card-title">{props.title}</span>
          {props.actions}
        </header>
      )}
      <div className={props.bodyClass ?? "card-body"}>{props.children}</div>
    </section>
  );
}

/** Card tone from a signed value: green for gains, red for losses. */
export function signTone(value: number): Tone {
  if (value > 0.005) return "good";
  if (value < -0.005) return "bad";
  return "default";
}
