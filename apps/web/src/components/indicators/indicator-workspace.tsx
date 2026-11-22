"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HelpTip } from "@/components/guide/help-tip";
import { IndicatorDashboard } from "@/components/indicators/indicator-dashboard";
import { IipSectorPanel } from "@/components/indicators/iip-sector-panel";
import { formatPeriod, latestObservation } from "@/lib/indicator";
import type { IndicatorConfig } from "@/lib/indicators";
import { BASE_YEAR_NOTE, resolveOption, type SeriesRole } from "@/lib/series-options";
import type { SeriesBundle } from "@/lib/series-data";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const ROLE_LABEL: Record<SeriesRole, string> = { current: "Current", back: "Back series", legacy: "Legacy (closed)", archive: "Archive (closed)" };

function span(b: SeriesBundle) {
  if (!b.result.ok) return { first: null as string | null, last: null as string | null, months: 0 };
  const rows = b.result.data.observations.filter((o) => o.index !== null);
  return { first: rows[0]?.period ?? null, last: latestObservation(rows)?.period ?? null, months: rows.length };
}

/** Lets the visitor choose which official series (base year) to explore. The choice is `?base=` in the URL.
 *  Each series is a separate view: nothing is joined across base years. */
export function IndicatorWorkspace({ config, bundles }: { config: IndicatorConfig; bundles: SeriesBundle[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wanted = params?.get("base") ?? null;
  const { option: resolved } = resolveOption(config.key, wanted);
  const bundle = bundles.find((b) => b.option.id === resolved.id) ?? bundles[0];
  const missingWanted = wanted !== null && bundle.option.id !== wanted;
  const multiple = bundles.length > 1;

  const choose = (id: string) => {
    const p = new URLSearchParams(params?.toString() ?? "");
    if (id === bundles[0].option.id) p.delete("base");
    else p.set("base", id);
    const qs = p.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const o = bundle.option;
  const chips = config.chips.map((c) => (c.startsWith("Base year:") ? `Base year: ${o.baseYear}` : c));

  return (
    <div className="space-y-6">
      <ul aria-label="Dataset" className="flex flex-wrap gap-1.5">
        {chips.map((c) => (
          <li key={c} className="rounded border border-rule bg-surface px-2 py-0.5 text-xs text-ink-muted">
            {c}
          </li>
        ))}
      </ul>

      {missingWanted && (
        <p role="status" className="rounded border border-warn px-3 py-2 text-xs text-warn">
          The series &quot;{wanted}&quot; is not stored for {config.shortName}, so the primary series is shown.
        </p>
      )}

      {multiple && (
        <section aria-label="Choose the official series" data-tour="series-switch" className="rounded-md border border-rule bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="mr-2 text-sm font-semibold">
              Series (base year) <HelpTip id="base-year" />
            </h2>
            <div role="group" aria-label="Series (base year)" className="flex flex-wrap gap-2">
              {bundles.map((b) => (
                <button
                  key={b.option.id}
                  type="button"
                  aria-pressed={b.option.id === o.id}
                  onClick={() => choose(b.option.id)}
                  className={`rounded border px-3 py-1 text-sm ${focusRing} ${b.option.id === o.id ? "border-accent bg-accent text-accent-ink" : "border-rule hover:bg-bg"}`}
                >
                  {b.option.label}
                </button>
              ))}
            </div>
          </div>
          <p className="mt-3 text-sm">
            <span className="mr-2 rounded border border-rule px-1.5 py-0.5 text-[11px] font-medium uppercase tracking-wide text-ink-muted">{ROLE_LABEL[o.role]}</span>
            {o.note}
          </p>
          <p className="mt-2 text-xs text-ink-muted">{BASE_YEAR_NOTE}</p>
          <details className="mt-3 text-sm">
            <summary className={`cursor-pointer font-medium ${focusRing}`}>What is stored for each series</summary>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-xs">
                <caption className="sr-only">Stored official series for {config.shortName}</caption>
                <thead>
                  <tr className="border-b border-rule text-left">
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Series</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">First month</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Last month</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Months stored</th>
                    <th scope="col" className="py-1.5 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {bundles.map((b) => {
                    const s = span(b);
                    return (
                      <tr key={b.option.id} className="border-b border-rule last:border-b-0">
                        <th scope="row" className="py-1.5 pr-3 text-left font-medium">{b.option.label}</th>
                        <td className="py-1.5 pr-3">{s.first ? formatPeriod(s.first) : "—"}</td>
                        <td className="py-1.5 pr-3">{s.last ? formatPeriod(s.last) : "—"}</td>
                        <td className="figure py-1.5 pr-3 text-right">{s.months}</td>
                        <td className="py-1.5">{ROLE_LABEL[b.option.role]}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </details>
        </section>
      )}

      <IndicatorDashboard key={o.id} config={config} result={bundle.result} option={o}>
        {bundle.sectors && <IipSectorPanel result={bundle.sectors} />}
      </IndicatorDashboard>
    </div>
  );
}
