"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { nextAvailable, placeTooltip, type Rect, type SpotStep } from "@/lib/forecast-tours";

/** Separate from ArthaGuide's "arthaguide:start" so the two tours can never open together. */
export const FORECAST_TOUR_EVENT = "forecast-tour:start";
const PAD = 6; // spotlight padding around the target, px

export function ForecastTourButton({ className = "", children = "Take a tour" }: { className?: string; children?: React.ReactNode }) {
  return (
    <button type="button" className={className} onClick={() => window.dispatchEvent(new Event(FORECAST_TOUR_EVENT))}>
      {children}
    </button>
  );
}

const find = (name: string) => (typeof document === "undefined" ? null : document.querySelector<HTMLElement>(`[data-tour="${name}"]`));

/** Present, not hidden, not display:none / visibility:hidden, and not inside a closed <details> body. */
export function isTargetAvailable(el: HTMLElement | null): boolean {
  if (!el || !el.isConnected) return false;
  if (el.closest("[hidden]")) return false;
  const closed = el.closest("details:not([open])");
  if (closed && !el.closest("summary")) return false;
  const check = (el as HTMLElement & { checkVisibility?: (o?: object) => boolean }).checkVisibility;
  if (typeof check === "function") return check.call(el, { checkVisibilityCSS: true });
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const s = window.getComputedStyle(n);
    if (s.display === "none" || s.visibility === "hidden") return false;
  }
  return true;
}

function stepAvailable(step: SpotStep): boolean {
  if (isTargetAvailable(find(step.target))) return true;
  // A step whose target appears after opening a disclosure is available if that disclosure is.
  return !!step.reveal && isTargetAvailable(find(step.reveal));
}

/** Spotlight tour: dims the page, cuts out the real element being explained, scrolls it into view and places a
 *  short card beside it without covering it. Modal while open (focus is trapped; Esc closes; ←/→ move). Steps
 *  whose element is missing or hidden are skipped, so conditional panels never break the tour. */
