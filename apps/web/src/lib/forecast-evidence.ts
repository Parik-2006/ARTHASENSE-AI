/** Forecasts V3 evidence logic. Pure, no I/O, never invents a number.
 *
 *  Fixes a V2 flaw (docs/FORECASTS-V3-VERIFICATION.md): reliability took the model's MAE from the NEWEST backtest
 *  run but the baseline's MAE from a DIFFERENT comparison group, so the two were scored on different origins.
 *  Here every number used to judge a model (its MAE, coverage, origin count AND the naive baseline's MAE) comes
 *  from ONE comparison group, i.e. identical data and forecast origins. All candidates at a horizon are ranked on
 *  the same group. Concerning results on any other matched group are never hidden: they become caveats.
 *
 *  `lib/forecast-v2.ts` is left unchanged (Indicators imports it); its rule-based `assessReliability` is reused. */

import { assessReliability, pickDefault, type Reliability, type ReliabilityLevel, RELIABILITY_RULES } from "@/lib/forecast-v2";
import { type ComparedModel, type Comparison, type ComparisonGroup, type ForecastRow, HORIZONS, monthLabel, type Run } from "@/lib/forecasting";

export const BASELINE = "naive";

/** Mirrors services/api/app/forecasting.py: 18 training months + 5 backtest origins, plus (h - 1) months. */
export const MIN_TRAIN_MONTHS = 18;
export const MIN_ORIGINS = RELIABILITY_RULES.minOrigins;
export const monthsNeeded = (h: number) => MIN_TRAIN_MONTHS + MIN_ORIGINS + h - 1;

// ---------- evidence sets ----------

export interface EvidenceSet {
  group: ComparisonGroup;
  model: ComparedModel;
  baseline: ComparedModel | null;
}

const hasBaseline = (g: ComparisonGroup) => g.models.some((m) => m.model === BASELINE);

/** The reference set for a horizon: among groups that contain the naive baseline, the one with the most origins
 *  (then the most models). Null when no group contains the baseline. */
export function primaryGroup(c: Comparison | null | undefined): ComparisonGroup | null {
  const gs = (c?.groups ?? []).filter((g) => hasBaseline(g) && g.models.length > 0);
  if (!gs.length) return null;
  return [...gs].sort((a, b) => b.n_origins - a.n_origins || b.models.length - a.models.length)[0];
}

function setOf(g: ComparisonGroup, model: string): EvidenceSet | null {
  const m = g.models.find((x) => x.model === model);
  if (!m) return null;
  return { group: g, model: m, baseline: g.models.find((x) => x.model === BASELINE) ?? null };
}

/** The primary evidence set for `model` (the reference group if it contains the model, else the largest group
 *  that holds both the model and the baseline), plus every other matched set. */
export function evidenceFor(c: Comparison | null | undefined, model: string): { primary: EvidenceSet | null; others: EvidenceSet[] } {
  const groups = (c?.groups ?? []).filter(hasBaseline);
  const ref = primaryGroup(c);
  const all = groups.map((g) => setOf(g, model)).filter((s): s is EvidenceSet => s !== null);
  const primary =
    (ref && setOf(ref, model)) ?? [...all].sort((a, b) => b.group.n_origins - a.group.n_origins || b.group.models.length - a.group.models.length)[0] ?? null;
  return { primary, others: all.filter((s) => s.group.group_id !== primary?.group.group_id) };
}

// ---------- reliability ----------

export interface Flags {
  isBaseline: boolean;
  worseThanBaseline: boolean;
  underCovered: boolean;
  fewOrigins: boolean;
  noIntervals: boolean;
  stale: boolean;
}

export interface Evidence extends Reliability {
  /** The set every number below was computed on; null when nothing comparable is stored. */
  set: EvidenceSet | null;
  /** Concerning results from other matched evaluation sets (never hidden). */
  caveats: string[];
  flags: Flags;
}

const range = (g: ComparisonGroup) =>
  g.evaluation_start ? `${monthLabel(g.evaluation_start)}–${monthLabel(g.evaluation_end ?? g.evaluation_start)}` : "an unrecorded window";

