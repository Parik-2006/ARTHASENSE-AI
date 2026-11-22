// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OverviewV3 } from "@/components/overview/v3/overview-v3";
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
const created: Blob[] = [];
vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: (b: Blob) => (created.push(b), "blob:x"), revokeObjectURL: () => {} }));
beforeEach(() => {
  search = "";
  push.mockClear();
  created.length = 0;
});
afterEach(cleanup);

const series = (start: number, count: number, rate = false): Observation[] =>
  Array.from({ length: count }, (_, i) => {
    const n = start + i;
    return { period: `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`, index: 100 + i, rate: rate ? 2 + (i % 3) : null, indexSource: null, rateSource: null } as Observation;
  });

function bundle(key: "cpi" | "wpi" | "iip", obs: Observation[]): IndicatorBundle {
  const cfg = CONFIGS[key];
  const data = { kind: key, baseYear: key === "cpi" ? "2024" : "2022-23", coverage: "India", geography: "India", sourceName: "MoSPI", sourceUrl: "https://api.mospi.gov.in", publisherNote: null, limitations: [], observations: obs, note: null };
  return {
    key, shortName: cfg.shortName, fullName: `${cfg.shortName} full`, plain: "plain", path: cfg.path, error: null,
    segments: [{ id: "current", label: `Base ${data.baseYear}`, baseYear: data.baseYear, coverage: "India", observations: obs }],
    source: sourceFor(cfg, data), rateKind: key === "wpi" ? null : key === "cpi" ? "inflation" : "growth", rateLabel: cfg.rateCard, rateMissingText: cfg.rateMissingText, units: "Index points",
  } as IndicatorBundle;
}
const START = 2022 * 12 + 3;
const bundles = () => [bundle("cpi", series(START, 48, true)), bundle("wpi", series(START, 48)), bundle("iip", series(START, 48, true))];

const gdpOk = (): GdpResult => ({
  ok: true,
  data: parseGdpResponse({
    indicator: "GDP", base_year: "2022-23", frequency: "quarterly", unit: "₹ crore", seasonally_adjusted: false, measure: "Real GDP at constant prices",
    observations: Array.from({ length: 16 }, (_, i) => {
      const y = 2022 + Math.floor(i / 4);
      return { fiscal_year: `${y}-${String((y + 1) % 100).padStart(2, "0")}`, quarter: (i % 4) + 1, level: 1000 + i * 10, growth_yoy: i >= 4 ? 6.5 : null };
    }),
  })!,
});
const gdpNone: GdpResult = { ok: false, state: "not_stored", reason: "The ArthaSense API has no GDP data yet: official GDP has not been ingested into the database." };
const view = (gdp: GdpResult = gdpNone) => <OverviewV3 bundles={bundles()} gdp={gdp} />;

describe("structure", () => {
  it("has exactly three main sections, in order", () => {
    const { container } = render(view());
    const sections = [...container.querySelectorAll("section")];
    expect(sections.map((s) => s.id)).toEqual(["indicators", "changes", "compare"]);
    expect(sections.map((s) => s.querySelector("h2")?.textContent?.replace(/[?]+/g, "").trim())).toEqual(["Economic indicators", "How are things changing", "Compare economic trends"]);
  });
  it("shows four indicator cards", () => {
    render(view());
    for (const n of ["Consumer Price Index", "Wholesale Price Index", "Index of Industrial Production", "Gross Domestic Product"]) {
      expect(screen.getByRole("article", { name: `${n} summary` })).toBeTruthy();
    }
  });
  it("cards carry a compact source line and the source details are inside a collapsible area", () => {
    render(view());
    const cpi = screen.getByRole("article", { name: "Consumer Price Index summary" });
    expect(within(cpi).getByText(/Source: /)).toBeTruthy();
    expect(cpi.querySelector("details summary")?.textContent).toBe("Source details");
  });
});

