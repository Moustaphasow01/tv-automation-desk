# Data-driven robust pass cohort — mega-1000-mnq-m5-diversified-v2-20260820-005

## Verdict

- Cohort gate: **NEEDS_REVIEW**
- Decision: **PORTFOLIO_COHORT_REVIEW_REQUIRED**
- Selection policy: `ALL_ROBUSTNESS_PASS_NO_TOP_K_CAP`
- Top-K cap: **none**
- Retained candidates: **24**
- OOS PASS inside retained cohort: **24/24**
- Broker commands matching batch: **0**

## Aggregate metrics

| Metric | Value |
| --- | --- |
| Total R | 96.1639 |
| Closed trades | 68 |
| Open/marked positions | 0 |
| Win rate | 89.71% |
| Profit factor | 14.2532 |
| Max drawdown R | -2.0664 |
| Trading days with activity | 29 |
| Max same-day candidate activity | 6 |

## Gate reasons

- COHORT_DAILY_CORRELATION_REQUIRES_CLUSTERING_REVIEW

## Daily correlation

| Metric | Value |
| --- | --- |
| Candidate pairs | 276 |
| Computable pairs | 267 |
| Skipped sparse pairs | 9 |
| Min active dates per pair | 4 |
| Max abs correlation | 1 |
| Average abs correlation | 0.5915 |
| High-correlation pairs | 87 |

## Diversification clusters

| Metric | Value |
| --- | --- |
| Cluster count | 2 |
| Clustered candidates | 20 |
| Unclustered candidates | 4 |
| Largest cluster size | 18 |

| Cluster | Candidates | Families | Total R | Representative |
| --- | --- | --- | --- | --- |
| corr_cluster_001 | 18 | asia_mid_reject_short, compression_breakout_short, ny_opening_mid_reject_short, opening_range_breakout_short, previous_day_high_reject_short, previous_day_lower_quartile_break_short, previous_day_mid_reclaim_long, previous_day_upper_quartile_reclaim_long, previous_day_upper_quartile_reject_short, rolling_three_day_mean_reject_short, session_open_drive_long, session_open_drive_short, vwap_deviation_fade_long, vwap_deviation_fade_short, vwap_proxy_reject_short | 72.6742 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:vwap_proxy_reject_short:v001 |
| corr_cluster_002 | 2 | compression_breakout_short | 6.6933 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:compression_breakout_short:v024 |

## Main blockers

| Blocker | Count |
| --- | --- |
| PRIORITY_DEFER:0.2 | 24 |
| OPERATOR_APPROVAL_PENDING | 24 |
| PORTFOLIO_FIT_TRADE_COUNT_BELOW_POLICY | 24 |
| PORTFOLIO_CORRELATION_NOT_PROVEN | 24 |
| PORTFOLIO_RISK_BUDGET_NOT_PROVEN | 24 |
| PORTFOLIO_FIT_PROFIT_FACTOR_BELOW_POLICY | 18 |

## Family distribution

| Family | Candidates | Trades | Total R | OOS PASS |
| --- | --- | --- | --- | --- |
| vwap_deviation_fade_long | 3 | 9 | 17.7976 | 3/3 |
| vwap_proxy_reject_short | 3 | 9 | 16.3626 | 3/3 |
| compression_breakout_short | 3 | 8 | 9.19 | 3/3 |
| asia_mid_reject_short | 1 | 5 | 6.8591 | 1/1 |
| session_open_drive_short | 1 | 4 | 5.8596 | 1/1 |
| vwap_deviation_fade_short | 2 | 4 | 5.853 | 2/2 |
| session_open_drive_long | 1 | 3 | 4.3346 | 1/1 |
| opening_range_breakout_long | 1 | 3 | 4.1569 | 1/1 |
| previous_day_lower_quartile_break_short | 1 | 2 | 3.9226 | 1/1 |
| ny_opening_mid_reject_short | 1 | 2 | 3.3863 | 1/1 |
| opening_range_breakout_short | 1 | 4 | 3.1437 | 1/1 |
| previous_day_high_reject_short | 1 | 2 | 2.9616 | 1/1 |
| rolling_three_day_mean_reject_short | 1 | 2 | 2.8492 | 1/1 |
| previous_day_upper_quartile_reject_short | 1 | 2 | 2.7058 | 1/1 |
| asia_mid_reclaim_long | 1 | 4 | 2.5808 | 1/1 |
| previous_day_upper_quartile_reclaim_long | 1 | 2 | 2.1248 | 1/1 |
| previous_day_mid_reclaim_long | 1 | 3 | 2.0757 | 1/1 |

## Retained candidates — all robustness PASS

