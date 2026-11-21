/** Deterministic, template-based insights. Each sentence is filled from stored observations or not produced.
 *  No causal claims, no predictions. */

import { formatPeriod } from "@/lib/indicator";
import type { IndicatorBundle } from "@/lib/overview-data";
import { coverage, derive, fmtPct } from "@/lib/overview";
import type { DataClass } from "@/lib/source";

export interface Insight {
  id: string;
  indicator: IndicatorBundle["key"];
  headline: string;
  text: string;
  evidence: string;
  period: string | null;
  cls: DataClass;
  method: string;
}

function direction(pct: number, up: string, down: string, flat: string): string {
  return Math.abs(pct) < 0.005 ? flat : pct > 0 ? up : down;
}

/** Mean of the index over `count` consecutive months ending at n; null if any month is missing. */
function meanEndingAt(byN: Map<number, number | null>, n: number, count: number): number | null {
  let sum = 0;
  for (let i = 0; i < count; i++) {
    const v = byN.get(n - i);
    if (v === null || v === undefined) return null;
    sum += v;
  }
  return sum / count;
}

export function buildInsights(bundle: IndicatorBundle): Insight[] {
  const seg = bundle.segments[0];
  const name = bundle.shortName;
  if (!seg) return [];
  const rows = derive(seg.observations);
  const valid = rows.filter((r) => r.index !== null);
  if (!valid.length) return [];
  const latest = valid[valid.length - 1];
  const out: Insight[] = [];
  const when = formatPeriod(latest.period, true);

  if (latest.mom !== null) {
    const prev = rows.find((r) => r.n === latest.n - 1)!;
    out.push({
      id: `${bundle.key}-mom`,
      indicator: bundle.key,
      headline: `${name} ${direction(latest.mom, "rose", "fell", "was unchanged")} from the previous month`,
      text: `The ${name} index in ${when} is ${Math.abs(latest.mom).toFixed(2)}% ${direction(latest.mom, "above", "below", "equal to")} the level in ${formatPeriod(prev.period, true)}.`,
      evidence: `${prev.index!.toFixed(2)} → ${latest.index!.toFixed(2)} (${fmtPct(latest.mom)})`,
      period: latest.period,
      cls: "calculated",
      method: "Month-over-month % = ((current index ÷ previous month index) − 1) × 100, from consecutive stored months of one base year.",
    });
  } else {
    out.push({
      id: `${bundle.key}-mom-na`,
      indicator: bundle.key,
      headline: `No month-over-month change for ${name}`,
      text: `The previous calendar month before ${when} is not stored, so no monthly change is calculated.`,
      evidence: "Previous month: not stored",
      period: latest.period,
      cls: "calculated",
      method: "A change is calculated only between consecutive stored months.",
    });
  }

  if (bundle.rateKind) {
    const rated = [...rows].reverse().find((r) => r.rate !== null);
    const word = bundle.rateKind === "inflation" ? "inflation" : "industrial growth";
    if (rated && rated.rate !== null) {
      out.push({
        id: `${bundle.key}-rate`,
        indicator: bundle.key,
        headline: `Official ${name} ${word} is ${direction(rated.rate, "positive", "negative", "zero")}`,
        text: `MoSPI reports a year-on-year ${word} figure of ${fmtPct(rated.rate)} for ${formatPeriod(rated.period, true)}. Whether that is good or bad depends on context.`,
        evidence: `Official year-on-year: ${fmtPct(rated.rate)}`,
        period: rated.period,
        cls: "official",
        method: "Published value, shown exactly as stored; ArthaSense does not recompute it.",
      });
    } else {
      out.push({
        id: `${bundle.key}-rate-na`,
        indicator: bundle.key,
        headline: `Official ${name} ${word} is unavailable`,
        text: `No official year-on-year ${word} figure is stored for ${name}, so none is shown or estimated here.`,
        evidence: "Stored official rate observations: 0",
        period: null,
        cls: "official",
        method: bundle.rateMissingText,
      });
    }
  }

  const byN = new Map(rows.map((r) => [r.n, r.index]));
  const a = meanEndingAt(byN, latest.n, 3);
  const b = meanEndingAt(byN, latest.n - 3, 3);
  if (a !== null && b !== null && b !== 0) {
    const pct = (a / b - 1) * 100;
    out.push({
      id: `${bundle.key}-avg3`,
      indicator: bundle.key,
      headline: `Recent 3-month average ${direction(pct, "is above", "is below", "matches")} the 3 months before`,
      text: `The average ${name} index over the three months to ${when} is ${Math.abs(pct).toFixed(2)}% ${direction(pct, "higher", "lower", "equal")} than over the three months before that.`,
      evidence: `${a.toFixed(2)} vs ${b.toFixed(2)}`,
      period: latest.period,
      cls: "calculated",
      method: "Mean of three consecutive monthly index values compared with the mean of the three preceding months. Skipped if any of the six months is missing.",
    });
  }

  const cov = coverage(seg.observations);
  const years = cov.count / 12;
  out.push({
    id: `${bundle.key}-coverage`,
    indicator: bundle.key,
    headline: years < 5 ? `${name} history is limited` : `${name} has about five years of history`,
    text: `${cov.count} monthly observations are stored (${formatPeriod(cov.first!, true)} to ${formatPeriod(cov.last!, true)}) on the ${seg.label.toLowerCase()} series${cov.missing.length ? `; ${cov.missing.length} month(s) in that span are missing` : ""}.`,
    evidence: `${cov.count} of ${cov.expected} months in span`,
    period: latest.period,
    cls: "calculated",
    method: "Count of stored months compared with the calendar months between the first and last stored month.",
  });
  return out;
}
