"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/forecasting", label: "Overview" },
  { href: "/forecasting/cpi", label: "CPI" },
  { href: "/forecasting/wpi", label: "WPI" },
  { href: "/forecasting/iip", label: "IIP" },
  { href: "/forecasting/comparison", label: "Model comparison" },
  { href: "/forecasting/experiments", label: "Experiments" },
];

export function ForecastingSubNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Forecasting" className="mb-6 border-b border-rule">
      <ul className="-mb-px flex flex-wrap gap-x-5">
        {ITEMS.map((item) => {
          const active = item.href === "/forecasting" ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
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
  );
}
