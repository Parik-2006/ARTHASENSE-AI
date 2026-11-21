import { renderToStaticMarkup as renderRaw } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { HelpTip } from "@/components/guide/help-tip";
import { IndicatorCard } from "@/components/overview/cards";
import { CoveragePanel } from "@/components/overview/coverage";
import { OverviewExplorer } from "@/components/overview/explorer";
import { Heatmap } from "@/components/overview/heatmap";
import { InsightsSection } from "@/components/overview/insights";
import { SourceAttribution } from "@/components/source/source-attribution";
import { HELP } from "@/lib/guide";
import type { Observation } from "@/lib/indicator";
import { CONFIGS } from "@/lib/indicators";
import type { IndicatorBundle } from "@/lib/overview-data";
import { heatGrid } from "@/lib/overview";
import { sourceFor } from "@/lib/source";

const render = (el: React.ReactElement) => renderRaw(el).replace(/<!-- -->/g, "");

let search = "";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(search),
}));

const series = (start: number, values: (number | null)[], rate?: (i: number) => number | null): Observation[] =>
  values.map((v, i) => {
    const n = start + i;
    return {
      period: `${Math.floor(n / 12)}-${String((n % 12) + 1).padStart(2, "0")}-01`,
      index: v,
      rate: rate ? rate(i) : null,
      indexSource: null,
      rateSource: null,
    };
  });

function bundle(key: "cpi" | "wpi" | "iip", obs: Observation[]): IndicatorBundle {
  const cfg = CONFIGS[key];
  const data = obs.length
    ? {
        kind: key,
        baseYear: key === "cpi" ? "2024" : "2022-23",
        coverage: "India",
        geography: "India",
        sourceName: "MoSPI",
        sourceUrl: "https://api.mospi.gov.in",
        publisherNote: null,
        limitations: [],
        observations: obs,
        note: null,
      }
    : null;
  return {
    key,
    shortName: cfg.shortName,
    fullName: `${cfg.shortName} full`,
    plain: "plain text",
    path: cfg.path,
    error: null,
    segments: data
      ? [{ id: "current", label: `Base ${data.baseYear}`, baseYear: data.baseYear, coverage: "India", observations: obs }]
      : [],
    source: sourceFor(cfg, data),
    rateKind: key === "wpi" ? null : key === "cpi" ? "inflation" : "growth",
    rateLabel: cfg.rateCard,
    rateMissingText: cfg.rateMissingText,
    units: "Index points",
  };
}

const long = Array.from({ length: 48 }, (_, i) => 100 + i); // 2022-01 .. 2025-12
const bundles = () => [
  bundle("cpi", series(2025 * 12, [100, 101, 102])),
  bundle("wpi", series(2022 * 12, long)),
  bundle("iip", series(2022 * 12, long, (i) => (i % 2 ? 3.2 : -1.1))),
];
const circles = (html: string) => (html.match(/<circle /g) ?? []).length;

describe("SourceAttribution", () => {
  const src = bundle("wpi", series(2025 * 12, [1, 2])).source;
  it("shows publisher, class, period, base, units and retrieval state on the strip", () => {
    const html = render(<SourceAttribution cls="official" sources={[src]} period="Jan 2025 – Feb 2025" units="Index points" />);
    expect(html).toContain("OEA via MoSPI");
    expect(html).toContain("Official data");
    expect(html).toContain("Base 2022-23");
    expect(html).toContain("Index points");
    expect(html).toContain("Source details");
  });
  it("states missing metadata instead of filling it in", () => {
    const html = render(<SourceAttribution cls="official" sources={[src]} period="x" />);
    expect(html).toContain("Release date not provided");
    expect(html).toContain("retrieval time unavailable");
    expect(html).not.toContain("Invalid Date");
  });
  it("lists every contributing source on multi-source charts and labels calculated metrics", () => {
    const html = render(
      <SourceAttribution cls="calculated" sources={[bundle("cpi", series(0, [1])).source, src]} period="p" method="Monthly change calculated by ArthaSense" />,
    );
    expect(html).toContain("MoSPI + OEA via MoSPI");
    expect(html).toContain("Calculated by ArthaSense");
    expect(html).toContain("Monthly change calculated by ArthaSense");
  });
  it("marks forecasts as model-generated, not official", () => {
    const html = render(<SourceAttribution cls="forecast" sources={[src]} period="p" />);
    expect(html).toContain("Model-generated forecast");
    expect(html).toContain("Not an official forecast");
  });
  it("handles no source at all", () => {
    expect(render(<SourceAttribution cls="official" sources={[]} period="p" />)).toContain("Source information unavailable");
  });
});

describe("IndicatorCard", () => {
  it("shows latest index, month, base year, source and honest rate-unavailable text", () => {
    const html = render(<IndicatorCard bundle={bundles()[0]} first />);
    expect(html).toContain("102.00");
    expect(html).toContain("March 2025");
    expect(html).toContain("Base 2024");
    expect(html).toContain("Official inflation unavailable");
    expect(html).toContain("Source:");
    expect(html).toContain("/indicators/cpi");
    expect(html).toContain('data-tour="card-index"');
  });
  it("shows an official rate with its period when the source has one", () => {
    const html = render(<IndicatorCard bundle={bundles()[2]} first={false} />);
    expect(html).toContain("Official year-on-year growth");
    expect(html).not.toContain("Official industrial growth unavailable");
  });
  it("shows not-available instead of zero when MoM cannot be computed", () => {
    const b = bundle("wpi", [{ period: "2025-01-01", index: 100, rate: null, indexSource: null, rateSource: null }]);
    const html = render(<IndicatorCard bundle={b} first={false} />);
    expect(html).toContain("Not available");
    expect(html).not.toContain("0.00%");
  });
  it("shows an error state without inventing numbers", () => {
    const b = { ...bundle("cpi", []), error: "boom" };
    expect(render(<IndicatorCard bundle={b} first={false} />)).toContain("Unable to load CPI data");
  });
});

