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

describe("Section 3: comparison is by percentage change only", () => {
  it("defaults to the monthly indicators, year-on-year", () => {
    render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    const sec = document.getElementById("compare")!;
    expect(within(sec).getByText("Monthly comparison.")).toBeTruthy();
    expect(within(sec).getByRole("button", { name: "Year-on-year %" }).getAttribute("aria-pressed")).toBe("true");
  });
  it("adding GDP makes it quarterly and disables month-on-month (no monthly GDP)", () => {
    search = "ci=cpi,gdp";
    render(<OverviewFinal bundles={all()} gdp={gdpOk()} />);
    const sec = document.getElementById("compare")!;
    expect(within(sec).getByText("Quarterly comparison.")).toBeTruthy();
    expect((within(sec).getByRole("button", { name: "Month-on-month %" }) as HTMLButtonElement).disabled).toBe(true);
  });
  it("GDP cannot be selected while it is not stored", () => {
    render(<OverviewFinal bundles={all()} gdp={none} />);
    const box = within(document.getElementById("compare")!).getByRole("checkbox", { name: /GDP/ }) as HTMLInputElement;
    expect(box.disabled).toBe(true);
  });
});

describe("defaults never open on an empty view (production-shaped data)", () => {
  const short = () => [bundle("cpi", series(2025 * 12, 12, false)), bundle("wpi", series(S, 48, false)), bundle("iip", series(S, 48, true))];
  it("Section 2 opens on the first indicator with a year-on-year figure (WPI when CPI has 12 months and no rate)", () => {
    render(<OverviewFinal bundles={short()} gdp={none} />);
    expect(screen.getByTestId("change-panel").textContent).toMatch(/WPI: wholesale inflation/);
  });
  it("the comparison leaves out an indicator without any year-on-year value", () => {
    render(<OverviewFinal bundles={short()} gdp={none} />);
    const boxes = within(document.getElementById("compare")!).getAllByRole("checkbox") as HTMLInputElement[];
    expect(boxes.map((b) => b.checked)).toEqual([false, true, true, false]);
  });
});
