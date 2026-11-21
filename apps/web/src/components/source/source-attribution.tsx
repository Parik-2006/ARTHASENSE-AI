import type { ReactNode } from "react";
import { formatPeriod, formatTimestamp } from "@/lib/indicator";
import { CLASS_LABEL, type DataClass, NOT_PROVIDED, type SourceInfo } from "@/lib/source";

const CLASS_STYLE: Record<DataClass, string> = {
  official: "border-ok text-ok",
  calculated: "border-target text-target",
  forecast: "border-demo text-demo",
};
const CLASS_GLYPH: Record<DataClass, string> = { official: "●", calculated: "ƒ", forecast: "◆" };

export function ClassBadge({ cls }: { cls: DataClass }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[11px] font-medium ${CLASS_STYLE[cls]}`}>
      <span aria-hidden>{CLASS_GLYPH[cls]}</span>
      {CLASS_LABEL[cls]}
    </span>
  );
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="grid gap-0.5 sm:grid-cols-[11rem_1fr] sm:gap-3">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  );
}

/** Compact, always-visible source strip plus an expandable details panel (native <details>: works without JS).
 *  Pass several `sources` for multi-source charts; each contributing source is listed. */
export function SourceAttribution({
  cls,
  sources,
  period,
  units,
  method,
  note,
  retrievedAt,
  className = "",
}: {
  cls: DataClass;
  sources: SourceInfo[];
  /** Observation / forecast period text, already formatted */
  period: string;
  units?: string;
  /** How a calculated / forecast value was produced */
  method?: string;
  note?: ReactNode;
  /** Overrides the retrieval time shown on the strip (default: latest of the sources) */
  retrievedAt?: string | null;
  className?: string;
}) {
  const retrieved =
    retrievedAt ??
    ([...sources.map((s) => s.retrievedAt)].filter((x): x is string => !!x).sort().pop() ?? null);
  const bases = [...new Set(sources.map((s) => s.baseYear).filter((x): x is string => !!x))];
  return (
    <div className={`text-xs text-ink-muted ${className}`} data-testid="source-attribution">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="font-medium text-ink">Source:</span>
        <span>{sources.map((s) => s.short).join(" + ") || "Source information unavailable"}</span>
        <ClassBadge cls={cls} />
        <span>· {period}</span>
        {bases.length > 0 && <span>· Base {bases.join(" / ")}</span>}
        {units && <span>· {units}</span>}
        <span>· {retrieved ? `retrieved ${formatTimestamp(retrieved)}` : "retrieval time unavailable"}</span>
      </p>
      {method && <p className="mt-1">Method: {method}</p>}
      <details className="mt-1 group">
        <summary className="inline-flex cursor-pointer select-none items-center gap-1 rounded text-accent underline focus-visible:outline-2 focus-visible:outline-accent">
          Source details
        </summary>
        <div className="mt-2 space-y-4 rounded-md border border-rule bg-bg p-3 text-ink">
          {sources.length === 0 && <p>Source information unavailable.</p>}
          {sources.map((s) => (
            <dl key={`${s.short}-${s.baseYear}`} className="space-y-1.5">
              <Row k="Publisher">{s.publisher}</Row>
              <Row k="Dataset">{s.dataset}</Row>
              <Row k="Source URL">{s.url ?? "Source URL unavailable"}</Row>
              <Row k="Access channel">{s.channel}</Row>
              <Row k="Coverage">{s.coverage ?? "Unavailable"}</Row>
              <Row k="Base year">{s.baseYear ?? "Unavailable"}</Row>
              <Row k="Official release date">
                {s.publishedAt ? formatTimestamp(s.publishedAt) : `Release date not provided. ${NOT_PROVIDED}.`}
              </Row>
              <Row k="Retrieved by ArthaSense">
                {s.retrievedAt ? formatTimestamp(s.retrievedAt) : "Unavailable"}
                {s.snapshots > 0 && ` (${s.snapshots} stored snapshot${s.snapshots === 1 ? "" : "s"})`}
              </Row>
              <Row k="Series identifier">Not included in the API response</Row>
              <Row k="Revision status">{s.revision}</Row>
              {s.limitations.length > 0 && (
                <Row k="Limitations">
                  <ul className="list-disc pl-4">
                    {s.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </Row>
              )}
            </dl>
          ))}
          <dl className="space-y-1.5 border-t border-rule pt-3">
            <Row k="Classification">{CLASS_LABEL[cls]}</Row>
            <Row k="Period shown">{period}</Row>
            {method && <Row k="Calculation / model">{method}</Row>}
            {cls === "forecast" && <Row k="Note">Not an official forecast. Official data was used as model input only.</Row>}
            {note && <Row k="Notes">{note}</Row>}
          </dl>
        </div>
      </details>
    </div>
  );
}

/** "Mar 2023 – Oct 2026" from period strings; "No observations" when empty. */
export function periodSpan(first: string | null, last: string | null): string {
  if (!first || !last) return "no observations";
  return first === last ? formatPeriod(first, true) : `${formatPeriod(first)} – ${formatPeriod(last)}`;
}
