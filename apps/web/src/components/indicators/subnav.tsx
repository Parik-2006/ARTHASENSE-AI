"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CONFIG_LIST } from "@/lib/indicators";

const ITEMS = [{ href: "/indicators", label: "Overview" }, ...CONFIG_LIST.map((c) => ({ href: c.path, label: c.navLabel }))];

/** Second-level navigation shown on every /indicators page. */
export function IndicatorsSubNav() {
  const pathname = usePathname();
  return (
    <nav aria-label="Indicators" className="mb-6 border-b border-rule">
      <ul className="-mb-px flex flex-wrap gap-x-5">
        {ITEMS.map((item) => {
          const active = pathname === item.href;
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
