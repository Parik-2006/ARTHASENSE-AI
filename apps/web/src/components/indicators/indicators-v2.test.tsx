// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IipSectorPanel, commonGrowthMonth } from "@/components/indicators/iip-sector-panel";
import { IndicatorDashboard } from "@/components/indicators/indicator-dashboard";
import { IndicatorsOverview } from "@/components/indicators/indicators-overview";
import { cpiPayload, iipPayload, iipSectorsPayload, wpiPayload } from "@/lib/fixtures";
import { type IndicatorKey, type IndicatorResult, parseIndicatorResponse } from "@/lib/indicator";
import { CONFIG_LIST, CPI_CONFIG, IIP_CONFIG, WPI_CONFIG } from "@/lib/indicators";
import { parseIipSectors } from "@/lib/iip-sectors";

let search = "";
const replace = vi.fn((url: string) => {
  search = url.includes("?") ? url.split("?")[1] : "";
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, replace, push: replace }),
  usePathname: () => "/indicators/cpi",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });

beforeEach(() => {
  search = "";
  replace.mockClear();
});
afterEach(cleanup);

/** 30 consecutive months 2024-04 .. 2026-09, index rising 1 per month, official rate on IIP. */
const periods = Array.from({ length: 30 }, (_, i) => {
  const n = 2024 * 12 + 3 + i;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;
});
const obs = (rate = false) => periods.map((period, i) => ({ period, index: 100 + i, rate: rate ? 1 + i * 0.1 : null }));
const res = (kind: IndicatorKey, payload: unknown): IndicatorResult => ({ ok: true, data: parseIndicatorResponse(payload, kind)! });
const cpi = () => res("cpi", cpiPayload(obs()));
const wpi = () => res("wpi", wpiPayload(obs()));
const iip = () => res("iip", iipPayload(obs(true)));

