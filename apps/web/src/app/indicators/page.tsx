import { redirect } from "next/navigation";

/** The Indicators page is four tabs (CPI, WPI, IIP, GDP); its entry point opens the first tab. */
export default function IndicatorsPage() {
  redirect("/indicators/cpi");
}
