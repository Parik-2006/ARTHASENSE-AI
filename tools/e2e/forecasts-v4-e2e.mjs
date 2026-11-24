// Forecasts V4 browser checks (real Chrome via playwright-core; see README.md in this folder).
//   WEB=http://127.0.0.1:3114 API=http://127.0.0.1:8765 [OLD=http://127.0.0.1:3115] OUT=report.json SHOTS=dir node forecasts-v4-e2e.mjs
// Read-only: GET requests and UI clicks only. OLD (optional) = a build of the previous main for Overview/Indicators
// pixel comparisons (needs pngjs + pixelmatch next to playwright-core).
import { chromium } from "playwright-core";
import fs from "node:fs";

const WEB = process.env.WEB || "http://127.0.0.1:3114";
const API = process.env.API || "http://127.0.0.1:8765";
const OLD = process.env.OLD || "";
const SHOTS = process.env.SHOTS || "";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 200) : ""}`);
};
const api = async (p) => (await fetch(API + p)).json();
const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function page(w = 1440, h = 900, scheme = "light", base = WEB) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, acceptDownloads: true, hasTouch: w < 800, reducedMotion: "reduce" });
  await ctx.addInitScript((t) => localStorage.setItem("arthasense-theme", t), scheme);
  const p = await ctx.newPage();
  if (base === WEB) {
    p.on("console", (m) => m.type() === "error" && errors.push(`${m.text().slice(0, 160)} @ ${p.url()}`));
    p.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)} @ ${p.url()}`));
  }
  return p;
}
const go = (p, url, base = WEB) => p.goto(base + url, { waitUntil: "networkidle", timeout: 90000 });
const overflowX = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const ALGOS = ["Naive", "Seasonal naive", "Drift", "ETS", "ARIMA", "SARIMA", "Random Forest", "XGBoost"];
const IDS = ["cpi", "wpi", "iip", "gdp"];

// ---------- 1. API contract ----------
const status = {};
for (const id of IDS) {
  const s = await api(`/api/v1/forecasting/model-status?indicator=${id}`);
  status[id] = s;
  ok(`${id}: /model-status lists exactly the eight algorithms`, s.models?.length === 8 && s.models.map((m) => m.model_name).join("|") === ALGOS.join("|"), s.models?.map((m) => `${m.model}:${m.status}`).join(" "));
  ok(`${id}: every unavailable model has a reason`, s.models.every((m) => m.status === "available" || m.reason), "");
}
ok("gdp: frequency is quarterly", status.gdp.frequency === "quarterly");
ok("gdp: SARIMA, RF, XGBoost reported as insufficient history", ["sarima", "rf", "xgboost"].every((m) => status.gdp.models.find((x) => x.model === m)?.status === "insufficient_history"));
for (const id of ["cpi", "wpi", "iip"]) ok(`${id}: all eight models available`, status[id].models.every((m) => m.status === "available"), status[id].models.filter((m) => m.status !== "available").map((m) => m.model).join(","));
const runs = await api("/api/v1/forecasting/runs?kind=forecast&status=completed&limit=200");
ok("every stored V4 forecast run carries a model label", runs.items.filter((r) => r.created_at > "2026-11-24").every((r) => r.model_label), "");
for (const r of runs.items.filter((x) => x.created_at > "2026-11-24")) {
  const f = await api(`/api/v1/forecasting/forecasts?run_id=${r.id}&limit=50`);
  const chain = (x) => [x.lower_95, x.lower_80, x.forecast, x.upper_80, x.upper_95].filter((v) => v !== null);
  const sorted = (a) => a.every((v, i) => i === 0 || a[i - 1] <= v);
  const pairs = (x) => (x.lower_80 === null) === (x.upper_80 === null) && (x.lower_95 === null) === (x.upper_95 === null);
  const bad = f.items.filter((x) => !pairs(x) || !sorted(chain(x)) || x.target_date <= r.training_cutoff);
  if (bad.length) ok(`run ${r.id}: interval order and target dates`, false, JSON.stringify(bad[0]));
}
ok("all V4 forecast rows: 95% ⊇ 80% ⊇ point, targets after the cutoff", !results.some((x) => x.name.startsWith("run ") && !x.pass));

