import { renderToStaticMarkup as renderRaw } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IipSectorPanel } from "@/components/indicators/iip-sector-panel";
import { IndicatorDashboard } from "@/components/indicators/indicator-dashboard";
import { IndicatorSummaryView } from "@/components/indicators/indicator-summary";
import { IndicatorsOverview } from "@/components/indicators/indicators-overview";
import { IndicatorsSubNav } from "@/components/indicators/subnav";
import { getIipSectors, getIndicator } from "@/lib/api";
import { cpiPayload, iipPayload, iipSectorsPayload, wpiPayload } from "@/lib/fixtures";
import { type IndicatorKey, type IndicatorResult, parseIndicatorResponse } from "@/lib/indicator";
import { CONFIG_LIST, CONFIGS, CPI_CONFIG, IIP_CONFIG, WPI_CONFIG } from "@/lib/indicators";
import { parseIipSectors } from "@/lib/iip-sectors";
import { isActive, NAV_ITEMS } from "@/lib/nav";

/** React inserts <!-- --> between adjacent text nodes; strip them so assertions read naturally. */
const renderToStaticMarkup = (el: React.ReactElement) => renderRaw(el).replace(/<!-- -->/g, "");

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: () => {} }),
  usePathname: () => "/indicators/wpi",
}));

const months = ["01", "02", "03", "09", "12"]; // Sep -> Dec is a gap (Oct, Nov not stored)
const obs = (rate = false) =>
  months.map((m, i) => ({ period: `2025-${m}-01`, index: 100 + i, rate: rate ? 1 + i : null }));

function result(kind: IndicatorKey, payload: unknown): IndicatorResult {
  return { ok: true, data: parseIndicatorResponse(payload, kind)! };
}
const cpi = () => result("cpi", cpiPayload(obs()));
const wpi = () => result("wpi", wpiPayload(obs()));
const iip = () => result("iip", iipPayload(obs(true)));
const empty = (kind: IndicatorKey, payload: unknown) => result(kind, payload);

describe("CPI dashboard (regression)", () => {
  const html = renderToStaticMarkup(<IndicatorDashboard config={CPI_CONFIG} result={cpi()} />);
  it("shows the latest value, MoM only when consecutive, and missing inflation as unavailable", () => {
    expect(html).toContain("Latest CPI Index");
    expect(html).toContain("104.00");
    expect(html).toContain("Year-over-Year Inflation");
    expect(html).toContain("Not available");
    expect(html).toContain("Official year-over-year inflation data is not available for this period.");
    expect(html).toContain("Needs the previous calendar month");
    expect(html).toContain("No stored observation for: Apr 2025, May 2025");
    expect(html).toContain("Oct 2025, Nov 2025. These months are left blank, not estimated.");
    expect(html).toContain("Data Source &amp; Methodology");
    expect(html).toContain("not provided by the API");
    expect(html).toContain("India CPI Index Trend");
    expect(html).toContain("YoY inflation (official)");
  });
});

describe("WPI dashboard", () => {
  const html = renderToStaticMarkup(<IndicatorDashboard config={WPI_CONFIG} result={wpi()} />);
  it("uses WPI wording, the real base year and the real publisher", () => {
    expect(html).toContain("Latest Headline WPI Index");
    expect(html).toContain("Base 2022-23 = 100");
    expect(html).toContain("India WPI Index Trend");
    expect(html).toContain("Office of the Economic Adviser");
    expect(html).toContain("WPI index (2022-23 = 100)");
    expect(html).not.toContain("Consumer Price");
    expect(html).not.toContain("2024 = 100");
  });
  it("never invents inflation: no inflation column, an explicit unavailable card", () => {
    expect(html).toContain("Official WPI Inflation");
    expect(html).toContain("Official WPI inflation is not available here");
    expect(html).not.toContain("YoY inflation (official)");
    expect(html).toContain("does not mark values as provisional or final");
  });
});

describe("IIP dashboard", () => {
  const html = renderToStaticMarkup(<IndicatorDashboard config={IIP_CONFIG} result={iip()} />);
  it("shows official growth as growth, not inflation, and warns about seasonality", () => {
    expect(html).toContain("Latest Headline IIP Index");
    expect(html).toContain("Official Industrial Growth (YoY)");
    expect(html).toContain("+5.00%");
    expect(html).toContain("YoY growth (official)");
    expect(html).toContain("not seasonally adjusted");
    expect(html).not.toMatch(/inflation/i);
  });
  it("renders extra panels passed as children (sector breakdown)", () => {
    const out = renderToStaticMarkup(
      <IndicatorDashboard config={IIP_CONFIG} result={iip()}>
        <p>SECTOR-PANEL</p>
      </IndicatorDashboard>,
    );
    expect(out).toContain("SECTOR-PANEL");
  });
});

describe("states", () => {
  it.each(CONFIG_LIST)("$shortName: error state with retry, and empty state", (config) => {
    const err = renderToStaticMarkup(
      <IndicatorDashboard config={config} result={{ ok: false, error: "ECONNREFUSED" }} />,
    );
    expect(err).toContain(`Unable to load ${config.shortName} data. Please check the API connection.`);
    expect(err).toContain("Retry");
    const payload = { cpi: cpiPayload([]), wpi: wpiPayload([]), iip: iipPayload([]) }[config.key];
    const none = renderToStaticMarkup(<IndicatorDashboard config={config} result={empty(config.key, payload)} />);
    expect(none).toContain(config.empty);
  });
});

