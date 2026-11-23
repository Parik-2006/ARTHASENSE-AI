"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/** Simple View (default) or Research View. Lives in the Forecasts URL as `?view=research` so it can be shared and
 *  survives tab changes inside Forecasts. It is never forwarded to Overview or Indicators. */
export type ViewMode = "simple" | "research";

export const parseView = (v: string | null | undefined): ViewMode => (v === "research" ? "research" : "simple");

/** Copies `params`, then sets or clears `view` (simple is the default, so it is omitted). */
export function withView(params: URLSearchParams, view: ViewMode): URLSearchParams {
  const p = new URLSearchParams(params.toString());
  if (view === "research") p.set("view", "research");
  else p.delete("view");
  return p;
}

export function useViewMode(): ViewMode {
  const params = useSearchParams();
  return parseView(params?.get("view"));
}

const opt = "rounded px-3 py-1 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function ViewModeToggle() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const view = parseView(params?.get("view"));
  const set = (v: ViewMode) => {
    if (v === view) return;
    const q = withView(new URLSearchParams(params?.toString() ?? ""), v).toString();
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false });
  };
  return (
    <div role="radiogroup" aria-label="Detail level" data-tour="fx-view" className="inline-flex shrink-0 rounded-md border border-rule bg-surface p-0.5">
      {(["simple", "research"] as const).map((v) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={view === v}
          onClick={() => set(v)}
          onKeyDown={(e) => {
            if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
              e.preventDefault();
              set(v === "simple" ? "research" : "simple");
              const other = [...(e.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role="radio"]') ?? [])].find((b) => b !== e.currentTarget);
              other?.focus();
            }
          }}
          tabIndex={view === v ? 0 : -1}
          className={`${opt} ${view === v ? "bg-accent font-medium text-accent-ink" : "text-ink-muted hover:text-ink"}`}
        >
          {v === "simple" ? "Simple" : "Research"}
        </button>
      ))}
    </div>
  );
}