describe("URL-driven filters on a detail page", () => {
  it("reads ?range=3M&metric=mom and shows 3 bars, with MoM available for the first visible month (lookback)", () => {
    search = "range=3M&metric=mom";
    const { container } = render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    expect(screen.getByRole("button", { name: "3M" }).getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll('[data-testid="bar"]')).toHaveLength(3);
  });
  it("3M + YoY still has values because 12-month lookback comes from outside the window", () => {
    search = "range=3M&metric=yoy";
    const { container } = render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    expect(container.querySelectorAll('[data-testid="bar"]')).toHaveLength(3);
  });
  it("clicking a range or metric writes it to the URL (shareable, Back/Forward friendly)", () => {
    render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    fireEvent.click(screen.getByRole("button", { name: "2Y" }));
    expect(replace).toHaveBeenLastCalledWith("/indicators/cpi?range=2Y", { scroll: false });
    fireEvent.click(screen.getByRole("button", { name: /Year-over-year % \(calculated\)/, pressed: false }));
    expect(replace.mock.calls.at(-1)![0]).toContain("metric=yoy");
  });
  it("invalid URL values fall back to defaults instead of crashing", () => {
    search = "range=99Y&metric=nonsense";
    render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    expect(screen.getByRole("button", { name: "All available" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("Custom range validates and explains an inverted range", () => {
    search = "range=Custom&from=2025-06&to=2025-01";
    render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    expect(screen.getAllByText(/start month must not be after/i).length).toBeGreaterThan(0);
  });
  it("a 5Y request on 30 stored months says the history is short", () => {
    search = "range=5Y";
    render(<IndicatorDashboard config={WPI_CONFIG} result={wpi()} />);
    expect(screen.getByText(/5Y was requested but only 30 stored months exist/)).toBeTruthy();
  });
  it("official metric on CPI (no official rate stored) shows an honest unavailable state, not zeros", () => {
    search = "metric=official";
    const { container } = render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    expect(container.querySelectorAll('[data-testid="bar"]')).toHaveLength(0);
    expect(screen.getByText(/values are available in this range/)).toBeTruthy();
  });
  it("WPI has no official option because the source supplies none", () => {
    render(<IndicatorDashboard config={WPI_CONFIG} result={wpi()} />);
    expect(screen.queryByRole("button", { name: /Official published rate/ })).toBeNull();
  });
});

describe("IIP specifics", () => {
  it("shows the seasonality warning for calculated MoM and never calls it official", () => {
    search = "metric=mom";
    render(<IndicatorDashboard config={IIP_CONFIG} result={iip()} />);
    const note = screen.getByRole("note");
    expect(note.textContent).toMatch(/not seasonally adjusted/);
    expect(note.textContent).toMatch(/not official industrial growth/);
  });
  it("no warning for the index metric", () => {
    render(<IndicatorDashboard config={IIP_CONFIG} result={iip()} />);
    expect(screen.queryByRole("note")).toBeNull();
  });
});

describe("source attribution on every visual", () => {
  it("chart and heatmap panels each carry a source line; calculated metrics list the formula separately", () => {
    search = "";
    render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    expect(screen.getAllByTestId("source-attribution").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText("Calculated by ArthaSense").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Official data").length).toBeGreaterThan(0);
  });
});

describe("table", () => {
  it("search filters by reporting month and the table follows the selected range", () => {
    search = "range=3M";
    render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    const table = screen.getByRole("table", { name: /observations/i });
    expect(within(table).getAllByRole("row")).toHaveLength(4); // header + 3
    fireEvent.change(screen.getByLabelText("Search by reporting month"), { target: { value: "sept" } });
    expect(within(table).getAllByRole("row")).toHaveLength(2); // header + September 2026
  });
});

describe("overview <-> detail consistency", () => {
  it("shows the same latest index for every indicator as its detail page", () => {
    const entries = [
      { config: CPI_CONFIG, result: cpi() },
      { config: WPI_CONFIG, result: wpi() },
      { config: IIP_CONFIG, result: iip() },
    ];
    const hub = render(<IndicatorsOverview entries={entries} />);
    const latest = "129.00"; // 100 + 29
    expect(hub.container.textContent).toContain(latest);
    hub.unmount();
    for (const e of entries) {
      const { container, unmount } = render(<IndicatorDashboard config={e.config} result={e.result} />);
      expect(container.textContent).toContain(latest);
      unmount();
    }
  });
  it("links each card to its page and carries valid filters across", () => {
    search = "range=3Y&metric=yoy";
    render(
      <IndicatorsOverview
        entries={[
          { config: CPI_CONFIG, result: cpi() },
          { config: WPI_CONFIG, result: wpi() },
          { config: IIP_CONFIG, result: iip() },
        ]}
      />,
    );
    for (const c of CONFIG_LIST) {
      const link = screen.getAllByRole("link", { name: new RegExp(`Explore ${c.shortName}`) })[0];
      expect(link.getAttribute("href")).toBe(`${c.path}?range=3Y&metric=yoy`);
    }
  });
  it("comparison uses a common window and warns about causation, never one raw-level axis", () => {
    render(
      <IndicatorsOverview
        entries={[
          { config: CPI_CONFIG, result: cpi() },
          { config: WPI_CONFIG, result: wpi() },
          { config: IIP_CONFIG, result: iip() },
        ]}
      />,
    );
    expect(screen.getByText(/Common calendar window/)).toBeTruthy();
    expect(screen.getByText(/does not show that one causes the other/)).toBeTruthy();
  });
  it("API failure for one indicator degrades only that card", () => {
    render(
      <IndicatorsOverview
        entries={[
          { config: CPI_CONFIG, result: cpi() },
          { config: WPI_CONFIG, result: { ok: false, error: "down" } },
          { config: IIP_CONFIG, result: iip() },
        ]}
      />,
    );
    expect(screen.getAllByText("API unavailable").length).toBeGreaterThan(0);
    expect(screen.getByText(/Unable to load WPI data/)).toBeTruthy();
  });
});

describe("IIP sector ranking and comparison", () => {
  const sec = (rates: Record<string, number | null>, last = "2026-09-01") =>
    parseIipSectors(
      iipSectorsPayload(
        Object.fromEntries(
          Object.entries(rates).map(([k, r]) => [
            k,
            [
              { period: "2026-08-01", index: 100, rate: r === null ? null : 1 },
              { period: last, index: 101, rate: r },
            ],
          ]),
        ),
      ),
    )!;
  it("ranks sectors by official growth for the common month and marks negatives", () => {
    render(<IipSectorPanel result={{ ok: true, data: sec({ mining: -2, manufacturing: 5, electricity: 1 }) }} />);
    const items = within(screen.getByRole("list", { name: "Sector growth ranking" })).getAllByRole("listitem");
    expect(items.map((i) => i.textContent)).toEqual([
      expect.stringContaining("Manufacturing"),
      expect.stringContaining("Electricity"),
      expect.stringContaining("Mining"),
    ]);
    expect(items[2].textContent).toContain("▼");
    expect(screen.getByText(/latest month in which every sector reports a value/)).toBeTruthy();
  });
  it("commonGrowthMonth ignores months where any sector lacks a value", () => {
    const a = { observations: [{ period: "2026-08-01", rate: 1 }, { period: "2026-09-01", rate: 2 }] };
    const b = { observations: [{ period: "2026-08-01", rate: 1 }, { period: "2026-09-01", rate: null }] };
    expect(commonGrowthMonth([a, b])).toBe("2026-08-01");
    expect(commonGrowthMonth([])).toBeNull();
  });
  it("multi-sector comparison renders one chart per selected sector", () => {
    const { container } = render(<IipSectorPanel result={{ ok: true, data: sec({ mining: 1, manufacturing: 2 }) }} />);
    fireEvent.click(screen.getByLabelText("Mining"));
    fireEvent.click(screen.getByLabelText("Manufacturing"));
    expect(screen.getAllByText(/official YoY growth$/)).toHaveLength(2);
    expect(container.querySelectorAll("svg").length).toBeGreaterThanOrEqual(2);
  });
});

describe("Custom range is reachable", () => {
  it("clicking Custom reveals month inputs seeded with the latest 12 months", () => {
    render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    fireEvent.click(screen.getByRole("button", { name: "Custom" }));
    expect(replace.mock.calls.at(-1)![0]).toBe("/indicators/cpi?range=Custom&from=2025-10&to=2026-09");
  });
});

describe("Indicators -> Forecasts navigation", () => {
  it("links to the matching forecast page carrying only the history window (never metric)", () => {
    search = "range=3Y&metric=yoy";
    render(<IndicatorDashboard config={WPI_CONFIG} result={wpi()} />);
    const link = screen.getByRole("link", { name: /WPI forecasts/ });
    expect(link.getAttribute("href")).toBe("/forecasting/wpi?range=3Y");
  });
  it("carries a valid custom range", () => {
    search = "range=Custom&from=2025-03&to=2025-08";
    render(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
    expect(screen.getByRole("link", { name: /CPI forecasts/ }).getAttribute("href")).toBe("/forecasting/cpi?range=Custom&from=2025-03&to=2025-08");
  });
});
