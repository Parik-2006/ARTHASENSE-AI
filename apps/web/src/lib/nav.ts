export interface NavItem {
  href: string;
  label: string;
  /** Milestone that delivers the page's real content. */
  milestone: string;
  summary: string;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/",
    label: "Overview",
    milestone: "M9",
    summary: "Latest official statistics with source and release date on every figure.",
  },
  {
    href: "/indicators",
    label: "Indicators",
    milestone: "M9",
    summary: "CPI, WPI, IIP and GDP: two charts each, with filters, sources and CSV downloads.",
  },
  {
    href: "/forecasting",
    label: "Forecasts",
    milestone: "M10",
    summary: "Stored model forecasts with uncertainty bands, backtest accuracy and model comparison.",
  },
  {
    href: "/intelligence",
    label: "Intelligence",
    milestone: "M11",
    summary: "Plain-language readings of stored data and forecasts, labelled as official, derived or forecast.",
  },
  {
    href: "/report-card",
    label: "Report Card",
    milestone: "M10",
    summary: "Every forecast we have published, scored against the official figure once it is released.",
  },
  {
    href: "/scenarios",
    label: "Scenarios",
    milestone: "M12",
    summary: "Conditional forecasts under stated assumptions. Not causal claims.",
  },
  {
    href: "/methodology",
    label: "Methodology",
    milestone: "M13",
    summary: "Data sources, rebasing and linking, models, evaluation protocol and limitations.",
  },
];

export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}
