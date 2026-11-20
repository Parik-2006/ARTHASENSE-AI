"use client";

import { useState } from "react";
import { Panel } from "@/components/ui/primitives";
import { fmt, hypotheticalPath, monthLabel } from "@/lib/forecasting";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export interface ScenarioStart {
  id: string;
  name: string;
  index: number;
  period: string; // last observed month, YYYY-MM-01
}

function addMonths(period: string, k: number): string {
  const [y, m] = period.split("-").map(Number);
  const n = y * 12 + (m - 1) + k;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;
}

/** Pure compounding arithmetic from the latest stored value. It is NOT a forecast and implies no causal claim. */
export function ScenarioCalculator({ starts }: { starts: ScenarioStart[] }) {
  const [id, setId] = useState(starts[0]?.id ?? "");
  const [pct, setPct] = useState("0.5");
  const [months, setMonths] = useState("6");
  if (starts.length === 0) {
    return (
      <Panel title="Hypothetical scenario">
        <p className="text-sm text-ink-muted">No stored index is available to start from.</p>
      </Panel>
    );
  }
  const start = starts.find((s) => s.id === id) ?? starts[0];
  const p = Number(pct);
  const n = Number(months);
  const valid = Number.isFinite(p) && Math.abs(p) <= 10 && Number.isInteger(n) && n >= 1 && n <= 12;
  const path = valid ? hypotheticalPath(start.index, p, n) : [];
  return (
    <Panel
      title="Hypothetical scenario"
      footnote="Illustrative arithmetic only: the index is compounded at a constant monthly rate that YOU choose. It is not a forecast, not an official projection, and says nothing about what would cause such a change."
    >
      <div className="mb-4 flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">Start from</span>
          <select className={`rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`} value={start.id} onChange={(e) => setId(e.target.value)}>
            {starts.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">Assumed monthly change (%)</span>
          <input type="number" step="0.1" min="-10" max="10" value={pct} onChange={(e) => setPct(e.target.value)} className={`w-28 rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">Months (1 to 12)</span>
          <input type="number" step="1" min="1" max="12" value={months} onChange={(e) => setMonths(e.target.value)} className={`w-24 rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`} />
        </label>
      </div>
      {!valid ? (
        <p role="alert" className="text-sm text-warn">Enter a monthly change between -10 and 10 and a whole number of months from 1 to 12.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[24rem] text-sm">
            <caption className="sr-only">Hypothetical index path</caption>
            <thead>
              <tr className="border-b border-rule text-left text-xs">
                <th scope="col" className="py-2 pr-4 font-semibold">Month</th>
                <th scope="col" className="py-2 text-right font-semibold">Hypothetical index</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-rule">
                <th scope="row" className="py-1.5 pr-4 text-left font-medium">{monthLabel(start.period)} (observed)</th>
                <td className="figure py-1.5 text-right">{fmt(start.index)}</td>
              </tr>
              {path.map((v, i) => (
                <tr key={i} className="border-b border-rule last:border-b-0">
                  <th scope="row" className="py-1.5 pr-4 text-left font-normal text-ink-muted">{monthLabel(addMonths(start.period, i + 1))} (hypothetical)</th>
                  <td className="figure py-1.5 text-right">{fmt(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
