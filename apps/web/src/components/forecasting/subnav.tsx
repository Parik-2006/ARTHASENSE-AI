"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { parseView, ViewModeToggle } from "@/components/forecasting/view-mode";

const ITEMS = [
  { href: "/forecasting", label: "Outlook" },
  { href: "/forecasting/cpi", label: "CPI" },
  { href: "/forecasting/wpi", label: "WPI" },
  { href: "/forecasting/iip", label: "IIP" },
  { href: "/forecasting/gdp", label: "GDP" },
  { href: "/forecasting/comparison", label: "Model comparison" },
  { href: "/forecasting/experiments", label: "Experiments" },
];

export function ForecastingSubNav() {
  const pathname = usePathname();
  const params = useSearchParams();
  // Research View follows the reader across Forecasts tabs (and only there).
  const suffix = parseView(params?.get("view")) === "research" ? "?view=research" : "";
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-b border-rule">
      <nav aria-label="Forecasting" className="-mb-px min-w-0 max-w-full overflow-x-auto">
        <ul className="flex gap-x-5 whitespace-nowrap">
          {ITEMS.map((item) => {
            const active = item.href === "/forecasting" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
            return (
              <li key={item.href}>
                <Link
                  href={`${item.href}${suffix}`}
                  aria-current={active ? "page" : undefined}
                  className={`block border-b-2 py-2 text-sm focus-visible:outline-2 focus-visible:outline-accent ${
                    active ? "border-accent font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink"
                  }`}
                >
                  {item.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
      <div className="mb-1.5 flex items-center gap-2">
        <span className="hidden text-xs text-ink-muted sm:inline">View</span>
        <ViewModeToggle />
      </div>
    </div>
  );
}
