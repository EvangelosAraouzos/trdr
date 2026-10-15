import { Card } from "../components/Card";

export function ComingSoon({ title, phase, items }: { title: string; phase: string; items: string[] }) {
  return (
    <div className="page">
      <h1 className="page-title">{title}</h1>
      <Card title={`Arrives in ${phase}`} tone="attention" style={{ maxWidth: 560 }}>
        <ul style={{ margin: 0, paddingLeft: 18, lineHeight: 1.8 }}>
          {items.map((i) => <li key={i}>{i}</li>)}
        </ul>
      </Card>
    </div>
  );
}
