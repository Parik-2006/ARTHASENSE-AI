// Forecasts V4: extract the backtest comparison (API) and the UI's reliability levels and default model (rendered
// pages) for every indicator and horizon, as JSON for docs/FORECASTS-V4-MODELS.md. Read-only.
//   WEB=http://127.0.0.1:3114 API=http://127.0.0.1:8765 OUT=results.json node forecasts-v4-results.mjs
import { chromium } from "playwright-core";
import fs from "node:fs";

const WEB = process.env.WEB || "http://127.0.0.1:3114";
const API = process.env.API || "http://127.0.0.1:8765";
const api = async (p) => (await fetch(API + p)).json();
const browser = await chromium.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true });
const H = { cpi: [1, 3, 6, 12], wpi: [1, 3, 6, 12], iip: [1, 3, 6, 12], gdp: [1, 2, 4] };
const out = { at: new Date().toISOString(), indicators: {} };
for (const [id, hs] of Object.entries(H)) {
  const p = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await p.goto(`${WEB}/forecasting/${id}?view=research`, { waitUntil: "networkidle", timeout: 90000 });
  const kpi = ((await p.locator('[data-testid="kpi-model"]').textContent().catch(() => "")) ?? "").replace(/^Model:\s*/, "");
  const level = await p.locator('[data-tour="fx-reliability"] [data-testid="reliability-meter"]').getAttribute("data-level").catch(() => null);
  const forecast = (await p.locator('[data-testid="kpis"]').textContent().catch(() => "")) ?? "";
  const status = await api(`/api/v1/forecasting/model-status?indicator=${id}`);
  const rec = { default: { model: kpi, level, kpis: forecast.replace(/\s+/g, " ").slice(0, 400) }, status: status.models, horizons: {} };
  for (const h of hs) {
    const c = await api(`/api/v1/forecasting/comparison?indicator=${id}&horizon=${h}`);
    const g = [...c.groups].filter((x) => x.models.some((m) => m.model === "naive")).sort((a, b) => b.n_origins - a.n_origins || b.models.length - a.models.length)[0];
    await p.goto(`${WEB}/forecasting/comparison?indicator=${id}&horizon=${h}`, { waitUntil: "networkidle", timeout: 90000 });
    const rows = await p.locator('[data-tour="fc-table"] tbody tr').evaluateAll((trs) =>
      trs.map((tr) => ({ name: tr.querySelector("th")?.childNodes[0]?.textContent?.trim(), level: tr.querySelector('[data-testid="reliability-meter"]')?.getAttribute("data-level"), isDefault: !!tr.querySelector('[data-testid="default-badge"]') })),
    );
    rec.horizons[h] = g
      ? {
          n_origins: g.n_origins, window: [g.evaluation_start, g.evaluation_end], rankable: g.rankable,
          models: g.models.map((m) => ({ model: m.model, name: m.model_name, run: m.run_id, n: m.n_origins, mae: m.metrics.mae, rmse: m.metrics.rmse, smape: m.metrics.smape, mase: m.metrics.mase, cov80: m.metrics.coverage_80 ?? null, cov95: m.metrics.coverage_95 ?? null, vs_naive_pct: m.vs_baseline_mae_pct, level: rows.find((r) => r.name === m.model_name)?.level ?? null, isDefault: rows.find((r) => r.name === m.model_name)?.isDefault ?? false })),
        }
      : null; // prettier-ignore
  }
  out.indicators[id] = rec;
  await p.context().close();
}
await browser.close();
fs.writeFileSync(process.env.OUT || "results.json", JSON.stringify(out, null, 1));
console.log("written");
