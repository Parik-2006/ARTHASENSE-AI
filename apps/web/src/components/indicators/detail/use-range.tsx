"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { RangeBar } from "@/components/overview/v3/ui";
import { parseRange, type RangeSel, ymNumber } from "@/lib/overview";

export const YEARS = [2022, 2023, 2024, 2025, 2026];

/** The one historical-range state used by the Overview and every Indicators view: `?range=&from=&to=` in the URL.
 *  Presets push a history entry (Back/Forward step through them); typing custom months replaces it. Other
 *  parameters (for example `base`) are kept. Invalid URL values fall back to All and say so. */
export function useRange(seed: () => { from: string; to: string } | null) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const { sel, error } = parseRange(params.get("range"), params.get("from"), params.get("to"));
  const [fromIn, setFromIn] = useState(sel.from ?? "");
  const [toIn, setToIn] = useState(sel.to ?? "");
  const [synced, setSynced] = useState(`${sel.from}|${sel.to}`);
  if (synced !== `${sel.from}|${sel.to}`) {
    // URL changed (Back/Forward or a link): keep the inputs in step with it.
    setSynced(`${sel.from}|${sel.to}`);
    setFromIn(sel.from ?? "");
    setToIn(sel.to ?? "");
  }

  const go = (patch: Record<string, string | null>, replace = false) => {
    const p = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) p.delete(k);
      else p.set(k, v);
    }
    const q = p.toString();
    const url = q ? `${pathname}?${q}` : pathname;
    if (replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  };

  const valid = (f: string, t: string) => ymNumber(f) !== null && ymNumber(t) !== null && ymNumber(f)! <= ymNumber(t)!;
  const onPreset = (key: string) => {
    if (key === "Custom") {
      const s = valid(fromIn, toIn) ? { from: fromIn, to: toIn } : seed();
      if (!s) return;
      setFromIn(s.from);
      setToIn(s.to);
      go({ range: "Custom", from: s.from, to: s.to });
    } else go({ range: key === "All" ? null : key, from: null, to: null });
  };
  const onCustom = (f: string, t: string) => {
    setFromIn(f);
    setToIn(t);
    if (valid(f, t)) go({ range: "Custom", from: f, to: t }, true);
  };
  /** A calendar year is a Custom range January–December, so it shares every Custom code path (and the URL). */
  const onYear = (y: number) => {
    setFromIn(`${y}-01`);
    setToIn(`${y}-12`);
    go({ range: "Custom", from: `${y}-01`, to: `${y}-12` });
  };
  const customBad = !!fromIn && !!toIn && ymNumber(fromIn) !== null && ymNumber(toIn) !== null && !valid(fromIn, toIn);
  const bar = (
    <RangeBar
      sel={sel}
      error={error ?? (customBad ? "The start month must not be after the end month." : null)}
      fromIn={fromIn}
      toIn={toIn}
      onPreset={onPreset}
      onCustom={onCustom}
      years={YEARS}
      onYear={onYear}
    />
  );
  return { sel: sel as RangeSel, bar, go, params };
}
