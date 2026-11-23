"use client";

import { useRef } from "react";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** WAI-ARIA radio group as a segmented control: one tab stop (the checked option), ←/→ (and ↑/↓) move and select,
 *  Home/End jump to the ends. Disabled options are skipped. */
export function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  label,
  labelledBy,
  size = "md",
}: {
  options: { value: T; label: string; title?: string; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
  label?: string;
  labelledBy?: string;
  size?: "md" | "sm";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const enabled = options.filter((o) => !o.disabled);
  const current = enabled.some((o) => o.value === value) ? value : enabled[0]?.value;
  const move = (to: T) => {
    onChange(to);
    const i = options.findIndex((o) => o.value === to);
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[i]?.focus();
  };
  const onKey = (e: React.KeyboardEvent, v: T) => {
    const i = enabled.findIndex((o) => o.value === v);
    let n: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") n = (i + 1) % enabled.length;
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") n = (i - 1 + enabled.length) % enabled.length;
    else if (e.key === "Home") n = 0;
    else if (e.key === "End") n = enabled.length - 1;
    if (n === null) return;
    e.preventDefault();
    move(enabled[n].value);
  };
  const pad = size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm";
  return (
    <div ref={ref} role="radiogroup" aria-label={label} aria-labelledby={labelledBy} className="inline-flex max-w-full flex-wrap rounded-md border border-rule bg-surface p-0.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            disabled={o.disabled}
            tabIndex={o.value === current ? 0 : -1}
            onClick={() => !on && onChange(o.value)}
            onKeyDown={(e) => onKey(e, o.value)}
            className={`rounded ${pad} ${focusRing} disabled:cursor-not-allowed disabled:text-ink-muted ${on ? "bg-accent font-medium text-accent-ink" : "text-ink-muted hover:text-ink"}`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
