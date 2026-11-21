"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { isActive, NAV_ITEMS } from "@/lib/nav";

export function SiteHeader() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="border-b border-rule bg-surface">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6 lg:px-8">
        <Link href="/" className="flex items-baseline gap-1.5" onClick={() => setOpen(false)}>
          <span className="font-serif text-xl font-semibold tracking-tight">ArthaSense</span>
          <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-accent">AI</span>
        </Link>

        <nav aria-label="Primary" className="hidden flex-1 lg:block">
          <ul className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`rounded px-2.5 py-1.5 text-sm transition-colors ${
                      active
                        ? "font-medium text-ink underline decoration-accent decoration-2 underline-offset-[18px]"
                        : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/status"
            className="hidden rounded border border-rule px-2 py-1 text-xs text-ink-muted hover:text-ink xl:inline-block"
          >
            System status
          </Link>
          <ThemeToggle />
          <button
            type="button"
            className="rounded border border-rule px-2.5 py-1 text-sm lg:hidden"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((v) => !v)}
          >
            {open ? "Close" : "Menu"}
          </button>
        </div>
      </div>

      {open && (
        <nav id="mobile-nav" aria-label="Primary" className="border-t border-rule lg:hidden">
          <ul className="mx-auto max-w-7xl px-4 py-2 sm:px-6">
            {[...NAV_ITEMS, { href: "/status", label: "System status" }].map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setOpen(false)}
                    className={`block border-b border-rule py-3 text-base last:border-b-0 ${
                      active ? "font-medium text-ink" : "text-ink-muted"
                    }`}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </header>
  );
}
