# Data-driven robust pass cohort — mega-1000-mnq-m5-20260817b

## Verdict

- Cohort gate: **NEEDS_REVIEW**
- Decision: **PORTFOLIO_COHORT_REVIEW_REQUIRED**
- Selection policy: `ALL_ROBUSTNESS_PASS_NO_TOP_K_CAP`
- Top-K cap: **none**
- Retained candidates: **41**
- OOS PASS inside retained cohort: **41/41**
- Broker commands matching batch: **0**

## Aggregate metrics

| Metric | Value |
| --- | --- |
| Total R | 154.0846 |
| Closed trades | 112 |
| Open/marked positions | 0 |
| Win rate | 86.61% |
| Profit factor | 10.9814 |
| Max drawdown R | -2.0595 |
| Trading days with activity | 41 |
| Max same-day candidate activity | 8 |

## Gate reasons

- COHORT_DAILY_CORRELATION_REQUIRES_CLUSTERING_REVIEW

## Daily correlation

| Metric | Value |
| --- | --- |
| Candidate pairs | 820 |
| Computable pairs | 796 |
| Skipped sparse pairs | 24 |
| Min active dates per pair | 4 |
| Max abs correlation | 1 |
| Average abs correlation | 0.5298 |
| High-correlation pairs | 178 |

## Diversification clusters

| Metric | Value |
| --- | --- |
| Cluster count | 1 |
| Clustered candidates | 30 |
| Unclustered candidates | 11 |
| Largest cluster size | 30 |

| Cluster | Candidates | Families | Total R | Representative |
| --- | --- | --- | --- | --- |
| corr_cluster_001 | 30 | asia_range_breakout_long, compression_breakout_short, ny_opening_drive_long, ny_opening_drive_short, opening_range_breakout_long, opening_range_breakout_short, previous_day_high_reclaim, previous_day_low_break, previous_day_mid_reclaim_long, previous_day_mid_reject_short, prior_close_reject_short, vwap_deviation_fade_long, vwap_deviation_fade_short, vwap_proxy_reject_short | 118.946 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_short:v004 |

## Main blockers

| Blocker | Count |
| --- | --- |
| PRIORITY_DEFER:0.2 | 41 |
| OPERATOR_APPROVAL_PENDING | 41 |
| PORTFOLIO_FIT_TRADE_COUNT_BELOW_POLICY | 41 |
| PORTFOLIO_CORRELATION_NOT_PROVEN | 41 |
| PORTFOLIO_RISK_BUDGET_NOT_PROVEN | 41 |
| PORTFOLIO_FIT_PROFIT_FACTOR_BELOW_POLICY | 27 |

## Family distribution

| Family | Candidates | Trades | Total R | OOS PASS |
| --- | --- | --- | --- | --- |
| vwap_deviation_fade_short | 5 | 12 | 26.5067 | 5/5 |
| vwap_deviation_fade_long | 4 | 9 | 16.8669 | 4/4 |
| opening_range_breakout_short | 5 | 14 | 15.1428 | 5/5 |
| vwap_proxy_reject_short | 2 | 8 | 13.5815 | 2/2 |
| prior_close_reject_short | 3 | 11 | 13.333 | 3/3 |
| previous_day_low_break | 3 | 10 | 11.9505 | 3/3 |
| previous_day_mid_reclaim_long | 4 | 9 | 8.0098 | 4/4 |
| previous_day_mid_reject_short | 3 | 6 | 7.6664 | 3/3 |
| vwap_proxy_reclaim_long | 2 | 6 | 7.3765 | 2/2 |
| asia_range_breakout_long | 3 | 8 | 7.2285 | 3/3 |
| ny_opening_drive_long | 2 | 5 | 6.5229 | 2/2 |
| opening_range_breakout_long | 1 | 4 | 6.044 | 1/1 |
| previous_day_high_reclaim | 1 | 2 | 4.1226 | 1/1 |
| ny_opening_drive_short | 1 | 2 | 4.0309 | 1/1 |
| asia_range_breakout_short | 1 | 4 | 3.3646 | 1/1 |
| compression_breakout_short | 1 | 2 | 2.337 | 1/1 |

## Retained candidates — all robustness PASS

