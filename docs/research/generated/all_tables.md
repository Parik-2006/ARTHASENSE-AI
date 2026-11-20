### Table 1: Dataset characteristics (stored headline index series)

| Indicator | Series | Base year | First month | Last month | Observations | Missing months | Source | Retrieved (UTC) | Publication date |
|---|---|---|---|---|---|---|---|---|---|
| CPI | mospi.cpi.2024.current.all_india.combined.general.index | 2024 | 2025-01-01 | 2025-12-01 | 12 | 0 | MoSPI eSankhyiki API | 2026-11-20 13:01:32 | not provided by the API |
| WPI | mospi.wpi.2022-23.india.all_commodities.index | 2022-23 | 2023-04-01 | 2026-10-01 | 43 | 0 | MoSPI eSankhyiki API | 2026-11-20 14:13:32 | not provided by the API |
| IIP | mospi.iip.2022-23.india.general.index | 2022-23 | 2023-04-01 | 2026-09-01 | 42 | 0 | MoSPI eSankhyiki API | 2026-11-20 14:13:45 | not provided by the API |

Index levels only. Retrieval time is when the data was downloaded, not when it was published.

### Table 2: Model configurations

| Model | Family | Class | Configuration | Min. training obs. | Status |
|---|---|---|---|---|---|
| naive | baseline | "Naive" | {} | 1 | available |
| snaive | baseline | "SeasonalNaive" | {} | 12 | available |
| drift | baseline | "Drift" | {} | 4 | available |
| ets | statistical | "ETS" | {"damped": true} | 12 | available |
| arima | statistical | "ARIMA" | {"order": [1, 1, 0]} | 12 | available |
| sarima | statistical | "SARIMA" | {"order": [1, 1, 0], "seasonal_order": [0, 1, 0, 12]} | 36 | available |
| xgboost | machine learning | "XGBoostForecaster" | {"learning_rate": 0.05, "max_depth": 2, "min_rows": 24, "n_estimators": 100} | 31 | available |
| chronos2 | foundation | "Chronos2" | {} | 12 | unavailable: python package(s) torch, chronos not installed (pip install chronos-forecasting torch; roughly ~0.5 GB of weights plus ~200 MB for CPU PyTorch). Needs explicit approval. |
| timesfm25 | foundation | "TimesFM25" | {} | 12 | unavailable: python package(s) torch, timesfm not installed (pip install timesfm torch; roughly ~0.9 GB of weights plus ~200 MB for CPU PyTorch). Needs explicit approval. |

### Table 3: Backtest errors by indicator, suite, horizon and model

