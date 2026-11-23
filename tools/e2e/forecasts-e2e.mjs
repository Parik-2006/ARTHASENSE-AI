// Forecasts V3 browser checks (real Chrome via playwright-core; see README.md in this folder).
//   WEB=http://127.0.0.1:3124 API=http://127.0.0.1:8775 OUT=report.json node forecasts-e2e.mjs
// Read-only: it only issues GET requests and clicks in the UI. Point API at a LOCAL database.
import { chromium } from "playwright-core";
import fs from "node:fs";

const WEB = process.env.WEB || "http://127.0.0.1:3124";
const API = process.env.API || "http://127.0.0.1:8775";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: !!pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`);
};
const api = async (p) => (await fetch(API + p)).json();
const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function page(w = 1440, h = 900, scheme = "light") {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, acceptDownloads: true, hasTouch: w < 800 });
  await ctx.addInitScript((t) => localStorage.setItem("arthasense-theme", t), scheme);
  const p = await ctx.newPage();
  p.on("console", (m) => m.type() === "error" && errors.push(`${m.text().slice(0, 160)} @ ${p.url()}`));
  p.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)} @ ${p.url()}`));
  return p;
}
const go = (p, url) => p.goto(WEB + url, { waitUntil: "networkidle", timeout: 60000 });
const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
const num = (s) => Number(String(s).replace(/[^0-9.-]/g, ""));

// ---------- 1. data: same official series, forecasts after cutoff ----------
const series = await api("/api/v1/forecasting/series");
for (const id of ["cpi", "wpi", "iip"]) {
  const ind = await api(`/api/v1/indicators/${id}?limit=240`);
  const last = [...ind.observations].reverse().find((o) => o.index !== null);
  const s = series.find((x) => x.indicator === id);
  ok(`${id}: /forecasting/series latest == /indicators latest`, s && last && Math.abs(s.latest_value - Number(last.index)) < 1e-9, `${s?.latest_value} vs ${last?.index}`);
  ok(`${id}: same base year on both APIs`, s?.base_year === ind.base_year, `${s?.base_year} / ${ind.base_year}`);
}
const fruns = await api("/api/v1/forecasting/runs?kind=forecast&limit=200");
let after = true;
for (const r of fruns.items) {
  const rows = await api(`/api/v1/forecasting/forecasts?run_id=${r.id}&limit=200`);
  for (const f of rows.items) if (!(f.target_date > r.training_cutoff)) after = false;
}
ok("every stored future forecast date is after its training cutoff", after, `${fruns.items.length} runs`);

// ---------- 2. Forecasts shows the same latest official value as Indicators ----------
{
  const p = await page();
  for (const id of ["wpi", "iip", "cpi"]) {
    await go(p, `/indicators/${id}`);
    // Indicators range summary at the default (All) window: the value under "Index at end of period".
    const indVal = num(
      await p.evaluate(() => {
        const label = [...document.querySelectorAll('[data-testid="range-summary"] *')].find((e) => e.childElementCount === 0 && e.textContent.trim() === "Index at end of period");
        const box = label?.parentElement;
        return box ? (box.innerText.split(/\n/).map((x) => x.trim()).filter(Boolean)[1] ?? "NaN") : "NaN";
      }),
    );
    await go(p, `/forecasting/${id}`);
    const sel = id === "cpi" ? '[data-testid="not-enough-history"] .figure' : '[data-tour="fx-official"] dd >> nth=0';
    const fcVal = num(await p.locator(sel).first().innerText().catch(() => "NaN"));
    ok(`${id}: Forecasts page latest official == Indicators page`, Number.isFinite(indVal) && indVal === fcVal, `${fcVal} vs ${indVal}`);
  }
  // CPI: clean state, no forecast numbers
  await go(p, "/forecasting/cpi");
  ok("CPI shows 'Not enough comparable history' and no explorer", (await p.getByText("Not enough comparable history").count()) > 0 && (await p.locator('[data-tour="fx-chart"]').count()) === 0);
  await p.context().close();
}

