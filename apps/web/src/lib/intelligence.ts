/** Deterministic, template-based statements about stored data. No language model, no generation:
 *  every sentence is filled from numbers that exist in the database, or it is not produced. */

import { type Comparison, fmt, type ForecastRow, methodLabel, monthLabel, type Run, type Statement, withArticle } from "@/lib/forecasting";
import { formatPercent, formatPeriod, latestObservation, latestRate, monthNumber, type Row } from "@/lib/indicator";

function direction(pct: number): string {
  if (Math.abs(pct) < 0.005) return "unchanged";
  return pct > 0 ? "higher" : "lower";
}

/** Observed / derived statements for one indicator. `rows` are chronological with MoM already computed. */
export function observedStatements(name: string, baseYear: string, rows: Row[], rateLabel: string | null): Statement[] {
  const latest = latestObservation(rows);
  if (!latest) return [];
  const out: Statement[] = [
    { kind: "observed", text: `${name} was ${fmt(latest.index)} in ${formatPeriod(latest.period, true)} (index, base ${baseYear} = 100).` },
  ];
  const row = rows.find((r) => r.period === latest.period);
  if (row && row.mom !== null) {
    out.push({
      kind: "derived",
      text: `The index is ${Math.abs(row.mom).toFixed(2)}% ${row.mom > 0 ? "above" : row.mom < 0 ? "below" : "equal to"} the previous month (calculated from consecutive stored months; not an official rate).`,
    });
  } else {
    out.push({ kind: "derived", text: "No month-over-month change is shown because the previous calendar month is not stored." });
  }
  const yearAgo = rows.find((r) => monthNumber(r.period) === monthNumber(latest.period) - 12 && r.index !== null);
  if (yearAgo && yearAgo.index !== null && latest.index !== null && yearAgo.index !== 0) {
    const pct = (latest.index / yearAgo.index - 1) * 100;
    out.push({
      kind: "derived",
      text: `The index is ${Math.abs(pct).toFixed(2)}% ${direction(pct)} than in ${formatPeriod(yearAgo.period, true)} (derived from stored index values, not an official rate).`,
    });
  } else {
    out.push({ kind: "derived", text: "No same-month-last-year comparison is possible because that month is not stored." });
  }
  const rate = latestRate(rows);
  if (rateLabel && rate && rate.rate !== null) {
    out.push({ kind: "observed", text: `Official ${rateLabel} reported by MoSPI for ${formatPeriod(rate.period, true)}: ${formatPercent(rate.rate, true)}.` });
  }
  return out;
}

/** One sentence about a stored forecast, always naming model and origin, plus an honest accuracy caveat. */
export function forecastStatements(args: {
  name: string;
  modelName: string;
  latestIndex: number | null;
  items: ForecastRow[];
  horizon: number;
  run: Run | null;
  beatsNaive: boolean | null;
  backtestOrigins: number | null;
}): Statement[] {
  const { name, modelName, latestIndex, items, horizon, run, beatsNaive, backtestOrigins } = args;
  const rows = items.filter((i) => (i.step ?? 0) <= horizon);
  const last = rows[rows.length - 1];
  if (!last || latestIndex === null || latestIndex === 0 || !run) return [];
  const origin = last.origin_date ? monthLabel(last.origin_date, true) : "the latest observation";
  const pct = (last.forecast / latestIndex - 1) * 100;
  const out: Statement[] = [
    {
      kind: "forecast",
      text: `${modelName} (forecast origin ${origin}) predicts ${withArticle(name)} index of ${fmt(last.forecast)} for ${monthLabel(last.target_date, true)}, ${Math.abs(pct).toFixed(2)}% ${direction(pct)} than the latest observed value.`,
    },
  ];
  if (last.lower_80 !== null && last.upper_80 !== null) {
    out.push({ kind: "forecast", text: `Its 80% interval (${methodLabel(last.interval_method)}) for that month is ${fmt(last.lower_80)} to ${fmt(last.upper_80)}. Backtest coverage can differ from the nominal level.` });
  } else {
    out.push({ kind: "forecast", text: "This model supplied no prediction interval for that month." });
  }
  if (beatsNaive === true) out.push({ kind: "forecast", text: `In backtests at this horizon its mean absolute error was lower than the naive baseline's on the same data and origins${backtestOrigins ? ` (${backtestOrigins} origins)` : ""}.` });
  else if (beatsNaive === false) out.push({ kind: "forecast", text: `In backtests at this horizon it did NOT beat the naive baseline${backtestOrigins ? ` (${backtestOrigins} origins)` : ""}: treat this forecast with caution.` });
  else out.push({ kind: "forecast", text: "No like-for-like comparison with the naive baseline is stored for this horizon." });
  if (backtestOrigins !== null && backtestOrigins < 12) out.push({ kind: "forecast", text: `Only ${backtestOrigins} backtest origins exist, so the accuracy estimate is indicative.` });
  return out;
}

export function mae(c: Comparison | null, model: string): number | null {
  const g = c?.groups.find((x) => x.models.some((m) => m.model === model));
  return g?.models.find((m) => m.model === model)?.metrics.mae ?? null;
}
