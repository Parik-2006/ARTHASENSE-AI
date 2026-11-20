import type { Metadata } from "next";
import { IndicatorPage } from "@/components/indicators/indicator-page";
import { CPI_CONFIG } from "@/lib/indicators";

export const metadata: Metadata = { title: CPI_CONFIG.title };

export default function CPIPage() {
  return <IndicatorPage config={CPI_CONFIG} />;
}