export function SpotlightTour({ steps, label = "Forecasts tour" }: { steps: SpotStep[]; label?: string }) {
  const [idx, setIdx] = useState<number | null>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [vp, setVp] = useState({ width: 1024, height: 768 });
  const [tipSize, setTipSize] = useState({ width: 360, height: 190 });
  const [order, setOrder] = useState<number[]>([]);
  const card = useRef<HTMLDivElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const bodyId = useId();
  const open = idx !== null;

  const close = useCallback(() => {
    setIdx(null);
    setRect(null);
    const back = opener.current;
    opener.current = null;
    if (back && back.isConnected) back.focus({ preventScroll: true });
  }, []);

  const measure = useCallback(() => {
    if (idx === null) return;
    const el = find(steps[idx].target);
    setVp({ width: window.innerWidth, height: window.innerHeight });
    if (!el) return setRect(null);
    const r = el.getBoundingClientRect();
    setRect({ top: r.top, left: r.left, width: r.width, height: r.height });
  }, [idx, steps]);

  // Start: listen for the trigger event.
  useEffect(() => {
    const start = () => {
      const avail = steps.map((s, i) => (stepAvailable(s) ? i : -1)).filter((i) => i >= 0);
      if (!avail.length) return; // nothing to show on this page state: do nothing rather than open an empty tour
      opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOrder(avail);
      setIdx(avail[0]);
    };
    window.addEventListener(FORECAST_TOUR_EVENT, start);
    return () => window.removeEventListener(FORECAST_TOUR_EVENT, start);
  }, [steps]);

  // On each step: reveal if needed, scroll the target into view, then measure (and keep measuring while scrolling).
  useEffect(() => {
    if (idx === null) return;
    const step = steps[idx];
    if (step.reveal && !isTargetAvailable(find(step.target))) {
      const btn = find(step.reveal);
      if (btn && btn.getAttribute("aria-expanded") === "false") btn.click();
    }
    let raf = 0;
    const hasRaf = typeof window.requestAnimationFrame === "function";
    const schedule = () => {
      if (!hasRaf) return measure();
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    const t = window.setTimeout(() => {
      const el = find(step.target);
      if (!isTargetAvailable(el)) {
        // Target vanished (conditional panel): skip forward, else back, else end.
        const n = nextAvailable(steps.length, idx, 1, (i) => stepAvailable(steps[i])) ?? nextAvailable(steps.length, idx, -1, (i) => stepAvailable(steps[i]));
        if (n === null) close();
        else setIdx(n);
        return;
      }
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
      const r = el!.getBoundingClientRect();
      el!.scrollIntoView?.({ behavior: reduce ? "auto" : "smooth", block: r.height > window.innerHeight * 0.6 ? "start" : "center", inline: "nearest" });
      measure(); // immediately, then again as smooth scrolling moves the target
      schedule();
      window.setTimeout(schedule, 450);
    }, 0);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      window.clearTimeout(t);
      if (hasRaf) cancelAnimationFrame(raf);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }, [idx, steps, measure, close]);

  const go = useCallback(
    (dir: 1 | -1) => {
      if (idx === null) return;
      const n = nextAvailable(steps.length, idx, dir, (i) => stepAvailable(steps[i]));
      if (n === null) {
        if (dir === 1) close();
        return;
      }
      setIdx(n);
    },
    [idx, steps, close],
  );

  // Keyboard: Esc closes, arrows move, Tab stays inside the card.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        go(1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        go(-1);
      } else if (e.key === "Tab" && card.current) {
        const f = [...card.current.querySelectorAll<HTMLElement>("button:not([disabled])")];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        const active = document.activeElement;
        if (e.shiftKey && (active === first || active === card.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && (active === last || !card.current.contains(active))) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, go, close]);

  // Move focus into the card on every step so screen readers announce it.
  useEffect(() => {
    if (open) card.current?.focus({ preventScroll: true });
  }, [open, idx]);

  useLayoutEffect(() => {
    if (!card.current) return;
    const { offsetWidth: width, offsetHeight: height } = card.current;
    if (width && height && (Math.abs(width - tipSize.width) > 1 || Math.abs(height - tipSize.height) > 1)) setTipSize({ width, height });
  }, [idx, rect, vp, tipSize.width, tipSize.height]);

  if (idx === null) return null;
  const step = steps[idx];
  const pos = Math.max(1, order.indexOf(idx) + 1);
  const total = Math.max(order.length, pos);
  const isLast = nextAvailable(steps.length, idx, 1, (i) => stepAvailable(steps[i])) === null;
  const isFirst = nextAvailable(steps.length, idx, -1, (i) => stepAvailable(steps[i])) === null;
  const hole = rect ? { top: rect.top - PAD, left: rect.left - PAD, width: rect.width + 2 * PAD, height: rect.height + 2 * PAD } : null;
  const width = Math.min(360, vp.width - 16);
  const placed = hole
    ? placeTooltip(hole, { width, height: tipSize.height }, vp)
    : { placement: "sheet-bottom" as const, top: vp.height - tipSize.height - 8, left: 8, width: vp.width - 16 };
  const btn = "rounded border border-rule px-3 py-1.5 text-sm hover:border-accent disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

  return (
    <div className="fixed inset-0 z-[60]" data-testid="spotlight-tour">
      {/* Catches clicks so the dimmed page is not operated by accident while the tour is open. */}
      <div aria-hidden className="absolute inset-0" style={{ background: hole ? "transparent" : "rgb(0 0 0 / 0.55)" }} />
      {hole && (
        <div
          aria-hidden
          data-testid="spotlight-hole"
          className="pointer-events-none absolute rounded-lg ring-2 ring-accent transition-all duration-200 ease-out"
          style={{ top: hole.top, left: hole.left, width: hole.width, height: hole.height, boxShadow: "0 0 0 200vmax rgb(0 0 0 / 0.55)" }}
        />
      )}
      <div
        ref={card}
        role="dialog"
        aria-modal="true"
        aria-label={`${label}: step ${pos} of ${total}`}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        data-placement={placed.placement}
        className="absolute rounded-lg border border-accent bg-surface p-4 text-ink shadow-2xl outline-none transition-[top,left] duration-200 ease-out"
        style={{ top: placed.top, left: placed.left, width: placed.width }}
      >
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">
            Step {pos} of {total}
          </p>
          <div aria-hidden className="flex gap-1">
            {order.map((i) => (
              <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === idx ? "bg-accent" : "bg-rule"}`} />
            ))}
          </div>
        </div>
        <h2 id={titleId} className="mt-1.5 text-base font-semibold">
          {step.title}
        </h2>
        <p id={bodyId} aria-live="polite" className="mt-1 text-sm text-ink-muted">
          {step.body}
        </p>
        <div className="mt-4 flex items-center gap-2">
          <button type="button" className={btn} onClick={() => go(-1)} disabled={isFirst}>
            Back
          </button>
          <button
            type="button"
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            onClick={() => (isLast ? close() : go(1))}
          >
            {isLast ? "Finish" : "Next"}
          </button>
          <button type="button" className="ml-auto text-sm text-ink-muted underline hover:text-ink focus-visible:outline-2 focus-visible:outline-accent" onClick={close}>
            Skip tour
          </button>
        </div>
      </div>
    </div>
  );
}