| Indicator | Suite | Horizon (months) | Model | Origins | MAE | RMSE | MASE | sMAPE (%) | Bias | Rankable (>=12 origins) |
|---|---|---|---|---|---|---|---|---|---|---|
| IIP | core | 1 | arima | 24 | 4.138 | 5.091 | 0.977 | 3.499 | -0.946 | yes |
| IIP | core | 1 | drift | 24 | 5.033 | 6.445 | 1.188 | 4.247 | 0.012 | yes |
| IIP | core | 1 | ets | 24 | 3.514 | 4.713 | 0.831 | 2.970 | -1.239 | yes |
| IIP | core | 1 | naive | 24 | 5.037 | 6.353 | 1.189 | 4.262 | -0.604 | yes |
| IIP | core | 1 | snaive | 24 | 5.908 | 6.258 | 1.368 | 5.103 | -5.825 | yes |
| IIP | core | 3 | arima | 22 | 4.410 | 5.691 | 1.056 | 3.738 | -2.288 | yes |
| IIP | core | 3 | drift | 22 | 4.956 | 5.962 | 1.162 | 4.144 | -0.127 | yes |
| IIP | core | 3 | ets | 22 | 3.915 | 5.088 | 0.921 | 3.293 | -2.015 | yes |
| IIP | core | 3 | naive | 22 | 5.132 | 5.958 | 1.215 | 4.339 | -1.977 | yes |
| IIP | core | 3 | snaive | 22 | 5.900 | 6.281 | 1.366 | 5.056 | -5.809 | yes |
| IIP | core | 6 | arima | 19 | 5.050 | 6.673 | 1.205 | 4.264 | -3.684 | yes |
| IIP | core | 6 | drift | 19 | 5.755 | 6.972 | 1.376 | 4.768 | 0.459 | yes |
| IIP | core | 6 | ets | 19 | 4.366 | 5.573 | 1.033 | 3.653 | -2.702 | yes |
| IIP | core | 6 | naive | 19 | 5.395 | 6.963 | 1.287 | 4.539 | -3.279 | yes |
| IIP | core | 6 | snaive | 19 | 5.942 | 6.340 | 1.397 | 5.068 | -5.837 | yes |
| IIP | core | 12 | arima | 13 | 6.479 | 7.315 | 1.543 | 5.450 | -6.479 | yes |
| IIP | core | 12 | drift | 13 | 3.223 | 4.344 | 0.794 | 2.620 | 1.350 | yes |
| IIP | core | 12 | ets | 13 | 4.542 | 5.216 | 1.096 | 3.785 | -3.798 | yes |
| IIP | core | 12 | naive | 13 | 6.415 | 6.829 | 1.526 | 5.430 | -6.262 | yes |
| IIP | core | 12 | snaive | 13 | 6.415 | 6.829 | 1.526 | 5.430 | -6.262 | yes |
| IIP | ml | 1 | arima | 11 | 4.336 | 5.352 | 0.968 | 3.568 | -1.514 | indicative |
| IIP | ml | 1 | ets | 11 | 3.582 | 4.694 | 0.800 | 2.943 | -2.658 | indicative |
| IIP | ml | 1 | naive | 11 | 4.718 | 6.165 | 1.054 | 3.875 | -1.155 | indicative |
| IIP | ml | 1 | snaive | 11 | 6.882 | 7.138 | 1.513 | 5.798 | -6.882 | indicative |
| IIP | ml | 1 | xgboost | 11 | 4.120 | 5.568 | 0.923 | 3.384 | -0.680 | indicative |
| IIP | ml | 3 | arima | 9 | 4.126 | 5.314 | 0.929 | 3.413 | -3.009 | indicative |
| IIP | ml | 3 | ets | 9 | 3.815 | 5.033 | 0.848 | 3.124 | -3.574 | indicative |
| IIP | ml | 3 | naive | 9 | 4.856 | 5.801 | 1.084 | 4.008 | -2.589 | indicative |
| IIP | ml | 3 | snaive | 9 | 6.711 | 7.019 | 1.472 | 5.610 | -6.711 | indicative |
| IIP | ml | 3 | xgboost | 9 | 4.779 | 5.586 | 1.078 | 3.950 | -1.012 | indicative |
| IIP | ml | 6 | arima | 6 | 4.211 | 4.885 | 0.961 | 3.519 | -3.838 | indicative |
| IIP | ml | 6 | ets | 6 | 4.049 | 4.525 | 0.920 | 3.339 | -4.049 | indicative |
| IIP | ml | 6 | naive | 6 | 4.833 | 5.333 | 1.098 | 4.019 | -3.033 | indicative |
| IIP | ml | 6 | snaive | 6 | 7.783 | 7.957 | 1.761 | 6.520 | -7.783 | indicative |
| IIP | ml | 6 | xgboost | 6 | 7.199 | 7.965 | 1.636 | 5.893 | 0.361 | indicative |
| IIP | seasonal | 1 | ets | 6 | 2.191 | 2.461 | 0.468 | 1.790 | -1.331 | indicative |
| IIP | seasonal | 1 | naive | 6 | 3.767 | 5.234 | 0.811 | 3.055 | 0.900 | indicative |
| IIP | seasonal | 1 | sarima | 6 | 1.455 | 1.994 | 0.309 | 1.189 | -0.994 | indicative |
| IIP | seasonal | 1 | snaive | 6 | 7.783 | 7.957 | 1.669 | 6.520 | -7.783 | indicative |
| WPI | core | 1 | arima | 25 | 0.691 | 1.175 | 1.743 | 0.647 | -0.127 | yes |
| WPI | core | 1 | drift | 25 | 0.637 | 1.019 | 1.685 | 0.604 | -0.341 | yes |
| WPI | core | 1 | ets | 25 | 1.136 | 1.750 | 3.050 | 1.089 | -0.369 | yes |
| WPI | core | 1 | naive | 25 | 0.676 | 1.091 | 1.766 | 0.640 | -0.484 | yes |
| WPI | core | 1 | snaive | 25 | 3.780 | 5.643 | 8.599 | 3.612 | -3.508 | yes |
| WPI | core | 3 | arima | 23 | 2.370 | 4.414 | 6.035 | 2.163 | -0.356 | yes |
| WPI | core | 3 | drift | 23 | 1.636 | 2.458 | 4.608 | 1.556 | -0.971 | yes |
| WPI | core | 3 | ets | 23 | 2.206 | 3.312 | 6.027 | 2.091 | -0.998 | yes |
| WPI | core | 3 | naive | 23 | 1.800 | 2.650 | 4.982 | 1.707 | -1.357 | yes |
| WPI | core | 3 | snaive | 23 | 3.935 | 5.854 | 9.755 | 3.754 | -3.639 | yes |
| WPI | core | 6 | arima | 20 | 5.523 | 11.394 | 14.320 | 4.737 | -0.155 | yes |
| WPI | core | 6 | drift | 20 | 3.387 | 4.384 | 9.953 | 3.216 | -2.276 | yes |
| WPI | core | 6 | ets | 20 | 3.744 | 4.999 | 10.929 | 3.560 | -2.623 | yes |
| WPI | core | 6 | naive | 20 | 3.540 | 4.718 | 10.353 | 3.360 | -2.900 | yes |
| WPI | core | 6 | snaive | 20 | 4.245 | 6.235 | 12.051 | 4.038 | -3.905 | yes |
| WPI | core | 12 | arima | 14 | 5.943 | 7.450 | 18.048 | 5.645 | -5.541 | yes |
| WPI | core | 12 | drift | 14 | 5.739 | 7.008 | 17.422 | 5.438 | -4.477 | yes |
| WPI | core | 12 | ets | 14 | 5.381 | 6.960 | 16.415 | 5.091 | -4.643 | yes |
| WPI | core | 12 | naive | 14 | 5.836 | 7.439 | 17.748 | 5.540 | -5.550 | yes |
| WPI | core | 12 | snaive | 14 | 5.836 | 7.439 | 17.748 | 5.540 | -5.550 | yes |
| WPI | ml | 1 | arima | 12 | 1.133 | 1.653 | 2.718 | 1.044 | -0.298 | yes |
| WPI | ml | 1 | ets | 12 | 1.556 | 2.372 | 3.963 | 1.465 | -1.106 | yes |
| WPI | ml | 1 | naive | 12 | 1.083 | 1.522 | 2.711 | 1.011 | -1.033 | yes |
| WPI | ml | 1 | snaive | 12 | 6.692 | 8.028 | 14.469 | 6.348 | -6.592 | yes |
| WPI | ml | 1 | xgboost | 12 | 1.254 | 1.603 | 2.904 | 1.148 | -0.155 | yes |
| WPI | ml | 3 | arima | 10 | 4.605 | 6.637 | 11.398 | 4.140 | -0.944 | indicative |
| WPI | ml | 3 | ets | 10 | 3.880 | 4.882 | 10.362 | 3.630 | -2.952 | indicative |
| WPI | ml | 3 | naive | 10 | 3.230 | 3.928 | 8.777 | 3.025 | -3.230 | indicative |
| WPI | ml | 3 | snaive | 10 | 7.940 | 8.791 | 19.170 | 7.530 | -7.940 | indicative |
| WPI | ml | 3 | xgboost | 10 | 3.783 | 4.765 | 9.418 | 3.446 | -0.970 | indicative |
| WPI | ml | 6 | arima | 7 | 13.165 | 19.123 | 33.110 | 10.960 | 0.289 | indicative |
| WPI | ml | 6 | ets | 7 | 7.871 | 8.107 | 22.836 | 7.389 | -7.871 | indicative |
| WPI | ml | 6 | naive | 7 | 7.529 | 7.643 | 21.849 | 7.052 | -7.529 | indicative |
| WPI | ml | 6 | snaive | 7 | 10.286 | 10.355 | 28.874 | 9.723 | -10.286 | indicative |
| WPI | ml | 6 | xgboost | 7 | 7.771 | 9.260 | 20.913 | 6.947 | -2.324 | indicative |
| WPI | seasonal | 1 | ets | 7 | 1.844 | 2.812 | 4.339 | 1.709 | -1.072 | indicative |
| WPI | seasonal | 1 | naive | 7 | 1.329 | 1.860 | 3.058 | 1.219 | -1.243 | indicative |
| WPI | seasonal | 1 | sarima | 7 | 1.357 | 1.897 | 3.055 | 1.235 | -0.099 | indicative |
| WPI | seasonal | 1 | snaive | 7 | 10.286 | 10.355 | 21.267 | 9.723 | -10.286 | indicative |
| WPI | seasonal | 3 | ets | 5 | 3.613 | 4.551 | 8.315 | 3.304 | -1.757 | indicative |
| WPI | seasonal | 3 | naive | 5 | 2.600 | 3.160 | 5.978 | 2.375 | -2.600 | indicative |
| WPI | seasonal | 3 | sarima | 5 | 4.899 | 6.898 | 10.508 | 4.287 | 1.583 | indicative |
| WPI | seasonal | 3 | snaive | 5 | 10.740 | 10.789 | 22.954 | 10.125 | -10.740 | indicative |

