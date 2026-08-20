# Data-driven robust pass cohort — mega-1000-mes-m5-diversified-v2-20260820-001

## Verdict

- Cohort gate: **NEEDS_REVIEW**
- Decision: **PORTFOLIO_COHORT_REVIEW_REQUIRED**
- Selection policy: `ALL_ROBUSTNESS_PASS_NO_TOP_K_CAP`
- Top-K cap: **none**
- Retained candidates: **35**
- OOS PASS inside retained cohort: **35/35**
- Broker commands matching batch: **0**

## Aggregate metrics

| Metric | Value |
| --- | --- |
| Total R | 147.5266 |
| Closed trades | 115 |
| Open/marked positions | 0 |
| Win rate | 74.78% |
| Profit factor | 5.9217 |
| Max drawdown R | -4.1399 |
| Trading days with activity | 33 |
| Max same-day candidate activity | 9 |

## Gate reasons

- COHORT_DAILY_CORRELATION_REQUIRES_CLUSTERING_REVIEW

## Daily correlation

| Metric | Value |
| --- | --- |
| Candidate pairs | 595 |
| Computable pairs | 589 |
| Skipped sparse pairs | 6 |
| Min active dates per pair | 4 |
| Max abs correlation | 1 |
| Average abs correlation | 0.3823 |
| High-correlation pairs | 58 |

## Diversification clusters

| Metric | Value |
| --- | --- |
| Cluster count | 3 |
| Clustered candidates | 25 |
| Unclustered candidates | 10 |
| Largest cluster size | 21 |

| Cluster | Candidates | Families | Total R | Representative |
| --- | --- | --- | --- | --- |
| corr_cluster_001 | 21 | asia_mid_reject_short, ny_opening_drive_short, opening_range_breakout_short, previous_day_high_reject_short, previous_day_low_break, previous_day_low_reclaim_long, previous_day_lower_quartile_break_short, previous_day_lower_quartile_reclaim_long, previous_day_mid_reject_short, previous_day_upper_quartile_reject_short, prior_close_reclaim_long, rolling_three_day_mean_reject_short, vwap_deviation_fade_long, vwap_deviation_fade_short | 83.9654 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:prior_close_reclaim_long:v022 |
| corr_cluster_002 | 2 | prior_close_reject_short | 12.4305 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:prior_close_reject_short:v013 |
| corr_cluster_003 | 2 | ny_opening_mid_reject_short, previous_day_lower_quartile_break_short | 8.3977 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:ny_opening_mid_reject_short:v013 |

## Main blockers

| Blocker | Count |
| --- | --- |
| PRIORITY_DEFER:0.2 | 35 |
| OPERATOR_APPROVAL_PENDING | 35 |
| PORTFOLIO_FIT_TRADE_COUNT_BELOW_POLICY | 35 |
| PORTFOLIO_CORRELATION_NOT_PROVEN | 35 |
| PORTFOLIO_RISK_BUDGET_NOT_PROVEN | 35 |
| PORTFOLIO_FIT_PROFIT_FACTOR_BELOW_POLICY | 11 |

## Family distribution

