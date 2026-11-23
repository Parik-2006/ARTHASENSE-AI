/** Cross-page consistency: Forecasts must read the SAME official series that Indicators shows as "current", link to
 *  existing routes only, and never substitute another base year. Read-only checks against shared modules. */
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { indicatorHref } from "@/lib/forecast-evidence";
import { INDICATOR_IDS } from "@/lib/forecasting";
import { CONFIGS } from "@/lib/indicators";
import { SERIES_OPTIONS } from "@/lib/series-options";
import { seriesIds } from "@/lib/source";

// Mirrors services/api/app/forecasting.py INDICATOR_SERIES (a backend test checks it against the indicators API).
const TRAINED: Record<string, { code: string; base: string }> = {
  cpi: { code: "mospi.cpi.2024.current.all_india.combined.general.index", base: "2024" },
  wpi: { code: "mospi.wpi.2022-23.india.all_commodities.index", base: "2022-23" },
  iip: { code: "mospi.iip.2022-23.india.general.index", base: "2022-23" },
};
const APP = path.resolve(__dirname, "../app");

describe("Forecasts and Indicators read the same official series", () => {
  for (const id of INDICATOR_IDS) {
    it(`${id.toUpperCase()}: Forecasts' history request equals Indicators' current-series request`, () => {
      const current = SERIES_OPTIONS[id][0];
      expect(current.role).toBe("current");
      expect(CONFIGS[id].apiQuery).toBe(current.query); // identical API call => identical latest observation
    });
    it(`${id.toUpperCase()}: the trained series is the current series with the same base year`, () => {
      expect(SERIES_OPTIONS[id][0].baseYear).toBe(TRAINED[id].base);
      expect(seriesIds(id, TRAINED[id].base, "general", id === "cpi" ? "current" : null)[0]).toBe(TRAINED[id].code);
    });
  }
  it("no other base-year option shares the trained series code (no silent substitution)", () => {
    for (const id of INDICATOR_IDS)
      for (const o of SERIES_OPTIONS[id].slice(1))
        expect(seriesIds(id, o.baseYear, "general", o.cpiSeries ?? null)[0]).not.toBe(TRAINED[id].code);
  });
});

describe("Forecasts links open existing pages", () => {
  it("historical links target existing Indicators routes; overview link targets the home page", () => {
    for (const id of INDICATOR_IDS) {
      const href = indicatorHref(id).split("?")[0];
      expect(fs.existsSync(path.join(APP, href, "page.tsx"))).toBe(true);
    }
    expect(fs.existsSync(path.join(APP, "page.tsx"))).toBe(true);
    for (const r of ["forecasting", "forecasting/comparison", "forecasting/experiments", "forecasting/experiments/[id]"])
      expect(fs.existsSync(path.join(APP, r, "page.tsx"))).toBe(true);
  });
});
