import type { Metadata } from "next";
import { ForecastIndicatorPage } from "@/components/forecasting/forecast-pages";
import { INDICATOR_NAMES } from "@/lib/forecasting";

export const metadata: Metadata = { title: `${INDICATOR_NAMES.wpi} forecasts` };

export default function Page() {
  return <ForecastIndicatorPage id="wpi" />;
}