describe("expand and collapse", () => {
  it("opens one chart at a time via the URL and closes on a second click", () => {
    const { rerender } = render(view());
    const cpiBtn = () => within(screen.getByRole("article", { name: "Consumer Price Index summary" })).getByRole("button", { expanded: false });
    fireEvent.click(cpiBtn());
    expect(push).toHaveBeenLastCalledWith("/?open=cpi", { scroll: false });
    rerender(view());
    expect(screen.getAllByRole("region", { name: /full chart/ })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Consumer Price Index full chart" })).toBeTruthy();
    // choosing another replaces it
    fireEvent.click(within(screen.getByRole("article", { name: "Wholesale Price Index summary" })).getByRole("button"));
    expect(push).toHaveBeenLastCalledWith("/?open=wpi", { scroll: false });
    rerender(view());
    expect(screen.getAllByRole("region", { name: /full chart/ })).toHaveLength(1);
    expect(screen.getByRole("region", { name: "Wholesale Price Index full chart" })).toBeTruthy();
    // clicking the selected one again closes it
    fireEvent.click(within(screen.getByRole("article", { name: "Wholesale Price Index summary" })).getByRole("button"));
    expect(push).toHaveBeenLastCalledWith("/", { scroll: false });
  });
  it("back/forward restore the same state because it lives in the URL", () => {
    search = "open=iip&range=1Y";
    render(view());
    expect(screen.getByRole("region", { name: "Index of Industrial Production full chart" })).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "1Y" })[0].getAttribute("aria-pressed")).toBe("true");
  });
  it("the expanded panel has filters, explanations, CSV, source links, explorer link and a close control", () => {
    search = "open=cpi";
    render(view());
    const panel = screen.getByRole("region", { name: "Consumer Price Index full chart" });
    for (const l of ["3M", "6M", "1Y", "2Y", "3Y", "5Y", "All", "Custom"]) expect(within(panel).getByRole("button", { name: l })).toBeTruthy();
    expect(within(panel).getByText("What it measures")).toBeTruthy();
    expect(within(panel).getByText("What the graph means")).toBeTruthy();
    expect(within(panel).getByRole("button", { name: "Download CSV" })).toBeTruthy();
    expect(within(panel).getByRole("link", { name: /Full CPI explorer/ }).getAttribute("href")).toContain("/indicators/cpi");
    expect(within(panel).getByRole("link", { name: /Publisher website/ }).getAttribute("href")).toMatch(/^https:\/\//);
    fireEvent.click(within(panel).getByRole("button", { name: /Close/ }));
    expect(push).toHaveBeenLastCalledWith("/", { scroll: false });
  });
  it("downloads a CSV of the series with provenance columns", async () => {
    search = "open=wpi&range=1Y";
    render(view());
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    expect(created).toHaveLength(1);
    const csv = await created[0].text();
    expect(csv.split("\r\n")[0]).toMatch(/series_id,publisher,source,release_key/);
    expect(csv.trim().split("\r\n").length).toBe(13); // header + 12 months
  });
});

describe("historical range", () => {
  it("a 1Y window plots 12 points and a window longer than the data is not widened", () => {
    search = "open=cpi&range=1Y";
    const { container, rerender } = render(view());
    const panel = container.querySelector("#ov-expanded")!;
    expect(panel.querySelectorAll("circle").length).toBe(12);
    search = "open=cpi&range=Custom&from=2030-01&to=2030-06";
    rerender(view());
    expect(screen.getByText(/No CPI observations fall in the selected window/)).toBeTruthy();
  });
  it("clicking a range writes it to the URL", () => {
    search = "open=cpi";
    render(view());
    fireEvent.click(within(screen.getByRole("region", { name: "Consumer Price Index full chart" })).getByRole("button", { name: "2Y" }));
    expect(push).toHaveBeenLastCalledWith("/?open=cpi&range=2Y", { scroll: false });
  });
});

describe("GDP", () => {
  it("shows an honest unavailable state, never a figure", () => {
    search = "open=gdp";
    render(view());
    const card = screen.getByRole("article", { name: "Gross Domestic Product summary" });
    expect(within(card).getByRole("status").textContent).toMatch(/GDP data is not available yet/);
    expect(card.textContent).not.toMatch(/\d{3,}/); // no numbers invented
    expect(screen.getByRole("region", { name: "Gross Domestic Product full chart" }).textContent).toMatch(/No figures are shown until then/);
    expect(within(screen.getByRole("region", { name: "Gross Domestic Product full chart" })).queryByRole("button", { name: "Download CSV" })).toBeNull();
  });
  it("when stored: shows quarterly latest value with fiscal-quarter label, unit and base year", () => {
    render(view(gdpOk()));
    const card = screen.getByRole("article", { name: "Gross Domestic Product summary" });
    expect(card.textContent).toContain("Q4 FY2025-26 (Jan–Mar 2026)");
    expect(card.textContent).toContain("₹ crore, constant prices, base 2022-23");
  });
  it("change panel: official and calculated year-on-year, with the seasonal-adjustment caveat and no monthly GDP", () => {
    render(view(gdpOk()));
    const panel = screen.getByText(/GDP: change \(quarterly\)/).closest("div")!.parentElement!;
    expect(panel.textContent).toMatch(/not seasonally adjusted, so no quarter-on-quarter figure is calculated/);
    expect(panel.textContent).not.toMatch(/month-over-month/i);
  });
  it("GDP change when unavailable says so instead of drawing zeros", () => {
    render(view());
    expect(screen.getByText(/GDP change cannot be shown/)).toBeTruthy();
  });
});

