import type { Metadata } from "next";
import { IntelligencePage } from "@/components/intelligence/intelligence-page";

export const metadata: Metadata = { title: "Economic Intelligence" };

export default function Page() {
  return <IntelligencePage />;
}
