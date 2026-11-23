// axe-core WCAG 2.1 A/AA audit of the Forecasts pages (Simple + Research, light + dark, 1440 + 390 px).
//   npm i playwright-core axe-core   (in a scratch dir)
//   WEB=http://127.0.0.1:3124 OUT=a11y.json node forecasts-a11y.mjs
// Violations are split into Forecasts-owned nodes and shared chrome (site header/footer), which this work must not edit.
import { chromium } from "playwright-core";
import fs from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const AXE = fs.readFileSync(require.resolve("axe-core/axe.min.js"), "utf8");
const WEB = process.env.WEB || "http://127.0.0.1:3124";
const PAGES = ["/forecasting", "/forecasting/wpi", "/forecasting/iip", "/forecasting/cpi", "/forecasting/comparison?indicator=wpi&horizon=6", "/forecasting/experiments", "/forecasting/experiments/175"];
const b = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const out = [];
const RUNS = PAGES.length * 8;
for (const theme of ["light", "dark"])
  for (const w of [1440, 390])
    for (const view of ["simple", "research"])
      for (const path of PAGES) {
        const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: theme });
        await ctx.addInitScript((t) => localStorage.setItem("arthasense-theme", t), theme);
        const p = await ctx.newPage();
        const url = view === "research" ? `${path}${path.includes("?") ? "&" : "?"}view=research` : path;
        await p.goto(WEB + url, { waitUntil: "networkidle" });
        if (path === "/forecasting/experiments") await p.getByRole("button", { name: /Show details for run/ }).first().click(); // audit expanded details too
        await p.addScriptTag({ content: AXE });
        const res = await p.evaluate(async () => {
          // eslint-disable-next-line no-undef
          const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
          return r.violations.map((v) => ({
            id: v.id,
            impact: v.impact,
            nodes: v.nodes.map((n) => ({ target: n.target.join(" "), shared: !!document.querySelector(n.target.join(" "))?.closest("header:not(main header), footer, body > a"), summary: n.failureSummary?.slice(0, 160) })),
          }));
        });
        for (const v of res)
          for (const n of v.nodes) out.push({ theme, w, view, url, rule: v.id, impact: v.impact, target: n.target, shared: n.shared, summary: n.summary });
        await ctx.close();
      }
await b.close();
const own = out.filter((x) => !x.shared);
const shared = out.filter((x) => x.shared);
const byRule = (xs) => Object.entries(xs.reduce((m, x) => ((m[`${x.rule} · ${x.target}`] = (m[`${x.rule} · ${x.target}`] ?? 0) + 1), m), {}));
console.log(`runs=${RUNS} forecasts-owned violations=${own.length} shared-chrome violations=${shared.length}`);
for (const [k, n] of byRule(own).slice(0, 40)) console.log(`  OWN   ${n}× ${k}`);
for (const [k, n] of byRule(shared).slice(0, 20)) console.log(`  SHARED ${n}× ${k}`);
if (process.env.OUT) fs.writeFileSync(process.env.OUT, JSON.stringify({ own, shared }, null, 1));
process.exit(own.length ? 1 : 0);
