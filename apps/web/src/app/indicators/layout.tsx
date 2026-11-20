import type { ReactNode } from "react";
import { IndicatorsSubNav } from "@/components/indicators/subnav";

export default function IndicatorsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <IndicatorsSubNav />
      {children}
    </>
  );
}