// ---------- 2. Outlook: four cards, each names its model ----------
{
  const p = await page(1920, 1100);
  await go(p, "/forecasting");
  for (const id of IDS) {
    const card = p.locator(`[data-testid="card-${id}"]`);
    ok(`outlook: ${id} card present`, (await card.count()) === 1);
    const model = (await p.locator(`[data-testid="card-model-${id}"]`).textContent().catch(() => "")) ?? "";
    const name = model.replace(/^Model:\s*/, "").split("(")[0].trim();
    ok(`outlook: ${id} card names its model`, ALGOS.includes(name), model);
    const txt = (await card.textContent()) ?? "";
    ok(`outlook: ${id} card has latest official, estimate, forecast period and reliability`, /Latest official/.test(txt) && /Model estimate/.test(txt) && /Forecast:/.test(txt) && (await card.locator('[data-testid="reliability-meter"]').count()) === 1, txt.slice(0, 160));
    // the card's model is the model the explorer opens with
    const q = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const e = await q.newPage();
    await e.goto(`${WEB}/forecasting/${id}`, { waitUntil: "networkidle", timeout: 90000 });
    const kpi = ((await e.locator('[data-testid="kpi-model"]').textContent().catch(() => "")) ?? "").replace(/^Model:\s*/, "").trim();
    ok(`${id}: card model == explorer default model`, kpi.startsWith(name), `${name} vs ${kpi}`);
    await q.close();
  }
  const gdp = (await p.locator('[data-testid="card-gdp"]').textContent()) ?? "";
  ok("outlook: GDP card uses fiscal quarters and lakh crore", /Q[1-4] FY20\d\d-\d\d/.test(gdp) && /lakh cr/.test(gdp), gdp.slice(0, 200));
  ok("outlook: GDP card shows implied year-on-year change", /same quarter a year earlier/.test(gdp));
  const boxes = await Promise.all(IDS.map((id) => p.locator(`[data-testid="card-${id}"]`).boundingBox()));
  ok("outlook: four cards in one row at 1920 px", new Set(boxes.map((b) => Math.round(b.y))).size === 1, boxes.map((b) => Math.round(b.y)).join(","));
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/v4-outlook-1920.png`, fullPage: true });
  await p.context().close();
}

// ---------- 3. Explorers: eight-model selector, horizons, research view ----------
for (const id of IDS) {
  const p = await page(1440, 900);
  await go(p, `/forecasting/${id}`);
  const opts = await p.locator('select[aria-label="Model"] option').evaluateAll((os) => os.map((o) => ({ t: o.textContent, d: o.disabled })));
  ok(`${id}: selector offers all eight algorithms`, ALGOS.every((a) => opts.some((o) => o.t.startsWith(a))) && opts.length === 8, opts.map((o) => o.t + (o.d ? "*" : "")).join(" | "));
  const enabled = opts.filter((o) => !o.d).length;
  const avail = status[id].models.filter((m) => m.status === "available").length;
  ok(`${id}: enabled options == available models`, enabled === avail, `${enabled} vs ${avail}`);
  const radios = await p.locator('[data-tour="fx-horizon"] [role="radio"]').allTextContents();
  ok(`${id}: horizon labels use the right period`, id === "gdp" ? radios.every((r) => /quarter/.test(r)) : radios.every((r) => /month/.test(r)), radios.join(","));
  if (id === "gdp") {
    const kp = (await p.locator('[data-testid="kpis"]').textContent()) ?? "";
    ok("gdp: KPIs show lakh crore, never raw crore figures", /lakh cr/.test(kp) && !/\d{6,}\.\d\d/.test(kp), kp.slice(0, 160));
    ok("gdp: availability note explains the missing models", /Random Forest/.test((await p.locator('[data-testid="model-availability"]').textContent()) ?? ""));
    const ticks = await p.locator('[data-testid="outlook-chart"] svg text').allTextContents();
    ok("gdp: chart axis labels are fiscal quarters", ticks.some((t) => /^Q[1-4] FY/.test(t)), ticks.slice(0, 8).join(","));
  }
  // pick another available model and check the URL/KPI follow
  const other = opts.find((o) => !o.d && !o.t.startsWith("Naive"));
  if (other) {
    const val = await p.locator('select[aria-label="Model"] option', { hasText: other.t }).first().getAttribute("value");
    await p.selectOption('select[aria-label="Model"]', val);
    await p.waitForURL(/model=/, { timeout: 20000 }).catch(() => {});
    ok(`${id}: switching model updates the URL and KPI`, p.url().includes(`model=${val}`) && ((await p.locator('[data-testid="kpi-model"]').textContent()) ?? "").includes(other.t.split(" (")[0]), p.url());
  }
  await go(p, `/forecasting/${id}?view=research`);
  const rv = (await p.locator('[data-testid="research-view"]').textContent().catch(() => "")) ?? "";
  ok(`${id}: research view shows configuration and provenance`, /Configuration/.test(rv) && /Data fingerprint/.test(rv), rv.slice(0, 120));
  const [dl] = await Promise.all([p.waitForEvent("download", { timeout: 20000 }).catch(() => null), p.getByRole("button", { name: "Download CSV" }).first().click()]);
  if (dl) {
    const body = fs.readFileSync(await dl.path(), "utf8");
    const head = body.split("\r\n")[0];
    ok(`${id}: CSV download`, id === "gdp" ? /target_quarter/.test(head) && /model_configuration/.test(head) : /target_month/.test(head), head.slice(0, 160));
  } else ok(`${id}: CSV download`, false, "no download event");
  await p.context().close();
}

// ---------- 4. Model comparison ----------
for (const [id, h] of [["cpi", 6], ["wpi", 6], ["iip", 6], ["gdp", 1], ["gdp", 4]]) {
  const p = await page(1440, 900);
  await go(p, `/forecasting/comparison?indicator=${id}&horizon=${h}`);
  const head = (await p.locator('[data-tour="fc-table"] thead').textContent().catch(() => "")) ?? "";
  ok(`comparison ${id} h=${h}: MAE, RMSE, sMAPE, tests, vs Naive`, ["MAE", "RMSE", "sMAPE", "Tests", "vs Naive"].every((c) => head.includes(c)), head);
  const rows = await p.locator('[data-tour="fc-table"] tbody tr').count();
  const missing = await p.locator('[data-testid="missing-models"] li').count();
  ok(`comparison ${id} h=${h}: compared + explained models = 8`, rows + missing === 8, `${rows} + ${missing}`);
  await p.context().close();
}
{
  const p = await page(1440, 900);
  await go(p, "/forecasting/comparison?indicator=wpi&horizon=6");
  ok("comparison: selected default badge shown at the default horizon", (await p.locator('[data-testid="default-badge"]').count()) === 1);
  await p.context().close();
}

// ---------- 5. Tours: open, keyboard, Escape, focus ----------
for (const [url, w] of [["/forecasting", 1440], ["/forecasting", 390], ["/forecasting/gdp", 768], ["/forecasting/comparison", 360]]) {
  const p = await page(w, w < 800 ? 820 : 900);
  await go(p, url);
  const btn = p.getByRole("button", { name: "Take a tour" }).first();
  await btn.click();
  const dlg = p.locator('[data-testid="spotlight-tour"] [role="dialog"]');
  await dlg.waitFor({ timeout: 10000 }).catch(() => {});
  const first = (await dlg.getAttribute("aria-label").catch(() => "")) ?? "";
  let steps = 0;
  for (let i = 0; i < 12; i++) {
    const next = p.locator('[data-testid="spotlight-tour"] button', { hasText: /^(Next|Finish)$/ });
    if (!(await next.count())) break;
    const lbl = await next.textContent();
    try {
      await next.click({ timeout: 10000 });
    } catch (e) {
      ok(`tour ${url} @${w}: step ${steps + 1} clickable`, false, e.message.split("\n").slice(0, 4).join(" | "));
      break;
    }
    steps++;
    if (lbl === "Finish") break;
  }
  ok(`tour ${url} @${w}: steps through to the end`, steps >= 3 && (await p.locator('[data-testid="spotlight-tour"]').count()) === 0, `${first}; ${steps} steps`);
  await btn.click();
  await dlg.waitFor({ timeout: 10000 }).catch(() => {});
  await p.keyboard.press("Escape");
  await p.waitForTimeout(300);
  const focused = await p.evaluate(() => document.activeElement?.textContent ?? "");
  ok(`tour ${url} @${w}: Escape closes and returns focus`, (await p.locator('[data-testid="spotlight-tour"]').count()) === 0 && /Take a tour/.test(focused), focused);
  await p.context().close();
}

// ---------- 6. Responsive, themes, overflow ----------
for (const w of [360, 390, 768, 1024, 1440, 1920]) {
  for (const scheme of w === 390 || w === 1440 ? ["light", "dark"] : ["light"]) {
    for (const url of ["/forecasting", "/forecasting/gdp", "/forecasting/wpi?view=research", "/forecasting/comparison?indicator=gdp&horizon=1"]) {
      const p = await page(w, 900, scheme);
      await go(p, url);
      const o = await overflowX(p);
      ok(`no horizontal overflow ${url} @${w} ${scheme}`, o <= 1, `${o}px`);
      if (SHOTS && (w === 390 || w === 1440)) await p.screenshot({ path: `${SHOTS}/v4-${url.replace(/[^a-z0-9]+/gi, "_")}-${w}-${scheme}.png`, fullPage: true });
      await p.context().close();
    }
  }
}

// ---------- 7. Overview and Indicators unchanged (pixel comparison with the previous main) ----------
if (OLD) {
  const { PNG } = await import("pngjs");
  const pixelmatch = (await import("pixelmatch")).default;
  for (const url of ["/", "/indicators", "/indicators/cpi", "/indicators/wpi", "/indicators/iip", "/indicators/gdp"]) {
    for (const [w, scheme] of [[1440, "light"], [390, "dark"]]) {
      const shots = [];
      for (const base of [OLD, WEB]) {
        const p = await page(w, 900, scheme, base);
        await go(p, url, base);
        await p.waitForTimeout(800);
        shots.push(PNG.sync.read(await p.screenshot({ fullPage: true, animations: "disabled" })));
        await p.context().close();
      }
      const [a, b] = shots;
      const same = a.width === b.width && a.height === b.height;
      let diff = -1;
      if (same) diff = pixelmatch(a.data, b.data, null, a.width, a.height, { threshold: 0.1 });
      ok(`unchanged vs previous main: ${url} @${w} ${scheme}`, same && diff === 0, same ? `${diff} px differ` : `size ${a.width}x${a.height} vs ${b.width}x${b.height}`);
    }
  }
}

// ---------- 8. API down (DEAD = the same build started with ARTHASENSE_API_URL pointing at a closed port) ----------
if (process.env.DEAD) {
  const DEAD = process.env.DEAD;
  for (const url of ["/forecasting", "/forecasting/gdp", "/forecasting/wpi?view=research", "/forecasting/comparison?indicator=gdp&horizon=4"]) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 800 } });
    const p = await ctx.newPage();
    const perr = [];
    p.on("pageerror", (e) => perr.push(e.message));
    const r = await p.goto(DEAD + url, { waitUntil: "networkidle", timeout: 90000 });
    const t = await p.locator("main").innerText().catch(() => "");
    ok(`API down ${url}: honest error state`, r.status() === 200 && /Unable to load|unavailable|check the API connection/i.test(t), t.slice(0, 120));
    ok(`API down ${url}: no invented numbers, no crash, no overflow`, !/\d{2,3}\.\d{2}|lakh cr/.test(t) && !perr.length && (await overflowX(p)) <= 1, perr.join(" | ").slice(0, 120));
    await ctx.close();
  }
}

ok("no console or page errors on the new build", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} passed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ web: WEB, api: API, old: OLD || null, at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
