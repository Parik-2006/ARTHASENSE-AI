import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { RunDetailView } from "@/components/forecasting/run-detail";
import { PageHeader } from "@/components/ui/primitives";
import { getRunDetail, getRunForecasts } from "@/lib/api";
import { loadErrorText } from "@/lib/forecasting";

export const metadata: Metadata = { title: "Experiment" };

async function Data({ id }: { id: number }) {
  const [run, rows] = await Promise.all([getRunDetail(id), getRunForecasts(id)]);
  if (!run.ok && run.error === "Not found") notFound();
  if (!run.ok || !rows.ok)
    return (
      <p role="alert" className="rounded-md border border-up bg-surface px-4 py-3 text-sm text-up">
        {loadErrorText("this experiment", run.ok ? (rows.ok ? "" : rows.error) : run.error)}
      </p>
    );
  return <RunDetailView run={run.data} rows={rows.data.items} totalRows={rows.data.total} />;
}

async function Content({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^\d{1,9}$/.test(id)) notFound();
  return (
    <>
      <PageHeader
        eyebrow="Experiment"
        title={`Run #${id}`}
        lede={
          <Link href="/forecasting/experiments" className="underline">
            Back to all experiments
          </Link>
        }
      />
      <Suspense
        fallback={<div role="status" aria-label="Loading" className="h-64 animate-pulse rounded-md border border-rule bg-surface" />}
      >
        <Data id={Number(id)} />
      </Suspense>
    </>
  );
}

export default function Page({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div role="status" aria-label="Loading" className="h-64 animate-pulse rounded-md border border-rule bg-surface" />}>
      <Content params={params} />
    </Suspense>
  );
}