// ---------- 3. explorer controls, view switching, tooltip, CSV ----------
{
  const p = await page();
  await go(p, "/forecasting/wpi");
  const kpi = async () => (await p.locator('[data-testid="kpis"] > div').nth(1).innerText()).replace(/\s+/g, " ");
  const k6 = await kpi();
  await p.getByRole("radio", { name: "1 month" }).click();
  await p.waitForURL(/horizon=1/);
  const k1 = await kpi();
  ok("horizon selector changes target month and keeps model", k1 !== k6 && /November 2026/.test(k1), k1);
  await p.getByLabel("Model", { exact: true }).selectOption("ets");
  await p.waitForURL(/model=ets/);
  ok("model selector updates URL and KPI", /ETS/.test(await kpi()) && /horizon=1/.test(p.url()), p.url());
  await p.getByRole("radio", { name: "1Y" }).click();
  await p.waitForURL(/range=1Y/);
  ok("history window is separate from horizon", /horizon=1/.test(p.url()) && /model=ets/.test(p.url()));
  await p.getByRole("radio", { name: "Research" }).click();
  await p.waitForURL(/view=research/);
  ok("Research View shows evidence panel", await p.locator('[data-testid="research-view"]').isVisible());
  await p.getByRole("radio", { name: "3 months" }).click();
  await p.waitForURL(/horizon=3/);
  ok("view=research survives control changes", /view=research/.test(p.url()) && /range=1Y/.test(p.url()), p.url());
  const hist = await p.getByRole("link", { name: /View historical WPI/ }).getAttribute("href");
  ok("historical link carries only the window", hist === "/indicators/wpi?range=1Y", hist);
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download CSV" }).click()]);
  const csv = fs.readFileSync(await dl.path(), "utf8");
  ok("explorer CSV has provenance and 'not official' classification", /model_forecast_not_official/.test(csv) && csv.trim().split("\n").length === 4, dl.suggestedFilename());
  await p.getByRole("radio", { name: "Simple" }).click();
  await p.waitForURL((u) => !/view=research/.test(u.toString()));
  ok("Simple View hides research panels", (await p.locator('[data-testid="research-view"]').count()) === 0);
  // tooltip
  const chart = p.getByTestId("outlook-chart");
  const box = await chart.boundingBox();
  await p.mouse.move(box.x + box.width - 6, box.y + box.height / 2);
  const tip = p.getByTestId("chart-tooltip");
  const tipText = await tip.innerText();
  const tb = await tip.boundingBox();
  ok("hover tooltip on forecast: month, value, source, ranges", /Model estimate/.test(tipText) && /80% range/.test(tipText) && /95% range/.test(tipText), tipText.replace(/\n/g, " | "));
  ok("tooltip stays inside the chart", tb.x >= box.x - 1 && tb.x + tb.width <= box.x + box.width + 1);
  await p.mouse.move(box.x + 60, box.y + box.height / 2);
  ok("hover tooltip on history says Official", /Official · /.test(await tip.innerText()));
  await p.context().close();
}

// ---------- 4. spotlight tours (desktop + phone) ----------
async function tour(url, w, h, expectSteps, label) {
  const p = await page(w, h);
  await go(p, url);
  const btn = p.getByRole("button", { name: "Take a tour" }).first();
  await btn.click();
  let seen = 0;
  let geometryOk = true;
  const notes = [];
  for (let i = 0; i < 12; i++) {
    const dlg = p.getByRole("dialog");
    if (!(await dlg.count())) break;
    await p.waitForTimeout(650);
    seen++;
    const title = await dlg.locator("h2").innerText();
    const placement = await dlg.getAttribute("data-placement");
    const target = await p.evaluate(() => {
      const hole = document.querySelector('[data-testid="spotlight-hole"]');
      return hole ? hole.getBoundingClientRect().toJSON() : null;
    });
    const d = await dlg.boundingBox();
    const vp = p.viewportSize();
    const inside = d.x >= 0 && d.y >= 0 && d.x + d.width <= vp.width + 1 && d.y + d.height <= vp.height + 1;
    const clear = !target || placement.startsWith("sheet") || !overlap(d, target);
    const holeVisible = target && target.bottom > 0 && target.top < vp.height;
    if (!inside || !clear || !holeVisible) {
      geometryOk = false;
      notes.push(`${title}: inside=${inside} clear=${clear} visible=${!!holeVisible} ${placement}`);
    }
    const next = dlg.getByRole("button", { name: /Next|Finish/ });
    const isFinish = (await next.innerText()) === "Finish";
    await next.click();
    if (isFinish) break;
  }
  ok(`${label}: tour visits ${expectSteps} steps and finishes`, seen === expectSteps && (await p.getByRole("dialog").count()) === 0, `seen ${seen}`);
  ok(`${label}: card inside viewport, never covering the target`, geometryOk, notes.join("; "));
  await btn.click();
  await p.waitForTimeout(300);
  await p.keyboard.press("ArrowRight");
  await p.keyboard.press("ArrowLeft");
  await p.keyboard.press("Escape");
  const focused = await p.evaluate(() => document.activeElement?.textContent);
  ok(`${label}: keyboard + Escape close and return focus`, (await p.getByRole("dialog").count()) === 0 && /Take a tour/.test(focused ?? ""), focused);
  await p.context().close();
}
await tour("/forecasting", 1440, 900, 5, "Outlook 1440");
await tour("/forecasting", 390, 844, 5, "Outlook 390");
await tour("/forecasting/wpi", 1440, 900, 7, "WPI explorer 1440");
await tour("/forecasting/iip", 360, 740, 7, "IIP explorer 360");
await tour("/forecasting/wpi", 768, 1024, 7, "WPI explorer 768");
await tour("/forecasting/comparison?indicator=wpi&horizon=6", 1440, 900, 5, "Comparison 1440");
await tour("/forecasting/experiments", 1440, 900, 4, "Experiments 1440 (reveals details)");
await tour("/forecasting/experiments", 390, 844, 4, "Experiments 390");

