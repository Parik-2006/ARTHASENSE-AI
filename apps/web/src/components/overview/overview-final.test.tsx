// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewFinal } from "@/components/overview/overview-final";
import { type GdpResult, parseGdpResponse } from "@/lib/gdp";
import type { Observation } from "@/lib/indicator";
import { CONFIGS } from "@/lib/indicators";
import type { IndicatorBundle } from "@/lib/overview-data";
import { sourceFor } from "@/lib/source";

let search = "";
const push = vi.fn((url: string) => {
  search = url.includes("?") ? url.split("?")[1] : "";
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace: push, refresh: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
beforeEach(() => {
  search = "";
  push.mockClear();
});
afterEach(cleanup);

const series = (start: number, count: number, rate: boolean): Observation[] =>
  Array.from({ length: count }, (_, i) => {
    const n = start + i;
    return { period: `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`, index: 100 + i, rate: rate ? 2 + (i % 3) : null, indexSource: null, rateSource: null } as Observation;
  });
function bundle(key: "cpi" | "wpi" | "iip", obs: Observation[], error: string | null = null): IndicatorBundle {
  const cfg = CONFIGS[key];
  const d = { kind: key, baseYear: key === "cpi" ? "2024" : "2022-23", coverage: "India", geography: "India", sourceName: "MoSPI", sourceUrl: "https://api.mospi.gov.in", publisherNote: null, limitations: [], observations: obs, note: null };
  return {
    key, shortName: cfg.shortName, fullName: cfg.title, plain: "", path: cfg.path, error,
    segments: error ? [] : [{ id: "current", label: `Base ${d.baseYear}`, baseYear: d.baseYear, coverage: "India", observations: obs }],
    source: sourceFor(cfg, d), rateKind: key === "wpi" ? null : key === "cpi" ? "inflation" : "growth", rateLabel: cfg.rateCard, rateMissingText: cfg.rateMissingText, units: "Index points",
  } as IndicatorBundle; // prettier-ignore
}
const S = 2022 * 12 + 3;
const all = () => [bundle("cpi", series(S, 48, true)), bundle("wpi", series(S, 48, false)), bundle("iip", series(S, 48, true))];
const gdpOk = (): GdpResult => ({
  ok: true,
  data: parseGdpResponse({
    indicator: "GDP", base_year: "2022-23", frequency: "quarterly", unit: "₹ crore",
    observations: Array.from({ length: 17 }, (_, i) => {
      const y = 2022 + Math.floor(i / 4);
      return { fiscal_year: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, quarter: (i % 4) + 1, level: 1000 + i * 10, growth_yoy: i >= 4 ? 6.5 + i / 10 : null };
    }),
  })!,
}); // prettier-ignore
const none: GdpResult = { ok: false, state: "not_stored", reason: "x" };

describe("Overview: exactly three sections", () => {
  it("sections are Key economic indicators, How are things changing?, Compare economic trends", () => {
    const { container } = render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    const top = [...container.querySelectorAll("section")].filter((s) => !s.parentElement?.closest("section"));
    expect(top.map((s) => s.id)).toEqual(["indicators", "changes", "compare"]);
    expect(top.map((s) => s.querySelector("h2")?.firstChild?.textContent?.trim())).toEqual(["Key economic indicators", "How are things changing?", "Compare economic trends"]);
  });
  it("has no expanded chart panel and no forecast content", () => {
    const { container } = render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    expect(container.querySelector("#ov-expanded")).toBeNull();
    expect(container.textContent).not.toMatch(/forecast/i);
  });
});

describe("Section 1: four cards that link straight to the Indicators views", () => {
  it.each([["cpi", "/indicators/cpi"], ["wpi", "/indicators/wpi"], ["iip", "/indicators/iip"], ["gdp", "/indicators/gdp"]])("%s card links to %s", (k, href) => {
    render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    const card = screen.getByTestId(`card-${k}`);
    expect(card.tagName).toBe("A");
    expect(card.getAttribute("href")).toBe(href);
  });
  it("cards show the latest stored value, its month, base year and official vs calculated", () => {
    render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    const cpi = screen.getByTestId("card-cpi");
    expect(cpi.textContent).toMatch(/147\.00/);
    expect(cpi.textContent).toMatch(/Index, base 2024 = 100 · March 2026/);
    expect(within(cpi).getByText("Official data")).toBeTruthy();
    expect(within(screen.getByTestId("card-wpi")).getByText("Calculated by ArthaSense")).toBeTruthy();
    expect(screen.getByTestId("card-gdp").textContent).toMatch(/8\.1%.*Q1 FY2026-27/);
  });
  it("GDP not stored: an honest message and no figure", () => {
    render(<OverviewFinal bundles={all()} gdp={none} />);
    const g = screen.getByTestId("card-gdp");
    expect(within(g).getByTestId("gdp-unavailable").textContent).toMatch(/not available yet/);
    expect(g.textContent).not.toMatch(/\d+\.\d%/);
  });
  it("a backend failure on one indicator says so without inventing a value", () => {
    render(<OverviewFinal bundles={[bundle("cpi", [], "down"), bundle("wpi", series(S, 48, false)), bundle("iip", series(S, 48, true))]} gdp={none} />);
    expect(screen.getByTestId("card-cpi").textContent).toMatch(/could not be loaded/);
  });
});

describe("Section 2: one compact change view with an indicator selector", () => {
  it("one chart at a time; switching writes ?chg= and changes the content", () => {
    const ui = () => <OverviewFinal bundles={all()} gdp={gdpOk()} />;
    const r = render(ui());
    expect(screen.getAllByTestId("change-panel")).toHaveLength(1);
    expect(screen.getByTestId("change-panel").textContent).toMatch(/consumer inflation/);
    fireEvent.click(within(screen.getByRole("group", { name: "Indicator" })).getByRole("button", { name: "GDP" }));
    expect(push).toHaveBeenLastCalledWith("/?chg=gdp", { scroll: false });
    act(() => r.rerender(ui()));
    expect(screen.getByTestId("change-panel").textContent).toMatch(/real growth by fiscal quarter.*Q1 FY2026-27/);
  });
  it("GDP with 2M explains that a quarter is longer than two months", () => {
    search = "chg=gdp&range=2M";
    render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    expect(screen.getByTestId("change-panel").textContent).toMatch(/2-month range cannot contain a full quarter/);
  });
});

describe("Section 2: level or year-on-year change", () => {
  it("'Level' shows the index (not a percentage) and writes ?chgm=level", () => {
    search = "chg=iip";
    const ui = () => <OverviewFinal bundles={all()} gdp={gdpOk()} />;
    const r = render(ui());
    fireEvent.click(within(screen.getByRole("group", { name: "Show" })).getByRole("button", { name: "Level" }));
    expect(push).toHaveBeenLastCalledWith("/?chg=iip&chgm=level", { scroll: false });
    act(() => r.rerender(ui()));
    expect(screen.getByTestId("change-panel").textContent).toMatch(/IIP: index level \(base 2022-23 = 100\)/);
  });
  it("GDP level is quarterly rupees at constant prices", () => {
    search = "chg=gdp&chgm=level";
    render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    expect(screen.getByTestId("change-panel").textContent).toMatch(/GDP: real level by fiscal quarter \(₹ crore, constant 2022-23 prices\)/);
  });
});

describe("Section 3: one year (2026), all four indicators, no filter controls", () => {
  const compare = () => document.getElementById("compare")!;
  it("shows only a 2026 year indicator: no checkboxes, mode, range, custom or date controls", () => {
    render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    const sec = compare();
    expect(within(sec).getByTestId("compare-year").textContent).toBe("2026");
    expect(within(sec).queryAllByRole("checkbox")).toHaveLength(0);
    expect(sec.querySelectorAll("input, select")).toHaveLength(0);
    for (const name of ["Year-on-year %", "Month-on-month %", "% change from start", "Side by side", "2M", "3M", "6M", "1Y", "2Y", "3Y", "5Y", "All", "Custom", "2022", "2023", "2024", "2025"]) {
      expect(within(sec).queryByRole("button", { name })).toBeNull();
    }
  });
  it("draws CPI, WPI, IIP and GDP by quarter with fiscal labels; GDP stays quarterly", () => {
    render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    const sec = compare();
    const legend = within(sec).getByRole("list", { name: "Legend" });
    for (const k of ["CPI", "WPI", "IIP", "GDP"]) expect(legend.textContent).toContain(k);
    expect(within(sec).getByTestId("compare-fiscal").textContent).toBe("Fiscal quarters: Jan–Mar = Q4 FY25-26 · Apr–Jun = Q1 FY26-27");
    // fixtures end in Mar 2026 for the monthly indices: their Apr–Jun gap is stated, never filled
    expect(within(sec).getByTestId("compare-notes").textContent).toMatch(/CPI for Apr–Jun 2026 is not published yet/);
  });
  it("ignores stale ?ci= and ?cmp= links and does not share Section 2's range", () => {
    search = "ci=cpi&cmp=mom&range=2M";
    render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    expect(within(compare()).getByTestId("compare-year").textContent).toBe("2026");
    expect(within(compare()).getByRole("list", { name: "Legend" }).textContent).toContain("GDP");
  });
  it("stays on 2026 even when a complete 2027 quarter exists", () => {
    const longer = () => [bundle("cpi", series(S, 63, true)), bundle("wpi", series(S, 63, false)), bundle("iip", series(S, 63, true))]; // to Jun 2027
    render(<OverviewFinal bundles={longer()} gdp={gdpOk()} />);
    expect(within(compare()).getByTestId("compare-year").textContent).toBe("2026");
    expect(within(compare()).getByTestId("compare-fiscal").textContent).not.toMatch(/2027|FY27-28/);
  });
  it("without stored GDP it draws the monthly indices and says GDP is not drawn", () => {
    render(<OverviewFinal bundles={all()} gdp={none} />);
    const sec = compare();
    expect(within(sec).getByRole("list", { name: "Legend" }).textContent).not.toContain("GDP");
    expect(within(sec).getByTestId("compare-notes").textContent).toMatch(/GDP is not stored yet/);
  });
});

describe("defaults never open on an empty view (production-shaped data)", () => {
  const short = () => [bundle("cpi", series(2025 * 12, 12, false)), bundle("wpi", series(S, 48, false)), bundle("iip", series(S, 48, true))];
  it("Section 2 opens on the first indicator with a year-on-year figure (WPI when CPI has 12 months and no rate)", () => {
    render(<OverviewFinal bundles={short()} gdp={none} />);
    expect(screen.getByTestId("change-panel").textContent).toMatch(/WPI: wholesale inflation/);
  });
  it("the comparison leaves out an indicator without any value in the year, and says why", () => {
    render(<OverviewFinal bundles={short()} gdp={none} />);
    const sec = document.getElementById("compare")!;
    const legend = within(sec).getByRole("list", { name: "Legend" }).textContent ?? "";
    expect(legend).not.toContain("CPI");
    expect(legend).toContain("WPI");
    expect(within(sec).getByTestId("compare-notes").textContent).toMatch(/CPI for Jan–Mar 2026 is not published yet/);
  });
});

// ---- historical series on the Overview (production coverage, 2026-11-23) ----------------------------------
const ym = (y: number, m: number) => y * 12 + m - 1; // month number
const obs = (from: number, to: number, idx: (i: number) => number, rateFrom: number | null): Observation[] =>
  Array.from({ length: to - from + 1 }, (_, i) => {
    const n = from + i;
    return { period: `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`, index: idx(i), rate: rateFrom !== null && n >= rateFrom ? 5 + (i % 3) / 10 : null, indexSource: null, rateSource: null } as Observation;
  });
function multi(key: "cpi" | "wpi" | "iip", segs: { id: string; label: string; baseYear: string; series?: string; o: Observation[] }[]): IndicatorBundle {
  const b = bundle(key, segs[0].o);
  return { ...b, segments: segs.map((s) => ({ id: s.id, label: s.label, baseYear: s.baseYear, series: s.series ?? null, coverage: "India", observations: s.o })) } as IndicatorBundle;
}
const growth = (i: number) => 100 * 1.01 ** i; // +1% a month => exactly +12.6825% year-on-year
const prodLike = () => [
  multi("cpi", [
    { id: "current", label: "Base 2024 · Current", baseYear: "2024", series: "current", o: obs(ym(2025, 1), ym(2026, 10), growth, ym(2026, 1)) },
    { id: "2012", label: "Base 2012 · Legacy", baseYear: "2012", series: "legacy2012", o: obs(ym(2013, 1), ym(2025, 12), growth, ym(2014, 1)) },
    { id: "back", label: "Base 2024 · Official back series", baseYear: "2024", series: "back", o: obs(ym(2013, 1), ym(2024, 12), growth, ym(2014, 1)) },
  ]),
  multi("wpi", [
    { id: "current", label: "Base 2022-23", baseYear: "2022-23", o: obs(ym(2023, 4), ym(2026, 10), growth, null) },
    { id: "2011-12", label: "Base 2011-12 · Legacy", baseYear: "2011-12", o: obs(ym(2012, 4), ym(2026, 4), growth, null) },
  ]),
  multi("iip", [
    { id: "current", label: "Base 2022-23", baseYear: "2022-23", o: obs(ym(2023, 4), ym(2026, 9), growth, ym(2024, 4)) },
    { id: "2011-12", label: "Base 2011-12 · Legacy", baseYear: "2011-12", o: obs(ym(2013, 1), ym(2026, 3), growth, ym(2013, 4)) },
  ]),
];
const ui = () => <OverviewFinal bundles={prodLike()} gdp={gdpOk()} />;
const panel = () => screen.getByTestId("change-panel");

describe("Fix 1 — CPI history on the Overview", () => {
  it("2025 year-on-year on base 2024 (official inflation only from Jan 2026) explains it and offers base 2012", () => {
    search = "chg=cpi&range=Custom&from=2025-01&to=2025-12";
    const r = render(ui());
    expect(panel().textContent).toMatch(/No consumer inflation figure for Base 2024 · Current in this range\. This series publishes it for Jan 2026 – Oct 2026\./);
    const hint = screen.getByTestId("series-hint");
    expect(hint.textContent).toMatch(/The Base 2012 · Legacy series has 12 months/);
    fireEvent.click(within(hint).getByRole("button", { name: "Show Base 2012 · Legacy" }));
    expect(push).toHaveBeenLastCalledWith("/?chg=cpi&range=Custom&from=2025-01&to=2025-12&chgs=2012", { scroll: false });
    act(() => r.rerender(ui()));
    expect(panel().textContent).toMatch(/consumer inflation \(% year-on-year\) · Base 2012 · Legacy/);
    expect(panel().querySelector("svg[role=group]")).toBeTruthy();
    expect(panel().textContent).toMatch(/between \+5\.0% and \+5\.2% \(official\)\. The latest figure in the range is \+5\.2% for December 2025\./);
    expect(screen.queryByTestId("series-hint")).toBeNull();
  });
  it.each([[2022, "back", 12], [2023, "back", 12], [2024, "back", 12], [2025, "2012", 12], [2026, "current", 10]])("year %i has official inflation in %s (%i months), never a fabricated join", (y, id, n) => {
    search = `chg=cpi&range=Custom&from=${y}-01&to=${y}-12${id === "current" ? "" : `&chgs=${id}`}`;
    render(ui());
    expect(screen.queryByTestId("series-hint")).toBeNull();
    expect(panel().querySelectorAll("svg[role=group] rect").length).toBe(n);
  });
  it("Level on the legacy series is in its own base (2012 = 100) and the source names the series", () => {
    search = "chg=cpi&chgm=level&chgs=2012";
    render(ui());
    expect(panel().textContent).toMatch(/CPI: index level \(base 2012 = 100\) · Base 2012 · Legacy/);
    expect(screen.getByTestId("series-coverage").textContent).toMatch(/Base 2012 · Legacy: index Jan 2013 – Dec 2025; official inflation Jan 2014 – Dec 2025\. A separate official series/);
    expect(panel().textContent).toMatch(/Base 2012/);
  });
});

describe("Fix 2 — WPI history on the Overview", () => {
  it("2022 on base 2022-23 (starts Apr 2023) points to base 2011-12; its calculated YoY is exact (+12.68%)", () => {
    search = "chg=wpi&range=Custom&from=2022-01&to=2022-12";
    const r = render(ui());
    expect(screen.getByTestId("series-hint").textContent).toMatch(/Base 2022-23 has no wholesale inflation figures in this range\. The Base 2011-12 · Legacy series has 12 months/);
    fireEvent.click(screen.getByRole("button", { name: "Show Base 2011-12 · Legacy" }));
    act(() => r.rerender(ui()));
    expect(panel().textContent).toMatch(/· Base 2011-12 · Legacy/);
    expect(within(panel()).getAllByText("Calculated by ArthaSense").length).toBeGreaterThan(0);
    expect(panel().textContent).toMatch(/between \+12\.7% and \+12\.7% \(calculated by ArthaSense\)/);
  });
  it("2024 on base 2022-23 has 9 calculated months (Apr–Dec); the page says the legacy series covers all 12", () => {
    search = "chg=wpi&range=Custom&from=2024-01&to=2024-12";
    render(ui());
    expect(panel().querySelectorAll("svg[role=group] rect").length).toBe(9);
    expect(screen.getByTestId("series-hint").textContent).toMatch(/has only 9 months in this range\. The Base 2011-12 · Legacy series has 12 months/);
  });
});

describe("Fix 3 — IIP history on the Overview", () => {
  it("All on base 2011-12 covers its whole history (Jan 2013 – Mar 2026)", () => {
    search = "chg=iip&chgm=level&chgs=2011-12";
    render(ui());
    expect(panel().textContent).toMatch(/From January 2013 to March 2026, the IIP index rose/);
    expect(screen.getByTestId("series-coverage").textContent).toMatch(/index Jan 2013 – Mar 2026; official growth Apr 2013 – Mar 2026/);
  });
  it("2022 level on base 2022-23 offers the legacy series; switching indicator resets the series choice", () => {
    search = "chg=iip&chgm=level&range=Custom&from=2022-01&to=2022-12";
    render(ui());
    expect(screen.getByTestId("series-hint").textContent).toMatch(/Base 2022-23 has no index values in this range\. The Base 2011-12 · Legacy series has 12 months/);
    fireEvent.click(within(screen.getByRole("group", { name: "Indicator" })).getByRole("button", { name: "WPI" }));
    expect(push.mock.calls.at(-1)?.[0]).not.toMatch(/chgs=/);
  });
});

describe("GDP is unchanged by the series selector", () => {
  it("GDP panel has no base selector and still shows quarterly official growth", () => {
    search = "chg=gdp";
    render(ui());
    expect(screen.queryByTestId("series-coverage")).toBeNull();
    expect(panel().textContent).toMatch(/GDP: real growth by fiscal quarter/);
  });
});

describe("the series hint is not shown for relative ranges when the selected series has data", () => {
  it("All on IIP base 2011-12 shows its full history without suggesting a longer archive", () => {
    search = "chg=iip&chgm=level&chgs=2011-12";
    render(ui());
    expect(screen.queryByTestId("series-hint")).toBeNull();
  });
});
