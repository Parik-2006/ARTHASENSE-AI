import { redirect } from "next/navigation";

/** The old placeholder route now points at the real forecasting section. */
export default function ForecastsPage() {
  redirect("/forecasting");
}
