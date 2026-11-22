import type { Metadata } from "next";
import { Suspense } from "react";
import { GdpDetail } from "@/components/indicators/detail/indicator-detail";
import { DetailSkeleton } from "@/components/indicators/indicator-page";
import { PageHeader } from "@/components/ui/primitives";
import { getGdp, getGva } from "@/lib/api";

export const metadata: Metadata = { title: "Gross Domestic Product (GDP)" };

async function Data() {
  // Server-side: FastAPI reads the stored National Accounts series from PostgreSQL. MoSPI is never called from here.
  const [gdp, gva] = await Promise.all([getGdp(), getGva()]);
  return <GdpDetail gdp={gdp} gva={gva} />;
}

export default function GdpPage() {
  return (
    <>
      <PageHeader eyebrow="Indicators" title="Gross Domestic Product (GDP)" />
      <Suspense fallback={<DetailSkeleton />}>
        <Data />
      </Suspense>
    </>
  );
}
