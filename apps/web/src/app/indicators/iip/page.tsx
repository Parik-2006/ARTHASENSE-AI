import type { Metadata } from "next";
import { IndicatorPage } from "@/components/indicators/indicator-page";
import { IIP_CONFIG } from "@/lib/indicators";

export const metadata: Metadata = { title: IIP_CONFIG.title };

export default function IIPPage() {
  return <IndicatorPage config={IIP_CONFIG} />;
}
