"use client";

import type { ReactNode } from "react";
import { HelpTip } from "@/components/guide/help-tip";
import { OV_RANGES, type RangeSel } from "@/lib/overview";

export function Seg<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { key: T; label: string; disabled?: boolean }[];
  onChange: (k: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.key}
          type="button"
          disabled={o.disabled}
          aria-pressed={value === o.key}
          onClick={() => onChange(o.key)}
          className={`rounded border px-2.5 py-1 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 ${
            value === o.key ? "border-accent bg-accent text-accent-ink" : "border-rule hover:border-accent"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p role="status" className="rounded-md border border-dashed border-rule px-4 py-8 text-center text-sm text-ink-muted">{children}</p>;
}

export function SectionShell({ id, tour, title, help, intro, children }: { id: string; tour?: string; title: string; help?: string; intro?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} data-tour={tour} aria-labelledby={`${id}-h`} className="mt-10 scroll-mt-20">
      <h2 id={`${id}-h`} className="font-serif text-2xl font-semibold tracking-tight">
        {title}
        {help && <HelpTip id={help} />}
      </h2>
      {intro && <p className="mt-1 max-w-3xl text-sm text-ink-muted">{intro}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function Panel({ title, help, aside, children, className = "" }: { title: string; help?: string; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`min-w-0 rounded-md border border-rule bg-surface p-4 ${className}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">
          {title}
          {help && <HelpTip id={help} />}
        </h3>
        {aside}
      </div>
      {children}
    </div>
  );
}

export function downloadCsv(name: string, csv: string) {
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Shared time-range control. All instances read and write the same URL state (range, from, to). */
export function RangeBar({
  sel,
  error,
  fromIn,
  toIn,
  onPreset,
  onCustom,
  hidePresets = [],
}: {
  sel: RangeSel;
  error: string | null;
  fromIn: string;
  toIn: string;
  onPreset: (key: string) => void;
  onCustom: (from: string, to: string) => void;
  hidePresets?: string[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-tour="range">
      <Seg
        label="Time range"
        value={sel.key}
        options={OV_RANGES.filter((r) => !hidePresets.includes(r.key)).map((r) => ({ key: r.key, label: r.label }))}
        onChange={onPreset}
      />
      {sel.key === "Custom" && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label>
            From <input type="month" value={fromIn} onChange={(e) => onCustom(e.target.value, toIn)} className="rounded border border-rule bg-bg px-2 py-1" />
          </label>
          <label>
            To <input type="month" value={toIn} onChange={(e) => onCustom(fromIn, e.target.value)} className="rounded border border-rule bg-bg px-2 py-1" />
          </label>
        </div>
      )}
      <HelpTip id="history-gaps" label="Why some history is missing" />
      {error && <p role="alert" className="w-full text-xs text-up">{error}</p>}
    </div>
  );
}
