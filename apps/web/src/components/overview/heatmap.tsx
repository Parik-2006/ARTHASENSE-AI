import { type HeatRow, symmetricLimit } from "@/lib/overview";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Diverging colour: warm = higher, blue = lower, neutral at 0. Intensity is capped so text stays legible.
 *  Every cell prints its value, so colour is never the only channel. Missing months are hatched. */
function cellStyle(v: number | null, limit: number): React.CSSProperties {
  if (v === null) {
    return { backgroundImage: "repeating-linear-gradient(45deg, transparent 0 4px, var(--rule) 4px 5px)" };
  }
  const a = Math.min(0.75, (Math.abs(v) / limit) * 0.75);
  const base = v >= 0 ? "var(--up)" : "var(--down)";
  return { background: `color-mix(in srgb, ${base} ${Math.round(a * 100)}%, transparent)` };
}

export function Heatmap({ rows, unit, label }: { rows: HeatRow[]; unit: string; label: string }) {
  const limit = symmetricLimit(rows.flatMap((r) => r.cells));
  return (
    <div>
      <div className="relative overflow-x-auto" role="region" aria-label={`${label} heatmap, scrollable`} tabIndex={0}>
        <table className="w-full min-w-[36rem] border-separate border-spacing-0.5 text-center text-[11px]">
          <caption className="sr-only">{label}: values by year and month. Empty hatched cells have no stored value.</caption>
          <thead>
            <tr>
              <th scope="col" className="w-12 text-left font-normal text-ink-muted">Year</th>
              {MONTHS.map((m) => (
                <th key={m} scope="col" className="font-normal text-ink-muted">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.year}>
                <th scope="row" className="text-left font-medium">{r.year}</th>
                {r.cells.map((v, i) => (
                  <td
                    key={i}
                    style={cellStyle(v, limit)}
                    title={v === null ? `${MONTHS[i]} ${r.year}: no stored value` : `${MONTHS[i]} ${r.year}: ${v > 0 ? "+" : ""}${v.toFixed(2)}${unit}`}
                    className="figure h-8 rounded-sm"
                  >
                    {v === null ? <span className="sr-only">no data</span> : `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--down)" }} /> lower ({unit})</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm border border-rule" /> about zero</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={{ background: "var(--up)" }} /> higher ({unit})</span>
        <span className="inline-flex items-center gap-1"><span aria-hidden className="inline-block h-3 w-3 rounded-sm" style={cellStyle(null, 1)} /> no stored value</span>
        <span>Scale: ±{limit.toFixed(1)}{unit}. Colour shows direction, not good or bad.</span>
      </p>
    </div>
  );
}
