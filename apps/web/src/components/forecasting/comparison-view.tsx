"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { Tour, TourButton } from "@/components/guide/tour";
import { Panel } from "@/components/ui/primitives";
import { COMPARISON_TOUR } from "@/lib/guide";
import {
  type Comparison,
  type ComparisonGroup,
  comparisonToCsv,
  fmtMetric,
  HORIZONS,
  INDICATOR_IDS,
  INDICATOR_NAMES,
  type IndicatorId,
  loadErrorText,
  METRIC_LABELS,
  monthLabel,
} from "@/lib/forecasting";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const selectClass = `rounded border border-rule bg-surface px-2 py-1.5 text-sm ${focusRing}`;
const TABLE_METRICS = ["mae", "rmse", "mase", "smape", "coverage_80", "coverage_95"] as const;
const BAR_METRICS = ["mae", "rmse", "mase", "smape"] as const;

export type ComparisonMap = Record<string, Comparison | null>; // key `${indicator}-${horizon}`

function Bars({ group, metric }: { group: ComparisonGroup; metric: string }) {
  const rows = group.models.filter((m) => m.metrics[metric] !== undefined);
  const max = Math.max(...rows.map((m) => m.metrics[metric]), 1e-9);
  return (
    <ul className="space-y-2" aria-label={`${METRIC_LABELS[metric]} by model (lower is better)`}>
      {rows.map((m) => (
        <li key={m.model} className="grid grid-cols-[8rem_1fr_4.5rem] items-center gap-3 text-sm">
          <span className="truncate">{m.model_name}</span>
          <span className="h-3 rounded-sm bg-bg" aria-hidden>
            <span
              className={`block h-3 rounded-sm ${m.is_baseline ? "bg-ink-muted" : "bg-accent"}`}
              style={{ width: `${Math.max(2, (m.metrics[metric] / max) * 100)}%` }}
            />
          </span>
          <span className="figure text-right">{fmtMetric(metric, m.metrics[metric])}</span>
        </li>
      ))}
    </ul>
  );
}

