"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { ComponentProps } from "react";
import { carryFilters } from "@/lib/overview";

/** Link to an indicator page that carries the visitor's valid time-range choice (range, from, to,
 *  metric) from the current page, so Overview and Indicators stay in step. Invalid values are dropped. */
export function IndicatorLink({ path, ...rest }: { path: string } & Omit<ComponentProps<typeof Link>, "href">) {
  const params = useSearchParams();
  const qs = carryFilters((k) => params?.get(k) ?? null);
  return <Link href={qs ? `${path}?${qs}` : path} {...rest} />;
}
