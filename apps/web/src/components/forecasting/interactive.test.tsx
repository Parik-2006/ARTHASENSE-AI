// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { OutlookChart, monthTicks, niceTicks, tooltipLines } from "@/components/forecasting/outlook-chart";
import { FORECAST_TOUR_EVENT, ForecastTourButton, isTargetAvailable, SpotlightTour } from "@/components/forecasting/spotlight-tour";
import { Segmented } from "@/components/forecasting/segmented";
import { parseView, ViewModeToggle, withView } from "@/components/forecasting/view-mode";
import { FORECAST_EXPLORER_STEPS, intersects, nextAvailable, placeTooltip, type SpotStep } from "@/lib/forecast-tours";
import { fc } from "@/lib/forecasting-fixtures";

const replace = vi.fn();
let search = "";
vi.mock("next/navigation", () => ({
  usePathname: () => "/forecasting/wpi",
  useRouter: () => ({ replace, push: vi.fn(), refresh: () => {} }),
  useSearchParams: () => new URLSearchParams(search),
}));

beforeAll(() => {
  // jsdom has no layout: give every element a non-zero box and stub the browser APIs the components use.
  Element.prototype.getBoundingClientRect = function () {
    return { top: 300, left: 100, width: 200, height: 80, right: 300, bottom: 380, x: 100, y: 300, toJSON: () => ({}) } as DOMRect;
  };
  Element.prototype.scrollIntoView = vi.fn();
  globalThis.ResizeObserver = class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  window.matchMedia = ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  search = "";
  replace.mockReset();
});

const flush = async () => {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
};
const start = async () => {
  await act(async () => {
    window.dispatchEvent(new Event(FORECAST_TOUR_EVENT));
  });
  await flush();
};

const STEPS: SpotStep[] = [
  { target: "a", title: "Step A", body: "Body A" },
  { target: "missing", title: "Missing", body: "Never shown" },
  { target: "b", title: "Step B", body: "Body B" },
  { target: "hidden", title: "Hidden", body: "Never shown either" },
  { target: "c", title: "Step C", body: "Body C" },
];

function Page() {
  return (
    <div>
      <ForecastTourButton>Take a tour</ForecastTourButton>
      <div data-tour="a">A</div>
      <div data-tour="b">B</div>
      <div style={{ display: "none" }}>
        <div data-tour="hidden">H</div>
      </div>
      <details>
        <summary>More</summary>
        <div data-tour="closed">inside closed details</div>
      </details>
      <div data-tour="c">C</div>
      <SpotlightTour steps={STEPS} />
    </div>
  );
}

