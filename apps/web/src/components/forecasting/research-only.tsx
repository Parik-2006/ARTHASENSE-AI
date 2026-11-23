"use client";

import { type ReactNode, Suspense } from "react";
import { useViewMode } from "@/components/forecasting/view-mode";

function Gate({ children, simple }: { children: ReactNode; simple?: ReactNode }) {
  return useViewMode() === "research" ? <>{children}</> : <>{simple ?? null}</>;
}

/** Renders its children only in Research View (server-rendered content can be passed straight through). */
export function ResearchOnly({ children, simple }: { children: ReactNode; simple?: ReactNode }) {
  return (
    <Suspense fallback={simple ?? null}>
      <Gate simple={simple}>{children}</Gate>
    </Suspense>
  );
}
