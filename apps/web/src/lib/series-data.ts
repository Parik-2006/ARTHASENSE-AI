/** Server-side loader shared by Overview V2 and the Indicators pages: every stored official series of an
 *  indicator, fetched from the same API/database. One request per series; a failure of an optional
 *  (non-primary) series never breaks the page. Bases are returned side by side, never merged. */

import { getIipSectors, getIndicator } from "@/lib/api";
import type { IipSectorsResult } from "@/lib/iip-sectors";
import type { IndicatorKey, IndicatorResult } from "@/lib/indicator";
import { type SeriesOption, SERIES_OPTIONS } from "@/lib/series-options";

export interface SeriesBundle {
  option: SeriesOption;
  result: IndicatorResult;
  /** IIP only: sector totals for this base (null where the base has none or the indicator is not IIP). */
  sectors: IipSectorsResult | null;
}

const hasIndex = (r: IndicatorResult) => r.ok && r.data.observations.some((o) => o.index !== null);

export async function loadAllSeries(key: IndicatorKey): Promise<SeriesBundle[]> {
  const options = SERIES_OPTIONS[key];
  const bundles = await Promise.all(
    options.map(async (option): Promise<SeriesBundle> => {
      const result = await getIndicator(key, option.query);
      const sectorBases = ["2022-23", "2011-12"]; // bases that store sector totals
      const sectors = key === "iip" && sectorBases.includes(option.baseYear) ? await getIipSectors(option.baseYear) : null;
      return { option, result, sectors };
    }),
  );
  // Keep the primary series always (so errors surface); drop optional series that hold no data.
  return bundles.filter((b, i) => i === 0 || hasIndex(b.result));
}
