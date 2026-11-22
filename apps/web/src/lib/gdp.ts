/** GDP data contract and pure calculations for Overview V3.
 *
 *  GDP is a QUARTERLY series (fiscal quarters: Q1 = Apr-Jun ... Q4 = Jan-Mar). There is no monthly GDP: nothing here
 *  creates, interpolates or disaggregates monthly values. Every point sits at its quarter's FIRST month number, so it
 *  shares the month-number axis used elsewhere, with a step of 3 months.
 *
 *  The backend endpoint does not exist yet (see docs/GDP-INGESTION.md). `parseGdpResponse` defines the contract it must
 *  meet. Until then the loader reports "not stored" and the UI shows an honest unavailable state; no value is invented.
 *
 *  Expected response of GET /api/v1/indicators/gdp?limit=N:
 *  { indicator:"GDP", base_year:"2022-23", frequency:"quarterly", measure:"GDP at constant prices (real)",
 *    unit:"₹ crore", geography:"India", seasonally_adjusted:false, source_url?:string, limitations?:string[],
 *    observations:[{ fiscal_year:"2025-26", quarter:1, level:number|null, growth_yoy:number|null,
 *                    level_source?:{release_key,retrieved_at,published_at?}, growth_source?:{...} }] }
 */

export interface GdpObservation {
  fiscalYear: string; // "2025-26"
  quarter: 1 | 2 | 3 | 4;
  /** Real GDP at constant prices (level), in `unit`. null = not published / not stored (never 0). */
  level: number | null;
  /** Official year-on-year real growth (%), exactly as published. null = not provided. */
  growthYoy: number | null;
  releaseKey: string | null;
  retrievedAt: string | null;
}

export interface GdpData {
  baseYear: string;
  measure: string;
  unit: string;
  geography: string;
  seasonallyAdjusted: boolean;
  sourceUrl: string | null;
  limitations: string[];
  observations: GdpObservation[];
}

export type GdpResult =
  | { ok: true; data: GdpData }
  | { ok: false; state: "not_stored" | "error"; reason: string };

export interface GdpRow {
  n: number; // month number of the quarter's FIRST month
  fiscalYear: string;
  quarter: 1 | 2 | 3 | 4;
  level: number | null;
  growthOfficial: number | null;
  /** Calculated: level ÷ level of the same quarter a year earlier. Only when both are stored. */
  yoyCalc: number | null;
  /** Calculated quarter-on-quarter. ONLY for a seasonally adjusted series; otherwise always null (seasonality). */
  qoq: number | null;
  releaseKey: string | null;
  retrievedAt: string | null;
}

// ---------- fiscal quarters ----------

/** Month number (year*12 + month-1) of the first month of fiscal quarter `q` of fiscal year "YYYY-YY". */
export function quarterStartN(fiscalYear: string, q: 1 | 2 | 3 | 4): number | null {
  const m = /^(\d{4})-(\d{2})$/.exec(fiscalYear);
  if (!m) return null;
  const y = Number(m[1]);
  if ((y + 1) % 100 !== Number(m[2])) return null; // "2025-27" is not a fiscal year
  return q === 4 ? (y + 1) * 12 : y * 12 + 3 * q; // Q1 Apr(3), Q2 Jul(6), Q3 Oct(9), Q4 Jan of next calendar year
}

/** The fiscal quarter that contains month number n, as its first month number and (fiscalYear, quarter). */
export function fiscalQuarterOf(n: number): { start: number; fiscalYear: string; quarter: 1 | 2 | 3 | 4 } {
  const year = Math.floor(n / 12);
  const mo = n % 12; // 0 = Jan
  const start = year * 12 + 3 * Math.floor(mo / 3);
  const quarter = (mo < 3 ? 4 : Math.floor(mo / 3)) as 1 | 2 | 3 | 4;
  const fyStart = mo < 3 ? year - 1 : year;
  return { start, quarter, fiscalYear: `${fyStart}-${String((fyStart + 1) % 100).padStart(2, "0")}` };
}

const MONTHS3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Q2 FY2025-26 (Jul–Sep 2025)" */
export function quarterLabel(n: number): string {
  const { quarter, fiscalYear } = fiscalQuarterOf(n);
  const y = Math.floor(n / 12);
  const m0 = n % 12;
  return `Q${quarter} FY${fiscalYear} (${MONTHS3[m0]}–${MONTHS3[m0 + 2]} ${y})`;
}

/** Short axis label: "Q2 FY25-26". */
export function quarterShort(n: number): string {
  const { quarter, fiscalYear } = fiscalQuarterOf(n);
  return `Q${quarter} FY${fiscalYear.slice(2)}`;
}

// ---------- parsing ----------

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

/** Strict parser: anything that does not match the contract yields null (shown as an error, not guessed at). */
export function parseGdpResponse(body: unknown): GdpData | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.indicator !== "GDP" || b.frequency !== "quarterly" || !Array.isArray(b.observations)) return null;
  const baseYear = str(b.base_year);
  const unit = str(b.unit);
  if (!baseYear || !unit) return null;
  const seen = new Set<number>();
  const observations: GdpObservation[] = [];
  for (const o of b.observations as Record<string, unknown>[]) {
    const fy = str(o?.fiscal_year);
    const q = o?.quarter;
    if (!fy || (q !== 1 && q !== 2 && q !== 3 && q !== 4)) return null;
    const n = quarterStartN(fy, q);
    if (n === null || seen.has(n)) return null; // malformed or duplicate quarter
    seen.add(n);
    const src = (o.level_source ?? o.growth_source) as Record<string, unknown> | undefined;
    observations.push({
      fiscalYear: fy,
      quarter: q,
      level: num(o.level),
      growthYoy: num(o.growth_yoy),
      releaseKey: str(src?.release_key),
      retrievedAt: str(src?.retrieved_at),
    });
  }
  return {
    baseYear,
    measure: str(b.measure) ?? "GDP at constant prices (real)",
    unit,
    geography: str(b.geography) ?? "India",
    seasonallyAdjusted: b.seasonally_adjusted === true,
    sourceUrl: str(b.source_url),
    limitations: Array.isArray(b.limitations) ? b.limitations.filter((x): x is string => typeof x === "string") : [],
    observations,
  };
}

