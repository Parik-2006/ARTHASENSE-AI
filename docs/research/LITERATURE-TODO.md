# Literature verification tasks (the paper draft has NO verified references yet)

Every `[REF-n]` in `arthasense-ieee-draft.md` is a placeholder. Before any submission, a human must find each
source, read it, and replace the placeholder with the verified authors, year, venue and DOI. Do not
cite anything from memory.

| Placeholder | What has to be found | Used for |
|---|---|---|
| REF-1 | A standard forecasting textbook defining naive, seasonal naive, drift, ETS and ARIMA | Section 6 model definitions |
| REF-2 | The paper that introduced the scaled-error measure (MASE) and discussions of sMAPE | Section 7 metrics |
| REF-3 | Conformal prediction for time series / online conformal methods | Section 7 interval method |
| REF-4 | The gradient-boosted trees / XGBoost paper | Section 6 XGBoost |
| REF-5 | The Chronos / Chronos-2 papers and model cards | Sections 2, 6 (feasibility only) |
| REF-6 | The TimesFM paper and the 2.5 model card | Sections 2, 6 (feasibility only) |
| REF-7 | Prior work on inflation / WPI / IIP forecasting in India | Section 2 related work |
| REF-8 | Rolling-origin (time-series cross-validation) evaluation | Section 7 |

Also still open for the research itself (not literature): a significance test for forecast comparisons
(for example Diebold-Mariano with small-sample care), evaluation of the CPI back series under a documented
linking policy, and the Chronos-2 / TimesFM 2.5 runs (needs PyTorch and an approved 0.5-1 GB download).
Also confirm the Hugging Face model identifiers and licences again at submission time, because they can change.
