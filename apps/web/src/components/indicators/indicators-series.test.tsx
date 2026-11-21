// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IndicatorWorkspace } from "@/components/indicators/indicator-workspace";
import { cpiPayload, iipPayload, wpiPayload } from "@/lib/fixtures";
import { type IndicatorKey, type IndicatorResult, parseIndicatorResponse } from "@/lib/indicator";
import { CPI_CONFIG, IIP_CONFIG, WPI_CONFIG } from "@/lib/indicators";
import { SERIES_OPTIONS } from "@/lib/series-options";
import type { SeriesBundle } from "@/lib/series-data";

let search = "";
const push = vi.fn((url: string) => {
  search = url.includes("?") ? url.split("?")[1] : "";
});
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, replace: push, push }),
  usePathname: () => "/indicators/wpi",
  useSearchParams: () => new URLSearchParams(search),
}));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });

beforeEach(() => {
  search = "";
  push.mockClear();
});
afterEach(cleanup);

// Synthetic fixtures (tests only): 30 consecutive months, index rising by 1.
const periods = Array.from({ length: 30 }, (_, i) => {
  const n = 2020 * 12 + i;
  return `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`;
});
const obs = (status: string | null = null) =>
  periods.map((period, i) => ({ period, index: 100 + i, rate: null, index_source: { release_key: "rk", retrieved_at: "2026-01-01T00:00:00Z", published_at: null, status } }));

function res(kind: IndicatorKey, payload: Record<string, unknown>): IndicatorResult {
  return { ok: true, data: parseIndicatorResponse(payload, kind)! };
}
const fixPayload = (kind: IndicatorKey, base: string, extra: Record<string, unknown> = {}, status: string | null = null) => {
  const raw = { cpi: cpiPayload, wpi: wpiPayload, iip: iipPayload }[kind](obs() as never) as Record<string, unknown>;
  return { ...raw, base_year: base, observations: obs(status), ...extra };
};
const bundle = (kind: IndicatorKey, idx: number, payload: Record<string, unknown>): SeriesBundle => ({ option: SERIES_OPTIONS[kind][idx], result: res(kind, payload), sectors: null });

const wpiBundles = () => [
  bundle("wpi", 0, fixPayload("wpi", "2022-23")),
  bundle("wpi", 1, fixPayload("wpi", "2011-12")),
  bundle("wpi", 3, fixPayload("wpi", "1993-94")),
];

describe("series registry", () => {
  it("every indicator has a primary 'current' series first and unique ids", () => {
    for (const k of ["cpi", "wpi", "iip"] as const) {
      const list = SERIES_OPTIONS[k];
      expect(list[0].id).toBe("current");
      expect(new Set(list.map((o) => o.id)).size).toBe(list.length);
      expect(list.every((o) => o.query.startsWith("?limit=240"))).toBe(true);
    }
  });
  it("CPI keeps the 2024 Current and Back series and the 2012 series as three separate options", () => {
    const cpi = SERIES_OPTIONS.cpi;
    expect(cpi.map((o) => o.cpiSeries)).toEqual(["current", "legacy2012", "back"]);
    expect(cpi.find((o) => o.id === "2012")?.query).toContain("series=legacy2012");
    expect(cpi.find((o) => o.id === "back")?.note).toMatch(/never joined/);
  });
});