| Family | Candidates | Trades | Total R | OOS PASS |
| --- | --- | --- | --- | --- |
| ny_opening_mid_reject_short | 3 | 13 | 15.416 | 3/3 |
| previous_day_low_break | 4 | 11 | 14.9018 | 4/4 |
| previous_day_upper_quartile_reject_short | 4 | 14 | 14.3783 | 4/4 |
| prior_close_reject_short | 2 | 9 | 12.4305 | 2/2 |
| prior_close_reclaim_long | 2 | 8 | 12.4143 | 2/2 |
| previous_day_low_reclaim_long | 2 | 4 | 9.0679 | 2/2 |
| previous_day_high_reject_short | 2 | 4 | 8.86 | 2/2 |
| previous_day_lower_quartile_break_short | 2 | 7 | 8.3687 | 2/2 |
| opening_range_breakout_short | 2 | 7 | 7.2944 | 2/2 |
| vwap_deviation_fade_short | 2 | 5 | 7.1698 | 2/2 |
| session_open_drive_long | 1 | 4 | 4.7803 | 1/1 |
| previous_day_mid_reject_short | 1 | 4 | 4.5333 | 1/1 |
| vwap_proxy_reclaim_long | 1 | 4 | 4.4816 | 1/1 |
| vwap_deviation_fade_long | 1 | 2 | 3.9872 | 1/1 |
| asia_mid_reject_short | 1 | 3 | 3.8358 | 1/1 |
| compression_breakout_short | 1 | 3 | 3.6715 | 1/1 |
| ny_opening_drive_short | 1 | 3 | 3.5454 | 1/1 |
| opening_mid_reject_short | 1 | 4 | 3.4128 | 1/1 |
| rolling_three_day_mean_reject_short | 1 | 4 | 2.7178 | 1/1 |
| previous_day_lower_quartile_reclaim_long | 1 | 2 | 2.2592 | 1/1 |

## Retained candidates — all robustness PASS