describe("mixed-frequency comparison", () => {
  it("is monthly by default and says so", () => {
    search = "";
    render(view(gdpOk()));
    // default selection includes GDP when available, so the policy applies immediately
    expect(screen.getByText(/Comparison frequency: Quarterly/)).toBeTruthy();
    expect(screen.getByText(/Monthly % change/).closest("button")?.disabled).toBe(true);
  });
  it("monthly indicators only: monthly frequency, mode available", () => {
    search = "ci=cpi,wpi,iip";
    render(view(gdpOk()));
    expect(screen.getByText(/Comparison frequency: Monthly/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Monthly % change" }).hasAttribute("disabled")).toBe(false);
  });
  it("explains why a monthly mode is replaced when GDP is selected", () => {
    search = "cmp=mom";
    render(view(gdpOk()));
    expect(screen.getByText(/GDP is published quarterly, so a monthly change does not exist/)).toBeTruthy();
  });
  it("GDP checkbox is disabled with a reason while GDP is not stored, and the rest still compare", () => {
    render(view());
    const gdpBox = screen.getByRole("checkbox", { name: /GDP/ }) as HTMLInputElement;
    expect(gdpBox.disabled).toBe(true);
    expect(screen.getByText(/Comparison frequency: Monthly/)).toBeTruthy();
  });
  it("selecting fewer than two indicators explains instead of drawing", () => {
    search = "ci=cpi";
    render(view());
    expect(screen.getByText("Select at least two indicators to compare.")).toBeTruthy();
  });
  it("toggling an indicator writes the selection to the URL", () => {
    render(view());
    fireEvent.click(screen.getByRole("checkbox", { name: /WPI/ }));
    expect(push).toHaveBeenLastCalledWith("/?ci=cpi%2Ciip", { scroll: false });
  });
});

describe("sources", () => {
  it("every chart area has a source attribution", () => {
    search = "open=cpi";
    const { container } = render(view(gdpOk()));
    expect(container.querySelectorAll('[data-testid="source-attribution"]').length).toBeGreaterThanOrEqual(7);
  });
});

describe("historical base-year segments (data platform)", () => {
  const withLegacy = () => {
    const b = bundle("cpi", series(START, 48, true));
    b.segments = [
      b.segments[0],
      { id: "2012", label: "Base 2012 · Legacy", baseYear: "2012", series: "legacy2012", coverage: "India", observations: series(2013 * 12, 156, true) },
    ];
    return [b, bundle("wpi", series(START, 48)), bundle("iip", series(START, 48, true))];
  };
  it("a selected legacy base exports its OWN series id and base year, never the primary's", async () => {
    search = "open=cpi&base=2012&range=5Y";
    render(<OverviewV3 bundles={withLegacy()} gdp={gdpNone} />);
    fireEvent.click(screen.getByRole("button", { name: "Download CSV" }));
    const lines = (await created[0].text()).trim().split(/\r?\n/);
    const cols = lines[0].split(",");
    expect(lines[1].split(",")[cols.indexOf("series_id")]).toBe("mospi.cpi.2012.current.all_india.combined.general.index");
    expect(lines[1].split(",")[cols.indexOf("base_year")]).toBe("2012");
    expect(lines.length - 1).toBe(60);
  });
  it("shows the series selector, warns the bases are not comparable, and writes ?base= to the URL", () => {
    search = "open=cpi&base=2012";
    render(<OverviewV3 bundles={withLegacy()} gdp={gdpNone} />);
    expect(screen.getByText(/never joined to it/)).toBeTruthy();
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "current" } });
    expect(push.mock.calls.at(-1)![0]).not.toContain("base=");
    expect(push.mock.calls.at(-1)![0]).toContain("open=cpi");
  });
});
