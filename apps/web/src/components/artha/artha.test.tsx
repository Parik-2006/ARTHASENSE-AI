// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Help } from "@/components/artha/help";
import { SourceAttribution } from "@/components/artha/source-attribution";
import { INDICATOR_TOUR, Tour } from "@/components/artha/tour";
import { SeriesChart } from "@/components/indicators/series-chart";
import { calculatedItem, FORMULA, officialItem } from "@/lib/provenance";

afterEach(cleanup);

// jsdom has no ResizeObserver
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });

describe("Tour", () => {
  const steps = INDICATOR_TOUR.slice(0, 3);
  it("opens, moves with Next/Back, shows progress, and restarts after closing", () => {
    render(<Tour steps={steps} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Take a tour"));
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    expect((screen.getByText("Back") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByText("Next"));
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("2");
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("Close tour"));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Take a tour")); // restart
    expect(screen.getByText("Step 1 of 3")).toBeTruthy();
  });
  it("Skip closes; last step offers Done; arrows and Escape work", () => {
    render(<Tour steps={steps} />);
    fireEvent.click(screen.getByText("Take a tour"));
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(screen.getByText("Step 3 of 3")).toBeTruthy();
    expect(screen.getByText("Done")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(screen.getByText("Step 2 of 3")).toBeTruthy();
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByText("Take a tour"));
    fireEvent.click(screen.getByText("Skip"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("is non-modal so the page stays usable", () => {
    render(<Tour steps={steps} />);
    fireEvent.click(screen.getByText("Take a tour"));
    expect(screen.getByRole("dialog").getAttribute("aria-modal")).toBe("false");
  });
});

describe("Help (ArthaGuide popover)", () => {
  it("answers the four questions, toggles, and closes with Escape", () => {
    render(<Help topic="yoy" />);
    const btn = screen.getByRole("button", { name: /Explain: Year-over-year/ });
    expect(btn.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(btn);
    for (const q of ["What is it?", "Why useful?", "How to read it", "Avoid this mistake"]) expect(screen.getByText(q)).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByText("What is it?")).toBeNull();
  });
});

describe("SourceAttribution", () => {
  const base = officialItem({
    label: "CPI index", publisher: "MoSPI", dataset: "CPI", seriesId: "mospi.cpi.x", coverage: "All India",
    baseYear: "2024", period: "Jan 2025 – Dec 2025", retrievedAt: "2026-01-01T00:00:00Z",
  });
  it("lists every contributing source with its class and never invents a publication date", () => {
    render(<SourceAttribution items={[base, calculatedItem(base, "MoM", FORMULA.mom, "%")]} />);
    expect(screen.getByText("Official")).toBeTruthy();
    expect(screen.getByText("Calculated by ArthaSense")).toBeTruthy();
    expect(screen.getAllByText("Not provided by the source").length).toBeGreaterThan(0);
    expect(screen.getByText(/MoM % = /)).toBeTruthy();
  });
  it("says so explicitly when there is no metadata", () => {
    render(<SourceAttribution items={[]} />);
    expect(screen.getByText(/Source metadata is unavailable/)).toBeTruthy();
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