MAE/RMSE/bias are in index points. MASE scales by the training-window mean absolute one-step change. Only models evaluated on identical origins within a suite are comparable.

### Table 4: MASE by forecast horizon (core suite, initial training window 18 months)

| Indicator | Model | h=1 | h=3 | h=6 | h=12 |
|---|---|---|---|---|---|
| WPI | arima | 1.743 | 6.035 | 14.320 | 18.048 |
| WPI | drift | 1.685 | 4.608 | 9.953 | 17.422 |
| WPI | ets | 3.050 | 6.027 | 10.929 | 16.415 |
| WPI | naive | 1.766 | 4.982 | 10.353 | 17.748 |
| WPI | snaive | 8.599 | 9.755 | 12.051 | 17.748 |
| IIP | arima | 0.977 | 1.056 | 1.205 | 1.543 |
| IIP | drift | 1.188 | 1.162 | 1.376 | 0.794 |
| IIP | ets | 0.831 | 0.921 | 1.033 | 1.096 |
| IIP | naive | 1.189 | 1.215 | 1.287 | 1.526 |
| IIP | snaive | 1.368 | 1.366 | 1.397 | 1.526 |

MASE < 1 means better than the one-step naive in-sample error. Origins shrink as the horizon grows (see Table 3).

### Table 5: Empirical prediction-interval coverage (nominal 0.80 and 0.95)

