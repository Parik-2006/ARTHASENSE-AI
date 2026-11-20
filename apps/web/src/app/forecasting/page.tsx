import type { Metadata } from "next";
import { ForecastOverviewPage } from "@/components/forecasting/forecast-pages";

export const metadata: Metadata = { title: "AI Economic Forecasting" };

export default function Page() {
  return <ForecastOverviewPage />;
}
