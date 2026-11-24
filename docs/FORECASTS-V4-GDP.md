# Forecasts V4: quarterly GDP

## 1. Official data audit (production snapshot 2026-11-24)

| Series | Frequency | Base | Unit | Quarters | Span | Gaps |
|---|---|---|---|---|---|---|
| `mospi.nas.2022-23.india.gdp.real.level` | quarterly | 2022-23 | ₹ crore at constant 2022-23 prices | 17 | Q1 FY2022-23 (Apr–Jun 2022) – Q1 FY2026-27 (Apr–Jun 2026) | none |
| `mospi.nas.2022-23.india.gdp.real.growth_yoy` | quarterly | 2022-23 | % YoY (real), as published | 13 | Q1 FY2023-24 – Q1 FY2026-27 | none |

* **Measure:** real GDP (constant prices), not seasonally adjusted. Current-price GDP is not used for forecasting.
* **Latest official quarter:** Q1 FY2026-27 (Apr–Jun 2026), ₹81,36,153 crore; official real growth 7.8% YoY.
* **Revisions:** all 17 levels come from one stored release (`mospi-nas-2022-23-quarterly-1e90c354a9f2d720`). No vintage
  history is stored, so revision behaviour cannot be audited and backtests use the latest estimates (a known limitation:
  real-time forecasters would have seen earlier estimates).
* **Growth consistency:** for all 13 quarters, level(t) / level(t − 4) − 1 equals MoSPI's published YoY growth within
  0.05 percentage points (rounding to one decimal). Level-derived YoY is therefore arithmetically consistent with the
  official figures.
* **Longer history:** MoSPI's 2011-12-base quarterly series exists, but its methodology and base differ, and no official
  back series or linking factor on the 2022-23 base has been published (it is announced for later). Splicing would mix
  incompatible series, so **no older GDP is used and none is fabricated**. No quarter is converted to monthly values.

## 2. What is forecast

The model target is the **real GDP level** (₹ crore, shown as ₹ lakh crore). Growth is never forecast directly:

```
implied YoY growth(t) = forecast level(t) / official level(t − 4 quarters) − 1        (calculated by ArthaSense)
```

For horizons up to 4 quarters the comparison quarter is always an official observation. Quarter-on-quarter change is not
shown as growth: for an unadjusted series it mostly reflects the season (Q4 is highest), and it is never labelled YoY.

## 3. Implementation

* Frequency-aware engine: `validate_history` / `future_periods` / the loader accept strictly consecutive quarters (dated by
  their first month); quarterly gaps are detected as missing quarters.
* Seasonal models use m = 4 (seasonal naive, SARIMA, seasonal ETS); tree models use quarterly lags 1–4.
* Horizons: 1, 2 and 4 quarters. Labels use India's fiscal quarters (Q1 = Apr–Jun … Q4 = Jan–Mar), e.g. "Q2 FY2026-27".
* Two suites, each one identical origin set: `v4_q8` (8 training quarters = two full years) and `v4_q12` (12 quarters,
  the minimum for ETS and ARIMA). Thresholds were **not** lowered to make more models appear.

## 4. Results (backtests, MAE in ₹ crore; all indicative: fewer than 12 origins)

`v4_q8` (origins: 9 at h = 1, 8 at h = 2, 6 at h = 4):

| Model | h = 1 MAE | h = 2 MAE | h = 4 MAE | 80% cov. (h = 1) |
|---|---|---|---|---|
| Naive | 513,893 | 798,886 | 575,431 | 0.67 |
| Seasonal naive | 551,741 | 559,044 | 575,431 | 0.00 |
| Drift | 544,002 | 877,824 | 141,178 | 0.44 |

`v4_q12` (5 origins, h = 1 only): Naive 544,482 · Seasonal naive 588,919 · Drift 585,828 · ETS 546,380 · ARIMA 544,482.

| Model | Status | Reason |
|---|---|---|
| Naive, Seasonal naive, Drift | available (future forecast to 4 quarters) | |
| ETS, ARIMA | available at 1 quarter only | 12-quarter window leaves 5 origins for h = 1, < 5 for h ≥ 2 |
| SARIMA | insufficient history | needs 16 quarters to train plus 5 validated origins |
| Random Forest, XGBoost | insufficient history | need 29 quarters (24 training rows after lags 1–4) |

Seasonal naive's 0% interval coverage is a real finding: its intervals come from only 4–8 seasonal differences, and it
repeats last year's level, so it misses steady ~7% real growth every time. Drift's strong h = 4 result reflects the
same-quarter comparison (a 4-step drift forecast lands on the same season). With 6–9 origins none of these differences is
evidence of superiority; the UI marks every GDP result as limited evidence.

## 5. Interface

* Outlook: fourth card (latest official quarter and level, forecast quarter, model, implied YoY change, reliability,
  12-quarter sparkline, links to the forecast and to `/indicators/gdp`).
* `/forecasting/gdp`: KPIs, eight-model selector (unavailable models greyed out with their reason), 1/2/4-quarter horizons,
  history window, quarterly chart with 80/95% bands where available, guided tour, Research view (configuration, backtest
  evidence, provenance) and a quarterly CSV (`forecastsToCsvV4`: levels, fiscal-quarter labels, implied YoY, model
  configuration, run provenance).
* Overview and Indicators GDP/GVA pages are unchanged.
