import type { Metadata } from "next";
import { ForecastIndicatorPage } from "@/components/forecasting/forecast-pages";
import { FORECAST_NAMES } from "@/lib/forecasting";

export const metadata: Metadata = { title: `${FORECAST_NAMES.gdp} forecasts` };

export default function Page() {
  return <ForecastIndicatorPage id="gdp" />;
}
