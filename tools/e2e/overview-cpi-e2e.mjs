// Browser checks for docs/OVERVIEW-CPI-IMPROVEMENTS-REPORT.md: Overview logo, the 2026-only comparison and the CPI
// forecast experience, at 360/390/768/1024/1440/1920 px in light and dark. GET requests and UI clicks only.
//
//   WEB=http://127.0.0.1:3124 API=http://127.0.0.1:8775 OUT=report.json SHOTS=dir node overview-cpi-e2e.mjs
//
// EXPECT_CPI=available (default) checks a CPI forecast card; EXPECT_CPI=unavailable checks the honest fallback
// (an API without linked CPI runs, e.g. production before the data import).
import { chromium } from "playwright-core";
import fs from "node:fs";
import path from "node:path";

const WEB = process.env.WEB ?? "http://127.0.0.1:3124";
const API = process.env.API ?? "http://127.0.0.1:8775";
const OUT = process.env.OUT ?? "overview-cpi-e2e.json";
const SHOTS = process.env.SHOTS ?? "";
const EXPECT_CPI = process.env.EXPECT_CPI ?? "available";
const CHROME = process.env.CHROME ?? "C:/Program Files/Google/Chrome/Application/chrome.exe";
const WIDTHS = [360, 390, 768, 1024, 1440, 1920];
const THEMES = ["light", "dark"];

const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  (${String(detail).slice(0, 160)})` : ""}`);
};
const shot = async (p, name, opts = {}) => {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await p.screenshot({ path: path.join(SHOTS, `${name}.png`), ...opts });
};

const browser = await chromium.launch({ executablePath: CHROME, headless: true });
async function page(w, theme) {
  const ctx = await browser.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme, hasTouch: w < 800 });
  await ctx.addInitScript((t) => localStorage.setItem("arthasense-theme", t), theme);
  const p = await ctx.newPage();
  const errors = [];
  p.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  p.on("pageerror", (e) => errors.push(String(e)));
  return { p, ctx, errors };
}
const overflow = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const box = (p, sel) => p.locator(sel).first().boundingBox();
const intersects = (a, b) => !!a && !!b && a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

// ---------------- Overview ----------------
for (const w of WIDTHS) {
  for (const theme of THEMES) {
    const tag = `${w}-${theme}`;
    const { p, ctx, errors } = await page(w, theme);
    await p.goto(`${WEB}/`, { waitUntil: "networkidle" });
    await p.waitForSelector("#compare");
    const img = p.getByTestId("hero-logo");
    const info = await img.evaluate((el) => ({ complete: el.complete, nw: el.naturalWidth, nh: el.naturalHeight, w: el.getBoundingClientRect().width, h: el.getBoundingClientRect().height, alt: el.alt, src: el.currentSrc }));
    ok(`overview ${tag}: logo loaded`, info.complete && info.nw > 0, `${info.nw}x${info.nh} ${info.src.slice(-60)}`);
    ok(`overview ${tag}: logo keeps 1:1 aspect ratio`, Math.abs(info.w - info.h) < 1 && info.nw === info.nh, `${info.w}x${info.h}`);
    ok(`overview ${tag}: logo alt text`, info.alt === "ArthaSense AI logo");
    const expected = w >= 1024 ? 176 : w >= 640 ? 136 : 96;
    ok(`overview ${tag}: logo size ${expected}px`, Math.abs(info.w - expected) < 1, info.w);
    const lb = await box(p, '[data-testid="hero-logo"]');
    const h1 = await box(p, "h1");
    const tourBtn = await box(p, 'header[data-tour="hero"] button');
    const link = await box(p, 'header[data-tour="hero"] a[href="/indicators/cpi"]');
    const nav = await box(p, "body > header, body nav, [role=banner]");
    const gdpCard = await box(p, '[data-testid="card-gdp"]');
    ok(`overview ${tag}: logo overlaps no heading, button, link, nav or card`, ![h1, tourBtn, link, nav, gdpCard].some((b) => intersects(lb, b)));
    if (w >= 640) ok(`overview ${tag}: logo is right of the heading`, lb.x >= h1.x + Math.min(h1.width, 200), `logo x ${lb.x}, h1 x ${h1.x}`);
    else ok(`overview ${tag}: logo stacked above the heading`, lb.y + lb.height <= h1.y + 1, `logo bottom ${lb.y + lb.height}, h1 top ${h1.y}`);
    ok(`overview ${tag}: heading text unchanged`, (await p.locator("h1").first().textContent()) === "India's Economy, Explained");
    ok(`overview ${tag}: no horizontal overflow`, (await overflow(p)) <= 0, await overflow(p));
    ok(`overview ${tag}: theme applied`, (await p.evaluate(() => document.documentElement.dataset.theme)) === theme);

    const cmp = p.locator("#compare");
    ok(`overview ${tag}: comparison shows year 2026`, (await cmp.getByTestId("compare-year").textContent()) === "2026");
    ok(`overview ${tag}: comparison has no inputs, selects or checkboxes`, (await cmp.locator("input, select").count()) === 0);
    const btnNames = await cmp.locator("button").allTextContents();
    ok(`overview ${tag}: comparison has no mode/range/year buttons`, !btnNames.some((t) => /Year-on-year %|Month-on-month|Side by side|^\d[MY]$|^All$|Custom|^202[2-5]$/.test(t.trim())), btnNames.join("|"));
    const legend = await cmp.getByRole("list", { name: "Legend" }).textContent();
    ok(`overview ${tag}: CPI, WPI, IIP and GDP in the legend`, ["CPI", "WPI", "IIP", "GDP"].every((k) => legend.includes(k)), legend);
    const cb = await cmp.boundingBox();
    ok(`overview ${tag}: comparison fits the viewport width`, cb.x >= 0 && cb.x + cb.width <= w + 0.5, `${cb.x}+${cb.width}`);
    // Section 2 keeps its own controls (only the comparison was simplified)
    ok(`overview ${tag}: Section 2 still has its range bar and indicator selector`, (await p.locator("#changes button").count()) > 6);
    ok(`overview ${tag}: no console errors`, errors.length === 0, errors.join(" | "));
    if ([360, 768, 1440, 1920].includes(w)) {
      await shot(p, `overview-hero-${tag}`, { clip: { x: 0, y: 0, width: w, height: Math.min(900, (await box(p, '[data-tour="cards"]')).y + 40) } });
      await cmp.scrollIntoViewIfNeeded();
      await cmp.screenshot({ path: SHOTS ? path.join(SHOTS, `overview-compare-${tag}.png`) : undefined });
    }
    await ctx.close();
  }
}

