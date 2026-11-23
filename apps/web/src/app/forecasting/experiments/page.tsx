import type { Metadata } from "next";
import { Suspense } from "react";
import { ExperimentsView } from "@/components/forecasting/experiments-view";
import { getRuns } from "@/lib/api";
import { loadErrorText } from "@/lib/forecasting";

export const metadata: Metadata = { title: "Forecast experiments" };

async function Data() {
  const r = await getRuns("?limit=200");
  if (!r.ok)
    return (
      <p role="alert" className="rounded-md border border-up bg-surface px-4 py-3 text-sm text-up">
        {loadErrorText("experiments", r.error)}
      </p>
    );
  return <ExperimentsView runs={r.data.items} total={r.data.total} />;
}

export default function Page() {
  return (
    <>
      <header className="mb-6 max-w-3xl">
        <h1 className="font-serif text-3xl font-semibold leading-tight tracking-tight sm:text-4xl">Experiments</h1>
        <p className="mt-2 text-base text-ink-muted">Every stored model run, with what it was trained on and how it scored, so each result can be checked and reproduced.</p>
      </header>
      <Suspense
        fallback={<div role="status" aria-label="Loading" className="h-96 animate-pulse rounded-md border border-rule bg-surface" />}
      >
        <Data />
      </Suspense>
    </>
  );
}
