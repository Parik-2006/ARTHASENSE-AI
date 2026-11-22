// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GdpDetail, MonthlyDetail } from "@/components/indicators/detail/indicator-detail";
import { type GdpResult, type GvaResult, parseGdpResponse, parseGvaResponse } from "@/lib/gdp";
import type { IndicatorData, IndicatorKey, Observation } from "@/lib/indicator";
import { CONFIGS } from "@/lib/indicators";
import type { SeriesBundle } from "@/lib/series-data";
import { SERIES_OPTIONS } from "@/lib/series-options";

let search = "";
const push = vi.fn((url: string) => {
  search = url.includes("?") ? url.split("?")[1] : "";
});
const replace = vi.fn((url: string) => {
  search = url.includes("?") ? url.split("?")[1] : "";
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace, refresh: () => {} }),
  usePathname: () => "/indicators/x",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
const blobs: Blob[] = [];
vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => (blobs.push(b), "blob:x"), revokeObjectURL: () => {} }));
beforeEach(() => {
  search = "";
  push.mockClear();
  replace.mockClear();
  blobs.length = 0;
});
afterEach(cleanup);

const per = (n: number) => `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;
const series = (start: number, count: number, rate: boolean): Observation[] =>
  Array.from({ length: count }, (_, i) => ({
    period: per(start + i), index: 100 + i, rate: rate ? 3 + (i % 4) / 10 : null,
    indexSource: { releaseKey: "rk-1", retrievedAt: "2026-11-01T00:00:00Z", publishedAt: null }, rateSource: null,
  })) as Observation[]; // prettier-ignore

function data(kind: IndicatorKey, baseYear: string, obs: Observation[], extra: Partial<IndicatorData> = {}): IndicatorData {
  return { kind, baseYear, coverage: "India", geography: "India", sourceName: "MoSPI", sourceUrl: "https://api.mospi.gov.in/api/x", publisherNote: null, limitations: [], observations: obs, note: null, ...extra } as IndicatorData;
}
function bundles(kind: IndicatorKey, opts: { rate: boolean; legacy?: boolean; sectors?: boolean }): SeriesBundle[] {
  const o = SERIES_OPTIONS[kind];
  const base0 = o[0].baseYear;
  const out: SeriesBundle[] = [{ option: o[0], result: { ok: true, data: data(kind, base0, series(2023 * 12 + 3, 40, opts.rate)) }, sectors: null }];
  if (opts.sectors) {
    out[0].sectors = { ok: true, data: { baseYear: base0, note: null, sectors: ["mining", "manufacturing", "electricity"].map((key) => ({ key, label: key[0].toUpperCase() + key.slice(1), observations: series(2023 * 12 + 3, 40, true) })) } };
  }
  if (opts.legacy) out.push({ option: o[1], result: { ok: true, data: data(kind, o[1].baseYear, series(2013 * 12, 156, opts.rate), { series: kind === "cpi" ? "legacy2012" : undefined }) }, sectors: null });
  return out;
}
const charts = () => screen.getAllByTestId("indicator-chart");
const csvText = async () => await blobs[blobs.length - 1].text();
const rerender = (ui: () => React.ReactElement, r: ReturnType<typeof render>) => act(() => r.rerender(ui()));

describe("Indicators: exactly two charts per indicator", () => {
  it("CPI: index history + official inflation history", () => {
    render(<MonthlyDetail config={CONFIGS.cpi} bundles={bundles("cpi", { rate: true })} />);
    expect(charts().map((c) => c.getAttribute("aria-label"))).toEqual(["CPI index history", "CPI inflation history (%)"]);
    expect(within(charts()[1]).getByText("Official data")).toBeTruthy();
    expect(screen.getByText(/CPI measures changes in the prices households pay for everyday goods and services\./)).toBeTruthy();
  });
  it("WPI: index history + year-on-year inflation labelled 'Calculated by ArthaSense' (the source has no official rate)", () => {
    render(<MonthlyDetail config={CONFIGS.wpi} bundles={bundles("wpi", { rate: false })} />);
    expect(charts().map((c) => c.getAttribute("aria-label"))).toEqual(["WPI index history", "WPI inflation, year-on-year (%)"]);
    expect(within(charts()[1]).getByText("Calculated by ArthaSense")).toBeTruthy();
  });
  it("IIP: index + growth history; the sector selector switches BOTH charts to that official sector", async () => {
    const ui = () => <MonthlyDetail config={CONFIGS.iip} bundles={bundles("iip", { rate: true, sectors: true })} />;
    const r = render(ui());
    expect(charts().map((c) => c.getAttribute("aria-label"))).toEqual(["IIP index history · General (headline)", "IIP growth history (%)"]);
    fireEvent.change(screen.getByLabelText("Sector"), { target: { value: "mining" } });
    expect(push).toHaveBeenLastCalledWith("/indicators/x?sector=mining", { scroll: false });
    rerender(ui, r);
    expect(charts().map((c) => c.getAttribute("aria-label"))).toEqual(["IIP index history · Mining", "IIP growth history (%) · Mining"]);
    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));
    const lines = (await csvText()).trim().split("\r\n");
    expect(lines[0]).toMatch(/,sector,/);
    expect(lines[1]).toMatch(/,mining,.*mospi\.iip\.2022-23\.india\.mining\.index/);
  });
  it("IIP without stored sectors: headline only, and the page says why (no invented sectors)", () => {
    render(<MonthlyDetail config={CONFIGS.iip} bundles={bundles("iip", { rate: true })} />);
    expect(charts()).toHaveLength(2);
    expect((screen.getByLabelText("Sector") as HTMLSelectElement).disabled).toBe(true);
    expect(screen.getByText(/Sector series are not stored for base 2022-23/)).toBeTruthy();
  });
});

describe("calendar-year buttons (2022-2026)", () => {
  it("a year is January-December of that calendar year, shared with Custom and the URL", async () => {
    const ui = () => <MonthlyDetail config={CONFIGS.cpi} bundles={bundles("cpi", { rate: true })} />;
    const r = render(ui());
    fireEvent.click(within(screen.getByRole("group", { name: "Calendar year" })).getByRole("button", { name: "2024" }));
    expect(push).toHaveBeenLastCalledWith("/indicators/x?range=Custom&from=2024-01&to=2024-12", { scroll: false });
    rerender(ui, r);
    expect(within(screen.getByRole("group", { name: "Calendar year" })).getByRole("button", { name: "2024" }).getAttribute("aria-pressed")).toBe("true");
    expect(within(screen.getByTestId("range-summary")).getByText("Jan 2024 – Dec 2024")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download CSV \(12 rows\)/ }));
    const lines = (await csvText()).trim().split("\r\n");
    expect([lines[1].slice(0, 10), lines[12].slice(0, 10)]).toEqual(["2024-01-01", "2024-12-01"]);
  });
  it("a year before the stored history shows a truthful empty state", () => {
    search = "range=Custom&from=2022-01&to=2022-12";
    render(<MonthlyDetail config={CONFIGS.cpi} bundles={bundles("cpi", { rate: true })} />);
    expect(within(screen.getByTestId("range-summary")).getByText("0 monthly observations")).toBeTruthy();
    expect(charts().map((c) => c.querySelectorAll("svg[role=group]").length)).toEqual([0, 0]); // no chart drawn, nothing padded
  });
});

describe("historical filters drive everything on the page", () => {
  it("range, summary, explanation and CSV all follow ?range=", async () => {
    const ui = () => <MonthlyDetail config={CONFIGS.cpi} bundles={bundles("cpi", { rate: true })} />;
    const r = render(ui());
    fireEvent.click(screen.getByRole("button", { name: "6M" }));
    expect(push).toHaveBeenLastCalledWith("/indicators/x?range=6M", { scroll: false });
    rerender(ui, r);
    const sum = screen.getByTestId("range-summary");
    expect(within(sum).getByText("Feb 2026 – Jul 2026")).toBeTruthy();
    expect(within(sum).getByText("6 monthly observations")).toBeTruthy();
    expect(screen.getByTestId("explanation").textContent).toMatch(/From February 2026 to July 2026, the CPI index rose/);
    expect(screen.queryByText(/The latest stored observation overall is/)).toBeNull(); // the window ends at the latest month
    fireEvent.click(screen.getByRole("button", { name: /Download CSV \(6 rows\)/ }));
    const lines = (await csvText()).trim().split("\r\n");
    expect(lines).toHaveLength(7);
    expect(lines[0]).toMatch(/^period,cpi_index,inflation_yoy_pct_official,yoy_change_pct_calculated/);
    expect(lines[1]).toMatch(/^2026-02-01,/);
    expect(lines[6]).toMatch(/^2026-07-01,.*mospi\.cpi\.2024\.current/);
  });
  it.each([["2M", 2], ["3M", 3], ["1Y", 12], ["2Y", 24], ["3Y", 36]])("%s gives %i CSV rows", async (k, n) => {
    search = `range=${k}`;
    render(<MonthlyDetail config={CONFIGS.wpi} bundles={bundles("wpi", { rate: false })} />);
    fireEvent.click(screen.getByRole("button", { name: new RegExp(`Download CSV \\(${n} rows\\)`) }));
    expect((await csvText()).trim().split("\r\n")).toHaveLength(n + 1);
  });
  it("5Y on 40 stored months says the history is shorter, without padding", () => {
    search = "range=5Y";
    render(<MonthlyDetail config={CONFIGS.wpi} bundles={bundles("wpi", { rate: false })} />);
    expect(screen.getByText(/asks for 60 months, but only 40 months are stored/)).toBeTruthy();
  });
  it("custom typing replaces (no history spam); presets push (Back works)", () => {
    search = "range=Custom&from=2024-01&to=2024-12";
    render(<MonthlyDetail config={CONFIGS.cpi} bundles={bundles("cpi", { rate: true })} />);
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2024-06" } });
    expect(replace).toHaveBeenLastCalledWith("/indicators/x?range=Custom&from=2024-01&to=2024-06", { scroll: false });
    expect(push).not.toHaveBeenCalled();
  });
});

describe("base years stay separate", () => {
  it("?base=2012 shows the legacy series with its own id in the CSV and a 'never joined' warning", async () => {
    search = "base=2012&range=1Y";
    render(<MonthlyDetail config={CONFIGS.cpi} bundles={bundles("cpi", { rate: true, legacy: true })} />);
    expect(screen.getAllByText(/never joined/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Download CSV \(12 rows\)/ }));
    const csv = await csvText();
    expect(csv).toMatch(/mospi\.cpi\.2012\.current/);
    expect(csv).not.toMatch(/mospi\.cpi\.2024/);
  });
  it("an earlier custom window keeps the overall latest observation separate from the in-range figures", () => {
    search = "range=Custom&from=2024-01&to=2024-06";
    render(<MonthlyDetail config={CONFIGS.cpi} bundles={bundles("cpi", { rate: true })} />);
    expect(screen.getByText(/The latest stored observation overall is July 2026 \(139\.00\); the figures above are for the selected period only/)).toBeTruthy();
    expect(within(screen.getByTestId("range-summary")).getByText("June 2024 · base 2024 = 100")).toBeTruthy();
  });
  it("an unknown ?base= says so and shows the current series", () => {
    search = "base=1999";
    render(<MonthlyDetail config={CONFIGS.wpi} bundles={bundles("wpi", { rate: false })} />);
    expect(screen.getByRole("status").textContent).toMatch(/"1999" is not stored/);
  });
});

describe("source flags are kept verbatim", () => {
  it("an F* month is exported in source_status and flagged on the page", async () => {
    const b = bundles("cpi", { rate: true });
    const o = (b[0].result as { ok: true; data: IndicatorData }).data.observations;
    o[5] = { ...o[5], indexSource: { ...o[5].indexSource!, status: "source_status_F*" } };
    o[6] = { ...o[6], indexSource: { ...o[6].indexSource!, status: "source_final" } };
    render(<MonthlyDetail config={CONFIGS.cpi} bundles={b} />);
    expect(screen.getByText(/The source flags Sep 2023 \(F\*\) in this range/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download CSV/ }));
    const lines = (await csvText()).trim().split("\r\n");
    expect(lines[0].endsWith(",source_status")).toBe(true);
    expect(lines[6].endsWith(",source_status_F*")).toBe(true);
    expect(lines[7].endsWith(",source_final")).toBe(true);
    expect(lines[8].endsWith(",")).toBe(true);
  });
});

describe("unavailable states never show invented numbers", () => {
  it("backend down: an alert, no charts with values, no CSV", () => {
    const b = bundles("cpi", { rate: true });
    b[0].result = { ok: false, error: "fetch failed" };
    render(<MonthlyDetail config={CONFIGS.cpi} bundles={b} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Unable to load CPI data/);
    expect(screen.queryAllByTestId("indicator-chart")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /Download CSV/ })).toBeNull();
  });
});

// ------------------------------------------------------------------ GDP

const gdpOk = (): GdpResult => ({
  ok: true,
  data: parseGdpResponse({
    indicator: "GDP", base_year: "2022-23", frequency: "quarterly", unit: "₹ crore", seasonally_adjusted: false, measure: "GDP at constant 2022-23 prices (real)", source_url: "https://api.mospi.gov.in/api/nas/getNASData?x",
    observations: Array.from({ length: 17 }, (_, i) => {
      const y = 2022 + Math.floor(i / 4);
      return { fiscal_year: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, quarter: (i % 4) + 1, level: 6000000 + i * 100000, growth_yoy: i >= 4 ? 7 + (i % 3) / 10 : null, level_source: { release_key: "mospi-nas-x", retrieved_at: "2026-11-22T00:00:00Z" } };
    }),
  })!,
}); // prettier-ignore
const gvaOk = (): GvaResult => ({
  ok: true,
  data: parseGvaResponse({
    indicator: "GVA", base_year: "2022-23", frequency: "quarterly",
    industries: ["total", "agriculture", "mining", "manufacturing", "electricity", "construction", "trade", "financial", "public"].map((key) => ({
      key, label: `Official ${key}`,
      observations: Array.from({ length: 13 }, (_, i) => {
        const y = 2023 + Math.floor(i / 4);
        return { fiscal_year: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, quarter: (i % 4) + 1, growth_yoy: 4 + i / 10 };
      }),
    })),
  })!,
}); // prettier-ignore
const notStored: GdpResult = { ok: false, state: "not_stored", reason: "x" };

describe("GDP view", () => {
  it("exactly two charts: real GDP quarterly level and official real GDP growth", () => {
    render(<GdpDetail gdp={gdpOk()} gva={gvaOk()} />);
    expect(charts().map((c) => c.getAttribute("aria-label"))).toEqual(["Real GDP quarterly level", "Official real GDP growth, year-on-year (%)"]);
  });
  it("the measure selector switches both charts to an official GVA industry (still two charts)", () => {
    const ui = () => <GdpDetail gdp={gdpOk()} gva={gvaOk()} />;
    const r = render(ui());
    fireEvent.change(screen.getByLabelText("Measure"), { target: { value: "manufacturing" } });
    expect(push).toHaveBeenLastCalledWith("/indicators/x?measure=manufacturing", { scroll: false });
    rerender(ui, r);
    expect(charts().map((c) => c.getAttribute("aria-label"))).toEqual(["Real GVA · Manufacturing quarterly level", "Official real GVA (Manufacturing) growth, year-on-year (%)"]);
    expect(screen.getByText(/no agriculture \/ industry \/ services split/)).toBeTruthy();
  });
  it("1Y = 4 quarters with fiscal labels; the CSV has quarters, never months", async () => {
    search = "range=1Y";
    render(<GdpDetail gdp={gdpOk()} gva={gvaOk()} />);
    fireEvent.click(screen.getByRole("button", { name: /Download CSV \(4 rows\)/ }));
    const lines = (await csvText()).trim().split("\r\n");
    expect(lines).toHaveLength(5);
    expect(lines.slice(1).map((l) => l.split(",").slice(0, 3).join(" "))).toEqual(["2025-26 Q2 2025-07", "2025-26 Q3 2025-10", "2025-26 Q4 2026-01", "2026-27 Q1 2026-04"]);
  });
  it("calendar year 2025 = quarters starting Jan-Dec 2025 (Q4 FY2024-25 to Q3 FY2025-26), stated on the page", async () => {
    search = "range=Custom&from=2025-01&to=2025-12";
    render(<GdpDetail gdp={gdpOk()} gva={gvaOk()} />);
    expect(screen.getByText(/Year 2025 is a calendar year: it includes the quarters that start in January–December 2025 \(Q4 FY2024-25 to Q3 FY2025-26\)/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Download CSV \(4 rows\)/ }));
    const lines = (await csvText()).trim().split("\r\n");
    expect(lines.slice(1).map((l) => l.split(",").slice(0, 2).join(" "))).toEqual(["2024-25 Q4", "2025-26 Q1", "2025-26 Q2", "2025-26 Q3"]);
  });
  it("2M explains that a quarter is longer than two months", () => {
    search = "range=2M";
    render(<GdpDetail gdp={gdpOk()} gva={gvaOk()} />);
    expect(screen.getAllByText(/shorter than one quarter/).length).toBe(2);
  });
  it("not stored: an honest unavailable state, two empty labelled charts, no figure and no CSV", () => {
    render(<GdpDetail gdp={notStored} gva={{ ok: false, state: "not_stored", reason: "x" }} />);
    expect(screen.getByTestId("gdp-unavailable").textContent).toMatch(/not been loaded into this database/);
    expect(charts()).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /Download CSV/ })).toBeNull();
    expect(document.body.textContent).not.toMatch(/₹\d/);
  });
});
