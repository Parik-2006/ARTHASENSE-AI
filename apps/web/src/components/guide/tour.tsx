"use client";

import { useEffect, useReducer, useRef } from "react";
import { type TourAction, type TourState, type TourStep, tourReducer } from "@/lib/guide";

const START_EVENT = "arthaguide:start";

/** Any button can start the tour without sharing React state. */
export function TourButton({ className = "", children = "Take a Tour" }: { className?: string; children?: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(START_EVENT))}
      className={className}
    >
      {children}
    </button>
  );
}

/** ArthaGuide guided tour: a small non-modal card that highlights one element at a time.
 *  The page stays fully usable: no overlay, no focus trap. Esc closes; arrow keys move. */
export function Tour({ steps }: { steps: TourStep[] }) {
  const [state, dispatch] = useReducer(
    (s: TourState, a: TourAction) => tourReducer(s, a, steps.length),
    { open: false, step: 0 },
  );
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const start = () => dispatch({ type: "start" });
    window.addEventListener(START_EVENT, start);
    return () => window.removeEventListener(START_EVENT, start);
  }, []);

  // Highlight + scroll the current target (smooth only if the user has not asked for reduced motion).
  const step = steps[state.step];
  useEffect(() => {
    if (!state.open || !step) return;
    const el = document.querySelector<HTMLElement>(`[data-tour="${step.target}"]`);
    if (!el) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    el.setAttribute("data-tour-active", "true");
    return () => el.removeAttribute("data-tour-active");
  }, [state.open, state.step, step]);

  useEffect(() => {
    if (!state.open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (e.key === "Escape") dispatch({ type: "close" });
      else if (tag !== "INPUT" && tag !== "SELECT" && tag !== "TEXTAREA") {
        if (e.key === "ArrowRight") dispatch({ type: "next" });
        else if (e.key === "ArrowLeft") dispatch({ type: "back" });
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [state.open]);

  useEffect(() => {
    if (state.open) card.current?.focus({ preventScroll: true });
  }, [state.open]);

  if (!state.open || !step) return null;
  const last = state.step === steps.length - 1;
  const btn =
    "rounded border border-rule px-3 py-1.5 text-sm hover:border-accent focus-visible:outline-2 focus-visible:outline-accent";
  return (
    <div
      ref={card}
      tabIndex={-1}
      role="dialog"
      aria-modal="false"
      aria-label={`ArthaGuide tour, step ${state.step + 1} of ${steps.length}`}
      className="fixed inset-x-3 bottom-3 z-40 rounded-md border border-accent bg-surface p-4 shadow-xl outline-none sm:inset-x-auto sm:right-4 sm:w-96"
    >
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-accent">
          ArthaGuide · Step {state.step + 1} of {steps.length}
        </p>
        <button type="button" aria-label="Close tour" onClick={() => dispatch({ type: "close" })} className="rounded px-1 text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-accent">
          ✕
        </button>
      </div>
      <h2 className="mt-1 text-base font-semibold">{step.title}</h2>
      <p aria-live="polite" className="mt-1 text-sm text-ink-muted">{step.body}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button type="button" className={btn} onClick={() => dispatch({ type: "back" })} disabled={state.step === 0}>
          Back
        </button>
        <button
          type="button"
          className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
          onClick={() => dispatch({ type: "next" })}
        >
          {last ? "Finish" : "Next"}
        </button>
        <button type="button" className="ml-auto rounded text-sm text-ink-muted underline focus-visible:outline-2 focus-visible:outline-accent" onClick={() => dispatch({ type: "close" })}>
          Skip tour
        </button>
      </div>
    </div>
  );
}
