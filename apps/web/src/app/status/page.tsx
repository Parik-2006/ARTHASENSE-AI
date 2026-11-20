import type { Metadata } from "next";
import { Suspense } from "react";
import { PageHeader, Panel, StatusPill } from "@/components/ui/primitives";
import { API_URL, getApiHealth } from "@/lib/api";
import { apiTone, dbTone } from "@/lib/health";

export const metadata: Metadata = { title: "System status" };

async function ServiceStatus() {
  const result = await getApiHealth();
  return (
    <dl className="divide-y divide-rule text-sm">
      <div className="flex items-center justify-between py-3">
        <dt>Web (Next.js)</dt>
        <dd>
          <StatusPill tone="ok">Serving</StatusPill>
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4 py-3">
        <dt>
          API (FastAPI)
          <span className="figure ml-2 text-xs text-ink-muted">{API_URL}</span>
        </dt>
        <dd className="text-right">
          <StatusPill tone={apiTone(result)}>
            {result.reachable ? `${result.health.status} · v${result.health.version}` : "Unreachable"}
          </StatusPill>
          {!result.reachable && <p className="figure mt-1 text-xs text-ink-muted">{result.error}</p>}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4 py-3">
        <dt>Database (PostgreSQL)</dt>
        <dd className="text-right">
          <StatusPill tone={dbTone(result)}>
            {result.reachable ? result.health.database.status.replace("_", " ") : "Unknown (API unreachable)"}
          </StatusPill>
          {result.reachable && result.health.database.detail && (
            <p className="figure mt-1 text-xs text-ink-muted">{result.health.database.detail}</p>
          )}
        </dd>
      </div>
    </dl>
  );
}

export default function StatusPage() {
  return (
    <>
      <PageHeader
        eyebrow="Developers"
        title="System status"
        lede="Live health of the local stack. This page checks the services on every request; it never shows cached results."
      />
      <Panel
        title="Services"
        footnote="Start the stack with `docker compose up -d db`, then `uvicorn` and `npm run dev`. See README."
      >
        <Suspense fallback={<p className="py-3 text-sm text-ink-muted">Checking services…</p>}>
          <ServiceStatus />
        </Suspense>
      </Panel>
    </>
  );
}
