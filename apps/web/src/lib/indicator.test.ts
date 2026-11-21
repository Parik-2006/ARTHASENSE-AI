import { describe, expect, it } from "vitest";
import { cpiPayload, iipPayload, wpiPayload } from "@/lib/fixtures";
import {
  filterRange,
  formatIndex,
  formatPeriod,
  latestObservation,
  latestRate,
  missingMonths,
  type Observation,
  parseIndicatorResponse,
  sortRows,
  toCsv,
  withMomChange,
} from "@/lib/indicator";

const obs = (period: string, index: number | null, rate: number | null = null): Observation => ({
  period,
  index,
  rate,
  indexSource: null,
  rateSource: null,
});

describe("parseIndicatorResponse", () => {
  it("parses CPI, sorts, and keeps null inflation as null", () => {
    const d = parseIndicatorResponse(
      cpiPayload([
        { period: "2025-12-01", index: 104.1 },
        { period: "2025-01-01", index: 100, rate: 3.2 },
      ]),
      "cpi",
    )!;
    expect(d.observations.map((o) => o.period)).toEqual(["2025-01-01", "2025-12-01"]);
    expect(d.observations[1].rate).toBeNull();
    expect(d.observations[0].rate).toBe(3.2);
    expect(d.observations[0].indexSource?.publishedAt).toBeNull();
    expect(d.coverage).toBe("All India · Combined · CPI (General)");
  });

  it("parses WPI: index only, never a rate; keeps limitations and publisher", () => {
    const d = parseIndicatorResponse(wpiPayload([{ period: "2025-01-01", index: 100.5 }]), "wpi")!;
    expect(d.baseYear).toBe("2022-23");
    expect(d.observations[0].rate).toBeNull();
    expect(d.coverage).toBe("India · All commodities (headline)");
    expect(d.publisherNote).toContain("Office of the Economic Adviser");
    expect(d.limitations).toHaveLength(1);
  });

  it("parses IIP growth into rate, separately from the index", () => {
    const d = parseIndicatorResponse(iipPayload([{ period: "2025-01-01", index: 118.1, rate: 6.3 }]), "iip")!;
    expect(d.observations[0]).toMatchObject({ index: 118.1, rate: 6.3 });
    expect(d.coverage).toBe("India · General (headline)");
  });

  it("handles an empty database response", () => {
    expect(parseIndicatorResponse(cpiPayload([]), "cpi")!.observations).toEqual([]);
  });

  it.each([null, "x", {}, { observations: "no" }, { ...cpiPayload([]), source: null }])("rejects %j", (bad) => {
    expect(parseIndicatorResponse(bad, "cpi")).toBeNull();
  });

  it("rejects payloads of the wrong indicator or malformed observations instead of guessing", () => {
    expect(parseIndicatorResponse(wpiPayload([]), "cpi")).toBeNull(); // no sector/division
    expect(parseIndicatorResponse(cpiPayload([]), "iip")).toBeNull(); // sector is not an object
    const p = cpiPayload([{ period: "2025-01-01", index: 1 }]);
    const bad = (patch: object) => ({ ...p, observations: [{ ...p.observations[0], ...patch }] });
    expect(parseIndicatorResponse(bad({ index: "104.1" }), "cpi")).toBeNull();
    expect(parseIndicatorResponse(bad({ period: "Jan 2025" }), "cpi")).toBeNull();
  });
});

describe("formatting", () => {
  it("formats index and periods", () => {
    expect(formatIndex(104.1)).toBe("104.10");
    expect(formatIndex(null)).toBe("Not available");
    expect(formatPeriod("2025-12-01")).toBe("Dec 2025");
    expect(formatPeriod("2025-12-01", true)).toBe("December 2025");
  });
});

describe("withMomChange", () => {
  it("computes (cur/prev - 1) * 100 for consecutive months", () => {
    const rows = withMomChange([obs("2025-01-01", 100), obs("2025-02-01", 101.5)]);
    expect(rows[0].mom).toBeNull();
    expect(rows[1].mom).toBeCloseTo(1.5, 10);
  });
  it("does not calculate across a gap", () => {
    expect(withMomChange([obs("2025-09-01", 103.74), obs("2025-12-01", 104.1)])[1].mom).toBeNull();
  });
  it("handles year boundaries, missing values and zero denominators", () => {
    expect(withMomChange([obs("2025-12-01", 100), obs("2026-01-01", 101)])[1].mom).toBeCloseTo(1);
    expect(withMomChange([obs("2025-01-01", null), obs("2025-02-01", 101)])[1].mom).toBeNull();
    expect(withMomChange([obs("2025-01-01", 0), obs("2025-02-01", 101)])[1].mom).toBeNull();
  });
  it("sorts unordered input", () => {
    const rows = withMomChange([obs("2025-02-01", 102), obs("2025-01-01", 100)]);
    expect(rows.map((r) => r.period)).toEqual(["2025-01-01", "2025-02-01"]);
  });
});

