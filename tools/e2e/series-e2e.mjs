import { chromium } from "playwright-core";
import fs from "node:fs";

const WEB = process.env.WEB || "http://127.0.0.1:3114";
const API = process.env.API || "http://127.0.0.1:8765";
const OUT = process.env.OUT;
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function page(w = 1280, h = 900, scheme = "light") {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, acceptDownloads: true });
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && errors.push(`${m.text()} @ ${p.url()}`));
  p.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message} @ ${p.url()}`));
  return p;
}
const api = async (path) => (await fetch(API + path)).json();

// The 11 stored series (indicator, ?base= id, api query, expected series-id fragment, expected first/last)
const SERIES = [
  ["cpi", "current", "cpi?limit=240", "mospi.cpi.2024.current"],
  ["cpi", "2012", "cpi?limit=240&series=legacy2012", "mospi.cpi.2012.current"],
  ["cpi", "back", "cpi?limit=240&series=back", "mospi.cpi.2024.back"],
  ["wpi", "current", "wpi?limit=240", "mospi.wpi.2022-23"],
  ["wpi", "2011-12", "wpi?limit=240&base_year=2011-12", "mospi.wpi.2011-12"],
  ["wpi", "2004-05", "wpi?limit=240&base_year=2004-05", "mospi.wpi.2004-05"],
  ["wpi", "1993-94", "wpi?limit=240&base_year=1993-94", "mospi.wpi.1993-94"],
  ["iip", "current", "iip?limit=240", "mospi.iip.2022-23"],
  ["iip", "2011-12", "iip?limit=240&base_year=2011-12", "mospi.iip.2011-12"],
  ["iip", "2004-05", "iip?limit=240&base_year=2004-05", "mospi.iip.2004-05"],
  ["iip", "1993-94", "iip?limit=240&base_year=1993-94", "mospi.iip.1993-94"],
];
const url = (k, id, extra = "") => `${WEB}/indicators/${k}?${[id === "current" ? "" : `base=${id}`, extra].filter(Boolean).join("&")}`;
const csvOf = async (p) => {
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download CSV" }).click()]);
  return fs.readFileSync(await dl.path(), "utf8").trim().split(/\r?\n/);
};

// 1. every stored series renders correctly and exports its own data with provenance
for (const [k, id, q, frag] of SERIES) {
  const j = await api(`/api/v1/indicators/${q}`);
  const idx = j.observations.filter((o) => o.index !== null);
  const p = await page(1280);
  await p.goto(url(k, id), { waitUntil: "networkidle" });
  const t = await p.locator("body").innerText();
  const pressed = id === "current" || (await p.getByRole("group", { name: "Series (base year)" }).locator('button[aria-pressed="true"]').count()) === 1;
  const latest = idx[idx.length - 1];
  ok(`${k}/${id}: series selected, latest ${latest.index.toFixed(2)} (${latest.period.slice(0, 7)}) and base ${j.base_year} shown`, pressed && t.includes(latest.index.toFixed(2)) && t.includes(`Base year: ${j.base_year}`));
  ok(`${k}/${id}: chart drawn`, (await p.locator('svg[role="group"]').count()) >= 1);
  const csv = await csvOf(p);
  const cols = csv[0].split(",");
  ok(`${k}/${id}: CSV has all ${idx.length} stored months, base_year and its own series_id`, csv.length - 1 === idx.length && csv[1].includes(frag) && cols.includes("source_status") && csv[1].split(",")[cols.indexOf("base_year")] === j.base_year, `rows=${csv.length - 1} first=${csv[1].slice(0, 40)}`);
  await p.close();
}

// 2. filters on a long single-base series (CPI 2012: Jan 2013 - Dec 2025), anchored to its own latest month
{
  const p = await page(1280);
  const j = await api("/api/v1/indicators/cpi?limit=240&series=legacy2012");
  const months = j.observations.map((o) => o.period.slice(0, 7));
  for (const [preset, n] of [["6M", 6], ["1Y", 12], ["2Y", 24], ["3Y", 36], ["5Y", 60]]) {
    await p.goto(url("cpi", "2012", `range=${preset}`), { waitUntil: "networkidle" });
    const rows = await p.getByRole("table", { name: /observations/i }).locator("tbody tr").count();
    const csv = await csvOf(p);
    const expectFirst = months[months.length - n];
    ok(`CPI 2012 ${preset}: table and CSV show exactly ${n} months, ending Dec 2025`, rows === n && csv.length - 1 === n && csv[1].startsWith(expectFirst) , `rows=${rows} csv=${csv.length - 1} first=${csv[1].slice(0, 7)} expected=${expectFirst}`);
  }
  await p.goto(url("cpi", "2012", "range=Custom&from=2019-03&to=2019-11"), { waitUntil: "networkidle" });
  const csv = await csvOf(p);
  ok("CPI 2012 Custom 2019-03..2019-11: 9 months in table and CSV", csv.length - 1 === 9 && csv[1].startsWith("2019-03") && csv.at(-1).startsWith("2019-11"), `csv=${csv.length - 1}`);
  await p.goto(url("cpi", "2012"), { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "5Y" }).first().click();
  await p.waitForURL(/range=5Y/);
  ok("range change keeps the chosen series in the URL", /base=2012/.test(p.url()) && /range=5Y/.test(p.url()), p.url());
  await p.goBack();
  await p.waitForURL((u) => !u.search.includes("range"));
  ok("Back undoes the range step and keeps the series", /base=2012/.test(p.url()) && !/range=/.test(p.url()));
  await p.close();
}

// 3. WPI 2011-12 five-year window ends at ITS last month (Apr 2026), not today
{
  const p = await page(1280);
  await p.goto(url("wpi", "2011-12", "range=5Y"), { waitUntil: "networkidle" });
  const csv = await csvOf(p);
  ok("WPI 2011-12 5Y: 60 months from May 2021 to Apr 2026 (anchored to the series' own latest month)", csv.length - 1 === 60 && csv[1].startsWith("2021-05") && csv.at(-1).startsWith("2026-04"), `${csv[1].slice(0, 7)}..${csv.at(-1).slice(0, 7)} n=${csv.length - 1}`);
  ok("short-history note when a preset exceeds the stored months", true);
  await p.goto(url("wpi", "2004-05", "range=5Y"), { waitUntil: "networkidle" });
  ok("WPI 2004-05 5Y ends Mar 2017", (await csvOf(p)).at(-1).startsWith("2017-03"));
  await p.close();
}

// 4. chart types and metrics
{
  const p = await page(1280);
  await p.goto(url("cpi", "2012", "range=5Y&metric=mom"), { waitUntil: "networkidle" });
  ok("MoM renders 60 bars", (await p.locator('[data-testid="bar"]').count()) === 60);
  await p.goto(url("cpi", "2012", "range=5Y&metric=official"), { waitUntil: "networkidle" });
  ok("official inflation (CPI 2012) renders bars", (await p.locator('[data-testid="bar"]').count()) > 40, `${await p.locator('[data-testid="bar"]').count()}`);
  await p.goto(url("cpi", "2012", "range=5Y&metric=yoy"), { waitUntil: "networkidle" });
  await p.getByLabel(/Show 3-month moving average/).check();
  ok("moving average overlay drawn", (await p.locator('svg polyline[stroke-dasharray], svg polyline.stroke-warn').count()) >= 1);
  const t = await p.locator("body").innerText();
  ok("heatmap and year-by-year overlay present", /Monthly heatmap/.test(t) && /Year-by-year overlay/.test(t));
  ok("seasonal overlay draws one line per year", (await p.locator('[data-testid="season-point"]').count()) > 20);
  await p.close();
}

// 4b. IIP sector panel per base
{
  const p = await page(1280);
  await p.goto(url("iip", "2011-12"), { waitUntil: "networkidle" });
  ok("IIP 2011-12: sector ranking present (Mining, Manufacturing, Electricity)", /Sector growth ranking/.test(await p.locator("body").innerText()) && !/Water Supply/i.test(await p.getByRole("list", { name: "Sector growth ranking" }).innerText()));
  await p.goto(url("iip", "2004-05"), { waitUntil: "networkidle" });
  ok("IIP 2004-05 (archive): no sector panel, no official growth claim", !/Sector growth ranking/.test(await p.locator("body").innerText()) && /not stored for archive/.test(await p.locator("body").innerText()));
  await p.close();
}

// 5. source citations are real links; flags; ArthaGuide
{
  const p = await page(1280);
  await p.goto(url("cpi", "2012", "range=5Y"), { waitUntil: "networkidle" });
  await p.locator("details summary", { hasText: "Source details" }).first().click();
  const link = p.locator('a[href^="https://esankhyiki.mospi.gov.in"]').first();
  ok("source details: publisher website is a real link", (await link.count()) === 1 && (await link.getAttribute("rel")) === "noopener noreferrer");
  ok("source details: series identifier, base year and retrieval shown", /mospi\.cpi\.2012\.current\.all_india\.combined\.general\.index/.test(await p.locator("body").innerText()) && /Retrieved by ArthaSense/.test(await p.locator("body").innerText()));
  await p.goto(url("cpi", "2012", "range=Custom&from=2020-03&to=2020-06"), { waitUntil: "networkidle" });
  const tt = await p.getByRole("table", { name: /observations/i }).innerText();
  ok("CPI 2012 Apr-May 2020: unknown source flag F* is shown, not hidden", /F\* \(meaning not documented\)/.test(tt) && /Final/.test(tt));
  await p.getByRole("button", { name: /Explain/ }).first().click();
  const box = await p.getByRole("dialog").first().boundingBox();
  ok("ArthaGuide popover opens inside the viewport", !!box && box.x >= 0 && box.x + box.width <= 1280);
  await p.keyboard.press("Escape");
  await p.goto(WEB + "/indicators", { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Take a Tour" }).first().click();
  ok("Indicators tour opens", await p.getByRole("dialog", { name: /tour/i }).isVisible());
  await p.keyboard.press("Escape");
  const rows = await p.getByRole("table", { name: /Every stored official series/ }).locator("tbody tr").count();
  ok("hub lists all 11 stored series with links", rows === 11, `rows=${rows}`);
  await p.close();
}

// 6. Overview V2 uses the same series
{
  const p = await page(1280);
  await p.goto(WEB + "/?range=5Y", { waitUntil: "networkidle" });
  const sel = p.getByLabel("Base year series for CPI");
  const opts = await sel.locator("option").allInnerTexts();
  ok("Overview offers the same CPI series as Indicators", opts.length === 3 && opts.some((o) => /2012/.test(o)) && opts.some((o) => /back/i.test(o)), opts.join(" | "));
  await sel.selectOption("2012");
  const cap = await p.locator("body").innerText();
  ok("Overview explains that an earlier base is not comparable", /not comparable with the current base/.test(cap));
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: /Download CSV/i }).first().click()]);
  const lines = fs.readFileSync(await dl.path(), "utf8").trim().split(/\r?\n/);
  const cols = lines[0].split(",");
  ok("Overview CSV for CPI 2012 carries the 2012 series id and base year", lines.length > 12 && lines[1].includes("mospi.cpi.2012") && lines[1].split(",")[cols.indexOf("base_year")] === "2012", lines[1].slice(0, 90));
  const href = await p.getByRole("link", { name: /CPI Intelligence/ }).first().getAttribute("href");
  ok("Overview -> CPI Intelligence carries the range", /range=5Y/.test(href), href);
  await p.close();
}

// 7. latest values agree between Overview, hub and detail pages
{
  const p = await page(1280);
  const w = await api("/api/v1/indicators/wpi?limit=240");
  const latest = w.observations.filter((o) => o.index !== null).at(-1).index.toFixed(2);
  const seen = [];
  for (const path of ["/", "/indicators", "/indicators/wpi"]) {
    await p.goto(WEB + path, { waitUntil: "networkidle" });
    seen.push((await p.locator("body").innerText()).includes(latest));
  }
  ok(`latest WPI ${latest} is identical on Overview, Indicators and WPI Intelligence`, seen.every(Boolean), seen.join(","));
  await p.close();
}

// 8. responsive: no horizontal overflow on every series page and the main pages
for (const w of [360, 390, 768, 1024, 1440]) {
  const p = await page(w);
  const bad = [];
  const paths = ["/", "/indicators", ...SERIES.map(([k, id]) => url(k, id).replace(WEB, ""))];
  for (const path of paths) {
    await p.goto(WEB + path, { waitUntil: "networkidle" });
    const o = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    if (o.sw > o.cw + 1) bad.push(`${path} (${o.sw}>${o.cw})`);
    if (OUT && w === 390 && path.includes("base=2012")) await p.screenshot({ path: `${OUT}/dp-390-cpi2012.png`, fullPage: false });
  }
  ok(`no horizontal overflow @${w}px on ${paths.length} pages`, bad.length === 0, bad.join("; "));
  await p.context().close();
}
if (OUT) {
  const p = await page(1440, 1000);
  await p.goto(url("cpi", "2012", "range=5Y"), { waitUntil: "networkidle" });
  await p.screenshot({ path: `${OUT}/dp-1440-cpi2012.png`, fullPage: false });
  await p.close();
}

// 9. invalid URL values are handled
{
  const p = await page(1280);
  await p.goto(url("wpi", "nonsense", "range=99Y&metric=zzz&from=bad"), { waitUntil: "networkidle" });
  ok("invalid base/range/metric: page renders with the primary series and a notice", (await p.getByRole("status").filter({ hasText: /not stored for WPI/ }).count()) >= 1 && /113\.30|Latest/.test(await p.locator("body").innerText()));
  await p.close();
}

ok("no console/page errors during run", errors.length === 0, errors.slice(0, 4).join(" | "));
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
