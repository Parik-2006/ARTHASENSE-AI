// Overview scientific-audit browser checks (real Chrome via playwright-core; see README.md in this folder).
//   WEB=http://127.0.0.1:3114 API=http://127.0.0.1:8765 [OLD=http://127.0.0.1:3115] OUT=report.json SHOTS=dir node overview-audit-e2e.mjs
// Read-only. Expects the official data as stored on 2026-11-25 (production or a restore of it):
// CPI Oct 2026 110.05 / 6.09%, Oct 2025 103.74; WPI Oct 2026 113.3 vs 100.9; IIP Sep 2026 124.3 / 6.7% vs 116.5;
// GDP Q1 FY2026-27 7.8% (levels 81,36,153 / 75,46,230). OLD = a build of the previous main: Indicators pages must be
// pixel-identical (the shared chart's new tooltip is opt-in). Needs axe-core, pngjs, pixelmatch next to playwright-core.
import { chromium } from "playwright-core";
import fs from "node:fs";

const WEB = process.env.WEB || "http://127.0.0.1:3114";
const OLD = process.env.OLD || "";
const SHOTS = process.env.SHOTS || "";
const results = [];
const ok = (name, pass, detail = "") => {
  results.push({ name, pass: !!pass, detail: String(detail).slice(0, 300) });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 200) : ""}`);
};
const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const errors = [];
async function page(w, h = 900, scheme = "light", base = WEB) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme: scheme, hasTouch: w < 800, reducedMotion: "reduce" });
  await ctx.addInitScript((t) => localStorage.setItem("arthasense-theme", t), scheme);
  const p = await ctx.newPage();
  if (base === WEB) {
    p.on("console", (m) => m.type() === "error" && errors.push(`${m.text().slice(0, 160)} @ ${p.url()}`));
    p.on("pageerror", (e) => errors.push(`PAGEERROR ${e.message.slice(0, 160)} @ ${p.url()}`));
  }
  return p;
}
const go = async (p, url, base = WEB) => {
  for (let i = 0; ; i++) {
    try {
      return await p.goto(base + url, { waitUntil: "networkidle", timeout: 90000 });
    } catch (e) {
      if (i >= 3 || !/net::ERR_|Timeout/.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 3000 * (i + 1)));
    }
  }
};
const overflowX = (p) => p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const text = async (p, sel) => ((await p.locator(sel).first().textContent().catch(() => "")) ?? "").replace(/\s+/g, " ");

// ---------- 1. card values: verified figures at the source's precision ----------
{
  const p = await page(1440);
  await go(p, "/");
  const cpi = await text(p, '[data-testid="card-cpi"]');
  ok("CPI card: 110.05 and official 6.09% (October 2026)", /110\.05/.test(cpi) && /6\.09%/.test(cpi) && /Official data/.test(cpi), cpi.slice(0, 200));
  const wpi = await text(p, '[data-testid="card-wpi"]');
  ok("WPI card: 113.3 (one decimal, not 113.30) and calculated 12.29%", /113\.3(?!0)/.test(wpi) && !/113\.30/.test(wpi) && /12\.29%/.test(wpi) && /Calculated by ArthaSense/.test(wpi), wpi.slice(0, 200));
  const iip = await text(p, '[data-testid="card-iip"]');
  ok("IIP card: 124.3 and official 6.7% (not 6.70%)", /124\.3(?!0)/.test(iip) && /6\.7%/.test(iip) && !/6\.70%/.test(iip), iip.slice(0, 200));
  const gdp = await text(p, '[data-testid="card-gdp"]');
  ok("GDP card: official 7.8%, Q1 FY2026-27", /7\.8%/.test(gdp) && /Q1 FY2026-27/.test(gdp), gdp.slice(0, 160));

  // ---------- 2. explanations: exact stored observations and formulas ----------
  const open = async (k) => {
    await p.locator(`[data-testid="explain-${k}"] button`).first().click();
    return text(p, `[data-testid="explain-${k}-dialog"]`);
  };
  const close = async () => p.keyboard.press("Escape");
  let t = await open("cpi");
  ok("CPI explainer: real Oct 2025 index 103.74, never the back-calculated 103.73", /CPI index, October 2025\s?103\.74/.test(t) && !/103\.73/.test(t), t.slice(0, 220));
  ok("CPI explainer: ((110.05 ÷ 103.74) − 1) × 100 = 6.0825%, rounding explained, official 6.09% shown", /\(\(110\.05 ÷ 103\.74\) − 1\) × 100 = 6\.0825%/.test(t) && /consistent/.test(t) && /6\.09%/.test(t));
  ok("CPI explainer: plain sentence with real periods", /Consumer prices in October 2026 were 6\.09% higher than in October 2025\./.test(t));
  await close();
  ok("Escape closes and returns focus to the button", (await p.locator('[data-testid="explain-cpi-dialog"]').count()) === 0 && /How was this calculated/.test(await p.evaluate(() => document.activeElement?.textContent ?? "")));
  t = await open("wpi");
  ok("WPI explainer: ((113.3 ÷ 100.9) − 1) × 100 = 12.2894%, calculated", /\(\(113\.3 ÷ 100\.9\) − 1\) × 100 = 12\.2894%/.test(t) && /Calculated by ArthaSense/.test(t) && /not the change in that month alone/.test(t));
  await close();
  t = await open("iip");
  ok("IIP explainer: official 6.7%, cross-check 124.3 ÷ 116.5", /\(\(124\.3 ÷ 116\.5\) − 1\) × 100 = 6\.69/.test(t) && /Official data/.test(t) && /Industrial production in September 2026 was 6\.7% higher/.test(t), t.slice(0, 200));
  await close();
  t = await open("gdp");
  ok("GDP explainer: same fiscal quarter a year earlier, 81,36,153 ÷ 75,46,230", /81,36,153 ÷ 75,46,230/.test(t) && /Q1 FY2025-26/.test(t) && /7\.8%/.test(t));
  await close();

  // ---------- 3. comparison chart: implemented method, inspectable points ----------
  const m = await text(p, '[data-testid="compare-method"]');
  ok("comparison: method sentence describes the implemented calculation", /averages the index over the quarter's three months/.test(m) && /official real growth/.test(m));
  await p.locator('[data-testid="compare-breakdown"] summary').click();
  const b = await text(p, '[data-testid="compare-breakdown"]');
  ok("comparison breakdown: WPI Jul–Sep 2026 uses Jul 110.0, Aug 110.8, Sep 112.5 → +10.4%", /Jul 110\.0, Aug 110\.8, Sep 112\.5/.test(b) && /\+10\.4%/.test(b), b.slice(0, 200));
  ok("comparison breakdown: GDP points are the official 8.6% and 7.8%", /\+8\.6%/.test(b) && /\+7\.8%/.test(b));
  ok("comparison breakdown: Oct–Dec 2026 is not drawn (incomplete quarter)", !/Oct–Dec 2026/.test(b));
  const svg = p.locator('#compare svg[role="group"]').first();
  await svg.focus();
  await p.keyboard.press("ArrowRight");
  const tip = await p.locator('#compare p[aria-live="polite"]').first().textContent();
  ok("comparison tooltip: quarter, fiscal quarter, provenance and method", /Jan–Mar 2026/.test(tip) && /Q4 FY2025-26/.test(tip) && /GDP official; others calculated/.test(tip), tip);

  // ---------- 4. change chart tooltips ----------
  await go(p, "/?chg=iip");
  const csvg = p.locator('#changes svg[role="group"]').first();
  await csvg.focus();
  await p.keyboard.press("End");
  const ctip = await p.locator('#changes p[aria-live="polite"]').first().textContent();
  ok("IIP change tooltip: official growth at 1 decimal, comparison month, base, provenance", /6\.7%/.test(ctip) && !/6\.70/.test(ctip) && /vs Sep 2025 · base 2022-23/.test(ctip) && /Official/.test(ctip), ctip);
  await go(p, "/?chg=wpi");
  await p.locator('#changes svg[role="group"]').first().focus();
  await p.keyboard.press("End");
  const wtip = await p.locator('#changes p[aria-live="polite"]').first().textContent();
  ok("WPI change tooltip: 12.29%, vs Oct 2025, calculated", /12\.29%/.test(wtip) && /vs Oct 2025/.test(wtip) && /Calculated by ArthaSense/.test(wtip), wtip);
  await go(p, "/?chg=gdp");
  await p.locator('#changes svg[role="group"]').first().focus();
  await p.keyboard.press("End");
  const gtip = await p.locator('#changes p[aria-live="polite"]').first().textContent();
  ok("GDP change tooltip: fiscal quarter with months, same-quarter comparison, official", /Apr–Jun 2026/.test(gtip) && /vs Q1 FY25-26/.test(gtip) && /Official/.test(gtip), gtip);
  if (SHOTS) await p.screenshot({ path: `${SHOTS}/overview-1440-light.png`, fullPage: true });
  await p.context().close();
}

// ---------- 5. responsive and themes: no overflow, dialogs inside the viewport ----------
for (const w of [320, 360, 390, 768, 1024, 1440, 1920]) {
  for (const scheme of ["light", "dark"]) {
    const p = await page(w, 900, scheme);
    await go(p, "/");
    ok(`no horizontal overflow @${w} ${scheme}`, (await overflowX(p)) <= 1, `${await overflowX(p)}px`);
    for (const k of ["cpi", "gdp"]) {
      await p.locator(`[data-testid="explain-${k}"] button`).first().click();
      const box = await p.locator(`[data-testid="explain-${k}-dialog"]`).boundingBox();
      ok(`${k} explainer inside the viewport @${w} ${scheme}`, box && box.x >= 0 && box.x + box.width <= w + 1, box ? `${Math.round(box.x)}..${Math.round(box.x + box.width)}` : "no box");
      if (SHOTS && k === "cpi" && (w === 320 || w === 1440)) await p.screenshot({ path: `${SHOTS}/explainer-cpi-${w}-${scheme}.png` });
      await p.keyboard.press("Escape");
    }
    const btn = p.locator('[data-testid="explain-cpi"] button').first();
    const bb = await btn.boundingBox();
    if (w <= 390) ok(`explainer button is a usable touch target @${w} ${scheme}`, bb && bb.height >= 32, bb ? `${Math.round(bb.height)}px` : "");
    await p.context().close();
  }
}

// ---------- 6. accessibility with an explanation open ----------
try {
  const axeSrc = fs.readFileSync(new URL("./node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
  for (const [w, scheme] of [[1440, "light"], [1440, "dark"], [390, "light"], [390, "dark"]]) {
    const p = await page(w, 900, scheme);
    await go(p, "/");
    await p.locator('[data-testid="explain-cpi"] button').first().click();
    await p.locator('[data-testid="compare-breakdown"] summary').click();
    await p.addScriptTag({ content: axeSrc });
    const r = await p.evaluate(async () => {
      const res = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
      return res.violations.map((v) => `${v.id}: ${v.nodes.length} (${v.nodes[0]?.target?.[0] ?? ""})`);
    });
    ok(`axe WCAG 2.1 A/AA with explainer and breakdown open @${w} ${scheme}`, r.length === 0, r.join(" | "));
    await p.context().close();
  }
} catch (e) {
  ok("axe available", false, e.message);
}

// ---------- 7. Indicators unchanged (shared chart: the new tooltip is opt-in) ----------
if (OLD) {
  const { PNG } = await import("pngjs");
  const pixelmatch = (await import("pixelmatch")).default;
  for (const url of ["/indicators", "/indicators/cpi", "/indicators/wpi", "/indicators/iip", "/indicators/gdp"]) {
    for (const [w, scheme] of [[1440, "light"], [390, "dark"]]) {
      const shots = [];
      for (const base of [OLD, WEB]) {
        const p = await page(w, 900, scheme, base);
        await go(p, url, base);
        await p.waitForTimeout(800);
        shots.push(PNG.sync.read(await p.screenshot({ fullPage: true, animations: "disabled" })));
        await p.context().close();
      }
      const [a, b2] = shots;
      const same = a.width === b2.width && a.height === b2.height;
      const diff = same ? pixelmatch(a.data, b2.data, null, a.width, a.height, { threshold: 0.1 }) : -1;
      ok(`Indicators unchanged vs previous main: ${url} @${w} ${scheme}`, same && diff === 0, same ? `${diff} px differ` : `size ${a.width}x${a.height} vs ${b2.width}x${b2.height}`);
    }
  }
}

ok("no console or page errors", errors.length === 0, errors.slice(0, 5).join(" | "));
await browser.close();
const pass = results.filter((r) => r.pass).length;
console.log(`\n${pass}/${results.length} passed`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ web: WEB, old: OLD || null, at: new Date().toISOString(), pass, total: results.length, results }, null, 1));
process.exit(pass === results.length ? 0 : 1);