describe("SpotlightTour", () => {
  it("opens from the button, spotlights the target, and moves Next/Back over missing and hidden targets", async () => {
    render(<Page />);
    const trigger = screen.getByText("Take a tour");
    trigger.focus();
    fireEvent.click(trigger);
    await flush();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveProperty("ariaModal", "true");
    expect(screen.getByText("Step A")).toBeTruthy();
    expect(screen.getByText("Step 1 of 3")).toBeTruthy(); // 5 steps, 2 unavailable
    expect(screen.getByTestId("spotlight-hole")).toBeTruthy();
    expect(Element.prototype.scrollIntoView).toHaveBeenCalled();
    expect((screen.getByText("Back") as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByText("Next"));
    await flush();
    expect(screen.getByText("Step B")).toBeTruthy(); // skipped "missing"
    fireEvent.click(screen.getByText("Next"));
    await flush();
    expect(screen.getByText("Step C")).toBeTruthy(); // skipped display:none
    expect(screen.getByText("Finish")).toBeTruthy();
    fireEvent.click(screen.getByText("Back"));
    await flush();
    expect(screen.getByText("Step B")).toBeTruthy();
  });

  it("supports arrow keys, Escape, and returns focus to the trigger", async () => {
    render(<Page />);
    const trigger = screen.getByText("Take a tour");
    trigger.focus();
    fireEvent.click(trigger);
    await flush();
    expect(document.activeElement).toBe(screen.getByRole("dialog"));
    fireEvent.keyDown(document, { key: "ArrowRight" });
    await flush();
    expect(screen.getByText("Step B")).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    await flush();
    expect(screen.getByText("Step A")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    await flush();
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("Finish and Skip close the tour", async () => {
    render(<Page />);
    await start();
    fireEvent.click(screen.getByText("Skip tour"));
    expect(screen.queryByRole("dialog")).toBeNull();
    await start();
    for (let i = 0; i < 2; i++) {
      fireEvent.click(screen.getByText("Next"));
      await flush();
    }
    fireEvent.click(screen.getByText("Finish"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("keeps Tab focus inside the card", async () => {
    render(<Page />);
    await start();
    fireEvent.click(screen.getByText("Next")); // enable Back so the card has three buttons
    await flush();
    const skip = screen.getByText("Skip tour");
    skip.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("Back"));
  });

  it("does not open at all when no step target exists (page state without the panels)", async () => {
    render(
      <div>
        <SpotlightTour steps={[{ target: "nope", title: "x", body: "y" }]} />
      </div>,
    );
    await start();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens a disclosure first when a step asks to reveal its target", async () => {
    function Reveal() {
      return (
        <div>
          <div data-tour="first">first</div>
          <button type="button" aria-expanded="false" data-tour="toggle" onClick={(e) => {
            e.currentTarget.setAttribute("aria-expanded", "true");
            const d = document.createElement("div");
            d.setAttribute("data-tour", "revealed");
            document.body.appendChild(d);
          }}>
            Details
          </button>
          <SpotlightTour steps={[{ target: "first", title: "First", body: "." }, { target: "revealed", title: "Revealed", body: ".", reveal: "toggle" }]} />
        </div>
      );
    }
    render(<Reveal />);
    await start();
    fireEvent.click(screen.getByText("Next"));
    await flush();
    expect(screen.getByText("Revealed")).toBeTruthy();
    expect(document.querySelector('[data-tour="revealed"]')).not.toBeNull();
  });

  it("treats closed <details> bodies and display:none as unavailable", () => {
    render(<Page />);
    expect(isTargetAvailable(document.querySelector('[data-tour="closed"]'))).toBe(false);
    expect(isTargetAvailable(document.querySelector('[data-tour="hidden"]'))).toBe(false);
    expect(isTargetAvailable(document.querySelector('[data-tour="a"]'))).toBe(true);
    expect(isTargetAvailable(null)).toBe(false);
  });

  it("explorer tour copy is short and plain", () => {
    for (const s of FORECAST_EXPLORER_STEPS) expect(s.body.length).toBeLessThanOrEqual(110);
    expect(FORECAST_EXPLORER_STEPS.find((s) => s.target === "fx-chart")?.body).toMatch(/Teal is official; yellow is the estimate/);
  });
});

describe("tour geometry (pure)", () => {
  const vpDesk = { width: 1440, height: 900 };
  const vpPhone = { width: 360, height: 740 };
  const tip = { width: 360, height: 190 };
  it("never covers the target when there is room, preferring below", () => {
    const t = { top: 200, left: 400, width: 300, height: 100 };
    const p = placeTooltip(t, tip, vpDesk);
    expect(p.placement).toBe("bottom");
    expect(intersects({ top: p.top, left: p.left, width: p.width, height: tip.height }, t)).toBe(false);
  });
  it("goes above when the target sits at the bottom of the screen", () => {
    expect(placeTooltip({ top: 760, left: 400, width: 300, height: 100 }, tip, vpDesk).placement).toBe("top");
  });
  it("stays inside a 360px viewport and docks when the target fills the screen", () => {
    const small = placeTooltip({ top: 100, left: 10, width: 340, height: 120 }, tip, vpPhone);
    expect(small.left).toBeGreaterThanOrEqual(8);
    expect(small.left + small.width).toBeLessThanOrEqual(352);
    const tall = placeTooltip({ top: 20, left: 0, width: 360, height: 700 }, tip, vpPhone);
    expect(tall.placement).toMatch(/^sheet-/);
    expect(tall.width).toBe(344);
  });
  it("nextAvailable skips unavailable steps and stops at the ends", () => {
    const ok = [true, false, false, true];
    expect(nextAvailable(4, 0, 1, (i) => ok[i])).toBe(3);
    expect(nextAvailable(4, 3, 1, (i) => ok[i])).toBeNull();
    expect(nextAvailable(4, 3, -1, (i) => ok[i])).toBe(0);
  });
});

describe("OutlookChart", () => {
  const history = Array.from({ length: 12 }, (_, i) => ({ period: `2026-${String(i + 1).padStart(2, "0")}-01`, index: 100 + i }));
  const rows = [
    { ...fc("2027-01-01", 112, 1, 110), lower_95: 109, upper_95: 115 },
    { ...fc("2027-02-01", 113, 2, 110), lower_95: 108, upper_95: 118 },
  ];
  it("tooltip shows month, value, source and both ranges, by keyboard", () => {
    render(<OutlookChart history={history} forecast={rows} name="WPI index" axisLabel="Index" officialSource="OEA via MoSPI" modelName="Drift" bandsTourId="fx-bands" />);
    const chart = screen.getByTestId("outlook-chart");
    fireEvent.keyDown(chart, { key: "End" });
    const tip = screen.getByTestId("chart-tooltip");
    expect(tip.textContent).toContain("February 2027");
    expect(tip.textContent).toContain("113.00");
    expect(tip.textContent).toContain("Model estimate · Drift");
    expect(tip.textContent).toContain("80% range 110.00 – 116.00");
    expect(tip.textContent).toContain("95% range 108.00 – 118.00");
    fireEvent.keyDown(chart, { key: "Home" });
    expect(screen.getByTestId("chart-tooltip").textContent).toContain("Official · OEA via MoSPI");
    fireEvent.keyDown(chart, { key: "Escape" });
    expect(screen.queryByTestId("chart-tooltip")).toBeNull();
  });
  it("has an accessible legend with both bands and the tour anchor", () => {
    render(<OutlookChart history={history} forecast={rows} name="WPI index" axisLabel="Index" officialSource="MoSPI" modelName="Drift" bandsTourId="fx-bands" />);
    const legend = screen.getByLabelText("Chart legend");
    expect(legend.textContent).toContain("Official history");
    expect(legend.textContent).toContain("Model estimate");
    expect(legend.textContent).toContain("80% range");
    expect(legend.textContent).toContain("95% range");
    expect(document.querySelector('[data-tour="fx-bands"]')).not.toBeNull();
  });
  it("labels the origin boundary and says 'no range' for interval-less models", () => {
    render(<OutlookChart history={history} forecast={[fc("2027-01-01", 112, 1)]} name="x" axisLabel="x" officialSource="MoSPI" modelName="XGB" />);
    // jsdom has no layout, so the chart uses its 240px minimum: the narrow single-label form, never clipped.
    expect(document.body.textContent).toContain("Forecast ▸");
    expect(document.body.textContent).not.toContain("Forecast →");
    fireEvent.keyDown(screen.getByTestId("outlook-chart"), { key: "End" });
    expect(screen.getByTestId("chart-tooltip").textContent).toContain("Uncertainty interval unavailable for this model");
    expect(screen.getByLabelText("Chart legend").textContent).not.toContain("80% range");
  });
  it("helpers: tooltip text, nice ticks, collision-free month ticks", () => {
    expect(tooltipLines({ n: 1, period: "2026-01-01", value: 100, forecast: false }, "MoSPI", "Drift").source).toBe("Official · MoSPI");
    expect(niceTicks(98.3, 121.7, 5)).toEqual([100, 105, 110, 115, 120]);
    const ticks = monthTicks(24300, 24360, 300); // 60 months on a narrow phone plot
    expect(ticks.length).toBeLessThanOrEqual(Math.floor(300 / 76));
  });
});

describe("Simple / Research view toggle", () => {
  it("parses and serialises the URL value, never forwarding other values", () => {
    expect(parseView("research")).toBe("research");
    expect(parseView("anything")).toBe("simple");
    expect(withView(new URLSearchParams("model=ets"), "research").toString()).toBe("model=ets&view=research");
    expect(withView(new URLSearchParams("model=ets&view=research"), "simple").toString()).toBe("model=ets");
  });
  it("switches with click and arrow keys, keeping other parameters", () => {
    search = "model=ets&horizon=3";
    render(<ViewModeToggle />);
    const research = screen.getByRole("radio", { name: "Research" });
    expect(screen.getByRole("radio", { name: "Simple" }).getAttribute("aria-checked")).toBe("true");
    fireEvent.click(research);
    expect(replace).toHaveBeenCalledWith("/forecasting/wpi?model=ets&horizon=3&view=research", { scroll: false });
    fireEvent.keyDown(screen.getByRole("radio", { name: "Simple" }), { key: "ArrowRight" });
    expect(replace).toHaveBeenCalledTimes(2);
  });
});

describe("Segmented radio group", () => {
  it("has one tab stop and moves selection with arrows, Home and End", () => {
    const onChange = vi.fn();
    const { rerender } = render(<Segmented label="Horizon" value={3} onChange={onChange} options={[1, 3, 6].map((h) => ({ value: h, label: `${h} mo` }))} />);
    const radios = screen.getAllByRole("radio");
    expect(radios.map((r) => r.getAttribute("tabindex"))).toEqual(["-1", "0", "-1"]);
    expect(screen.getByRole("radiogroup", { name: "Horizon" })).toBeTruthy();
    fireEvent.keyDown(radios[1], { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(radios[1], { key: "ArrowLeft" });
    expect(onChange).toHaveBeenLastCalledWith(1);
    fireEvent.keyDown(radios[1], { key: "End" });
    expect(onChange).toHaveBeenLastCalledWith(6);
    fireEvent.keyDown(radios[1], { key: "Home" });
    expect(onChange).toHaveBeenLastCalledWith(1);
    rerender(<Segmented label="Horizon" value={6} onChange={onChange} options={[1, 3, 6].map((h) => ({ value: h, label: `${h} mo` }))} />);
    fireEvent.keyDown(screen.getAllByRole("radio")[2], { key: "ArrowRight" });
    expect(onChange).toHaveBeenLastCalledWith(1); // wraps
  });
});
