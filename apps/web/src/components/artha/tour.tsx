"use client";

import { useEffect, useRef, useState } from "react";

export interface TourStep {
  title: string;
  body: string;
}

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";
const btn = `rounded border border-rule px-3 py-1.5 text-sm hover:bg-bg disabled:opacity-40 ${focusRing}`;

/** Optional, non-blocking step-by-step tour (ArthaGuide). A docked card, not a modal overlay:
 *  the page stays usable. Keyboard: arrows move, Escape closes. Restartable via `Take a tour`. */
export function Tour({ steps, label = "Take a tour" }: { steps: TourStep[]; label?: string }) {
  const [step, setStep] = useState<number | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const open = step !== null;

  useEffect(() => {
    if (open) card.current?.focus();
  }, [open, step]);

  const close = () => setStep(null);
  const s = step === null ? null : steps[step];

  return (
    <>
      <button type="button" onClick={() => setStep(0)} className={`${btn} border-accent text-accent`}>
        {label}
      </button>
      {s && step !== null && (
        <div
          ref={card}
          role="dialog"
          aria-modal="false"
          aria-label={`Tour step ${step + 1} of ${steps.length}: ${s.title}`}
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Escape") close();
            else if (e.key === "ArrowRight") setStep(Math.min(steps.length - 1, step + 1));
            else if (e.key === "ArrowLeft") setStep(Math.max(0, step - 1));
          }}
          className="fixed inset-x-3 bottom-3 z-40 mx-auto max-w-md rounded-md border border-accent bg-surface p-4 shadow-xl outline-none sm:inset-x-auto sm:right-4"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="font-serif text-lg font-semibold">{s.title}</p>
            <button type="button" aria-label="Close tour" onClick={close} className={`${btn} px-2 py-0.5`}>
              ✕
            </button>
          </div>
          <p className="mt-1 text-sm text-ink-muted">{s.body}</p>
          <div
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
            aria-label="Tour progress"
            className="mt-3 h-1 rounded bg-rule"
          >
            <div className="h-1 rounded bg-accent" style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <div className="mt-3 flex items-center justify-between gap-2">
            <span className="text-xs text-ink-muted">
              Step {step + 1} of {steps.length}
            </span>
            <div className="flex gap-2">
              <button type="button" className={btn} onClick={close}>
                Skip
              </button>
              <button type="button" className={btn} disabled={step === 0} onClick={() => setStep(step - 1)}>
                Back
              </button>
              {step < steps.length - 1 ? (
                <button type="button" className={`${btn} bg-accent text-accent-ink`} onClick={() => setStep(step + 1)}>
                  Next
                </button>
              ) : (
                <button type="button" className={`${btn} bg-accent text-accent-ink`} onClick={close}>
                  Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export const INDICATOR_TOUR: TourStep[] = [
  { title: "What are economic indicators?", body: "Indicators are official statistics that track the economy over time. Here you can explore three of them using data from MoSPI." },
  { title: "CPI, WPI and IIP", body: "CPI measures consumer prices, WPI measures wholesale prices of goods, and IIP measures industrial output. They are different measures with different base years." },
  { title: "The latest-value cards", body: "Each card shows the newest stored index, its month, base year, the monthly change we calculate, and the official yearly rate when the source provides one." },
  { title: "Choosing a date range", body: "Use 3M to 5Y, All, or Custom months. Ranges end at each series' latest stored month. Your choice is saved in the page link." },
  { title: "Switching the metric", body: "Switch between index level, monthly change, yearly change and the official rate. Calculated and official values are labelled differently." },
  { title: "Reading historical trends", body: "Hover or use the arrow keys on a chart to read each month. Breaks in a line are months with no stored data." },
  { title: "Comparing sectors", body: "On the IIP page, compare Mining, Manufacturing, Electricity and Water using their official growth rates for the same month." },
  { title: "Checking the source", body: "Every chart has a source line. Open View source for the publisher, series identifier, base year, retrieval time and formula." },
  { title: "Downloading the data", body: "Each table has a CSV download of exactly the months you have selected, with source and method columns." },
];