| # | Candidate | Family | Variant | Robust | OOS | Trades | R | PF | Promotion |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_short:v004 | vwap_deviation_fade_short | 4 | 0.95 | PASS | 3 | 9.3234 | n/a | BLOCKED |
| 2 | mega:mega-1000-mnq-m5-20260817b:vwap_proxy_reject_short:v036 | vwap_proxy_reject_short | 36 | 0.9417 | PASS | 4 | 8.1648 | 8.8478 | BLOCKED |
| 3 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_long:v037 | vwap_deviation_fade_long | 37 | 0.936 | PASS | 3 | 6.8787 | n/a | BLOCKED |
| 4 | mega:mega-1000-mnq-m5-20260817b:previous_day_low_break:v004 | previous_day_low_break | 4 | 0.9288 | PASS | 4 | 7.1271 | 7.8981 | BLOCKED |
| 5 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_long:v025 | vwap_deviation_fade_long | 25 | 0.9184 | PASS | 2 | 5.4704 | n/a | BLOCKED |
| 6 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_short:v044 | vwap_deviation_fade_short | 44 | 0.918 | PASS | 2 | 5.4402 | n/a | BLOCKED |
| 7 | mega:mega-1000-mnq-m5-20260817b:opening_range_breakout_long:v020 | opening_range_breakout_long | 20 | 0.9153 | PASS | 4 | 6.044 | 6.8817 | BLOCKED |
| 8 | mega:mega-1000-mnq-m5-20260817b:prior_close_reject_short:v005 | prior_close_reject_short | 5 | 0.9135 | PASS | 4 | 5.9006 | 6.7572 | BLOCKED |
| 9 | mega:mega-1000-mnq-m5-20260817b:opening_range_breakout_short:v037 | opening_range_breakout_short | 37 | 0.9079 | PASS | 2 | 4.6296 | n/a | BLOCKED |
| 10 | mega:mega-1000-mnq-m5-20260817b:vwap_proxy_reject_short:v015 | vwap_proxy_reject_short | 15 | 0.9074 | PASS | 4 | 5.4167 | 6.2789 | BLOCKED |
| 11 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_short:v009 | vwap_deviation_fade_short | 9 | 0.9063 | PASS | 2 | 4.5027 | n/a | BLOCKED |
| 12 | mega:mega-1000-mnq-m5-20260817b:previous_day_mid_reject_short:v026 | previous_day_mid_reject_short | 26 | 0.9055 | PASS | 2 | 4.442 | n/a | BLOCKED |
| 13 | mega:mega-1000-mnq-m5-20260817b:previous_day_high_reclaim:v020 | previous_day_high_reclaim | 20 | 0.9015 | PASS | 2 | 4.1226 | n/a | BLOCKED |
| 14 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_short:v026 | vwap_deviation_fade_short | 26 | 0.9011 | PASS | 2 | 4.0898 | n/a | BLOCKED |
| 15 | mega:mega-1000-mnq-m5-20260817b:ny_opening_drive_short:v017 | ny_opening_drive_short | 17 | 0.9004 | PASS | 2 | 4.0309 | n/a | BLOCKED |
| 16 | mega:mega-1000-mnq-m5-20260817b:opening_range_breakout_short:v005 | opening_range_breakout_short | 5 | 0.8985 | PASS | 4 | 3.8816 | n/a | BLOCKED |
| 17 | mega:mega-1000-mnq-m5-20260817b:prior_close_reject_short:v045 | prior_close_reject_short | 45 | 0.8945 | PASS | 4 | 4.3791 | 5.2727 | BLOCKED |
| 18 | mega:mega-1000-mnq-m5-20260817b:vwap_proxy_reclaim_long:v038 | vwap_proxy_reclaim_long | 38 | 0.8943 | PASS | 3 | 4.3615 | 5.2477 | BLOCKED |
| 19 | mega:mega-1000-mnq-m5-20260817b:asia_range_breakout_short:v015 | asia_range_breakout_short | 15 | 0.8921 | PASS | 4 | 3.3646 | n/a | BLOCKED |
| 20 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_short:v039 | vwap_deviation_fade_short | 39 | 0.8894 | PASS | 3 | 3.1506 | n/a | BLOCKED |
| 21 | mega:mega-1000-mnq-m5-20260817b:ny_opening_drive_long:v040 | ny_opening_drive_long | 40 | 0.8892 | PASS | 2 | 3.1353 | n/a | BLOCKED |
| 22 | mega:mega-1000-mnq-m5-20260817b:asia_range_breakout_long:v040 | asia_range_breakout_long | 40 | 0.8855 | PASS | 2 | 2.8418 | n/a | BLOCKED |
| 23 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_long:v044 | vwap_deviation_fade_long | 44 | 0.8852 | PASS | 2 | 2.8132 | n/a | BLOCKED |
| 24 | mega:mega-1000-mnq-m5-20260817b:asia_range_breakout_long:v026 | asia_range_breakout_long | 26 | 0.8852 | PASS | 3 | 2.812 | n/a | BLOCKED |
| 25 | mega:mega-1000-mnq-m5-20260817b:previous_day_mid_reclaim_long:v021 | previous_day_mid_reclaim_long | 21 | 0.8848 | PASS | 3 | 3.614 | 4.4979 | BLOCKED |
| 26 | mega:mega-1000-mnq-m5-20260817b:opening_range_breakout_short:v004 | opening_range_breakout_short | 4 | 0.8821 | PASS | 4 | 4.215 | 3.0485 | BLOCKED |
| 27 | mega:mega-1000-mnq-m5-20260817b:ny_opening_drive_long:v024 | ny_opening_drive_long | 24 | 0.8821 | PASS | 3 | 3.3876 | 4.2957 | BLOCKED |
| 28 | mega:mega-1000-mnq-m5-20260817b:compression_breakout_short:v005 | compression_breakout_short | 5 | 0.8792 | PASS | 2 | 2.337 | n/a | BLOCKED |
| 29 | mega:mega-1000-mnq-m5-20260817b:previous_day_low_break:v013 | previous_day_low_break | 13 | 0.8791 | PASS | 3 | 3.1507 | 4.0628 | BLOCKED |
| 30 | mega:mega-1000-mnq-m5-20260817b:prior_close_reject_short:v015 | prior_close_reject_short | 15 | 0.8779 | PASS | 3 | 3.0533 | 3.9751 | BLOCKED |
| 31 | mega:mega-1000-mnq-m5-20260817b:vwap_proxy_reclaim_long:v025 | vwap_proxy_reclaim_long | 25 | 0.8774 | PASS | 3 | 3.015 | 3.9181 | BLOCKED |
| 32 | mega:mega-1000-mnq-m5-20260817b:previous_day_mid_reclaim_long:v012 | previous_day_mid_reclaim_long | 12 | 0.8755 | PASS | 2 | 2.0427 | n/a | BLOCKED |
| 33 | mega:mega-1000-mnq-m5-20260817b:previous_day_mid_reject_short:v009 | previous_day_mid_reject_short | 9 | 0.8724 | PASS | 2 | 1.7928 | n/a | BLOCKED |
| 34 | mega:mega-1000-mnq-m5-20260817b:vwap_deviation_fade_long:v014 | vwap_deviation_fade_long | 14 | 0.8713 | PASS | 2 | 1.7046 | n/a | BLOCKED |
| 35 | mega:mega-1000-mnq-m5-20260817b:asia_range_breakout_long:v024 | asia_range_breakout_long | 24 | 0.8697 | PASS | 3 | 1.5747 | n/a | BLOCKED |
| 36 | mega:mega-1000-mnq-m5-20260817b:previous_day_mid_reclaim_long:v014 | previous_day_mid_reclaim_long | 14 | 0.869 | PASS | 2 | 1.5229 | n/a | BLOCKED |
| 37 | mega:mega-1000-mnq-m5-20260817b:opening_range_breakout_short:v049 | opening_range_breakout_short | 49 | 0.869 | PASS | 2 | 1.5177 | n/a | BLOCKED |
| 38 | mega:mega-1000-mnq-m5-20260817b:previous_day_mid_reject_short:v049 | previous_day_mid_reject_short | 49 | 0.8679 | PASS | 2 | 1.4316 | n/a | BLOCKED |
| 39 | mega:mega-1000-mnq-m5-20260817b:opening_range_breakout_short:v033 | opening_range_breakout_short | 33 | 0.8612 | PASS | 2 | 0.8989 | n/a | BLOCKED |
| 40 | mega:mega-1000-mnq-m5-20260817b:previous_day_low_break:v049 | previous_day_low_break | 49 | 0.8606 | PASS | 3 | 1.6727 | 2.6298 | BLOCKED |
| 41 | mega:mega-1000-mnq-m5-20260817b:previous_day_mid_reclaim_long:v040 | previous_day_mid_reclaim_long | 40 | 0.8604 | PASS | 2 | 0.8302 | n/a | BLOCKED |

## Safety note

This cohort report is research-only. It retains every candidate that passed ROBUSTNESS, but it does not authorize live execution, broker submission, or automatic promotion.