describe("IndicatorWorkspace", () => {
  it("shows a series switcher with the primary pressed and explains that bases are never joined", () => {
    render(<IndicatorWorkspace config={WPI_CONFIG} bundles={wpiBundles()} />);
    const group = screen.getByRole("group", { name: "Series (base year)" });
    expect(group.querySelectorAll("button")).toHaveLength(3);
    expect(screen.getByRole("button", { name: "Base 2022-23" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/never joined by ArthaSense/)).toBeTruthy();
  });
  it("choosing a series writes ?base= to the URL (history step) and keeps other parameters", () => {
    search = "range=3Y&metric=yoy";
    render(<IndicatorWorkspace config={WPI_CONFIG} bundles={wpiBundles()} />);
    fireEvent.click(screen.getByRole("button", { name: /Base 2011-12/ }));
    expect(push).toHaveBeenLastCalledWith("/indicators/wpi?range=3Y&metric=yoy&base=2011-12", { scroll: false });
    search = "range=3Y&base=2011-12";
    cleanup();
    render(<IndicatorWorkspace config={WPI_CONFIG} bundles={wpiBundles()} />);
    fireEvent.click(screen.getByRole("button", { name: "Base 2022-23" }));
    expect(push).toHaveBeenLastCalledWith("/indicators/wpi?range=3Y", { scroll: false }); // primary needs no ?base=
  });
  it("?base= renders that series: base year in the chips, text and chart label (no other base leaks in)", () => {
    search = "base=2011-12";
    const { container } = render(<IndicatorWorkspace config={WPI_CONFIG} bundles={wpiBundles()} />);
    expect(screen.getByText("Base year: 2011-12")).toBeTruthy();
    expect(container.textContent).toContain("Base 2011-12 = 100");
    expect(container.textContent).not.toContain("Base 2022-23 = 100");
    expect(screen.getByText(/previous series \(2011-12 = 100\)/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /Base 2011-12/ }).getAttribute("aria-pressed")).toBe("true");
  });
  it("an unknown or not-stored base falls back to the primary series and says so", () => {
    search = "base=2004-05"; // registered, but not in this bundle list
    render(<IndicatorWorkspace config={WPI_CONFIG} bundles={wpiBundles()} />);
    expect(screen.getByRole("status").textContent).toMatch(/not stored for WPI/);
    expect(screen.getByRole("button", { name: "Base 2022-23" }).getAttribute("aria-pressed")).toBe("true");
    cleanup();
    search = "base=nonsense";
    render(<IndicatorWorkspace config={WPI_CONFIG} bundles={wpiBundles()} />);
    expect(screen.getByRole("status")).toBeTruthy();
  });
  it("no switcher when only one series is stored", () => {
    render(<IndicatorWorkspace config={WPI_CONFIG} bundles={[wpiBundles()[0]]} />);
    expect(screen.queryByRole("group", { name: "Series (base year)" })).toBeNull();
  });
  it("lists what is stored per series (first/last month, months)", () => {
    render(<IndicatorWorkspace config={WPI_CONFIG} bundles={wpiBundles()} />);
    const table = screen.getByRole("table", { name: /Stored official series for WPI/ });
    expect(table.textContent).toContain("Jan 2020");
    expect(table.textContent).toContain("Jun 2022");
    expect(table.textContent).toMatch(/Legacy \(closed\)|Archive \(closed\)/);
  });
  it("CPI 2012: sources name the 2012 series ids, never the 2024 ones", () => {
    search = "base=2012";
    const bundles = [bundle("cpi", 0, fixPayload("cpi", "2024")), bundle("cpi", 1, fixPayload("cpi", "2012", { series: "legacy2012" }, "source_final"))];
    const { container } = render(<IndicatorWorkspace config={CPI_CONFIG} bundles={bundles} />);
    const text = container.textContent ?? "";
    expect(text).toContain("mospi.cpi.2012.current.all_india.combined.general.index");
    expect(text).not.toContain("mospi.cpi.2024.current");
  });
  it("CPI back series is identified as its own series", () => {
    search = "base=back";
    const bundles = [bundle("cpi", 0, fixPayload("cpi", "2024", { series: "current" })), bundle("cpi", 2, fixPayload("cpi", "2024", { series: "back" }))];
    const { container } = render(<IndicatorWorkspace config={CPI_CONFIG} bundles={bundles} />);
    expect(container.textContent).toContain("mospi.cpi.2024.back.all_india.combined.general.index");
  });
  it("shows a 'Source flag' column only when the source supplied flags, and keeps unknown flags visible", () => {
    const plain = render(<IndicatorWorkspace config={CPI_CONFIG} bundles={[bundle("cpi", 0, fixPayload("cpi", "2024"))]} />);
    expect(plain.container.textContent).not.toContain("Source flag");
    plain.unmount();
    const flagged = render(<IndicatorWorkspace config={CPI_CONFIG} bundles={[bundle("cpi", 0, fixPayload("cpi", "2012", { series: "legacy2012" }, "source_status_F*"))]} />);
    expect(flagged.container.textContent).toContain("Source flag");
    expect(flagged.container.textContent).toContain("Flag F* (meaning not documented)");
  });
  it("IIP archive base explains why there is no official growth", () => {
    search = "base=2004-05";
    const bundles = [bundle("iip", 0, fixPayload("iip", "2022-23")), bundle("iip", 2, fixPayload("iip", "2004-05"))];
    const { container } = render(<IndicatorWorkspace config={IIP_CONFIG} bundles={bundles} />);
    expect(container.textContent).toContain("Official growth is not stored for archive base years.");
  });
  it("changing the date range keeps the chosen series in the URL", () => {
    search = "base=2011-12";
    render(<IndicatorWorkspace config={WPI_CONFIG} bundles={wpiBundles()} />);
    fireEvent.click(screen.getByRole("button", { name: "2Y" }));
    expect(push.mock.calls.at(-1)![0]).toContain("base=2011-12");
    expect(push.mock.calls.at(-1)![0]).toContain("range=2Y");
  });
});
