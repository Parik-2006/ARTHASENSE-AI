import type { ReactNode } from "react";

export function PageHeader({
  eyebrow,
  title,
  lede,
  aside,
}: {
  eyebrow?: string;
  title: string;
  lede?: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <header className="mb-8 flex flex-col gap-4 border-b border-rule pb-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        {eyebrow && (
          <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-accent">{eyebrow}</p>
        )}
        <h1 className="font-serif text-4xl leading-[1.15] font-semibold tracking-tight">{title}</h1>
        {lede && <p className="mt-3 text-base text-ink-muted">{lede}</p>}
      </div>
      {aside}
    </header>
  );
}

export function Panel({
  title,
  children,
  footnote,
  className = "",
}: {
  title?: string;
  children: ReactNode;
  footnote?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`rounded-md border border-rule bg-surface ${className}`}>
      {title && (
        <h2 className="border-b border-rule px-5 py-3 text-sm font-semibold tracking-tight">{title}</h2>
      )}
      <div className="px-5 py-4">{children}</div>
      {footnote && (
        <div className="border-t border-rule px-5 py-2 text-xs text-ink-muted">{footnote}</div>
      )}
    </section>
  );
}

/** Honest empty state: says exactly what is missing and when it arrives. */
export function EmptyState({
  title,
  children,
  milestone,
}: {
  title: string;
  children?: ReactNode;
  milestone?: string;
}) {
  return (
    <div className="rounded-md border border-dashed border-rule bg-surface px-6 py-10 text-center">
      <p className="font-serif text-xl font-semibold">{title}</p>
      {children && <div className="mx-auto mt-2 max-w-xl text-sm text-ink-muted">{children}</div>}
      {milestone && (
        <p className="mt-4 text-xs uppercase tracking-[0.12em] text-ink-muted">
          Planned in milestone <span className="figure text-ink">{milestone}</span>
        </p>
      )}
    </div>
  );
}

/** Mandatory label for any synthetic value shown during UI development. */
export function DemoBadge({ className = "" }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded border border-demo px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-demo ${className}`}
      title="Synthetic value for UI development. Not official data and not a model prediction."
    >
      Demo data
    </span>
  );
}

export type StatusTone = "ok" | "warn" | "down" | "unknown";

const TONE_CLASS: Record<StatusTone, string> = {
  ok: "border-ok text-ok",
  warn: "border-warn text-warn",
  down: "border-up text-up",
  unknown: "border-rule text-ink-muted",
};

const TONE_GLYPH: Record<StatusTone, string> = { ok: "●", warn: "▲", down: "■", unknown: "○" };

export function StatusPill({ tone, children }: { tone: StatusTone; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded border px-2 py-0.5 text-xs font-medium ${TONE_CLASS[tone]}`}
    >
      <span aria-hidden>{TONE_GLYPH[tone]}</span>
      {children}
    </span>
  );
}

export interface Provenance {
  source: string;
  detail: string;
  released: string;
}

/** A headline figure. Provenance is required, so no number appears without its source. */
export function StatTile({
  label,
  value,
  unit,
  change,
  provenance,
  demo = false,
}: {
  label: string;
  value: string;
  unit?: string;
  change?: { text: string; direction: "up" | "down" | "flat" };
  provenance: Provenance;
  demo?: boolean;
}) {
  const glyph = change?.direction === "up" ? "▲" : change?.direction === "down" ? "▼" : "–";
  const tone =
    change?.direction === "up" ? "text-up" : change?.direction === "down" ? "text-down" : "text-ink-muted";
  return (
    <div className="flex flex-col gap-2 rounded-md border border-rule bg-surface p-4">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink-muted">{label}</p>
        {demo && <DemoBadge />}
      </div>
      <p className="figure text-3xl font-medium tracking-tight">
        {value}
        {unit && <span className="ml-0.5 text-lg text-ink-muted">{unit}</span>}
      </p>
      {change && (
        <p className={`figure text-xs ${tone}`}>
          <span aria-hidden>{glyph}</span> {change.text}
        </p>
      )}
      <p className="mt-auto border-t border-rule pt-2 text-[11px] text-ink-muted">
        {provenance.source} · {provenance.detail} · released {provenance.released}
      </p>
    </div>
  );
}
