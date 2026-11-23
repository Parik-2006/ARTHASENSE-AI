/** Forecasts guided tours: step content and the pure geometry/navigation used by the spotlight tour.
 *  Separate from lib/guide.ts (shared with Overview and Indicators), which is left unchanged. */

export interface SpotStep {
  /** `data-tour` value of the element to spotlight. */
  target: string;
  title: string;
  body: string;
  /** Optional `data-tour` of a disclosure button to open first (clicked only if aria-expanded="false"). */
  reveal?: string;
}

export const FORECAST_OVERVIEW_STEPS: SpotStep[] = [
  { target: "fo-cards", title: "Forecast cards", body: "Each card is one indicator. Start here to see where it may head next." },
  { target: "fo-official", title: "Official vs predicted", body: "The first figure is the latest official value. The second is the model's estimate, not official data." },
  { target: "fo-reliability", title: "Reliability", body: "How well this model did when tested on past data. More filled bars mean a stronger track record." },
  { target: "fo-chart", title: "Forecast chart", body: "The teal line is official history. The yellow line shows the model's estimate of what may happen next." },
  { target: "fo-explore", title: "Explore forecast", body: "Open the full chart, switch models and see the uncertainty range." },
];

export const FORECAST_EXPLORER_STEPS: SpotStep[] = [
  { target: "fx-official", title: "Official observation", body: "The latest value published by the government. Everything after it on the chart is a model estimate." },
  { target: "fx-model", title: "Model", body: "Pick a forecasting method. Each one was tested on past data before being shown here." },
  { target: "fx-horizon", title: "Forecast horizon", body: "Choose how many months ahead to look. Further ahead means more uncertainty." },
  { target: "fx-chart", title: "Interactive chart", body: "Hover, tap or use the arrow keys to read any month. Teal is official; yellow is the estimate." },
  { target: "fx-bands", title: "Uncertainty bands", body: "The shaded bands show likely ranges (80% and 95%). Actual values can still land outside them." },
  { target: "fx-reliability", title: "Reliability", body: "How this model performed in past tests, in plain terms." },
  { target: "fx-view", title: "Research View", body: "Switch here for error metrics, backtest details, data fingerprints and CSV downloads." },
];

export const COMPARISON_STEPS: SpotStep[] = [
  { target: "fc-indicator", title: "Indicator", body: "Choose which indicator's models to compare." },
  { target: "fc-horizon", title: "Forecast horizon", body: "Compare accuracy for forecasts made this many months ahead." },
  { target: "fc-table", title: "Comparison table", body: "Average error per model, all tested on the same past months. Lower error is generally better." },
  { target: "fc-chart", title: "Error chart", body: "The same errors as bars. The grey bar is the naive baseline." },
  { target: "fc-baseline", title: "Baseline", body: "The naive baseline just repeats the last value. A model is only useful if it beats it." },
];

export const EXPERIMENTS_STEPS: SpotStep[] = [
  { target: "fe-filters", title: "Filters", body: "Search by run number or model, or narrow by indicator, model and status." },
  { target: "fe-table", title: "Experiment list", body: "Every stored run, including skipped ones, so nothing is hidden." },
  { target: "fe-details", title: "Run details", body: "Expand a row to see its training window, test window and scores." },
  { target: "fe-repro", title: "Reproducibility", body: "Fingerprints identify the exact data and test months, so the run can be reproduced.", reveal: "fe-details" },
];

// ---------- navigation ----------

/** Next index in `dir` (+1/-1) whose target is available, or null when there is none. */
export function nextAvailable(count: number, from: number, dir: 1 | -1, available: (i: number) => boolean): number | null {
  for (let i = from + dir; i >= 0 && i < count; i += dir) if (available(i)) return i;
  return null;
}

// ---------- geometry ----------

export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export type Placement = "bottom" | "top" | "right" | "left" | "sheet-bottom" | "sheet-top";

export interface Placed {
  placement: Placement;
  top: number;
  left: number;
  width: number;
}

const MARGIN = 8;

export function intersects(a: Rect, b: Rect): boolean {
  return a.left < b.left + b.width && b.left < a.left + a.width && a.top < b.top + b.height && b.top < a.top + a.height;
}

/** Positions a tooltip of `tip` size next to `target` inside the viewport without covering it. Tries below,
 *  above, right, left; if nothing fits (small screens, very tall targets) docks to the screen edge with more free
 *  space, keeping as much of the target visible as possible. */
export function placeTooltip(target: Rect, tip: { width: number; height: number }, vp: { width: number; height: number }, gap = 12): Placed {
  const w = Math.min(tip.width, vp.width - 2 * MARGIN);
  const h = tip.height;
  const clampX = (x: number) => Math.min(Math.max(MARGIN, x), vp.width - w - MARGIN);
  const clampY = (y: number) => Math.min(Math.max(MARGIN, y), vp.height - h - MARGIN);
  const cx = clampX(target.left + target.width / 2 - w / 2);
  const cy = clampY(target.top + target.height / 2 - h / 2);
  const options: Placed[] = [
    { placement: "bottom", top: target.top + target.height + gap, left: cx, width: w },
    { placement: "top", top: target.top - gap - h, left: cx, width: w },
    { placement: "right", top: cy, left: target.left + target.width + gap, width: w },
    { placement: "left", top: cy, left: target.left - gap - w, width: w },
  ];
  const fits = (p: Placed) =>
    p.top >= MARGIN && p.left >= MARGIN && p.top + h <= vp.height - MARGIN && p.left + w <= vp.width - MARGIN && !intersects({ top: p.top, left: p.left, width: w, height: h }, target);
  const ok = options.find(fits);
  if (ok) return ok;
  // Dock: put the card on the side of the screen that leaves more of the target visible.
  const above = Math.max(0, target.top);
  const below = Math.max(0, vp.height - (target.top + target.height));
  const sw = vp.width - 2 * MARGIN;
  return below >= above
    ? { placement: "sheet-bottom", top: vp.height - h - MARGIN, left: MARGIN, width: sw }
    : { placement: "sheet-top", top: MARGIN, left: MARGIN, width: sw };
}
