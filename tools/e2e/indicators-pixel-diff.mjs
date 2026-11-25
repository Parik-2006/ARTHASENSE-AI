// Indicators pages: previous main (OLD) vs this build (WEB) must be pixel-identical.
import { chromium } from "playwright-core";
import { PNG } from "pngjs";
import pixelmatch from "pixelmatch";
const b = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" });
let bad = 0, n = 0;
for (const url of ["/indicators", "/indicators/cpi", "/indicators/wpi", "/indicators/iip", "/indicators/gdp", "/indicators/cpi?base=legacy2012", "/indicators/wpi?base=2011-12"]) {
  for (const [w, scheme] of [[1440, "light"], [390, "dark"]]) {
    const shots = [];
    for (const base of [process.env.OLD, process.env.WEB]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 900 }, colorScheme: scheme, reducedMotion: "reduce" });
      await ctx.addInitScript((t) => localStorage.setItem("arthasense-theme", t), scheme);
      const p = await ctx.newPage();
      await p.goto(base + url, { waitUntil: "networkidle", timeout: 120000 });
      await p.waitForTimeout(800);
      shots.push(PNG.sync.read(await p.screenshot({ fullPage: true, animations: "disabled" })));
      await ctx.close();
    }
    const [x, y] = shots; n++;
    const same = x.width === y.width && x.height === y.height;
    const d = same ? pixelmatch(x.data, y.data, null, x.width, x.height, { threshold: 0.1 }) : -1;
    if (!(same && d === 0)) bad++;
    console.log(`${same && d === 0 ? "PASS" : "FAIL"}  ${url} @${w} ${scheme}: ${same ? d + " px differ" : "size differs"}`);
  }
}
await b.close();
console.log(`${n - bad}/${n} identical`);
