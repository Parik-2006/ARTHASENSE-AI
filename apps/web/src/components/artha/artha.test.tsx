// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Help } from "@/components/artha/help";
import { Tour, TourButton } from "@/components/guide/tour";
import { SeriesChart } from "@/components/indicators/series-chart";
import { SourceAttribution } from "@/components/source/source-attribution";
import { HELP, INDICATORS_TOUR, OVERVIEW_TOUR } from "@/lib/guide";
import { IIP_CONFIG } from "@/lib/indicators";
import { FORMULA, sourceFor } from "@/lib/source";

afterEach(cleanup);

// jsdom has no ResizeObserver / scrollIntoView
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
Element.prototype.scrollIntoView = () => {};
window.matchMedia = window.matchMedia || ((() => ({ matches: false, addEventListener() {}, removeEventListener() {} })) as never);

describe("shared Tour (Overview + Indicators use the same component)", () => {
  const steps = INDICATORS_TOUR.slice(0, 3);
  const start = () => {
    render(<><TourButton>Take a Tour</TourButton><Tour steps={steps} /></>);
    fireEvent.click(screen.getByText("Take a Tour"));
  };
  it("starts from a button, moves with Next/Back, and shows progress", () => {
    render(<><TourButton>Take a Tour</TourButton><Tour steps={steps} /></>);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Take a Tour"));
    expect(screen.getByText(/Step 1 of 3/)).toBeTruthy();
    expect((screen.getByText("Back") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText(/Step 2 of 3/)).toBeTruthy();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText(/Step 1 of 3/)).toBeTruthy();
  });
  it("Skip and Close end it; it can be restarted; Finish on the last step", () => {
    start();
    fireEvent.click(screen.getByText("Skip tour"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Take a Tour"));
    expect(screen.getByText(/Step 1 of 3/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close tour"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Take a Tour"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Next"));
    fireEvent.click(screen.getByText("Finish"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("arrow keys move and Escape closes; the card is non-modal", () => {
    start();
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("false");
    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByText(/Step 2 of 3/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByText(/Step 1 of 3/)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("page tours are independent and every step has a target", () => {
    for (const t of [OVERVIEW_TOUR, INDICATORS_TOUR]) {
      expect(t.length).toBeGreaterThan(5);
      expect(t.every((x) => x.target && x.title && x.body)).toBe(true);
    }
    expect(INDICATORS_TOUR.map((x) => x.target)).not.toContain("hero");
  });
});

describe("Help (shared ArthaGuide popover)", () => {
  it("answers the four questions, toggles, and closes with Escape", () => {
    render(<Help topic="yoy" />);
    const btn = screen.getByRole("button", { name: /Explain/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    for (const q of ["What is it?", "Why it matters:", "How to read it:", "Common mistake:"]) expect(screen.getByText(q)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("What is it?")).toBeNull();
  });
  it("every Indicators topic resolves to a shared HELP entry", () => {
    for (const id of ["index-value", "base-year", "mom", "yoy", "official", "range", "moving-average", "heatmap", "seasonal", "sectors", "source", "missing", "comparison", "indicators", "trend-chart"]) {
      expect(HELP[id], id).toBeTruthy();
    }
  });
});

describe("SourceAttribution (shared)", () => {
  const src = { ...sourceFor(IIP_CONFIG, null), baseYear: "2022-23", seriesIds: ["mospi.iip.2022-23.india.general.index"] };
  it("shows class, publisher, series id and publisher site; never invents a release date", () => {
    render(<SourceAttribution cls="calculated" sources={[src]} period="Apr 2023 – Sep 2026" method={FORMULA.yoy} />);
    expect(screen.getAllByText("Calculated by ArthaSense").length).toBeGreaterThan(0);
    expect(screen.getByText("mospi.iip.2022-23.india.general.index")).toBeTruthy();
    expect(screen.getByText("https://esankhyiki.mospi.gov.in/")).toBeTruthy();
    expect(screen.getByText(/Release date not provided/)).toBeTruthy();
    expect(screen.getAllByText(/YoY % = /).length).toBeGreaterThan(0);
  });
  it("says so explicitly when there is no source", () => {
    render(<SourceAttribution cls="official" sources={[]} period="n/a" />);
    expect(screen.getAllByText(/unavailable/i).length).toBeGreaterThan(0);
  });
});

describe("SeriesChart", () => {
  const pts = [
    { n: 100, label: "Jan", value: 1.5, tip: [] },
    { n: 101, label: "Feb", value: -0.5, tip: [] },
    { n: 103, label: "Apr", value: 2, tip: [] }, // Mar missing
  ];
  it("bar mode draws a zero line and one bar per observed month, negatives distinct", () => {
    const { container } = render(<SeriesChart points={pts} mode="bar" name="MoM" yLabel="%" suffix="%" />);
    expect(screen.getByTestId("zero-line")).toBeTruthy();
    const bars = container.querySelectorAll('[data-testid="bar"]');
    expect(bars).toHaveLength(3);
    expect(bars[1].getAttribute("class")).toContain("fill-warn");
    expect(bars[0].getAttribute("class")).toContain("fill-accent");
  });
  it("line mode breaks the line at a missing month instead of bridging it", () => {
    const { container } = render(<SeriesChart points={pts} mode="line" name="MoM" yLabel="%" />);
    expect(container.querySelectorAll("polyline")).toHaveLength(2);
  });
  it("tooltip shows the exact value via keyboard", () => {
    const { container } = render(<SeriesChart points={pts} mode="line" name="MoM" yLabel="%" suffix="%" />);
    const svg = container.querySelector("svg")!;
    fireEvent.keyDown(svg, { key: "End" });
    expect(container.textContent).toContain("MoM 2.00%");
  });
});
