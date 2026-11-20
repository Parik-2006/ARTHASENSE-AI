import type { ReactNode } from "react";
import { Suspense } from "react";
import { ForecastingSubNav } from "@/components/forecasting/subnav";

export default function ForecastingLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Suspense fallback={<div className="mb-6 h-10 border-b border-rule" />}>
        <ForecastingSubNav />
      </Suspense>
      {children}
    </>
  );
}