// Tour: the hero step spotlights the hero (logo inside it), the compare step reaches the simplified section.
for (const w of [390, 1440]) {
  const { p, ctx } = await page(w, "light");
  await p.goto(`${WEB}/`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Take a tour" }).first().click();
  const dlg = p.getByRole("dialog");
  await dlg.waitFor();
  ok(`overview tour ${w}: opens on the hero`, /Welcome/.test(await dlg.textContent()));
  let seen = false;
  for (let i = 0; i < 10; i++) {
    const t = await dlg.textContent();
    if (/Comparing trends/.test(t)) {
      seen = /2026/.test(t);
      const db = await dlg.boundingBox();
      const cb = await box(p, "#compare");
      ok(`overview tour ${w}: compare step fits the viewport`, db.x >= 0 && db.x + db.width <= w + 0.5 && db.y >= 0, JSON.stringify(db));
      ok(`overview tour ${w}: compare step does not cover the section title`, !intersects(db, await box(p, "#compare-h")) || !cb, "");
      break;
    }
    const next = dlg.getByRole("button", { name: /Next/ });
    if (!(await next.count())) break;
    await next.click();
    await p.waitForTimeout(250);
  }
  ok(`overview tour ${w}: reaches the comparison step describing 2026`, seen);
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
  ok(`overview tour ${w}: Escape closes the tour`, (await p.getByRole("dialog").count()) === 0);
  await ctx.close();
}

// ---------------- Forecasts ----------------
const series = await (await fetch(`${API}/api/v1/forecasting/series`)).json();
const cpiInfo = series.find((s) => s.indicator === "cpi");
for (const w of WIDTHS) {
  for (const theme of THEMES) {
    const tag = `${w}-${theme}`;
    const { p, ctx, errors } = await page(w, theme);
    await p.goto(`${WEB}/forecasting`, { waitUntil: "networkidle" });
    const card = p.getByTestId("card-cpi");
    const txt = await card.textContent();
    if (EXPECT_CPI === "available") {
      ok(`forecasts ${tag}: CPI card shows a model estimate`, /Model estimate/.test(txt) && (await card.getByTestId("card-unavailable").count()) === 0, txt.slice(0, 120));
      ok(`forecasts ${tag}: CPI card latest official equals API latest`, txt.includes(cpiInfo.latest_value.toFixed(2)), cpiInfo.latest_value);
      ok(`forecasts ${tag}: CPI card says what it was trained on`, /Trained on 166 months of official data/.test(txt));
    } else {
      ok(`forecasts ${tag}: CPI card is an honest unavailable card`, (await card.getByTestId("card-unavailable").count()) === 1 && !/Model estimate/.test(txt), txt.slice(0, 160));
      ok(`forecasts ${tag}: CPI unavailable card mentions the older official history`, /back series on the same 2024 base/.test(txt));
    }
    for (const id of ["wpi", "iip"]) ok(`forecasts ${tag}: ${id.toUpperCase()} card still shows a model estimate`, /Model estimate/.test(await p.getByTestId(`card-${id}`).textContent()));
    ok(`forecasts ${tag}: no horizontal overflow`, (await overflow(p)) <= 0, await overflow(p));
    ok(`forecasts ${tag}: no console errors`, errors.length === 0, errors.join(" | "));
    if ([390, 1440].includes(w)) await shot(p, `forecasts-outlook-${tag}`, { fullPage: true });

    await p.goto(`${WEB}/forecasting/cpi`, { waitUntil: "networkidle" });
    if (EXPECT_CPI === "available") {
      const horizons = await p.locator('[data-tour="fx-horizon"] [role="radio"]').allTextContents();
      ok(`cpi explorer ${tag}: 1, 3 and 6 month horizons`, ["1 month", "3 months", "6 months"].every((h) => horizons.includes(h)), horizons.join("|"));
      ok(`cpi explorer ${tag}: training history line`, (await p.getByTestId("training-history").count()) === 1);
      ok(`cpi explorer ${tag}: chart drawn`, (await p.locator('[data-tour="fx-chart"] svg').count()) > 0);
    } else {
      ok(`cpi explorer ${tag}: unavailable page with older-history note`, /back series on the same 2024 base/.test(await p.getByTestId("not-enough-history").textContent()));
    }
    ok(`cpi explorer ${tag}: no horizontal overflow`, (await overflow(p)) <= 0, await overflow(p));
    ok(`cpi explorer ${tag}: no console errors`, errors.length === 0, errors.join(" | "));
    if ([390, 1440].includes(w)) await shot(p, `forecasts-cpi-${tag}`, { fullPage: true });
    await ctx.close();
  }
}

if (EXPECT_CPI === "available") {
  const { p, ctx, errors } = await page(1440, "light");
  await p.goto(`${WEB}/forecasting/cpi?view=research`, { waitUntil: "networkidle" });
  const t = await p.locator("body").textContent();
  ok("cpi research: Training data row lists the back and current series", /Training data/.test(t) && t.includes("mospi.cpi.2024.back.all_india.combined.general.index (Jan 2013 – Dec 2024, 144 mo)"));
  ok("cpi research: data fingerprint of the linked history", t.includes("e9b1f3b6f3fbf346"));
  await shot(p, "forecasts-cpi-research-1440-light", { fullPage: true });
  for (const h of [1, 3, 6]) {
    await p.goto(`${WEB}/forecasting/cpi?horizon=${h}`, { waitUntil: "networkidle" });
    const rows = await (await fetch(`${API}/api/v1/forecasting/forecasts/latest?indicator=cpi&model=drift&horizon=${h}`)).json();
    ok(`cpi explorer: ${h}-month view has ${h} stored forecast month(s)`, rows.items.length === h && rows.items.every((r) => r.target_date > "2026-10-01"));
  }
  await p.goto(`${WEB}/forecasting/comparison?indicator=cpi&horizon=6`, { waitUntil: "networkidle" });
  const ct = await p.locator("body").textContent();
  ok("comparison: CPI h=6 shows 6 models on 17 identical origins", /17/.test(ct) && /SARIMA/.test(ct) && /Drift/.test(ct));
  await shot(p, "forecasts-comparison-cpi-h6-1440-light", { fullPage: true });
  ok("cpi research/comparison: no console errors", errors.length === 0, errors.join(" | "));
  // spotlight tour on the outlook anchors on the first available card (CPI now)
  await p.goto(`${WEB}/forecasting`, { waitUntil: "networkidle" });
  ok("forecasts tour anchors on the CPI card", (await p.getByTestId("card-cpi").locator('[data-tour="fo-official"]').count()) === 1);
  await ctx.close();
}

// Indicators pages unchanged in structure and error-free
for (const id of ["cpi", "wpi", "iip", "gdp"]) {
  const { p, ctx, errors } = await page(1440, "light");
  const r = await p.goto(`${WEB}/indicators/${id}`, { waitUntil: "networkidle" });
  ok(`indicators/${id}: loads`, r.status() === 200);
  ok(`indicators/${id}: keeps its range filters`, (await p.getByRole("button", { name: "All" }).count()) > 0);
  ok(`indicators/${id}: no console errors`, errors.length === 0, errors.join(" | "));
  await ctx.close();
}

await browser.close();
const failed = results.filter((r) => !r.pass);
fs.writeFileSync(OUT, JSON.stringify({ web: WEB, expect_cpi: EXPECT_CPI, total: results.length, failed: failed.length, results }, null, 1));
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
