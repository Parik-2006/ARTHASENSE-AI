import type { Metadata } from "next";
import { DemoBadge, PageHeader, Panel, StatTile, StatusPill } from "@/components/ui/primitives";

export const metadata: Metadata = { title: "Design system" };

const SWATCHES = [
  ["bg", "Page"],
  ["surface", "Panels"],
  ["ink", "Text · actual data"],
  ["ink-muted", "Labels · footnotes"],
  ["rule", "Borders · gridlines"],
  ["accent", "Forecast · links · focus"],
  ["target", "RBI 2–6% band"],
  ["up", "Increase (with ▲)"],
  ["down", "Decrease (with ▼)"],
  ["warn", "Stale · provisional"],
  ["demo", "Demo data label"],
] as const;

export default function DesignPage() {
  return (
    <>
      <PageHeader
        eyebrow="Research Desk"
        title="Design system"
        lede="Tokens and components for ArthaSense AI. Every figure on this page is synthetic and labelled as demo data."
        aside={<DemoBadge />}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <Panel title="Colour tokens" footnote="Switch theme in the header to see the dark values.">
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SWATCHES.map(([token, use]) => (
              <li key={token} className="flex items-center gap-2">
                <span
                  className="h-8 w-8 shrink-0 rounded border border-rule"
                  style={{ background: `var(--${token})` }}
                  aria-hidden
                />
                <span className="text-xs">
                  <span className="figure block">{token}</span>
                  <span className="text-ink-muted">{use}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>

        <Panel title="Typography">
          <p className="font-serif text-4xl font-semibold leading-[1.15] tracking-tight">Newsreader for headlines</p>
          <p className="mt-3">IBM Plex Sans for interface and body text, set at 15px with 1.5 line height.</p>
          <p className="figure mt-3 text-2xl">IBM Plex Mono · 0123456789 · 4.27%</p>
        </Panel>
      </div>

      <h2 className="mt-10 mb-4 font-serif text-2xl font-semibold">Stat tiles</h2>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile
          demo
          label="CPI inflation (YoY)"
          value="0.0"
          unit="%"
          change={{ text: "0.0 pp vs prior month", direction: "up" }}
          provenance={{ source: "Demo", detail: "synthetic", released: "—" }}
        />
        <StatTile
          demo
          label="IIP growth (YoY)"
          value="0.0"
          unit="%"
          change={{ text: "0.0 pp vs prior month", direction: "down" }}
          provenance={{ source: "Demo", detail: "synthetic", released: "—" }}
        />
        <StatTile
          demo
          label="WPI inflation (YoY)"
          value="0.0"
          unit="%"
          change={{ text: "no change", direction: "flat" }}
          provenance={{ source: "Demo", detail: "synthetic", released: "—" }}
        />
        <StatTile
          demo
          label="Policy repo rate"
          value="0.00"
          unit="%"
          provenance={{ source: "Demo", detail: "synthetic", released: "—" }}
        />
      </div>
      <p className="mt-2 text-xs text-ink-muted">
        Demo tiles show zeros on purpose, so they can never be mistaken for real readings.
      </p>

      <h2 className="mt-10 mb-4 font-serif text-2xl font-semibold">Status</h2>
      <div className="flex flex-wrap gap-2">
        <StatusPill tone="ok">Fresh</StatusPill>
        <StatusPill tone="warn">Provisional</StatusPill>
        <StatusPill tone="down">Source unavailable</StatusPill>
        <StatusPill tone="unknown">Not yet released</StatusPill>
      </div>
    </>
  );
}
