import type { Metadata } from "next";
import { SectionStub } from "@/components/layout/section-stub";

export const metadata: Metadata = { title: "Report Card" };

export default function ReportCardPage() {
  return (
    <SectionStub
      href="/report-card"
      notice="The ledger starts with the first live forecast. Each entry stays pending until the official figure is released, then it is scored. Entries are never edited or replaced."
    />
  );
}