export function ComparisonView({ data, apiError = "" }: { data: ComparisonMap; apiError?: string }) {
  // Indicator, horizon and evaluation set live in the URL (?indicator=&horizon=&set=) so the view can be shared.
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const indParam = params?.get("indicator") ?? "";
  const indicator: IndicatorId = (INDICATOR_IDS as string[]).includes(indParam) ? (indParam as IndicatorId) : "wpi";
  const hParam = Number(params?.get("horizon"));
  const horizon: number = (HORIZONS as readonly number[]).includes(hParam) ? hParam : 1;
  const groupIdx = Math.max(0, Math.floor(Number(params?.get("set"))) || 0);
  const setView = (patch: { indicator?: string; horizon?: number; set?: number }) => {
    const p = new URLSearchParams();
    p.set("indicator", patch.indicator ?? indicator);
    p.set("horizon", String(patch.horizon ?? horizon));
    if (patch.set) p.set("set", String(patch.set));
    router.push(`${pathname}?${p.toString()}`, { scroll: false });
  };
  const isDefault = !params || [...params.keys()].length === 0;
  const [barMetric, setBarMetric] = useState<string>("mae");
  const cmp = data[`${indicator}-${horizon}`] ?? null;
  const group = cmp?.groups[Math.min(groupIdx, Math.max(0, (cmp?.groups.length ?? 1) - 1))];

  const download = () => {
    if (!group) return;
    const url = URL.createObjectURL(new Blob([comparisonToCsv(group)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `comparison-${indicator}-h${horizon}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <Tour steps={COMPARISON_TOUR} />
      <div data-tour="fc-filters" className="flex flex-wrap items-end gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">Indicator</span>
          <select aria-label="Indicator" className={selectClass} value={indicator} onChange={(e) => setView({ indicator: e.target.value, set: 0 })}>
            {INDICATOR_IDS.map((i) => (
              <option key={i} value={i}>{INDICATOR_NAMES[i]}</option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-ink-muted">Forecast horizon</span>
          <select aria-label="Forecast horizon" className={selectClass} value={horizon} onChange={(e) => setView({ horizon: Number(e.target.value), set: 0 })}>
            {HORIZONS.map((h) => (
              <option key={h} value={h}>{h} month{h > 1 ? "s" : ""} ahead</option>
            ))}
          </select>
        </label>
        {cmp && cmp.groups.length > 1 && (
          <label className="text-sm">
            <span className="mb-1 block text-ink-muted">Evaluation set</span>
            <select className={selectClass} value={groupIdx} onChange={(e) => setView({ set: Number(e.target.value) })}>
              {cmp.groups.map((g, i) => (
                <option key={g.group_id} value={i}>
                  {g.models.length} models, {g.n_origins} origins{g.evaluation_start ? `, ${monthLabel(g.evaluation_start)} to ${monthLabel(g.evaluation_end ?? g.evaluation_start)}` : ""}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" onClick={() => router.push(pathname, { scroll: false })} disabled={isDefault} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-40 ${focusRing}`}>
          Reset filters
        </button>
        <TourButton className={`rounded border border-accent px-3 py-1.5 text-sm text-accent hover:bg-bg ${focusRing}`}>Take a Tour</TourButton>
        <Link href={`/forecasting/${indicator}`} className="pb-1.5 text-sm text-accent underline">{indicator.toUpperCase()} forecast explorer →</Link>
        <Link href={`/forecasting/experiments?indicator=${indicator}&horizon=${horizon}`} className="pb-1.5 text-sm text-accent underline">Experiments →</Link>
      </div>

      {!cmp ? (
        <Panel title="Comparison">
          <p role="alert" className="text-sm text-up">{loadErrorText("the comparison", apiError)}</p>
        </Panel>
      ) : !group ? (
        <Panel title="Comparison">
          <p className="text-sm text-ink-muted">
            No completed backtest exists for {INDICATOR_NAMES[indicator]} at a {horizon}-month horizon, so there is
            nothing to compare. {indicator === "cpi" ? "The CPI Current series has only 12 monthly observations, which is too short to evaluate." : ""}
          </p>
          <Excluded cmp={cmp} />
        </Panel>
      ) : (
        <>
          <Panel
            title={`${INDICATOR_NAMES[indicator]}: ${horizon}-month-ahead accuracy`}
            footnote={<span data-tour="fc-baseline">Lower is better for MAE, RMSE, MASE and sMAPE. MASE is scaled by one-step changes in the training data, so longer horizons naturally score higher. Coverage should be near its nominal level (80% or 95%); a narrow interval is not a better one. Models are compared only on identical origins <HelpTip id="model-comparison" />, MAE <HelpTip id="mae" />, coverage <HelpTip id="coverage" />. The naive baseline repeats the latest value; a more complex model is useful only if it beats it.</span>}
          >
            <div className="-mt-1 mb-3 flex flex-wrap items-center justify-between gap-2 text-sm text-ink-muted">
              <p>
                {group.n_origins} backtest origins
                {group.evaluation_start ? `, targets ${monthLabel(group.evaluation_start, true)} to ${monthLabel(group.evaluation_end ?? group.evaluation_start, true)}` : ""}. Baseline: Naive.
              </p>
              <button type="button" onClick={download} className={`rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg ${focusRing}`}>
                Download CSV
              </button>
            </div>
            {group.warnings.length > 0 && (
              <ul className="mb-3 space-y-1 rounded border border-warn px-3 py-2 text-xs text-warn" role="note">
                {group.warnings.map((w) => <li key={w}>{w}</li>)}
              </ul>
            )}
            <div data-tour="fc-table" className="overflow-x-auto">
              <table className="w-full min-w-[40rem] text-sm">
                <caption className="sr-only">Backtest accuracy by model on identical forecast origins</caption>
                <thead>
                  <tr className="border-b border-rule text-left text-xs">
                    <th scope="col" className="py-2 pr-4 font-semibold">Model</th>
                    {TABLE_METRICS.map((k) => (
                      <th key={k} scope="col" className="py-2 pr-4 text-right font-semibold">{METRIC_LABELS[k]}</th>
                    ))}
                    <th scope="col" className="py-2 pr-4 text-right font-semibold">MAE vs naive</th>
                    <th scope="col" className="py-2 text-right font-semibold">Runtime</th>
                  </tr>
                </thead>
                <tbody>
                  {group.models.map((m) => (
                    <tr key={m.model} className="border-b border-rule last:border-b-0">
                      <th scope="row" className="py-2 pr-4 text-left font-medium">
                        {m.model_name}
                        {m.is_baseline && <span className="ml-2 rounded border border-rule px-1.5 text-[10px] uppercase tracking-wide text-ink-muted">baseline</span>}
                      </th>
                      {TABLE_METRICS.map((k) => {
                        const best = group.best[k] === m.model;
                        return (
                          <td key={k} className={`figure py-2 pr-4 text-right ${best ? "font-semibold text-ok" : ""}`}>
                            {fmtMetric(k, m.metrics[k])}
                            {best && <span className="sr-only"> (lowest error)</span>}
                          </td>
                        );
                      })}
                      <td className="figure py-2 pr-4 text-right">
                        {m.vs_baseline_mae_pct === null ? "—" : `${m.vs_baseline_mae_pct > 0 ? "+" : ""}${m.vs_baseline_mae_pct.toFixed(1)}%`}
                      </td>
                      <td className="figure py-2 text-right">{m.runtime_seconds === null ? "—" : `${m.runtime_seconds.toFixed(1)} s`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 text-xs text-ink-muted">
              {group.rankable
                ? "Green marks the lowest error among models on identical data and origins. This is not a significance test."
                : "No model is highlighted: this evaluation set is too small (or has a single model) to rank fairly."}{" "}
              “—” means unavailable (for example intervals that could not be calibrated).
            </p>
          </Panel>

          <Panel title="Error by model">
            <label className="mb-3 block text-sm">
              <span className="mr-2 text-ink-muted">Metric</span>
              <select className={selectClass} value={barMetric} onChange={(e) => setBarMetric(e.target.value)}>
                {BAR_METRICS.map((k) => <option key={k} value={k}>{METRIC_LABELS[k]}</option>)}
              </select>
            </label>
            <Bars group={group} metric={barMetric} />
          </Panel>
          <Panel title="Models not compared">
            <Excluded cmp={cmp} />
            <p className="mt-2 text-xs text-ink-muted">{cmp.note}</p>
          </Panel>
        </>
      )}
    </div>
  );
}

function Excluded({ cmp }: { cmp: Comparison }) {
  if (cmp.excluded.length === 0) return <p className="text-sm text-ink-muted">Every stored model was compared.</p>;
  return (
    <ul className="space-y-1 text-sm">
      {cmp.excluded.map((e) => (
        <li key={e.model}>
          <span className="font-medium">{e.model_name}</span> <span className="text-ink-muted">excluded: {e.reason}</span>
        </li>
      ))}
    </ul>
  );
}
