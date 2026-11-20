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

