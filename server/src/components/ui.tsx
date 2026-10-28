import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`ui-card p-4 sm:p-5 ${className}`}>{children}</section>;
}

export function CardTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-text-2">{children}</h2>
      {right}
    </div>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="ui-card px-4 py-3">
      <div className="text-xs text-text-2">{label}</div>
      <div className="tabular mt-1 text-2xl font-semibold">{value}</div>
      {hint ? <div className="mt-0.5 text-xs text-muted">{hint}</div> : null}
    </div>
  );
}

export function Badge({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "good" | "warning" | "critical" | "accent" }) {
  const tones: Record<string, string> = {
    neutral: "bg-surface-2 text-text-2",
    good: "bg-good/15 text-good",
    warning: "bg-warning/20 text-text",
    critical: "bg-critical/15 text-critical",
    accent: "bg-accent/15 text-accent",
  };
  return <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>;
}

export function Notice({ children, tone = "warning" }: { children: ReactNode; tone?: "warning" | "info" }) {
  const cls = tone === "warning" ? "border-warning/60 bg-warning/10" : "border-border bg-surface-2";
  return <div className={`rounded-lg border px-3 py-2 text-sm text-text-2 ${cls}`}>{children}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="ui-card px-4 py-10 text-center text-sm text-text-2">{children}</div>;
}
