import { type Observation, parseIndicatorResponse } from "@/lib/indicator";

export interface IipSector {
  key: string;
  label: string;
  observations: Observation[]; // chronological
}

export interface IipSectors {
  baseYear: string;
  sectors: IipSector[];
  note: string | null;
}

export type IipSectorsResult = { ok: true; data: IipSectors } | { ok: false; error: string };

/** Parses /api/v1/indicators/iip/sectors by reusing the strict single-series parser per sector. */
export function parseIipSectors(json: unknown): IipSectors | null {
  if (typeof json !== "object" || json === null) return null;
  const j = json as Record<string, unknown>;
  if (typeof j.base_year !== "string" || !Array.isArray(j.sectors)) return null;
  const sectors: IipSector[] = [];
  for (const s of j.sectors) {
    if (typeof s !== "object" || s === null) return null;
    const sec = s as Record<string, unknown>;
    if (typeof sec.key !== "string" || typeof sec.label !== "string") return null;
    const parsed = parseIndicatorResponse(
      {
        base_year: j.base_year,
        geography: j.geography ?? "India",
        source: j.source,
        sector: { label: sec.label },
        observations: sec.observations,
      },
      "iip",
    );
    if (!parsed) return null;
    sectors.push({ key: sec.key, label: sec.label, observations: parsed.observations });
  }
  return { baseYear: j.base_year, sectors, note: typeof j.note === "string" ? j.note : null };
}
