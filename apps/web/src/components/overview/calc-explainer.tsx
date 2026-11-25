"use client";

import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { ClassBadge } from "@/components/source/source-attribution";
import type { Explanation } from "@/lib/calc-explain";
import { HELP } from "@/lib/guide";

const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** "How was this calculated?": a small button that opens an accessible popover with the exact official observations,
 *  the formula with those values substituted, the result, rounding, source and key terms. Escape, outside click or
 *  Close dismiss it and return focus to the button. Nothing is computed here: content comes from lib/calc-explain. */
export function CalcExplainer({
  explanation,
  terms = [],
  label = "How was this calculated?",
  testId,
  children,
}: {
  explanation: Explanation | null;
  /** HELP entry ids to list under "Key terms". */
  terms?: string[];
  label?: string;
  testId?: string;
  /** Extra content (e.g. a per-quarter table) shown after the formula. */
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; width: number }>({ left: 0, width: 400 });
  const btn = useRef<HTMLButtonElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const uid = useId();
  const e = explanation;

  useEffect(() => {
    if (!open) return;
    box.current?.focus();
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key === "Escape") {
        setOpen(false);
        btn.current?.focus();
      }
    };
    const onDown = (ev: PointerEvent) => {
      const t = ev.target as Node;
      if (!box.current?.contains(t) && !btn.current?.contains(t)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    btn.current?.focus();
  };

  return (
    <span className="relative inline-block" data-testid={testId}>
      <button
        ref={btn}
        type="button"
        aria-expanded={open}
        aria-controls={open ? uid : undefined}
        aria-haspopup="dialog"
        onClick={() => {
          const r = btn.current?.getBoundingClientRect();
          if (r) {
            const width = Math.min(400, window.innerWidth - 32);
            const left = Math.min(Math.max(r.left, 16), window.innerWidth - 16 - width);
            setPos({ left: left - r.left, width });
          }
          setOpen((o) => !o);
        }}
        className={`inline-flex min-h-[32px] items-center gap-1.5 rounded text-xs font-medium text-accent underline decoration-dotted underline-offset-2 hover:decoration-solid ${focusRing}`}
      >
        <span aria-hidden className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-current text-[10px] no-underline">ƒ</span>
        {label}
      </button>
      {open && (
        <div
          ref={box}
          id={uid}
          role="dialog"
          aria-label={e ? `How this was calculated: ${e.title}` : label}
          tabIndex={-1}
          style={{ left: pos.left, width: pos.width }}
          className="absolute top-9 z-40 max-h-[70vh] overflow-y-auto rounded-md border border-rule bg-surface p-4 text-left text-xs font-normal normal-case tracking-normal text-ink shadow-lg outline-none"
          data-testid={testId ? `${testId}-dialog` : undefined}
        >
          {!e ? (
            <p className="text-sm">The figure needed for this explanation is not stored, so nothing is calculated or shown.</p>
          ) : (
            <>
              <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                {e.title}
                <ClassBadge cls={e.provenance} />
              </p>
              <p className="mt-1.5 text-sm" data-testid="explain-plain">
                {e.plain}
              </p>
              <p className="mt-1.5 text-ink-muted">{e.definition}</p>
              <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1">
                {e.observations.map((o) => (
                  <div key={o.label} className="contents">
                    <dt className="text-ink-muted">{o.label}</dt>
                    <dd className="figure text-right">{o.value}</dd>
                  </div>
                ))}
                <dt className="font-semibold">{e.provenance === "official" ? "Shown (official)" : "Result (calculated by ArthaSense)"}</dt>
                <dd className="figure text-right font-semibold" data-testid="explain-value">
                  {e.value}
                </dd>
              </dl>
              <p className="mt-3 font-semibold">{e.provenance === "official" ? "Cross-check with the same formula" : "Formula"}</p>
              <p className="figure mt-0.5 break-words">{e.formula}</p>
              {e.substituted && (
                <p className="figure mt-0.5 break-words" data-testid="explain-substituted">
                  {e.substituted}
                </p>
              )}
              {e.rounding && <p className="mt-2 text-ink-muted">{e.rounding}</p>}
              {children}
              <dl className="mt-3 space-y-0.5 text-ink-muted">
                <div>
                  <dt className="inline">Units: </dt>
                  <dd className="inline">{e.units}</dd>
                </div>
                <div>
                  <dt className="inline">Base year: </dt>
                  <dd className="inline">{e.baseYear}</dd>
                </div>
                <div>
                  <dt className="inline">Source: </dt>
                  <dd className="inline">
                    {e.sourceUrl ? (
                      <a href={e.sourceUrl} target="_blank" rel="noreferrer" className={`text-accent underline ${focusRing}`}>
                        {e.sourceName}
                      </a>
                    ) : (
                      e.sourceName
                    )}
                    {e.retrieved ? ` · retrieved by ArthaSense ${e.retrieved}` : ""}
                  </dd>
                </div>
              </dl>
            </>
          )}
          {terms.length > 0 && (
            <details className="mt-3 border-t border-rule pt-2">
              <summary className={`cursor-pointer font-semibold ${focusRing}`}>Key terms</summary>
              <dl className="mt-1.5 space-y-1.5">
                {terms
                  .filter((t) => HELP[t])
                  .map((t) => (
                    <div key={t}>
                      <dt className="font-semibold">{HELP[t].title}</dt>
                      <dd>
                        {HELP[t].what} <span className="text-ink-muted">{HELP[t].mistake}</span>
                      </dd>
                    </div>
                  ))}
              </dl>
            </details>
          )}
          <button type="button" onClick={close} className={`mt-3 rounded border border-rule px-2.5 py-1 text-xs hover:border-accent ${focusRing}`}>
            Close
          </button>
        </div>
      )}
    </span>
  );
}
