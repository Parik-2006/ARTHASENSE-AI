import { formatTimestamp } from "@/lib/indicator";
import { CLASS_LABEL, type SourceItem } from "@/lib/provenance";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const NP = "Not provided by the source";

const tone = {
  official: "border-accent text-accent",
  calculated: "border-warn text-warn",
  model: "border-demo text-demo",
} as const;

/** Mandatory provenance block for any chart, table or statistic. The summary line always shows
 *  publisher, class, period, base year and retrieval time; "View source" reveals the full record.
 *  Multi-source visuals pass several items and every one is listed. */
export function SourceAttribution({ items, className = "" }: { items: SourceItem[]; className?: string }) {
  if (items.length === 0) {
    return <p className={`text-xs text-warn ${className}`}>Source metadata is unavailable for this view.</p>;
  }
  return (
    <div className={`space-y-1 text-xs text-ink-muted ${className}`} data-testid="source-attribution">
      {items.map((s) => (
        <details key={`${s.label}-${s.seriesId}-${s.classification}`}>
          <summary className={`flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 ${focusRing}`}>
            <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${tone[s.classification]}`}>
              {CLASS_LABEL[s.classification]}
            </span>
            <span>
              {s.label}: {s.publisher}
              {s.period ? ` · ${s.period}` : ""}
              {s.baseYear ? ` · base ${s.baseYear}` : ""}
              {" · retrieved "}
              {s.retrievedAt ? formatTimestamp(s.retrievedAt) : "unknown"}
            </span>
            <span className="text-accent underline">View source</span>
          </summary>
          <dl className="mt-2 grid gap-x-4 gap-y-1 rounded border border-rule bg-bg p-3 sm:grid-cols-[10rem_1fr]">
            <dt>Publisher</dt>
            <dd className="text-ink">{s.publisher}</dd>
            <dt>Dataset</dt>
            <dd className="text-ink">{s.dataset}</dd>
            <dt>Access channel</dt>
            <dd className="text-ink">{s.accessChannel}</dd>
            <dt>Publisher dataset page</dt>
            <dd>Not recorded by ArthaSense</dd>
            <dt>Series identifier</dt>
            <dd className="figure break-all text-ink">{s.seriesId ?? NP}</dd>
            <dt>Coverage</dt>
            <dd className="text-ink">{s.coverage ?? NP}</dd>
            <dt>Base year / units</dt>
            <dd className="text-ink">
              {s.baseYear ?? "—"} · {s.units ?? "—"}
            </dd>
            <dt>Reporting period</dt>
            <dd className="text-ink">{s.period ?? "—"}</dd>
            <dt>Publication date</dt>
            <dd>{s.publishedAt ? formatTimestamp(s.publishedAt) : NP}</dd>
            <dt>Retrieved</dt>
            <dd className="text-ink">
              {s.retrievedAt ? formatTimestamp(s.retrievedAt) : "Unknown"} (our download time)
            </dd>
            <dt>Revisions</dt>
            <dd>Provisional or final status is not provided; each retrieval is kept as a snapshot.</dd>
            {s.formula && (
              <>
                <dt>Calculation</dt>
                <dd className="text-ink">{s.formula}</dd>
              </>
            )}
            {s.limitations.length > 0 && (
              <>
                <dt>Limitations</dt>
                <dd>
                  <ul className="list-disc pl-4">
                    {s.limitations.map((l) => (
                      <li key={l}>{l}</li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        </details>
      ))}
    </div>
  );
}