function assessSet(s: EvidenceSet, stale: boolean): Reliability {
  const isBase = s.model.model === BASELINE;
  const r = assessReliability({
    nOrigins: s.model.n_origins,
    mae: s.model.metrics.mae ?? null,
    baselineMae: isBase ? null : (s.baseline?.metrics.mae ?? null),
    coverage80: s.model.metrics.coverage_80 ?? null,
    coverage95: s.model.metrics.coverage_95 ?? null,
    stale,
  });
  if (!isBase) return r;
  // The baseline cannot be judged against itself: say so instead of "no baseline is stored".
  return { ...r, reasons: r.reasons.map((x) => (x.startsWith("No naive baseline") ? "This is the naive baseline itself: the reference other models must beat." : x)) };
}

/** Reliability of one model judged only on `group` (used by the comparison table for the selected test set). */
export function reliabilityOnGroup(group: ComparisonGroup, model: string): Reliability | null {
  const s = setOf(group, model);
  return s ? assessSet(s, false) : null;
}

/** Display order for a comparison set. Sorting by error IS a ranking, so it is used only when the set is rankable
 *  (enough origins, one origin set); otherwise the order is neutral: the baseline first, then alphabetical. */
export function displayOrder<T extends { model: string; model_name: string; metrics: Record<string, number> }>(
  models: T[],
  rankable: boolean,
  metric = "mae",
): T[] {
  if (rankable) return [...models].sort((a, b) => (a.metrics[metric] ?? Infinity) - (b.metrics[metric] ?? Infinity));
  return [...models].sort((a, b) => Number(b.model === BASELINE) - Number(a.model === BASELINE) || a.model_name.localeCompare(b.model_name));
}

const LABEL_LIMITED = "Limited evidence";

/** Reliability of `model` at one horizon, judged on one evaluation set. */
export function evidenceReliability(c: Comparison | null | undefined, model: string, stale = false): Evidence {
  const { primary, others } = evidenceFor(c, model);
  const noFlags: Flags = { isBaseline: model === BASELINE, worseThanBaseline: false, underCovered: false, fewOrigins: true, noIntervals: true, stale };
  if (!primary) {
    const r = assessReliability({ nOrigins: null, mae: null, baselineMae: null, coverage80: null, coverage95: null, stale });
    return { ...r, set: null, caveats: [], flags: noFlags };
  }
  const base = assessSet(primary, stale);
  const caveats: string[] = [];
  for (const o of others) {
    const r = assessSet(o, stale);
    if (r.level === "concerning") {
      const why = r.reasons.find((x) => /larger than|contained the actual/.test(x)) ?? r.reasons[0];
      caveats.push(`On a separate test set of ${o.group.n_origins} origins (${range(o.group)}): ${why}`);
    }
  }
  let level: ReliabilityLevel = base.level;
  let label = base.label;
  const reasons = [...base.reasons];
  if (level === "supported" && caveats.length) {
    level = "limited";
    label = LABEL_LIMITED;
    reasons.push("Another test set shows concerning results, so this is not called supported.");
  }
  const m = primary.model.metrics;
  const bm = primary.baseline?.metrics.mae;
  const R = RELIABILITY_RULES;
  const flags: Flags = {
    isBaseline: model === BASELINE,
    worseThanBaseline: model !== BASELINE && m.mae !== undefined && bm !== undefined && m.mae > bm,
    underCovered: (m.coverage_80 !== undefined && m.coverage_80 < R.coverage80Floor) || (m.coverage_95 !== undefined && m.coverage_95 < R.coverage95Floor),
    fewOrigins: primary.model.n_origins < R.rankableOrigins,
    noIntervals: m.coverage_80 === undefined || m.coverage_95 === undefined,
    stale,
  };
  return { level, label, reasons, set: primary, caveats, flags };
}

// ---------- plain-language presentation (Simple View) ----------

export interface Meter {
  filled: 0 | 1 | 2 | 3;
  short: string;
  tone: "ok" | "target" | "up" | "muted";
}

export const METER: Record<ReliabilityLevel, Meter> = {
  supported: { filled: 3, short: "Stronger track record", tone: "ok" },
  limited: { filled: 2, short: "Limited evidence", tone: "target" },
  concerning: { filled: 1, short: "Weak track record", tone: "up" },
  insufficient: { filled: 0, short: "Not yet tested", tone: "muted" },
};

