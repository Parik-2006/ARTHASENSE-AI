import type { Metadata } from "next";
import { SectionStub } from "@/components/layout/section-stub";

export const metadata: Metadata = { title: "Scenarios" };

export default function ScenariosPage() {
  return (
    <SectionStub
      href="/scenarios"
      notice="Scenarios will be conditional forecasts (for example, a crude oil or rupee path) with their assumptions stated on screen. They describe what a model implies under those assumptions. They are not proof of cause and effect."
    />
  );
}
