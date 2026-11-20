import type { Metadata } from "next";
import { Suspense } from "react";
import { ExperimentsView } from "@/components/forecasting/experiments-view";
import { PageHeader } from "@/components/ui/primitives";
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
      <PageHeader
        eyebrow="Forecasting"
        title="Experiment history"
        lede="Every stored run with its data fingerprint, training range, horizon and scores, so each result can be reproduced."
      />
      <Suspense
        fallback={<div role="status" aria-label="Loading" className="h-96 animate-pulse rounded-md border border-rule bg-surface" />}
      >
        <Data />
      </Suspense>
    </>
  );
}