| # | Candidate | Family | Variant | Robust | OOS | Trades | R | PF | Promotion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:vwap_proxy_reject_short:v001 | vwap_proxy_reject_short | 1 | 0.9389 | PASS | 3 | 7.1122 | n/a | BLOCKED |
| 2 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:asia_mid_reject_short:v001 | asia_mid_reject_short | 1 | 0.9357 | PASS | 5 | 6.8591 | n/a | BLOCKED |
| 3 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:vwap_proxy_reject_short:v023 | vwap_proxy_reject_short | 23 | 0.9296 | PASS | 4 | 6.3685 | n/a | BLOCKED |
| 4 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:vwap_deviation_fade_long:v025 | vwap_deviation_fade_long | 25 | 0.9294 | PASS | 4 | 7.1768 | 7.9759 | BLOCKED |
| 5 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:session_open_drive_short:v023 | session_open_drive_short | 23 | 0.9232 | PASS | 4 | 5.8596 | n/a | BLOCKED |
| 6 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:vwap_deviation_fade_long:v011 | vwap_deviation_fade_long | 11 | 0.918 | PASS | 2 | 5.4402 | n/a | BLOCKED |
| 7 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:vwap_deviation_fade_long:v004 | vwap_deviation_fade_long | 4 | 0.9148 | PASS | 3 | 5.1806 | n/a | BLOCKED |
| 8 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:compression_breakout_short:v024 | compression_breakout_short | 24 | 0.9126 | PASS | 4 | 5.8383 | 6.6116 | BLOCKED |
| 9 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:vwap_deviation_fade_short:v014 | vwap_deviation_fade_short | 14 | 0.9073 | PASS | 2 | 4.5858 | n/a | BLOCKED |
| 10 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:previous_day_lower_quartile_break_short:v003 | previous_day_lower_quartile_break_short | 3 | 0.899 | PASS | 2 | 3.9226 | n/a | BLOCKED |
| 11 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:session_open_drive_long:v001 | session_open_drive_long | 1 | 0.8938 | PASS | 3 | 4.3346 | 5.1663 | BLOCKED |
| 12 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:ny_opening_mid_reject_short:v015 | ny_opening_mid_reject_short | 15 | 0.8923 | PASS | 2 | 3.3863 | n/a | BLOCKED |
| 13 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:opening_range_breakout_long:v025 | opening_range_breakout_long | 25 | 0.8914 | PASS | 3 | 4.1569 | 4.9361 | BLOCKED |
| 14 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:previous_day_high_reject_short:v008 | previous_day_high_reject_short | 8 | 0.887 | PASS | 2 | 2.9616 | n/a | BLOCKED |
| 15 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:vwap_proxy_reject_short:v015 | vwap_proxy_reject_short | 15 | 0.886 | PASS | 2 | 2.8819 | n/a | BLOCKED |
| 16 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:rolling_three_day_mean_reject_short:v017 | rolling_three_day_mean_reject_short | 17 | 0.8856 | PASS | 2 | 2.8492 | n/a | BLOCKED |
| 17 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:previous_day_upper_quartile_reject_short:v005 | previous_day_upper_quartile_reject_short | 5 | 0.8838 | PASS | 2 | 2.7058 | n/a | BLOCKED |
| 18 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:compression_breakout_short:v007 | compression_breakout_short | 7 | 0.8812 | PASS | 2 | 2.4967 | n/a | BLOCKED |
| 19 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:opening_range_breakout_short:v019 | opening_range_breakout_short | 19 | 0.8791 | PASS | 4 | 3.1437 | 4.0706 | BLOCKED |
| 20 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:previous_day_upper_quartile_reclaim_long:v012 | previous_day_upper_quartile_reclaim_long | 12 | 0.8766 | PASS | 2 | 2.1248 | n/a | BLOCKED |
| 21 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:previous_day_mid_reclaim_long:v014 | previous_day_mid_reclaim_long | 14 | 0.8759 | PASS | 3 | 2.0757 | n/a | BLOCKED |
| 22 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:vwap_deviation_fade_short:v007 | vwap_deviation_fade_short | 7 | 0.8658 | PASS | 2 | 1.2672 | n/a | BLOCKED |
| 23 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:asia_mid_reclaim_long:v019 | asia_mid_reclaim_long | 19 | 0.8616 | PASS | 4 | 2.5808 | 2.2489 | BLOCKED |
| 24 | mega:mega-1000-mnq-m5-diversified-v2-20260820-005:compression_breakout_short:v017 | compression_breakout_short | 17 | 0.8607 | PASS | 2 | 0.855 | n/a | BLOCKED |

## Safety note

This cohort report is research-only. It retains every candidate that passed ROBUSTNESS, but it does not authorize live execution, broker submission, or automatic promotion.