| # | Candidate | Family | Variant | Robust | OOS | Trades | R | PF | Promotion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:prior_close_reclaim_long:v022 | prior_close_reclaim_long | 22 | 0.9422 | PASS | 4 | 7.3752 | n/a | BLOCKED |
| 2 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:prior_close_reject_short:v013 | prior_close_reject_short | 13 | 0.9313 | PASS | 5 | 7.3246 | 8.1404 | BLOCKED |
| 3 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_low_reclaim_long:v004 | previous_day_low_reclaim_long | 4 | 0.9172 | PASS | 2 | 5.375 | n/a | BLOCKED |
| 4 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_high_reject_short:v013 | previous_day_high_reject_short | 13 | 0.9152 | PASS | 2 | 5.213 | n/a | BLOCKED |
| 5 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:ny_opening_mid_reject_short:v006 | ny_opening_mid_reject_short | 6 | 0.9139 | PASS | 4 | 5.9376 | 6.7468 | BLOCKED |
| 6 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:prior_close_reject_short:v006 | prior_close_reject_short | 6 | 0.9035 | PASS | 4 | 5.1059 | 5.963 | BLOCKED |
| 7 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:prior_close_reclaim_long:v015 | prior_close_reclaim_long | 15 | 0.9027 | PASS | 4 | 5.0391 | 5.8772 | BLOCKED |
| 8 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_upper_quartile_reject_short:v016 | previous_day_upper_quartile_reject_short | 16 | 0.901 | PASS | 3 | 4.9279 | 5.6661 | BLOCKED |
| 9 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_low_break:v014 | previous_day_low_break | 14 | 0.8998 | PASS | 2 | 3.9872 | n/a | BLOCKED |
| 10 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:vwap_deviation_fade_long:v021 | vwap_deviation_fade_long | 21 | 0.8998 | PASS | 2 | 3.9872 | n/a | BLOCKED |
| 11 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:session_open_drive_long:v008 | session_open_drive_long | 8 | 0.8994 | PASS | 4 | 4.7803 | 5.6222 | BLOCKED |
| 12 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:opening_range_breakout_short:v005 | opening_range_breakout_short | 5 | 0.8982 | PASS | 4 | 4.6763 | 5.5392 | BLOCKED |
| 13 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_low_break:v021 | previous_day_low_break | 21 | 0.8982 | PASS | 3 | 3.857 | n/a | BLOCKED |
| 14 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_low_break:v025 | previous_day_low_break | 25 | 0.8969 | PASS | 3 | 4.5735 | 5.4559 | BLOCKED |
| 15 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_mid_reject_short:v005 | previous_day_mid_reject_short | 5 | 0.8964 | PASS | 4 | 4.5333 | 5.3991 | BLOCKED |
| 16 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_low_reclaim_long:v009 | previous_day_low_reclaim_long | 9 | 0.8962 | PASS | 2 | 3.6929 | n/a | BLOCKED |
| 17 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:ny_opening_mid_reject_short:v013 | ny_opening_mid_reject_short | 13 | 0.8961 | PASS | 4 | 4.5163 | 5.3822 | BLOCKED |
| 18 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_lower_quartile_break_short:v003 | previous_day_lower_quartile_break_short | 3 | 0.8958 | PASS | 3 | 4.4873 | 5.371 | BLOCKED |
| 19 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:vwap_proxy_reclaim_long:v004 | vwap_proxy_reclaim_long | 4 | 0.8956 | PASS | 4 | 4.4816 | 5.2927 | BLOCKED |
| 20 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_high_reject_short:v020 | previous_day_high_reject_short | 20 | 0.8956 | PASS | 2 | 3.647 | n/a | BLOCKED |
| 21 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:vwap_deviation_fade_short:v021 | vwap_deviation_fade_short | 21 | 0.8935 | PASS | 2 | 3.4802 | n/a | BLOCKED |
| 22 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:ny_opening_mid_reject_short:v020 | ny_opening_mid_reject_short | 20 | 0.8915 | PASS | 5 | 4.9621 | 3.4116 | BLOCKED |
| 23 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_lower_quartile_break_short:v013 | previous_day_lower_quartile_break_short | 13 | 0.8882 | PASS | 4 | 3.8814 | 4.7691 | BLOCKED |
| 24 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:asia_mid_reject_short:v005 | asia_mid_reject_short | 5 | 0.8876 | PASS | 3 | 3.8358 | 4.7097 | BLOCKED |
| 25 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_upper_quartile_reject_short:v023 | previous_day_upper_quartile_reject_short | 23 | 0.8875 | PASS | 3 | 3.8361 | 4.6744 | BLOCKED |
| 26 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:vwap_deviation_fade_short:v023 | vwap_deviation_fade_short | 23 | 0.8857 | PASS | 3 | 3.6896 | 4.5532 | BLOCKED |
| 27 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:compression_breakout_short:v005 | compression_breakout_short | 5 | 0.8856 | PASS | 3 | 3.6715 | 4.5625 | BLOCKED |
| 28 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:ny_opening_drive_short:v020 | ny_opening_drive_short | 20 | 0.8839 | PASS | 3 | 3.5454 | 4.4077 | BLOCKED |
| 29 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_low_break:v007 | previous_day_low_break | 7 | 0.8811 | PASS | 3 | 2.4841 | n/a | BLOCKED |
| 30 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_lower_quartile_reclaim_long:v022 | previous_day_lower_quartile_reclaim_long | 22 | 0.8782 | PASS | 2 | 2.2592 | n/a | BLOCKED |
| 31 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:opening_range_breakout_short:v007 | opening_range_breakout_short | 7 | 0.8724 | PASS | 3 | 2.6181 | 3.5266 | BLOCKED |
| 32 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:opening_mid_reject_short:v016 | opening_mid_reject_short | 16 | 0.8721 | PASS | 4 | 3.4128 | 2.6586 | BLOCKED |
| 33 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_upper_quartile_reject_short:v009 | previous_day_upper_quartile_reject_short | 9 | 0.8674 | PASS | 4 | 3.0335 | 2.4774 | BLOCKED |
| 34 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:rolling_three_day_mean_reject_short:v021 | rolling_three_day_mean_reject_short | 21 | 0.8631 | PASS | 4 | 2.7178 | 2.3025 | BLOCKED |
| 35 | mega:mega-1000-mes-m5-diversified-v2-20260820-001:previous_day_upper_quartile_reject_short:v012 | previous_day_upper_quartile_reject_short | 12 | 0.8616 | PASS | 4 | 2.5808 | 2.2489 | BLOCKED |

## Safety note

This cohort report is research-only. It retains every candidate that passed ROBUSTNESS, but it does not authorize live execution, broker submission, or automatic promotion.