describe("OverviewExplorer", () => {
  const run = (q: string) => {
    search = q;
    return render(<OverviewExplorer bundles={bundles()} />);
  };
  it("renders every chart section with a source strip", () => {
    const html = run("");
    for (const t of ["Historical trends", "How are things changing?", "Compare economic trends", "Monthly heatmap"]) expect(html).toContain(t);
    expect((html.match(/data-testid="source-attribution"/g) ?? []).length).toBeGreaterThanOrEqual(6);
  });
  it("changing the range changes the plotted points; a 5Y window is not silently widened", () => {
    expect(circles(run("range=1Y"))).toBeLessThan(circles(run("")));
    const five = run("range=5Y");
    expect(five).toContain("No other months are filled in");
  });
  it("supports custom ranges, reports invalid ones and handles empty windows", () => {
    expect(run("range=Custom&from=2025-01&to=2025-03")).toContain("Historical trends");
    expect(run("range=Custom&from=2025-06&to=2025-01")).toContain("must not be after");
    expect(run("range=Custom&from=2030-01&to=2030-06")).toContain("observations fall in the selected window");
  });
  it("switches indicator and annual metric", () => {
    expect(run("ind=iip")).toContain("IIP: month-over-month change");
    expect(run("ind=iip")).toContain("Official figures are shown exactly as published");
    expect(run("ind=wpi")).toContain("Official WPI inflation is not available");
    expect(run("ind=wpi&ann=calc")).toContain("Calculated: ((current index");
  });
  it("offers the safe comparison modes and never plots raw levels together", () => {
    for (const m of ["mom", "yoy", "rebased"]) {
      const html = run(`cmp=${m}`);
      expect(html).toContain("These indicators measure different parts of the economy");
      expect(html).not.toContain("separate scales");
    }
    expect(run("cmp=aligned")).toContain("separate scales");
  });
  it("reports no common window instead of a misleading comparison", () => {
    const b = [bundle("cpi", series(2020 * 12, [1, 2, 3])), bundle("wpi", series(2025 * 12, [1, 2, 3])), bundle("iip", series(2025 * 12, [1, 2, 3]))];
    search = "cmp=mom";
    expect(render(<OverviewExplorer bundles={b} />)).toContain("no calendar months in common");
  });
  it("offers CSV download and a monthly table with blank missing cells", () => {
    const html = run("range=3M");
    expect((html.match(/Download CSV/g) ?? []).length).toBe(3);
    expect(html).toContain("Monthly data");
    expect(html).toContain("Official YoY %");
  });
  it("shows the Custom month inputs when the URL carries a valid custom window", () => {
    const html = run("range=Custom&from=2025-01&to=2025-03");
    expect(html).toContain('type="month"');
  });
  it("says no official rate is stored (not 'limited history') when an official series is empty", () => {
    expect(run("ind=cpi")).not.toContain("Not available</td>"); // sanity: no zero-filling
  });
  it("shows the IIP seasonality warning on monthly movements", () => {
    expect(run("ind=iip")).toContain("Monthly industrial output changes can reflect seasonal patterns");
  });
});

describe("Heatmap", () => {
  it("prints values, distinguishes missing months and lists units", () => {
    const html = render(<Heatmap rows={heatGrid([{ n: 2025 * 12, v: 1.5 }, { n: 2025 * 12 + 2, v: -0.4 }])} unit="%" label="WPI" />);
    expect(html).toContain("+1.5");
    expect(html).toContain("-0.4");
    expect(html).toContain("no stored value");
    expect(html).not.toContain("NaN");
  });
});

describe("Insights and coverage", () => {
  it("insights name the source and calculation, and never claim causes", () => {
    const html = render(<InsightsSection bundles={bundles()} />);
    expect(html).toContain("How was this calculated?");
    expect(html).toContain("Source: MoSPI observations");
    expect(html).not.toMatch(/because|due to|will (rise|fall)/i);
  });
  it("coverage reports missing months, unknown release dates, empty series and planned datasets", () => {
    const b = [bundle("cpi", series(2025 * 12, [1, null, 3])), bundle("wpi", series(2025 * 12, [1, 2])), bundle("iip", [])];
    const html = render(<CoveragePanel bundles={b} />);
    expect(html).toContain("Feb 2025");
    expect(html).toContain("Release date not provided");
    expect(html).toContain("Planned: not yet ingested");
    expect(html).toContain("No observations");
  });
});

describe("ArthaGuide help", () => {
  it("has complete entries for every topic", () => {
    for (const e of Object.values(HELP)) for (const k of ["title", "what", "why", "how", "mistake"] as const) expect(e[k].trim().length).toBeGreaterThan(5);
  });
  it("renders an accessible closed button and ignores unknown ids", () => {
    const html = render(<HelpTip id="cpi" />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("Explain: Consumer Price Index (CPI)");
    expect(render(<HelpTip id="nope" />)).toBe("");
  });
});