// ---------- derivations ----------

export function deriveGdp(data: GdpData): GdpRow[] {
  const rows = data.observations
    .map((o) => ({ o, n: quarterStartN(o.fiscalYear, o.quarter) as number }))
    .sort((a, b) => a.n - b.n);
  const byN = new Map(rows.map((r) => [r.n, r.o]));
  const pct = (cur: number | null, prev: number | null | undefined) =>
    cur !== null && prev !== null && prev !== undefined && prev !== 0 ? (cur / prev - 1) * 100 : null;
  return rows.map(({ o, n }) => ({
    n,
    fiscalYear: o.fiscalYear,
    quarter: o.quarter,
    level: o.level,
    growthOfficial: o.growthYoy,
    yoyCalc: pct(o.level, byN.get(n - 12)?.level),
    qoq: data.seasonallyAdjusted ? pct(o.level, byN.get(n - 3)?.level) : null,
    releaseKey: o.releaseKey,
    retrievedAt: o.retrievedAt,
  }));
}

export const GDP_QOQ_CAVEAT =
  "Quarter-on-quarter change is only meaningful for a seasonally adjusted series. This series is not seasonally adjusted, so no quarter-on-quarter figure is calculated. Use the year-on-year change, which compares the same quarter in two years.";

/** Fiscal-year totals are NOT built from quarters here: official annual GDP is a published figure, not a sum we invent. */
export const GDP_ANNUAL_NOTE = "Annual (fiscal-year) GDP growth is shown only if the source publishes it. None is stored yet.";

// ---------- CSV ----------

const cell = (v: string | number | null): string => {
  if (v === null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** One row per stored quarter. Missing values stay empty (never 0); calculated and official columns are named as such. */
export function gdpCsv(rows: GdpRow[], meta: { baseYear: string; unit: string; measure: string }): string {
  const head = ["fiscal_year", "quarter", "quarter_first_month", "gdp_level_constant_prices", "unit", "yoy_growth_pct_official",
    "yoy_change_pct_calculated", "qoq_change_pct_calculated", "base_year", "measure", "release_key", "observation_retrieved_at"]; // prettier-ignore
  const lines = rows.map((r) =>
    [r.fiscalYear, `Q${r.quarter}`, `${Math.floor(r.n / 12)}-${String((r.n % 12) + 1).padStart(2, "0")}`, r.level, meta.unit,
      r.growthOfficial, r.yoyCalc === null ? null : r.yoyCalc.toFixed(4), r.qoq === null ? null : r.qoq.toFixed(4),
      meta.baseYear, meta.measure, r.releaseKey, r.retrievedAt].map(cell).join(","),
  ); // prettier-ignore
  return [head.join(","), ...lines].join("\r\n") + "\r\n";
}

// ---------- GVA by industry (official growth, quarterly) ----------

export interface GvaIndustry {
  key: string;
  /** MoSPI's own industry label, verbatim. */
  label: string;
  points: { n: number; growth: number | null; releaseKey: string | null; retrievedAt: string | null }[];
}
export interface GvaData {
  baseYear: string;
  unit: string;
  sourceUrl: string | null;
  limitations: string[];
  industries: GvaIndustry[];
}
export type GvaResult = { ok: true; data: GvaData } | { ok: false; state: "not_stored" | "error"; reason: string };

/** Strict parser for GET /api/v1/indicators/gdp/gva. */
export function parseGvaResponse(body: unknown): GvaData | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (b.indicator !== "GVA" || b.frequency !== "quarterly" || !Array.isArray(b.industries)) return null;
  const baseYear = str(b.base_year);
  if (!baseYear) return null;
  const industries: GvaIndustry[] = [];
  for (const i of b.industries as Record<string, unknown>[]) {
    const key = str(i?.key);
    const label = str(i?.label);
    if (!key || !label || !Array.isArray(i.observations)) return null;
    const seen = new Set<number>();
    const points: GvaIndustry["points"] = [];
    for (const o of i.observations as Record<string, unknown>[]) {
      const fy = str(o?.fiscal_year);
      const q = o?.quarter;
      if (!fy || (q !== 1 && q !== 2 && q !== 3 && q !== 4)) return null;
      const n = quarterStartN(fy, q);
      if (n === null || seen.has(n)) return null;
      seen.add(n);
      const src = o.growth_source as Record<string, unknown> | undefined;
      points.push({ n, growth: num(o.growth_yoy), releaseKey: str(src?.release_key), retrievedAt: str(src?.retrieved_at) });
    }
    industries.push({ key, label, points: points.sort((x, y) => x.n - y.n) });
  }
  return {
    baseYear,
    unit: str(b.unit) ?? "%",
    sourceUrl: str(b.source_url),
    limitations: Array.isArray(b.limitations) ? b.limitations.filter((x): x is string => typeof x === "string") : [],
    industries,
  };
}
