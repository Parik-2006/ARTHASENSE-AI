"use client";

import { useEffect, useId, useRef, useState } from "react";
import { HELP } from "@/lib/guide";

/** ArthaGuide contextual help: a small "?" button that opens a compact popover.
 *  Closes on Escape, outside click, or the Close button, and returns focus to the button. */
export function HelpTip({ id, label }: { id: string; label?: string }) {
  const entry = HELP[id];
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const uid = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!box.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!entry) return null;
  return (
    <span className="relative inline-block align-middle">
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        aria-label={label ?? `Explain: ${entry.title}`}
        onClick={() => setOpen((o) => !o)}
        className="ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-rule text-[11px] font-semibold text-ink-muted hover:border-accent hover:text-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
      >
        ?
      </button>
      {open && (
        <div
          ref={box}
          id={uid}
          role="dialog"
          aria-label={entry.title}
          className="absolute left-0 top-7 z-30 w-[min(20rem,calc(100vw-2rem))] rounded-md border border-rule bg-surface p-3 text-left text-xs font-normal normal-case tracking-normal text-ink shadow-lg"
        >
          <p className="mb-1.5 text-sm font-semibold">{entry.title}</p>
          <dl className="space-y-1.5">
            <div><dt className="inline font-semibold">What is it? </dt><dd className="inline">{entry.what}</dd></div>
            <div><dt className="inline font-semibold">Why it matters: </dt><dd className="inline">{entry.why}</dd></div>
            <div><dt className="inline font-semibold">How to read it: </dt><dd className="inline">{entry.how}</dd></div>
            <div><dt className="inline font-semibold">Common mistake: </dt><dd className="inline">{entry.mistake}</dd></div>
          </dl>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              btn.current?.focus();
            }}
            className="mt-2 rounded text-accent underline focus-visible:outline-2 focus-visible:outline-accent"
          >
            Close
          </button>
        </div>
      )}
    </span>
  );
}
