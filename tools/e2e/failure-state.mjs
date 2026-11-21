import { chromium } from "playwright-core";
const b = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const p = await (await b.newContext({ viewport: { width: 390, height: 800 } })).newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const res = [];
for (const path of ["/", "/indicators", "/indicators/cpi", "/indicators/cpi?base=2012", "/indicators/wpi?base=2011-12", "/indicators/iip"]) {
  const r = await p.goto("http://127.0.0.1:3115" + path, { waitUntil: "networkidle" });
  const t = await p.locator("body").innerText();
  const o = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  res.push(`${path}: HTTP ${r.status()} | message=${/Unable to load|check the API connection/i.test(t)} | fake numbers=${/\b1[0-9]{2}\.[0-9]{2}\b/.test(t)} | overflow=${o} | retry=${(await p.getByRole("button", { name: /Retry|Check again|Refresh/ }).count()) > 0}`);
}
console.log(res.join("\n")); console.log("page errors:", errs.length);
await b.close();
