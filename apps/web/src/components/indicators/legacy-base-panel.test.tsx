// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LegacyBasePanel } from "@/components/indicators/legacy-base-panel";
import { iipPayload, wpiPayload } from "@/lib/fixtures";
import { type IndicatorKey, type IndicatorResult, parseIndicatorResponse } from "@/lib/indicator";
import { IIP_CONFIG, WPI_CONFIG } from "@/lib/indicators";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {}, push: () => {} }),
  usePathname: () => "/indicators/wpi",
  useSearchParams: () => new URLSearchParams(""),
}));
vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} unobserve() {} });
afterEach(cleanup);

const obs = Array.from({ length: 24 }, (_, i) => {
  const n = 2024 * 12 + i;
  return { period: `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`, index: 150 + i, rate: null };
});
const res = (kind: IndicatorKey, payload: unknown): IndicatorResult => ({ ok: true, data: parseIndicatorResponse(payload, kind)! });

describe("LegacyBasePanel", () => {
  it("renders nothing when the indicator has no previous-base request", () => {
    const { container } = render(<LegacyBasePanel config={WPI_CONFIG} result={null} />);
    expect(container.innerHTML).toBe("");
  });

  it("states honestly that nothing is stored instead of inventing history", () => {
    const empty = res("wpi", wpiPayload([]));
    render(<LegacyBasePanel config={WPI_CONFIG} result={empty} />);
    expect(screen.getByText(/No previous-base WPI observations are stored/)).toBeTruthy();
    expect(screen.getByText(/Nothing has been estimated/)).toBeTruthy();
  });

  it("shows the previous base as its own labelled segment, never joined to the current base", () => {
    render(<LegacyBasePanel config={WPI_CONFIG} result={res("wpi", wpiPayload(obs))} />);
    expect(screen.getByText(/Previous base year \(separate segment\)/)).toBeTruthy();
    const note = screen.getByTestId("legacy-note").textContent ?? "";
    expect(note).toMatch(/kept apart/);
    expect(note).toMatch(/no line, monthly or yearly change crosses between them/);
    expect(note).toMatch(/none is applied/);
    expect(screen.getAllByTestId("source-attribution").length).toBeGreaterThan(0);
  });

  it("works for IIP and exposes the base year it is drawn from", () => {
    render(<LegacyBasePanel config={IIP_CONFIG} result={res("iip", iipPayload(obs))} />);
    expect(screen.getByText(/Previous base year \(separate segment\)/)).toBeTruthy();
    expect(screen.getByTestId("legacy-note").textContent).toMatch(/24 months/);
  });

  it("a failed request shows the honest empty state, not an error stack", () => {
    const failed = { ok: false, error: "boom" } as unknown as IndicatorResult;
    render(<LegacyBasePanel config={WPI_CONFIG} result={failed} />);
    expect(screen.getByText(/No previous-base WPI observations are stored/)).toBeTruthy();
  });
});