/** One short, plain sentence built from the flags (never from free text). */
export function plainReliability(e: Evidence): string {
  const f = e.flags;
  if (!e.set) return "This model has not been tested on enough past data to judge it.";
  const parts: string[] = [];
  if (f.worseThanBaseline) parts.push("in past tests it was less accurate than simply repeating the latest value");
  if (f.underCovered) parts.push("actual values often fell outside its uncertainty range");
  if (parts.length) return `Use with caution: ${parts.join(", and ")}.`;
  if (e.level === "supported") return "In past tests it beat simply repeating the latest value, and its ranges were about right.";
  if (f.isBaseline) return "This is the simple reference model: it repeats the latest official value.";
  if (e.caveats.length) return "Mixed results: it did well on most past tests but poorly on another set.";
  if (f.fewOrigins) return "Only a few past tests are available, so this is a rough guide.";
  if (f.noIntervals) return "It gives no uncertainty range, so its reliability is only partly known.";
  return "Past tests are mixed, so treat this as a rough guide.";
}

// ---------- horizon views over stored future forecasts ----------

export interface StoredForecastLike {
  model: string;
  run: Run;
  items: ForecastRow[];
}

export interface ForecastView {
  model: string;
  horizon: number;
  run: Run;
  /** Steps 1..horizon of the stored run. */
  rows: ForecastRow[];
  /** True when the view is the first `horizon` steps of a longer stored forecast. */
  partial: boolean;
}

/** Each stored future run of horizon H offers the standard horizons k <= H. For these one-shot fits, steps 1..k of
 *  the H-step forecast ARE the k-step forecast (the API's /forecasts/latest serves them the same way). */
export function forecastViews(stored: StoredForecastLike[]): ForecastView[] {
  const out: ForecastView[] = [];
  const seen = new Set<string>();
  for (const s of stored) {
    const H = s.run.horizon;
    for (const k of [...new Set([...HORIZONS.filter((h) => h <= H), H])].sort((a, b) => a - b)) {
      const key = `${s.model}|${k}`;
      if (seen.has(key)) continue;
      const rows = s.items.filter((r) => (r.step ?? 0) >= 1 && (r.step ?? 0) <= k).sort((a, b) => a.target_date.localeCompare(b.target_date));
      if (rows.length !== k) continue; // never show a horizon whose rows are not all stored
      seen.add(key);
      out.push({ model: s.model, horizon: k, run: s.run, rows, partial: k < H });
    }
  }
  return out;
}

export const isStale = (rows: ForecastRow[], latestPeriod: string | null) =>
  !!latestPeriod && !!rows[0]?.origin_date && rows[0].origin_date.slice(0, 7) < latestPeriod.slice(0, 7);

/** Default view: user choice from the URL, else the V2 policy (strongest evidence at the longest horizon <= 6,
 *  then lowest MAE) where MAE now comes from the SAME evaluation set for every candidate. */
export function chooseView(
  views: ForecastView[],
  comparisons: Record<number, Comparison | null | undefined>,
  latestPeriod: string | null,
  want: { model?: string | null; horizon?: number | null } = {},
): { view: ForecastView; evidence: Evidence; reason: string } | null {
  const scored = views.map((v) => ({ v, e: evidenceReliability(comparisons[v.horizon], v.model, isStale(v.rows, latestPeriod)) }));
  const pick = pickDefault(
    scored.map(({ v, e }) => ({ model: v.model, horizon: v.horizon, level: e.level, mae: e.set?.model.metrics.mae ?? null, createdAt: v.run.created_at })),
    want,
  );
  if (!pick) return null;
  const hit = scored.find(({ v }) => v.model === pick.model && v.horizon === pick.horizon);
  if (!hit) return null;
  const reason = pick.reason.startsWith("Strongest")
    ? `Strongest evidence level, then lowest average error, with every model scored on the same ${hit.e.set?.group.n_origins ?? 0} test origins at the ${pick.horizon}-month horizon. It is not a claim that it is best at every horizon.`
    : pick.reason;
  return { view: hit.v, evidence: hit.e, reason };
}

// ---------- links (never forward model/horizon/view to Indicators) ----------

/** Ranges that BOTH the Forecasts history window and Indicators' range parser accept. */
export const SHARED_RANGES = ["3M", "6M", "1Y", "2Y", "3Y", "5Y"] as const;

export function indicatorHref(id: string, range?: string | null): string {
  return range && (SHARED_RANGES as readonly string[]).includes(range) ? `/indicators/${id}?range=${range}` : `/indicators/${id}`;
}