// ---------- 5. comparison, experiments, deep links ----------
{
  const p = await page();
  await go(p, "/forecasting/comparison?indicator=iip&horizon=3&view=research");
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: "Download CSV" }).click()]);
  ok("comparison CSV downloads", /^indicator,horizon,model/.test(fs.readFileSync(await dl.path(), "utf8")), dl.suggestedFilename());
  await p.getByRole("radio", { name: "CPI" }).click();
  await p.waitForURL(/indicator=cpi/);
  ok("comparison: CPI explains from real counts", (await p.getByText(/has \d+ monthly observations/).count()) > 0 && /view=research/.test(p.url()));
  await go(p, "/forecasting/experiments?indicator=iip&status=completed");
  const cells = await p.locator("tbody tr:has(th a) td:nth-of-type(1)").allInnerTexts();
  const stat = await p.locator("tbody tr:has(th a) td:nth-of-type(4)").allInnerTexts();
  ok("experiments deep link applies filters", cells.length > 0 && cells.every((c) => c.trim() === "IIP") && stat.every((s) => s.trim() === "completed"), `${cells.length} rows`);
  await p.getByRole("button", { name: /Show details for run/ }).first().click();
  ok("row details show reproducibility fingerprints", await p.getByText("Data fingerprint").first().isVisible());
  const [dl2] = await Promise.all([p.waitForEvent("download"), p.getByRole("button", { name: /Download CSV/ }).click()]);
  const c2 = fs.readFileSync(await dl2.path(), "utf8").trim().split("\n");
  ok("experiments CSV = filtered rows", c2.length - 1 > 0 && c2.slice(1).every((l) => l.split(",")[1] === "iip"), `${c2.length - 1} rows`);
  const first = p.locator('tbody tr th a[href^="/forecasting/experiments/"]').first();
  const href = await first.getAttribute("href");
  await first.click();
  await p.waitForURL(new RegExp(href.replace(/[?]/g, "\\?") + "$"));
  ok("run deep link opens run detail", await p.getByRole("heading", { name: "Provenance" }).waitFor({ timeout: 15000 }).then(() => true, () => false), href);
  await go(p, "/forecasting/experiments/175");
  ok("direct run URL works", (await p.getByText("Dataset fingerprint").count()) > 0);
  await go(p, "/forecasting/wpi");
  await p.getByRole("link", { name: /View historical WPI/ }).click();
  await p.waitForURL(/\/indicators\/wpi/);
  ok("'View historical WPI' opens the existing Indicators page", await p.locator('[data-testid="range-summary"]').waitFor({ timeout: 15000 }).then(() => true, () => false));
  await go(p, "/forecasting");
  await p.getByRole("link", { name: "Back to economic overview" }).click();
  await p.waitForURL(WEB + "/");
  ok("'Back to economic overview' opens Overview", p.url() === WEB + "/");
  await p.context().close();
}

// ---------- 6. dark mode renders the explorer with dark tokens ----------
{
  const p = await page(1440, 900, "dark");
  await go(p, "/forecasting/wpi");
  const bg = await p.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok("dark theme applied on Forecasts", (await p.evaluate(() => document.documentElement.dataset.theme)) === "dark" && bg !== "rgb(246, 245, 241)", bg);
  await p.context().close();
}

const hydration = errors.filter((e) => /hydrat/i.test(e));
ok("no console errors", errors.length === 0, errors.slice(0, 5).join(" || "));
ok("no hydration errors", hydration.length === 0);
await browser.close();
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ web: WEB, api: API, results, errors }, null, 1));
process.exit(failed.length ? 1 : 0);
