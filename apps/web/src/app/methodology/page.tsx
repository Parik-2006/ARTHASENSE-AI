import type { Metadata } from "next";
import { SectionStub } from "@/components/layout/section-stub";

export const metadata: Metadata = { title: "Methodology" };

export default function MethodologyPage() {
  return (
    <SectionStub
      href="/methodology"
      notice="Methodology will document data sources, the 2026 base-year revisions and the official linking factors, the models, the rolling-origin evaluation protocol and known limitations. The data-source verification report (M1) is the first input."
    />
  );
}
