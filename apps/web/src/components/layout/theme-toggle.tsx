"use client";

import { THEME_STORAGE_KEY, type Theme } from "@/lib/theme";

function currentTheme(): Theme {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

export function ThemeToggle() {
  function toggle() {
    const next: Theme = currentTheme() === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode, blocked): theme still applies for this page view.
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="rounded border border-rule px-2 py-1 text-xs text-ink-muted hover:text-ink"
      aria-label="Toggle light or dark theme"
    >
      <span className="dark:hidden">Dark</span>
      <span className="hidden dark:inline">Light</span>
    </button>
  );
}
