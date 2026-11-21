"use client";

import { HelpTip } from "@/components/guide/help-tip";

/** Indicators-page topic names mapped onto the shared ArthaGuide entries (lib/guide.ts HELP). */
const TOPIC: Record<string, string> = {
  index: "index-value",
  baseYear: "base-year",
  mom: "mom",
  yoy: "yoy",
  official: "official",
  range: "range",
  movingAverage: "moving-average",
  heatmap: "heatmap",
  seasonal: "seasonal",
  sectors: "sectors",
  source: "source",
  missing: "missing",
  compare: "comparison",
  indicators: "indicators",
  trend: "trend-chart",
};

export type GuideKey = keyof typeof TOPIC;

export function Help({ topic, label }: { topic: GuideKey; label?: string }) {
  return <HelpTip id={TOPIC[topic]} label={label} />;
}
