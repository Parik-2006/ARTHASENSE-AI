import Link from "next/link";
import { EmptyState, PageHeader, Panel } from "@/components/ui/primitives";

export default function OverviewPage() {
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="India's economy, measured and forecast with stated uncertainty"
        lede="ArthaSense shows official statistics with their source and release date, forecasts from evaluated models, and a public record of how those forecasts performed."
      />

      <EmptyState title="No official data has been loaded yet" milestone="M3">
        The ingestion pipeline is not built yet, so this page deliberately shows no figures. Data
        sources are being verified first. The M1 verification report is in{" "}
        <code className="figure">docs/m1-data-verification.md</code>.
      </EmptyState>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <Panel title="What it will explain">
          <p className="text-sm text-ink-muted">
            Latest CPI, IIP, WPI, GDP and repo-rate figures. Each one shows the publisher, the
            statistical base year and the release date.
          </p>
        </Panel>
        <Panel title="What it will forecast">
          <p className="text-sm text-ink-muted">
            CPI inflation first, then IIP. Forecasts come from SARIMA, XGBoost, Chronos-2 and
            TimesFM 2.5, are computed offline and stored, and always carry prediction intervals.
          </p>
        </Panel>
        <Panel title="How reliable it is">
          <p className="text-sm text-ink-muted">
            The Report Card scores every stored forecast once the official figure is released.
            Forecasts are never edited after the fact.
          </p>
        </Panel>
      </div>

      <p className="mt-8 text-sm text-ink-muted">
        Developers: check the <Link href="/status" className="text-accent underline">system status</Link>{" "}
        page to confirm the API and database are reachable.
      </p>
    </>
  );
}
