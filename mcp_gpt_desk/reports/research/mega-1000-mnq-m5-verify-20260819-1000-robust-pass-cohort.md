# Data-driven robust pass cohort — mega-1000-mnq-m5-verify-20260819-1000

## Verdict

- Cohort gate: **NEEDS_REVIEW**
- Decision: **PORTFOLIO_COHORT_REVIEW_REQUIRED**
- Selection policy: `ALL_ROBUSTNESS_PASS_NO_TOP_K_CAP`
- Top-K cap: **none**
- Retained candidates: **40**
- OOS PASS inside retained cohort: **40/40**
- Broker commands matching batch: **0**

## Aggregate metrics

| Metric | Value |
| --- | --- |
| Total R | 157.1099 |
| Closed trades | 112 |
| Open/marked positions | 0 |
| Win rate | 85.71% |
| Profit factor | 10.4912 |
| Max drawdown R | -2.078 |
| Trading days with activity | 37 |
| Max same-day candidate activity | 9 |

## Gate reasons

- COHORT_DAILY_CORRELATION_REQUIRES_CLUSTERING_REVIEW

## Daily correlation

| Metric | Value |
| --- | --- |
| Candidate pairs | 780 |
| Computable pairs | 757 |
| Skipped sparse pairs | 23 |
| Min active dates per pair | 4 |
| Max abs correlation | 1 |
| Average abs correlation | 0.5296 |
| High-correlation pairs | 183 |

## Diversification clusters

| Metric | Value |
| --- | --- |
| Cluster count | 1 |
| Clustered candidates | 32 |
| Unclustered candidates | 8 |
| Largest cluster size | 32 |

| Cluster | Candidates | Families | Total R | Representative |
| --- | --- | --- | --- | --- |
| corr_cluster_001 | 32 | asia_range_breakout_long, asia_range_breakout_short, compression_breakout_long, compression_breakout_short, ny_opening_drive_long, ny_opening_drive_short, opening_range_breakout_long, opening_range_breakout_short, previous_day_mid_reclaim_long, previous_day_mid_reject_short, prior_close_reject_short, vwap_deviation_fade_long, vwap_deviation_fade_short, vwap_proxy_reject_short | 123.5708 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_proxy_reject_short:v001 |

## Main blockers

| Blocker | Count |
| --- | --- |
| PRIORITY_DEFER:0.2 | 40 |
| OPERATOR_APPROVAL_PENDING | 40 |
| PORTFOLIO_FIT_TRADE_COUNT_BELOW_POLICY | 40 |
| PORTFOLIO_CORRELATION_NOT_PROVEN | 40 |
| PORTFOLIO_RISK_BUDGET_NOT_PROVEN | 40 |
| PORTFOLIO_FIT_PROFIT_FACTOR_BELOW_POLICY | 25 |

## Family distribution

| Family | Candidates | Trades | Total R | OOS PASS |
| --- | --- | --- | --- | --- |
| vwap_deviation_fade_long | 7 | 20 | 33.3967 | 7/7 |
| vwap_proxy_reject_short | 6 | 18 | 26.4242 | 6/6 |
| compression_breakout_short | 5 | 15 | 18.5149 | 5/5 |
| vwap_deviation_fade_short | 4 | 11 | 15.0148 | 4/4 |
| prior_close_reject_short | 3 | 9 | 14.5861 | 3/3 |
| previous_day_mid_reject_short | 4 | 10 | 11.9425 | 4/4 |
| ny_opening_drive_long | 2 | 5 | 8.5095 | 2/2 |
| opening_range_breakout_short | 3 | 10 | 8.272 | 3/3 |
| ny_opening_drive_short | 1 | 2 | 4.6798 | 1/1 |
| opening_range_breakout_long | 1 | 3 | 4.1569 | 1/1 |
| compression_breakout_long | 1 | 2 | 3.7776 | 1/1 |
| asia_range_breakout_long | 1 | 2 | 3.4446 | 1/1 |
| asia_range_breakout_short | 1 | 2 | 2.3146 | 1/1 |
| previous_day_mid_reclaim_long | 1 | 3 | 2.0757 | 1/1 |

## Retained candidates — all robustness PASS

