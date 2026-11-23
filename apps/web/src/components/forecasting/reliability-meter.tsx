import { METER } from "@/lib/forecast-evidence";
import type { ReliabilityLevel } from "@/lib/forecast-v2";

const FILL: Record<string, string> = { ok: "bg-ok", target: "bg-target", up: "bg-up", muted: "bg-rule" };
const TEXT: Record<string, string> = { ok: "text-ok", target: "text-target", up: "text-up", muted: "text-ink-muted" };

/** Three-bar track-record meter. The label always accompanies the bars, so meaning never rests on colour. */
export function ReliabilityMeter({ level, className = "" }: { level: ReliabilityLevel; className?: string }) {
  const m = METER[level];
  return (
    <span className={`inline-flex items-center gap-2 ${className}`} data-testid="reliability-meter" data-level={level}>
      <span aria-hidden className="inline-flex items-end gap-0.5">
        {[0, 1, 2].map((i) => (
          <span key={i} className={`w-1.5 rounded-sm ${i < m.filled ? FILL[m.tone] : "bg-rule"}`} style={{ height: 6 + i * 4 }} />
        ))}
      </span>
      <span className={`text-sm font-medium ${TEXT[m.tone]}`}>{m.short}</span>
    </span>
  );
}
