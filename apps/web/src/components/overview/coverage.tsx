import Link from "next/link";
import { formatPeriod, formatTimestamp } from "@/lib/indicator";
import type { IndicatorBundle } from "@/lib/overview-data";
import { coverage } from "@/lib/overview";

function status(b: IndicatorBundle, count: number, missing: number): string {
  if (b.error) return "Retrieval failed";
  if (count === 0) return "No observations";
  const notes: string[] = [];
  if (count < 24) notes.push("Limited history");
  if (missing) notes.push(`${missing} missing month${missing === 1 ? "" : "s"}`);
  return notes.length ? notes.join("; ") : "No gaps in stored span";
}

/** Freshness is about the data, not the server: "API reachable" is never shown as "data is current". */
export function CoveragePanel({ bundles }: { bundles: IndicatorBundle[] }) {
  return (
    <section id="coverage" data-tour="coverage" aria-labelledby="coverage-h" className="mt-10 scroll-mt-20">
      <h2 id="coverage-h" className="font-serif text-2xl font-semibold tracking-tight">Data coverage &amp; freshness</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">
        What is stored for each indicator. The latest observation month is the official reference period, not the day we fetched it. Retrieval time and release date are different things.
      </p>
      <div className="relative mt-4 overflow-x-auto rounded-md border border-rule bg-surface" role="region" aria-label="Data coverage table, scrollable" tabIndex={0}>
        <table className="w-full min-w-[56rem] text-left text-sm">
          <thead className="border-b border-rule text-xs text-ink-muted">
            <tr>
              {["Indicator", "Earliest", "Latest", "Months stored", "Months in span", "Missing", "Base year", "Publisher", "Last retrieved", "Official release date", "Status"].map((h) => (
                <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bundles.map((b) => {
              const seg = b.segments[0];
              const c = coverage(seg?.observations ?? []);
              return (
                <tr key={b.key} className="border-b border-rule last:border-0 align-top">
                  <th scope="row" className="px-3 py-2 font-medium">
                    <Link href={b.path} className="text-accent underline">{b.shortName}</Link>
                  </th>
                  <td className="px-3 py-2">{c.first ? formatPeriod(c.first) : "—"}</td>
                  <td className="px-3 py-2">{c.last ? formatPeriod(c.last) : "—"}</td>
                  <td className="figure px-3 py-2">{c.count}</td>
                  <td className="figure px-3 py-2">{c.expected}</td>
                  <td className="px-3 py-2">{c.missing.length ? c.missing.join(", ") : "None"}</td>
                  <td className="px-3 py-2">{seg?.baseYear ?? "—"}</td>
                  <td className="px-3 py-2">{b.source.short}</td>
                  <td className="px-3 py-2">{b.source.retrievedAt ? formatTimestamp(b.source.retrievedAt) : "—"}</td>
                  <td className="px-3 py-2">{b.source.publishedAt ? formatTimestamp(b.source.publishedAt) : "Release date not provided"}</td>
                  <td className="px-3 py-2">{status(b, c.count, c.missing.length)}</td>
                </tr>
              );
            })}
            {[
              ["GDP", "Planned: not yet ingested"],
              ["Repo rate", "Planned: not yet ingested"],
            ].map(([name, s]) => (
              <tr key={name} className="border-b border-rule text-ink-muted last:border-0">
                <th scope="row" className="px-3 py-2 font-medium">{name}</th>
                <td colSpan={9} className="px-3 py-2">No data stored</td>
                <td className="px-3 py-2">{s}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Calculated from the stored observations shown above. Older base-year or back series, if the API holds any, are listed in each chart&apos;s base-year selector rather than merged here.
      </p>
    </section>
  );
}
