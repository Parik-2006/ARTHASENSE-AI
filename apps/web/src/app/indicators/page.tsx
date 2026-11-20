import type { Metadata } from "next";
import { SectionStub } from "@/components/layout/section-stub";

export const metadata: Metadata = { title: "Indicators" };

export default function IndicatorsPage() {
  return (
    <SectionStub
      href="/indicators"
      notice="Historical series will appear once ingestion stores official releases with their vintages (M3–M4). Old-base and new-base series will be shown separately, with base-year breaks marked on the charts."
    />
  );
}