describe("selection and ranges", () => {
  const months = ["01", "02", "03", "04", "05", "06", "07", "08", "09", "12"].map((m, i) =>
    obs(`2025-${m}-01`, 100 + i),
  );

  it("picks the latest observation and latest official rate (never substituted)", () => {
    expect(latestObservation(months)?.period).toBe("2025-12-01");
    expect(latestRate(months)).toBeNull();
    expect(latestRate([...months, obs("2025-06-01", 1, 4.2)])?.rate).toBe(4.2);
  });
  it("filters by calendar window ending at the latest month", () => {
    expect(filterRange(months, "3M").map((r) => r.period)).toEqual(["2025-12-01"]);
    expect(filterRange(months, "6M").map((r) => r.period)).toEqual([
      "2025-07-01",
      "2025-08-01",
      "2025-09-01",
      "2025-12-01",
    ]);
    expect(filterRange(months, "1Y")).toHaveLength(10);
    expect(filterRange(months, "All")).toHaveLength(10);
  });
  it("reports missing months", () => {
    expect(missingMonths(months)).toEqual(["Oct 2025", "Nov 2025"]);
    expect(missingMonths([obs("2025-01-01", 1)])).toEqual([]);
  });
});

describe("toCsv", () => {
  const meta = { source: "MoSPI", indexColumn: "cpi_index", rateColumn: "yoy_inflation_pct_official" };
  it("keeps missing values empty (not zero) and escapes cells", () => {
    const rows = withMomChange([obs("2025-01-01", 100), obs("2025-02-01", 101)]);
    const lines = toCsv(rows, meta).trim().split("\r\n");
    expect(lines[0]).toBe(
      "period,cpi_index,mom_change_pct_calculated,yoy_inflation_pct_official,source,release_key,retrieved_at",
    );
    expect(lines[1]).toBe("2025-01-01,100,,,MoSPI,,");
    expect(lines[2].startsWith("2025-02-01,101,1.0000,,MoSPI")).toBe(true);
    expect(toCsv([rows[0]], { ...meta, source: 'a"b,c' })).toContain('"a""b,c"');
  });
  it("omits the rate column entirely for indicators without one (WPI)", () => {
    const rows = withMomChange([obs("2025-01-01", 100)]);
    const header = toCsv(rows, { source: "OEA", indexColumn: "wpi_index", rateColumn: null }).split("\r\n")[0];
    expect(header).toBe("period,wpi_index,mom_change_pct_calculated,source,release_key,retrieved_at");
  });
});

describe("sortRows", () => {
  const rows = withMomChange([obs("2025-01-01", 100), obs("2025-02-01", null), obs("2025-03-01", 90)]);
  it("sorts by period and by value, both directions", () => {
    expect(sortRows(rows, "period", "desc").map((r) => r.period)[0]).toBe("2025-03-01");
    expect(sortRows(rows, "index", "asc").map((r) => r.index)).toEqual([90, 100, null]);
    expect(sortRows(rows, "index", "desc").map((r) => r.index)).toEqual([100, 90, null]);
  });
  it("always puts missing values last, including for MoM", () => {
    const mom = sortRows(rows, "mom", "asc").map((r) => r.mom);
    expect(mom.slice(-2)).toEqual([null, null]);
  });
});

import { mergeLinkedHistory } from "@/lib/indicator";

describe("mergeLinkedHistory (CPI Back + Current)", () => {
  const mk = (periods: string[], base = "2024") => {
    const d = parseIndicatorResponse(cpiPayload(periods.map((period, i) => ({ period, index: 100 + i, rate: null }))), "cpi")!;
    return { ...d, baseYear: base };
  };
  it("prepends back months, keeps order, marks the join and lets Current win on overlap", () => {
    const m = mergeLinkedHistory(mk(["2025-01-01", "2025-02-01"]), mk(["2024-11-01", "2024-12-01", "2025-01-01"]));
    expect(m.observations.map((o) => o.period)).toEqual(["2024-11-01", "2024-12-01", "2025-01-01", "2025-02-01"]);
    expect(m.observations[2].index).toBe(100); // Current's value, not Back's 102
    expect(m.linkedHistory?.until).toBe("2024-12-01");
  });
  it("refuses to merge different base years", () => {
    const cur = mk(["2025-01-01"]);
    expect(mergeLinkedHistory(cur, mk(["2024-12-01"], "2012"))).toBe(cur);
  });
  it("is a no-op when the back series adds nothing", () => {
    const cur = mk(["2025-01-01"]);
    expect(mergeLinkedHistory(cur, mk(["2025-01-01"]))).toBe(cur);
  });
});
