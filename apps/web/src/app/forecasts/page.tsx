import type { Metadata } from "next";
import { SectionStub } from "@/components/layout/section-stub";

export const metadata: Metadata = { title: "Forecasts" };

export default function ForecastsPage() {
  return (
    <SectionStub
      href="/forecasts"
      notice="No model has been run yet. Forecasts will only appear here after they are produced offline by an evaluated model and stored with their run date, data vintage and model version."
    />
  );
}
