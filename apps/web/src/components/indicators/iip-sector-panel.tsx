"use client";

import { useMemo, useState } from "react";
import { TrendChart } from "@/components/indicators/indicator-dashboard";
import { Panel } from "@/components/ui/primitives";
import {
  formatIndex,
  formatPercent,
  formatPeriod,
  latestObservation,
  withMomChange,
} from "@/lib/indicator";
import type { IipSectorsResult } from "@/lib/iip-sectors";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Sector totals (Mining, Manufacturing, Electricity, ...). Shows only what is stored. */
export function IipSectorPanel({ result }: { result: IipSectorsResult }) {
  const [selected, setSelected] = useState<string | null>(null);
  const sectors = useMemo(() => (result.ok ? result.data.sectors.filter((s) => s.observations.length > 0) : []), [result]);
  const active = sectors.find((s) => s.key === selected) ?? sectors[0];
  const rows = useMemo(() => (active ? withMomChange(active.observations) : []), [active]);

  if (!result.ok) {
    return (
      <Panel title="Industrial breakdown">
        <p role="alert" className="text-sm text-up">
          Unable to load the sector breakdown. Please check the API connection.
        </p>
      </Panel>
    );
  }
  if (sectors.length === 0) {
    return (
      <Panel title="Industrial breakdown">
        <p className="text-sm text-ink-muted">No sector observations have been imported yet.</p>
      </Panel>
    );
  }
  const base = result.data.baseYear;
  return (
    <Panel
      title="Industrial breakdown"
      footnote="Sector totals as published by MoSPI. Each sector has its own index level; levels are not additive and not comparable between sectors."
    >
      <div role="group" aria-label="Sector" className="mb-4 flex flex-wrap gap-2">
        {sectors.map((s) => (
          <button
            key={s.key}
            type="button"
            aria-pressed={active?.key === s.key}
            onClick={() => setSelected(s.key)}
            className={`rounded border px-3 py-1 text-sm ${focusRing} ${
              active?.key === s.key ? "border-accent bg-accent text-accent-ink" : "border-rule hover:bg-bg"
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>
      {active && (
        <>
          <p className="mb-2 text-sm font-medium">{active.label} · index (base {base} = 100)</p>
          <TrendChart rows={rows} axisLabel={`${active.label} index`} name={`${active.label} index`} />
        </>
      )}
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[30rem] text-sm">
          <caption className="sr-only">Latest stored value for each IIP sector</caption>
          <thead>
            <tr className="border-b border-rule text-left text-xs">
              <th scope="col" className="py-2 pr-4 font-semibold">Sector</th>
              <th scope="col" className="py-2 pr-4 font-semibold">Latest period</th>
              <th scope="col" className="py-2 pr-4 text-right font-semibold">Index</th>
              <th scope="col" className="py-2 text-right font-semibold">YoY growth (official)</th>
            </tr>
          </thead>
          <tbody>
            {sectors.map((s) => {
              const latest = latestObservation(s.observations);
              return (
                <tr key={s.key} className="border-b border-rule last:border-b-0">
                  <th scope="row" className="py-2 pr-4 text-left font-medium">{s.label}</th>
                  <td className="py-2 pr-4">{latest ? formatPeriod(latest.period, true) : "—"}</td>
                  <td className="figure py-2 pr-4 text-right">{formatIndex(latest?.index ?? null)}</td>
                  <td className="figure py-2 text-right">
                    {latest?.rate == null ? <span className="text-ink-muted">—</span> : formatPercent(latest.rate, true)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}
