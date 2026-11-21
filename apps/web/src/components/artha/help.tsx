"use client";

import { useEffect, useId, useRef, useState } from "react";
import { GUIDE, type GuideKey } from "@/lib/guide";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** Small "?" button that opens a short four-question explanation (ArthaGuide). Not a modal:
 *  it does not block the page, closes with Escape or a second click. */
export function Help({ topic, label }: { topic: GuideKey; label?: string }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const ref = useRef<HTMLSpanElement>(null);
  const g = GUIDE[topic];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  return (
    <span ref={ref} className="relative inline-block align-middle">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`Explain: ${label ?? g.title}`}
        onClick={() => setOpen((o) => !o)}
        className={`ml-1 inline-flex h-5 w-5 items-center justify-center rounded-full border border-rule text-[11px] font-semibold text-ink-muted hover:bg-bg ${focusRing}`}
      >
        ?
      </button>
      {open && (
        <div
          id={id}
          role="region"
          aria-label={g.title}
          className="absolute left-0 top-7 z-30 w-72 max-w-[85vw] rounded-md border border-rule bg-surface p-3 text-left text-xs font-normal normal-case tracking-normal text-ink shadow-lg"
        >
          <p className="mb-1 text-sm font-semibold">{g.title}</p>
          <dl className="space-y-1.5">
            <div><dt className="font-semibold text-accent">What is it?</dt><dd className="text-ink-muted">{g.what}</dd></div>
            <div><dt className="font-semibold text-accent">Why useful?</dt><dd className="text-ink-muted">{g.why}</dd></div>
            <div><dt className="font-semibold text-accent">How to read it</dt><dd className="text-ink-muted">{g.read}</dd></div>
            <div><dt className="font-semibold text-warn">Avoid this mistake</dt><dd className="text-ink-muted">{g.avoid}</dd></div>
          </dl>
          <button type="button" onClick={() => setOpen(false)} className={`mt-2 rounded border border-rule px-2 py-0.5 ${focusRing}`}>
            Close
          </button>
        </div>
      )}
    </span>
  );
}