| # | Candidate | Family | Variant | Robust | OOS | Trades | R | PF | Promotion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_proxy_reject_short:v001 | vwap_proxy_reject_short | 1 | 0.9389 | PASS | 3 | 7.1122 | n/a | BLOCKED |
| 2 | mega:mega-1000-mnq-m5-verify-20260819-1000:compression_breakout_short:v042 | compression_breakout_short | 42 | 0.9384 | PASS | 4 | 7.9199 | 8.4992 | BLOCKED |
| 3 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_long:v044 | vwap_deviation_fade_long | 44 | 0.9377 | PASS | 4 | 7.8458 | 8.5952 | BLOCKED |
| 4 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_proxy_reject_short:v023 | vwap_proxy_reject_short | 23 | 0.9296 | PASS | 4 | 6.3685 | n/a | BLOCKED |
| 5 | mega:mega-1000-mnq-m5-verify-20260819-1000:prior_close_reject_short:v038 | prior_close_reject_short | 38 | 0.9294 | PASS | 4 | 7.1768 | 7.9759 | BLOCKED |
| 6 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_long:v025 | vwap_deviation_fade_long | 25 | 0.9294 | PASS | 4 | 7.1768 | 7.9759 | BLOCKED |
| 7 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_long:v011 | vwap_deviation_fade_long | 11 | 0.918 | PASS | 2 | 5.4402 | n/a | BLOCKED |
| 8 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_long:v004 | vwap_deviation_fade_long | 4 | 0.9148 | PASS | 3 | 5.1806 | n/a | BLOCKED |
| 9 | mega:mega-1000-mnq-m5-verify-20260819-1000:compression_breakout_short:v024 | compression_breakout_short | 24 | 0.9126 | PASS | 4 | 5.8383 | 6.6116 | BLOCKED |
| 10 | mega:mega-1000-mnq-m5-verify-20260819-1000:previous_day_mid_reject_short:v035 | previous_day_mid_reject_short | 35 | 0.9099 | PASS | 2 | 4.7903 | n/a | BLOCKED |
| 11 | mega:mega-1000-mnq-m5-verify-20260819-1000:ny_opening_drive_short:v048 | ny_opening_drive_short | 48 | 0.9085 | PASS | 2 | 4.6798 | n/a | BLOCKED |
| 12 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_short:v014 | vwap_deviation_fade_short | 14 | 0.9073 | PASS | 2 | 4.5858 | n/a | BLOCKED |
| 13 | mega:mega-1000-mnq-m5-verify-20260819-1000:ny_opening_drive_long:v033 | ny_opening_drive_long | 33 | 0.9044 | PASS | 3 | 5.1824 | 6.0159 | BLOCKED |
| 14 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_long:v032 | vwap_deviation_fade_long | 32 | 0.9031 | PASS | 2 | 4.2487 | n/a | BLOCKED |
| 15 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_short:v012 | vwap_deviation_fade_short | 12 | 0.9027 | PASS | 4 | 5.0391 | 5.8772 | BLOCKED |
| 16 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_short:v039 | vwap_deviation_fade_short | 39 | 0.9015 | PASS | 3 | 4.1227 | n/a | BLOCKED |
| 17 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_proxy_reject_short:v044 | vwap_proxy_reject_short | 44 | 0.8998 | PASS | 2 | 3.9872 | n/a | BLOCKED |
| 18 | mega:mega-1000-mnq-m5-verify-20260819-1000:prior_close_reject_short:v031 | prior_close_reject_short | 31 | 0.8974 | PASS | 2 | 3.7953 | n/a | BLOCKED |
| 19 | mega:mega-1000-mnq-m5-verify-20260819-1000:compression_breakout_long:v044 | compression_breakout_long | 44 | 0.8972 | PASS | 2 | 3.7776 | n/a | BLOCKED |
| 20 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_proxy_reject_short:v037 | vwap_proxy_reject_short | 37 | 0.8932 | PASS | 3 | 3.4522 | n/a | BLOCKED |
| 21 | mega:mega-1000-mnq-m5-verify-20260819-1000:asia_range_breakout_long:v040 | asia_range_breakout_long | 40 | 0.8931 | PASS | 2 | 3.4446 | n/a | BLOCKED |
| 22 | mega:mega-1000-mnq-m5-verify-20260819-1000:ny_opening_drive_long:v026 | ny_opening_drive_long | 26 | 0.8916 | PASS | 2 | 3.3271 | n/a | BLOCKED |
| 23 | mega:mega-1000-mnq-m5-verify-20260819-1000:opening_range_breakout_long:v025 | opening_range_breakout_long | 25 | 0.8914 | PASS | 3 | 4.1569 | 4.9361 | BLOCKED |
| 24 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_proxy_reject_short:v015 | vwap_proxy_reject_short | 15 | 0.886 | PASS | 2 | 2.8819 | n/a | BLOCKED |
| 25 | mega:mega-1000-mnq-m5-verify-20260819-1000:prior_close_reject_short:v008 | prior_close_reject_short | 8 | 0.8848 | PASS | 3 | 3.614 | 4.4979 | BLOCKED |
| 26 | mega:mega-1000-mnq-m5-verify-20260819-1000:compression_breakout_short:v007 | compression_breakout_short | 7 | 0.8812 | PASS | 2 | 2.4967 | n/a | BLOCKED |
| 27 | mega:mega-1000-mnq-m5-verify-20260819-1000:opening_range_breakout_short:v049 | opening_range_breakout_short | 49 | 0.8805 | PASS | 3 | 2.4386 | n/a | BLOCKED |
| 28 | mega:mega-1000-mnq-m5-verify-20260819-1000:previous_day_mid_reject_short:v049 | previous_day_mid_reject_short | 49 | 0.8794 | PASS | 2 | 2.3545 | n/a | BLOCKED |
| 29 | mega:mega-1000-mnq-m5-verify-20260819-1000:opening_range_breakout_short:v019 | opening_range_breakout_short | 19 | 0.8791 | PASS | 4 | 3.1437 | 4.0706 | BLOCKED |
| 30 | mega:mega-1000-mnq-m5-verify-20260819-1000:asia_range_breakout_short:v047 | asia_range_breakout_short | 47 | 0.8789 | PASS | 2 | 2.3146 | n/a | BLOCKED |
| 31 | mega:mega-1000-mnq-m5-verify-20260819-1000:previous_day_mid_reject_short:v038 | previous_day_mid_reject_short | 38 | 0.8774 | PASS | 3 | 3.015 | 3.9181 | BLOCKED |
| 32 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_long:v030 | vwap_deviation_fade_long | 30 | 0.877 | PASS | 3 | 2.9962 | 3.8677 | BLOCKED |
| 33 | mega:mega-1000-mnq-m5-verify-20260819-1000:previous_day_mid_reclaim_long:v014 | previous_day_mid_reclaim_long | 14 | 0.8759 | PASS | 3 | 2.0757 | n/a | BLOCKED |
| 34 | mega:mega-1000-mnq-m5-verify-20260819-1000:opening_range_breakout_short:v035 | opening_range_breakout_short | 35 | 0.8734 | PASS | 3 | 2.6897 | 3.63 | BLOCKED |
| 35 | mega:mega-1000-mnq-m5-verify-20260819-1000:compression_breakout_short:v031 | compression_breakout_short | 31 | 0.8676 | PASS | 3 | 1.405 | n/a | BLOCKED |
| 36 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_short:v007 | vwap_deviation_fade_short | 7 | 0.8658 | PASS | 2 | 1.2672 | n/a | BLOCKED |
| 37 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_proxy_reject_short:v032 | vwap_proxy_reject_short | 32 | 0.8622 | PASS | 4 | 2.6222 | 2.2744 | BLOCKED |
| 38 | mega:mega-1000-mnq-m5-verify-20260819-1000:previous_day_mid_reject_short:v045 | previous_day_mid_reject_short | 45 | 0.862 | PASS | 3 | 1.7827 | 2.7336 | BLOCKED |
| 39 | mega:mega-1000-mnq-m5-verify-20260819-1000:compression_breakout_short:v017 | compression_breakout_short | 17 | 0.8607 | PASS | 2 | 0.855 | n/a | BLOCKED |
| 40 | mega:mega-1000-mnq-m5-verify-20260819-1000:vwap_deviation_fade_long:v028 | vwap_deviation_fade_long | 28 | 0.8564 | PASS | 2 | 0.5084 | n/a | BLOCKED |

## Safety note

This cohort report is research-only. It retains every candidate that passed ROBUSTNESS, but it does not authorize live execution, broker submission, or automatic promotion.
