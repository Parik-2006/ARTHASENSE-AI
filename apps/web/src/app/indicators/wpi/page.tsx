import type { Metadata } from "next";
import { IndicatorPage } from "@/components/indicators/indicator-page";
import { WPI_CONFIG } from "@/lib/indicators";

export const metadata: Metadata = { title: WPI_CONFIG.title };

export default function WPIPage() {
  return <IndicatorPage config={WPI_CONFIG} />;
}