| Indicator | Suite | Horizon | Model | Origins | Coverage n (80%) | Coverage n (95%) | Coverage 80% | Coverage 95% | Mean width 80% |
|---|---|---|---|---|---|---|---|---|---|
| IIP | core | 1 | arima | 24 | 24 | 24 | 0.750 | 0.875 | 11.117 |
| IIP | core | 1 | drift | 24 | 24 | 24 | 0.750 | 0.833 | 14.764 |
| IIP | core | 1 | ets | 24 | 24 | 24 | 0.667 | 0.875 | 9.219 |
| IIP | core | 1 | naive | 24 | 24 | 24 | 0.750 | 0.875 | 14.500 |
| IIP | core | 1 | snaive | 24 | 24 | 24 | 0.042 | 0.167 | 5.241 |
| IIP | core | 3 | arima | 22 | 22 | 22 | 0.773 | 0.955 | 14.527 |
| IIP | core | 3 | drift | 22 | 22 | 22 | 0.955 | 1.000 | 26.389 |
| IIP | core | 3 | ets | 22 | 22 | 22 | 0.727 | 0.909 | 9.159 |
| IIP | core | 3 | naive | 22 | 22 | 22 | 1.000 | 1.000 | 25.007 |
| IIP | core | 3 | snaive | 22 | 22 | 22 | 0.045 | 0.182 | 5.185 |
| IIP | core | 6 | arima | 19 | 19 | 19 | 0.842 | 0.895 | 18.142 |
| IIP | core | 6 | drift | 19 | 19 | 19 | 1.000 | 1.000 | 38.840 |
| IIP | core | 6 | ets | 19 | 19 | 19 | 0.579 | 0.895 | 9.021 |
| IIP | core | 6 | naive | 19 | 19 | 19 | 0.947 | 1.000 | 34.902 |
| IIP | core | 6 | snaive | 19 | 19 | 19 | 0.053 | 0.105 | 5.131 |
| IIP | core | 12 | arima | 13 | 13 | 13 | 0.923 | 1.000 | 23.951 |
| IIP | core | 12 | drift | 13 | 13 | 13 | 1.000 | 1.000 | 60.215 |
| IIP | core | 12 | ets | 13 | 13 | 13 | 0.615 | 0.769 | 8.808 |
| IIP | core | 12 | naive | 13 | 13 | 13 | 1.000 | 1.000 | 48.707 |
| IIP | core | 12 | snaive | 13 | 13 | 13 | 0.077 | 0.077 | 4.826 |
| IIP | ml | 1 | arima | 11 | 11 | 11 | 0.818 | 0.909 | 11.601 |
| IIP | ml | 1 | ets | 11 | 11 | 11 | 0.727 | 0.818 | 9.705 |
| IIP | ml | 1 | naive | 11 | 11 | 11 | 0.727 | 0.909 | 15.019 |
| IIP | ml | 1 | snaive | 11 | 11 | 11 | 0.000 | 0.091 | 5.732 |
| IIP | ml | 1 | xgboost | 11 | 7 |  | 1.000 | n/a | 22.973 |
| IIP | ml | 3 | arima | 9 | 9 | 9 | 0.778 | 1.000 | 15.184 |
| IIP | ml | 3 | ets | 9 | 9 | 9 | 0.778 | 0.889 | 9.666 |
| IIP | ml | 3 | naive | 9 | 9 | 9 | 1.000 | 1.000 | 25.951 |
| IIP | ml | 3 | snaive | 9 | 9 | 9 | 0.000 | 0.111 | 5.703 |
| IIP | ml | 3 | xgboost | 9 |  |  | n/a | n/a |  |
| IIP | ml | 6 | arima | 6 | 6 | 6 | 0.833 | 1.000 | 18.922 |
| IIP | ml | 6 | ets | 6 | 6 | 6 | 0.500 | 1.000 | 9.483 |
| IIP | ml | 6 | naive | 6 | 6 | 6 | 1.000 | 1.000 | 35.902 |
| IIP | ml | 6 | snaive | 6 | 6 | 6 | 0.000 | 0.000 | 5.791 |
| IIP | ml | 6 | xgboost | 6 |  |  | n/a | n/a |  |
| IIP | seasonal | 1 | ets | 6 | 6 | 6 | 1.000 | 1.000 | 10.011 |
| IIP | seasonal | 1 | naive | 6 | 6 | 6 | 0.833 | 1.000 | 15.395 |
| IIP | seasonal | 1 | sarima | 6 | 6 | 6 | 0.833 | 1.000 | 7.088 |
| IIP | seasonal | 1 | snaive | 6 | 6 | 6 | 0.000 | 0.000 | 5.649 |
| WPI | core | 1 | arima | 25 | 25 | 25 | 0.640 | 0.840 | 1.200 |
| WPI | core | 1 | drift | 25 | 25 | 25 | 0.640 | 0.920 | 1.333 |
| WPI | core | 1 | ets | 25 | 25 | 25 | 0.320 | 0.680 | 1.410 |
| WPI | core | 1 | naive | 25 | 25 | 25 | 0.680 | 0.800 | 1.311 |
| WPI | core | 1 | snaive | 25 | 25 | 25 | 0.360 | 0.400 | 3.378 |
| WPI | core | 3 | arima | 23 | 23 | 23 | 0.565 | 0.783 | 2.827 |
| WPI | core | 3 | drift | 23 | 23 | 23 | 0.565 | 0.783 | 2.266 |
| WPI | core | 3 | ets | 23 | 23 | 23 | 0.435 | 0.522 | 2.174 |
| WPI | core | 3 | naive | 23 | 23 | 23 | 0.478 | 0.696 | 2.152 |
| WPI | core | 3 | snaive | 23 | 23 | 23 | 0.348 | 0.478 | 2.860 |
| WPI | core | 6 | arima | 20 | 20 | 20 | 0.400 | 0.600 | 4.563 |
| WPI | core | 6 | drift | 20 | 20 | 20 | 0.400 | 0.550 | 3.029 |
| WPI | core | 6 | ets | 20 | 20 | 20 | 0.100 | 0.400 | 2.286 |
| WPI | core | 6 | naive | 20 | 20 | 20 | 0.350 | 0.500 | 2.727 |
| WPI | core | 6 | snaive | 20 | 20 | 20 | 0.400 | 0.450 | 2.176 |
| WPI | core | 12 | arima | 14 | 14 | 14 | 0.429 | 0.429 | 5.162 |
| WPI | core | 12 | drift | 14 | 14 | 14 | 0.286 | 0.500 | 4.535 |
| WPI | core | 12 | ets | 14 | 14 | 14 | 0.214 | 0.286 | 2.724 |
| WPI | core | 12 | naive | 14 | 14 | 14 | 0.357 | 0.429 | 3.671 |
| WPI | core | 12 | snaive | 14 | 14 | 14 | 0.143 | 0.214 | 1.714 |
| WPI | ml | 1 | arima | 12 | 12 | 12 | 0.417 | 0.750 | 1.416 |
| WPI | ml | 1 | ets | 12 | 12 | 12 | 0.417 | 0.667 | 1.641 |
| WPI | ml | 1 | naive | 12 | 12 | 12 | 0.500 | 0.667 | 1.579 |
| WPI | ml | 1 | snaive | 12 | 12 | 12 | 0.250 | 0.250 | 5.277 |
| WPI | ml | 1 | xgboost | 12 | 8 |  | 0.750 | n/a | 5.036 |
| WPI | ml | 3 | arima | 10 | 10 | 10 | 0.200 | 0.500 | 3.574 |
| WPI | ml | 3 | ets | 10 | 10 | 10 | 0.200 | 0.300 | 2.932 |
| WPI | ml | 3 | naive | 10 | 10 | 10 | 0.200 | 0.300 | 2.556 |
| WPI | ml | 3 | snaive | 10 | 10 | 10 | 0.100 | 0.200 | 4.465 |
| WPI | ml | 3 | xgboost | 10 |  |  | n/a | n/a |  |
| WPI | ml | 6 | arima | 7 | 7 | 7 | 0.000 | 0.000 | 6.531 |
| WPI | ml | 6 | ets | 7 | 7 | 7 | 0.000 | 0.143 | 2.776 |
| WPI | ml | 6 | naive | 7 | 7 | 7 | 0.000 | 0.000 | 2.954 |
| WPI | ml | 6 | snaive | 7 | 7 | 7 | 0.000 | 0.000 | 3.199 |
| WPI | ml | 6 | xgboost | 7 |  |  | n/a | n/a |  |
| WPI | seasonal | 1 | ets | 7 | 7 | 7 | 0.429 | 0.714 | 1.929 |
| WPI | seasonal | 1 | naive | 7 | 7 | 7 | 0.571 | 0.714 | 1.975 |
| WPI | seasonal | 1 | sarima | 7 | 7 | 7 | 0.571 | 0.714 | 2.190 |
| WPI | seasonal | 1 | snaive | 7 | 7 | 7 | 0.000 | 0.000 | 7.003 |
| WPI | seasonal | 3 | ets | 5 | 5 | 5 | 0.400 | 0.600 | 4.072 |
| WPI | seasonal | 3 | naive | 5 | 5 | 5 | 0.400 | 0.600 | 3.336 |
| WPI | seasonal | 3 | sarima | 5 | 5 | 5 | 0.600 | 0.600 | 6.369 |
| WPI | seasonal | 3 | snaive | 5 | 5 | 5 | 0.000 | 0.000 | 6.070 |