describe("homepage summary cards", () => {
  it.each([
    [CPI_CONFIG, cpi, "Source: MoSPI"],
    [WPI_CONFIG, wpi, "Source: OEA via MoSPI"],
    [IIP_CONFIG, iip, "Source: MoSPI"],
  ] as const)("%s shows the real latest value and links to its page", (config, make, source) => {
    const html = renderToStaticMarkup(<IndicatorSummaryView config={config} result={make()} />);
    expect(html).toContain("104.00");
    expect(html).toContain("December 2025");
    expect(html).toContain(source);
    expect(html).toContain(`href="${config.path}"`);
  });
  it("shows honest error and empty states instead of numbers", () => {
    expect(renderToStaticMarkup(<IndicatorSummaryView config={WPI_CONFIG} result={{ ok: false, error: "x" }} />)).toContain(
      "Unable to load WPI data",
    );
    const html = renderToStaticMarkup(
      <IndicatorSummaryView config={IIP_CONFIG} result={empty("iip", iipPayload([]))} />,
    );
    expect(html).toContain("No IIP observations have been imported yet.");
    expect(html).not.toMatch(/\d{2,3}\.\d{2}/);
  });
});

describe("indicators overview", () => {
  it("lists all three with accurate status and no fabricated values", () => {
    const html = renderToStaticMarkup(
      <IndicatorsOverview
        entries={[
          { config: CPI_CONFIG, result: cpi() },
          { config: WPI_CONFIG, result: empty("wpi", wpiPayload([])) },
          { config: IIP_CONFIG, result: { ok: false, error: "down" } },
        ]}
      />,
    );
    expect(html).toContain("Available");
    expect(html).toContain("No data imported");
    expect(html).toContain("API unavailable");
    expect(html).toContain("104.00");
    expect(html.match(/Unavailable/g)?.length).toBe(4); // value + period for the two without data
    expect(html).toContain("levels must not be compared");
    for (const c of CONFIG_LIST) expect(html).toContain(`href="${c.path}"`);
  });
});

describe("IIP sector panel", () => {
  const sectors = parseIipSectors(
    iipSectorsPayload({ mining: obs(true), manufacturing: obs(true), electricity: [] }),
  )!;
  it("shows only sectors that have stored data", () => {
    const html = renderToStaticMarkup(<IipSectorPanel result={{ ok: true, data: sectors }} />);
    expect(html).toContain("Mining");
    expect(html).toContain("Manufacturing");
    expect(html).not.toContain("Electricity");
    expect(html).toContain("YoY growth (official)");
    expect(html).toContain("not additive");
  });
  it("handles empty and error states", () => {
    const none = parseIipSectors(iipSectorsPayload({ mining: [] }))!;
    expect(renderToStaticMarkup(<IipSectorPanel result={{ ok: true, data: none }} />)).toContain(
      "No sector observations have been imported yet.",
    );
    expect(renderToStaticMarkup(<IipSectorPanel result={{ ok: false, error: "x" }} />)).toContain("Unable to load");
  });
  it("rejects malformed sector payloads", () => {
    expect(parseIipSectors({ base_year: "2022-23", sectors: [{ key: 1 }] })).toBeNull();
    expect(parseIipSectors(null)).toBeNull();
  });
});

describe("navigation", () => {
  it("keeps one Indicators item that stays active on every indicator page", () => {
    expect(NAV_ITEMS.filter((n) => n.href.startsWith("/indicators"))).toHaveLength(1);
    for (const c of CONFIG_LIST) expect(isActive(c.path, "/indicators")).toBe(true);
  });
  it("sub-navigation links to Overview, CPI, WPI and IIP and marks the current page", () => {
    const html = renderToStaticMarkup(<IndicatorsSubNav />);
    for (const href of ["/indicators", "/indicators/cpi", "/indicators/wpi", "/indicators/iip"])
      expect(html).toContain(`href="${href}"`);
    for (const label of ["CPI Intelligence", "WPI Intelligence", "IIP Intelligence"]) expect(html).toContain(label);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/href="\/indicators\/wpi"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/indicators\/wpi"/);
  });
  it("every config has a unique route and api query", () => {
    expect(new Set(CONFIG_LIST.map((c) => c.path)).size).toBe(3);
    expect(Object.keys(CONFIGS).sort()).toEqual(["cpi", "iip", "wpi"]);
  });
});

describe("API fetchers (mocked fetch, no network)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (body: unknown, status = 200) =>
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));

  it("parses a good response for each indicator", async () => {
    respond(wpiPayload(obs()));
    const r = await getIndicator("wpi");
    expect(r.ok && r.data.observations).toHaveLength(5);
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/api/v1/indicators/wpi?limit=240");
  });
  it("reports HTTP errors, malformed bodies and network failures without throwing", async () => {
    respond({ detail: "database unavailable" }, 503);
    expect(await getIndicator("cpi")).toEqual({ ok: false, error: "API answered HTTP 503" });
    respond({ nonsense: true });
    expect((await getIndicator("cpi")).ok).toBe(false);
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNREFUSED"))));
    expect(await getIndicator("iip")).toEqual({ ok: false, error: "ECONNREFUSED" });
    expect((await getIipSectors()).ok).toBe(false);
  });
  it("fetches IIP sectors from the sectors endpoint", async () => {
    respond(iipSectorsPayload({ mining: obs(true) }));
    const r = await getIipSectors();
    expect(r.ok && r.data.sectors[0].key).toBe("mining");
    expect(vi.mocked(fetch).mock.calls[0][0]).toContain("/api/v1/indicators/iip/sectors");
  });
});
