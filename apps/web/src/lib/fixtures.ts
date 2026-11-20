/** Test-only mocked API payloads (shape of services/api responses). Not real economic data. */

const prov = (key = "k1") => ({ release_key: key, retrieved_at: "2026-01-05T10:00:00Z", published_at: null });
const SOURCE = {
  code: "mospi",
  name: "Ministry of Statistics and Programme Implementation (MoSPI), eSankhyiki",
  url: "x",
};

export interface Obs {
  period: string;
  index: number | null;
  rate?: number | null;
}

function observations(obs: Obs[], rateField: string | null) {
  return obs.map((o) => ({
    period: o.period,
    index: o.index,
    ...(rateField ? { [rateField]: o.rate ?? null } : {}),
    index_source: o.index === null ? null : prov(),
    ...(rateField ? { [`${rateField}_source`]: o.rate == null ? null : prov() } : {}),
  }));
}

export const cpiPayload = (obs: Obs[]) => ({
  indicator: "CPI",
  base_year: "2024",
  series: "current",
  geography: "All India",
  sector: "Combined",
  division: "CPI (General)",
  source: SOURCE,
  count: obs.length,
  note: null,
  observations: observations(obs, "inflation"),
});

export const wpiPayload = (obs: Obs[]) => ({
  indicator: "WPI",
  base_year: "2022-23",
  geography: "India",
  coverage: "All commodities (headline)",
  source: SOURCE,
  publisher_note: "Compiled and published by the Office of the Economic Adviser, DPIIT; served via MoSPI",
  limitations: ["The source API provides the index only: there is no official inflation figure here."],
  count: obs.length,
  note: null,
  observations: observations(obs, null),
});

export const iipPayload = (obs: Obs[]) => ({
  indicator: "IIP",
  base_year: "2022-23",
  geography: "India",
  sector: { key: "general", label: "General (headline)" },
  source: SOURCE,
  count: obs.length,
  note: null,
  observations: observations(obs, "growth"),
});

export const iipSectorsPayload = (sectors: Record<string, Obs[]>) => ({
  indicator: "IIP",
  base_year: "2022-23",
  geography: "India",
  source: SOURCE,
  note: null,
  sectors: Object.entries(sectors).map(([key, obs]) => ({
    key,
    label: key[0].toUpperCase() + key.slice(1),
    observations: observations(obs, "growth"),
  })),
});