n/a: not enough earlier errors to calibrate (online conformal 95% needs >= 19) or the model has no intervals. Coverage far below nominal means the intervals are too narrow.

### Table 6: Runs that were not evaluated, and why

| Indicator | Model | Reason |
|---|---|---|
| CPI | arima | only 0 usable forecast origin(s); at least 5 needed |
| CPI | chronos2 | unavailable: python package(s) torch, chronos not installed (pip install chronos-forecasting torch; roughly ~0.5 GB of weights plus ~200 MB for CPU PyTorch). Needs explicit approval. |
| CPI | drift | only 0 usable forecast origin(s); at least 5 needed |
| CPI | ets | only 0 usable forecast origin(s); at least 5 needed |
| CPI | naive | only 0 usable forecast origin(s); at least 5 needed |
| CPI | sarima | only 0 usable forecast origin(s); at least 5 needed |
| CPI | snaive | only 0 usable forecast origin(s); at least 5 needed |
| CPI | timesfm25 | unavailable: python package(s) torch, timesfm not installed (pip install timesfm torch; roughly ~0.9 GB of weights plus ~200 MB for CPU PyTorch). Needs explicit approval. |
| CPI | xgboost | only 0 usable forecast origin(s); at least 5 needed |
| IIP | arima | only 0 usable forecast origin(s); at least 5 needed |
| IIP | chronos2 | unavailable: python package(s) torch, chronos not installed (pip install chronos-forecasting torch; roughly ~0.5 GB of weights plus ~200 MB for CPU PyTorch). Needs explicit approval. |
| IIP | ets | only 0 usable forecast origin(s); at least 5 needed |
| IIP | ets | only 4 usable forecast origin(s); at least 5 needed |
| IIP | naive | only 0 usable forecast origin(s); at least 5 needed |
| IIP | naive | only 4 usable forecast origin(s); at least 5 needed |
| IIP | sarima | only 4 usable forecast origin(s); at least 5 needed |
| IIP | snaive | only 0 usable forecast origin(s); at least 5 needed |
| IIP | snaive | only 4 usable forecast origin(s); at least 5 needed |
| IIP | timesfm25 | unavailable: python package(s) torch, timesfm not installed (pip install timesfm torch; roughly ~0.9 GB of weights plus ~200 MB for CPU PyTorch). Needs explicit approval. |
| IIP | xgboost | only 0 usable forecast origin(s); at least 5 needed |
| WPI | arima | only 1 usable forecast origin(s); at least 5 needed |
| WPI | chronos2 | unavailable: python package(s) torch, chronos not installed (pip install chronos-forecasting torch; roughly ~0.5 GB of weights plus ~200 MB for CPU PyTorch). Needs explicit approval. |
| WPI | ets | only 1 usable forecast origin(s); at least 5 needed |
| WPI | naive | only 1 usable forecast origin(s); at least 5 needed |
| WPI | snaive | only 1 usable forecast origin(s); at least 5 needed |
| WPI | timesfm25 | unavailable: python package(s) torch, timesfm not installed (pip install timesfm torch; roughly ~0.9 GB of weights plus ~200 MB for CPU PyTorch). Needs explicit approval. |
| WPI | xgboost | only 1 usable forecast origin(s); at least 5 needed |

