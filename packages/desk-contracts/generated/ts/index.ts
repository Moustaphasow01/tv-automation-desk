/* Generated from packages/desk-contracts/schemas. Do not edit manually. */



export const SESSION_VALUES = ["asia_open","asia_to_london","ny_open","custom"] as const;
export type SESSION_VALUESValue = typeof SESSION_VALUES[number];

export const VNEXT_SESSIONS = ["asia_open","london_session","ny_open","work_forward","post_event_replan"] as const;
export type VNEXT_SESSIONSValue = typeof VNEXT_SESSIONS[number];

export const DECISION_SESSIONS = ["asia_open","asia_to_london","ny_open"] as const;
export type DECISION_SESSIONSValue = typeof DECISION_SESSIONS[number];

export const DESK_INSTRUMENTS = ["MNQ","NQ","MES","ES","WAIT"] as const;
export type DESK_INSTRUMENTSValue = typeof DESK_INSTRUMENTS[number];

export const TRADE_INSTRUMENTS = ["MNQ","NQ","MES","ES"] as const;
export type TRADE_INSTRUMENTSValue = typeof TRADE_INSTRUMENTS[number];

export const THESIS_STATUSES = ["NO_ACTIVE_THESIS","THESIS_ACTIVE","THESIS_CONDITIONAL","WAIT_MONITORED","THESIS_WEAKENED","THESIS_AT_RISK","THESIS_INVALIDATED","SETUP_ARMED","SETUP_TRIGGERED","REPLAN_REQUIRED","EXPIRED"] as const;
export type THESIS_STATUSESValue = typeof THESIS_STATUSES[number];

export const ANALYSIS_TYPES = ["asia_open","london_session","ny_open","work_forward","live_position","post_event_replan","position_monitor","weekly_brief","daily_brief"] as const;
export type ANALYSIS_TYPESValue = typeof ANALYSIS_TYPES[number];

export const DATASETS = ["MNQ_M1","MES_M1","MNQ_M5","MES_M5","NQ_M15","NQ_H1","ES_M15","ES_H1","MNQ_H4","MES_H4","NQ_H4","ES_H4","US10Y_US02Y","US10Y_US02Y_H4","DXY_CL_GC_VIX","DXY_CL_GC_VIX_H4","indices_asie_europe","indices_asie_europe_H4","ny_close_mega_caps","mega_caps_premarket","mega_caps_premarket_H4","macro_calendar","news_digest"] as const;
export type DATASETSValue = typeof DATASETS[number];

export const CONTRACT_MODES_V2 = ["LIVE","REPLAY","BACK_FORWARD","PAPER"] as const;
export type CONTRACT_MODES_V2Value = typeof CONTRACT_MODES_V2[number];

export const ANALYSIS_PHASES_V2 = ["ASIA_OPEN","LONDON_HANDOFF","NY_OPEN","WORK_FORWARD","POST_EVENT_REPLAN"] as const;
export type ANALYSIS_PHASES_V2Value = typeof ANALYSIS_PHASES_V2[number];

export const OPPORTUNITY_PROFILES = ["OPPORTUNITY_SEEKING_CONTROLLED"] as const;
export type OPPORTUNITY_PROFILESValue = typeof OPPORTUNITY_PROFILES[number];

export const PLAN_DISPOSITIONS = ["SETUP_READY","SETUP_CONDITIONAL","WAIT_BETTER_PRICE","WAIT_NO_SETUP","MANAGEMENT_ONLY","FORBIDDEN","REPLAN_REQUIRED"] as const;
export type PLAN_DISPOSITIONSValue = typeof PLAN_DISPOSITIONS[number];

export const TRADING_PERMISSIONS = ["ENTRIES_ALLOWED","REDUCED_RISK_ONLY","MANAGEMENT_ONLY","ENTRIES_BLOCKED"] as const;
export type TRADING_PERMISSIONSValue = typeof TRADING_PERMISSIONS[number];

export const GLOBAL_REGIME_CODES = ["RISK_ON_EXPANSION","RISK_OFF_STRESS","TECH_ROTATION","BROAD_MARKET_ROTATION","COMPRESSION","RANGE","EXHAUSTION","NEUTRAL"] as const;
export type GLOBAL_REGIME_CODESValue = typeof GLOBAL_REGIME_CODES[number];

export const REGIME_STATUSES = ["DOMINANT","SECONDARY","ELIMINATED","UNCONFIRMED"] as const;
export type REGIME_STATUSESValue = typeof REGIME_STATUSES[number];

export const HYPOTHESIS_KINDS = ["BULL","BEAR","RANGE","BEST_LONG","BEST_SHORT","WAIT"] as const;
export type HYPOTHESIS_KINDSValue = typeof HYPOTHESIS_KINDS[number];

export const HYPOTHESIS_STATUSES = ["DOMINANT","CANDIDATE","CONDITIONAL","ELIMINATED","WAIT_PROVED"] as const;
export type HYPOTHESIS_STATUSESValue = typeof HYPOTHESIS_STATUSES[number];

export const BIAS_VALUES = ["BULLISH","BEARISH","NEUTRAL","MIXED","UNKNOWN"] as const;
export type BIAS_VALUESValue = typeof BIAS_VALUES[number];

export const EXECUTION_TIMEFRAMES = ["M1","M5","M15","H1","H4"] as const;
export type EXECUTION_TIMEFRAMESValue = typeof EXECUTION_TIMEFRAMES[number];

export const THESIS_STATES_V2 = ["NO_ACTIVE","WAIT_MONITORED","CONDITIONAL","ACTIVE","WEAKENED","AT_RISK","POST_EVENT","INVALIDATED","EXPIRED","REPLAN_REQUIRED","SUPERSEDED"] as const;
export type THESIS_STATES_V2Value = typeof THESIS_STATES_V2[number];

export const SETUP_STATES_V1 = ["NONE","SETUP_CANDIDATE","PRE_ARMED","ARMED_CONDITIONAL","TRIGGERED","CANCELLED","EXPIRED","INVALIDATED","REPLACED"] as const;
export type SETUP_STATES_V1Value = typeof SETUP_STATES_V1[number];

export const POSITION_STATES_V1 = ["NONE","PENDING_SUBMISSION","OPEN","PROTECTED","PARTIAL_TAKEN","CLOSED","STOPPED","CANCELLED","REVIEW_REQUIRED"] as const;
export type POSITION_STATES_V1Value = typeof POSITION_STATES_V1[number];

export const REPLAN_STATES_V1 = ["IDLE","REQUESTED","QUEUED","IN_PROGRESS","COMPLETED","FAILED","CANCELLED"] as const;
export type REPLAN_STATES_V1Value = typeof REPLAN_STATES_V1[number];

export const THESIS_COMMAND_TYPES_V1 = ["NOOP","CREATE_WAIT","MAKE_CONDITIONAL","ACTIVATE","MAINTAIN","WEAKEN","MARK_AT_RISK","MARK_POST_EVENT","INVALIDATE","EXPIRE","REQUIRE_REPLAN","SUPERSEDE"] as const;
export type THESIS_COMMAND_TYPES_V1Value = typeof THESIS_COMMAND_TYPES_V1[number];

export const SETUP_COMMAND_TYPES_V1 = ["NOOP","UPSERT_CANDIDATE","PRE_ARM","ARM","CANCEL","EXPIRE","INVALIDATE","REPLACE"] as const;
export type SETUP_COMMAND_TYPES_V1Value = typeof SETUP_COMMAND_TYPES_V1[number];

export const SETUP_ENGINE_COMMAND_TYPES_V1 = ["NOOP","ENGINE_TRIGGER"] as const;
export type SETUP_ENGINE_COMMAND_TYPES_V1Value = typeof SETUP_ENGINE_COMMAND_TYPES_V1[number];

export const POSITION_REQUEST_TYPES_V1 = ["NONE","REDUCE_RISK","MOVE_STOP_BE","TAKE_PARTIAL","EXIT_POSITION"] as const;
export type POSITION_REQUEST_TYPES_V1Value = typeof POSITION_REQUEST_TYPES_V1[number];

export const POSITION_EVENT_TYPES_V1 = ["NOOP","SUBMISSION_ACCEPTED","FILL_CONFIRMED","PROTECTION_CONFIRMED","PARTIAL_FILL_CONFIRMED","CLOSE_CONFIRMED","STOP_FILL_CONFIRMED","CANCEL_CONFIRMED","MARK_REVIEW_REQUIRED","RECONCILIATION_RECOVERED"] as const;
export type POSITION_EVENT_TYPES_V1Value = typeof POSITION_EVENT_TYPES_V1[number];

export const REPLAN_REQUEST_TYPES_V1 = ["NOOP","REQUEST"] as const;
export type REPLAN_REQUEST_TYPES_V1Value = typeof REPLAN_REQUEST_TYPES_V1[number];

export const REPLAN_EVENT_TYPES_V1 = ["NOOP","REQUEST","QUEUE","START","COMPLETE","FAIL","RETRY","CANCEL","RESET"] as const;
export type REPLAN_EVENT_TYPES_V1Value = typeof REPLAN_EVENT_TYPES_V1[number];

export const SETUP_PATTERN_CODES = ["PULLBACK","BREAKOUT_RETEST","BREAKDOWN_RETEST","REJECTION","SWEEP_RECLAIM","RANGE_ROTATION","FAKEOUT_REVERSAL","CONTINUATION"] as const;
export type SETUP_PATTERN_CODESValue = typeof SETUP_PATTERN_CODES[number];

export const ORDER_TYPES_V2 = ["MARKET","LIMIT","STOP","STOP_LIMIT"] as const;
export type ORDER_TYPES_V2Value = typeof ORDER_TYPES_V2[number];

export const ENTRY_MODES = ["NEXT_BAR_MARKET_AFTER_CONFIRMATION","RETEST_ZONE_AFTER_CONFIRMATION","STOP_CROSS","LIMIT_TOUCH"] as const;
export type ENTRY_MODESValue = typeof ENTRY_MODES[number];

export const STOP_TYPES = ["STRUCTURAL","ATR","HYBRID"] as const;
export type STOP_TYPESValue = typeof STOP_TYPES[number];

export const PREDICATE_TYPES_V1 = ["PRICE_RELATION","PRICE_CROSS","ZONE_TOUCH","BREAKOUT_CLOSE","BREAK_RETEST_SEQUENCE","REJECTION_PATTERN","VWAP_RELATION","RSI_THRESHOLD","TIME_WINDOW","INTERMARKET_CONFIRMATION","EVENT_BLACKOUT"] as const;
export type PREDICATE_TYPES_V1Value = typeof PREDICATE_TYPES_V1[number];

export const CONDITION_ROLES = ["ACTIVATION","CONFIRMATION","INVALIDATION","VETO"] as const;
export type CONDITION_ROLESValue = typeof CONDITION_ROLES[number];

export const CONDITION_EFFECTS = ["REQUIRE_TRUE","BLOCK_IF_TRUE"] as const;
export type CONDITION_EFFECTSValue = typeof CONDITION_EFFECTS[number];

export const CONDITION_OPERATORS_V2 = ["CLOSE_ABOVE","CLOSE_BELOW","CROSS_ABOVE","CROSS_BELOW","TOUCH_ABOVE","TOUCH_BELOW","REJECT_ABOVE","REJECT_BELOW","REJECT_RESISTANCE","REJECT_SUPPORT","WITHIN_WINDOW","OUTSIDE_WINDOW","ALIGNS_WITH","DIVERGES_FROM","EVENT_ACTIVE","EVENT_CLEAR"] as const;
export type CONDITION_OPERATORS_V2Value = typeof CONDITION_OPERATORS_V2[number];

export const CONDITION_IMPORTANCE_VALUES = ["HARD_BLOCKER","MANDATORY","PRIMARY","SECONDARY","OPTIONAL","ADVISORY"] as const;
export type CONDITION_IMPORTANCE_VALUESValue = typeof CONDITION_IMPORTANCE_VALUES[number];

export const CONDITION_MEMORY_POLICIES = ["LATCH_UNTIL_TRIGGER","LATEST_ONLY","INVALIDATE_TERMINAL"] as const;
export type CONDITION_MEMORY_POLICIESValue = typeof CONDITION_MEMORY_POLICIES[number];

export const CONDITION_TEMPORAL_MODES = ["LATEST_CLOSED","ANY_SINCE_ARM","CONSECUTIVE_CLOSED","CROSS_AFTER_ARM"] as const;
export type CONDITION_TEMPORAL_MODESValue = typeof CONDITION_TEMPORAL_MODES[number];

export const CONDITION_STATES_V1 = ["NOT_STARTED","PENDING","SATISFIED","FAILED","INVALIDATED","EXPIRED","UNKNOWN"] as const;
export type CONDITION_STATES_V1Value = typeof CONDITION_STATES_V1[number];

export const GATE_SEVERITIES = ["HARD","SOFT"] as const;
export type GATE_SEVERITIESValue = typeof GATE_SEVERITIES[number];

export const GATE_STATES = ["PASS","FAIL","UNKNOWN","NOT_APPLICABLE"] as const;
export type GATE_STATESValue = typeof GATE_STATES[number];

export const GATE_EFFECTS = ["BLOCK_ENTRY","REDUCE_RISK","REQUIRE_CONFIRMATION","INFORMATIONAL"] as const;
export type GATE_EFFECTSValue = typeof GATE_EFFECTS[number];

export const GATE_ENFORCEMENT_PHASES = ["PLAN_COMPILE","SETUP_ARM","ENTRY_TRIGGER","BROKER_SUBMIT"] as const;
export type GATE_ENFORCEMENT_PHASESValue = typeof GATE_ENFORCEMENT_PHASES[number];

export const GATE_PASS_SEMANTICS = ["FAILURE_ABSENT"] as const;
export type GATE_PASS_SEMANTICSValue = typeof GATE_PASS_SEMANTICS[number];

export const PREDICATE_PARAMETER_TYPES = ["NUMBER","POSITIVE_INTEGER","BOOLEAN","IDENTIFIER","TIME_OF_DAY","INSTRUMENT_REF"] as const;
export type PREDICATE_PARAMETER_TYPESValue = typeof PREDICATE_PARAMETER_TYPES[number];

export const PREDICATE_PARAMETER_UNITS = ["PRICE","POINTS","BARS","PERIODS","BOOLEAN","IDENTIFIER","TIME_PARIS","SYMBOL","NONE"] as const;
export type PREDICATE_PARAMETER_UNITSValue = typeof PREDICATE_PARAMETER_UNITS[number];

export const PREDICATE_PARAMETER_SOURCES = ["GPT_PINNED","PACK_REFERENCE","CONDITION_REFERENCE","POLICY"] as const;
export type PREDICATE_PARAMETER_SOURCESValue = typeof PREDICATE_PARAMETER_SOURCES[number];

export const PREDICATE_SOURCE_KINDS = ["OHLC_CANDLES","SESSION_SNAPSHOT","TECHNICAL_INDICATOR","CLOCK","INTERMARKET_SNAPSHOT","MACRO_CALENDAR","CONDITION_MEMORY"] as const;
export type PREDICATE_SOURCE_KINDSValue = typeof PREDICATE_SOURCE_KINDS[number];

export const PREDICATE_EVALUATION_FIELDS = ["close","high_low","ohlc_pattern","indicator_value","clock","intermarket","event"] as const;
export type PREDICATE_EVALUATION_FIELDSValue = typeof PREDICATE_EVALUATION_FIELDS[number];

export const HARD_GATE_CODES_V5 = ["ANTI_LOOKAHEAD_FAILED","SCOPE_CONTRACT_MISMATCH","CANONICAL_TRIGGER_DATA_MISSING","GEOMETRY_INVALID","RR_BELOW_MINIMUM","STOP_INVALID","TARGET_INVALID","SETUP_EXPIRED_OR_TERMINAL","DETERMINISTIC_VETO_ACTIVE","BROKER_SAFETY_FAILED","MAJOR_EVENT_ENTRY_BLOCK","MANDATORY_INDICATOR_MISSING"] as const;
export type HARD_GATE_CODES_V5Value = typeof HARD_GATE_CODES_V5[number];

export const SOFT_GATE_CODES_V5 = ["PACK_DEGRADED","MEGA_CAPS_MISSING_FOR_NQ","PRICE_MID_RANGE","CROSS_ASSET_PARTIAL","MACRO_NEUTRAL","NQ_ES_DIVERGENCE","HIGH_VOLATILITY","LEVEL_CONSUMED","CONTEXTUAL_DATA_GAP","OPTIONAL_INDICATOR_MISSING"] as const;
export type SOFT_GATE_CODES_V5Value = typeof SOFT_GATE_CODES_V5[number];

export const THESIS_HEALTH_STATES_V2 = ["STRONG","VALID","FRAGILE","VERY_FRAGILE","NON_EXECUTABLE"] as const;
export type THESIS_HEALTH_STATES_V2Value = typeof THESIS_HEALTH_STATES_V2[number];

export const TARGET_ACTIONS_V2 = ["PARTIAL_CLOSE","MOVE_STOP_BE","TRAIL","FULL_CLOSE","RUNNER"] as const;
export type TARGET_ACTIONS_V2Value = typeof TARGET_ACTIONS_V2[number];

export const ALERT_LEVELS_V2 = ["INFO","WATCH","WARNING","ACTION","CRITICAL"] as const;
export type ALERT_LEVELS_V2Value = typeof ALERT_LEVELS_V2[number];

export const catalogs = {
  "condition-catalog-v1-1.json": {
    "contract_name": "DeskConditionCatalogContract",
    "schema_version": "1.1.0",
    "catalog_id": "condition_catalog_v1_1",
    "profile": "OPPORTUNITY_SEEKING_CONTROLLED",
    "profile_defaults": {
      "min_weighted_confirmation_ratio": 0.55,
      "max_risk_pct": 0.25,
      "min_rr": 2,
      "hard_gate_policy": "FAIL_CLOSED",
      "contextual_gap_policy": "SOFT_REQUIRE_CONFIRMATION"
    },
    "condition_roles": [
      "ACTIVATION",
      "CONFIRMATION",
      "INVALIDATION",
      "VETO"
    ],
    "condition_effects": [
      "REQUIRE_TRUE",
      "BLOCK_IF_TRUE"
    ],
    "operators": [
      {
        "code": "CLOSE_ABOVE",
        "field": "close",
        "description": "Dernière clôture éligible au-dessus du seuil."
      },
      {
        "code": "CLOSE_BELOW",
        "field": "close",
        "description": "Dernière clôture éligible sous le seuil."
      },
      {
        "code": "CROSS_ABOVE",
        "field": "close",
        "description": "Croisement haussier du seuil après armement."
      },
      {
        "code": "CROSS_BELOW",
        "field": "close",
        "description": "Croisement baissier du seuil après armement."
      },
      {
        "code": "TOUCH_ABOVE",
        "field": "high_low",
        "description": "Le plus haut touche ou dépasse le seuil."
      },
      {
        "code": "TOUCH_BELOW",
        "field": "high_low",
        "description": "Le plus bas touche ou traverse le seuil."
      },
      {
        "code": "REJECT_ABOVE",
        "field": "ohlc_pattern",
        "description": "Test au-dessus puis clôture de rejet sous le seuil."
      },
      {
        "code": "REJECT_BELOW",
        "field": "ohlc_pattern",
        "description": "Test sous le seuil puis clôture de rejet au-dessus."
      },
      {
        "code": "REJECT_RESISTANCE",
        "field": "ohlc_pattern",
        "description": "Rejet déterministe d’une résistance référencée."
      },
      {
        "code": "REJECT_SUPPORT",
        "field": "ohlc_pattern",
        "description": "Rejet déterministe d’un support référencé."
      },
      {
        "code": "WITHIN_WINDOW",
        "field": "clock",
        "description": "Le checkpoint est inclus dans la fenêtre autorisée."
      },
      {
        "code": "OUTSIDE_WINDOW",
        "field": "clock",
        "description": "Le checkpoint est hors de la fenêtre définie."
      },
      {
        "code": "ALIGNS_WITH",
        "field": "intermarket",
        "description": "L’instrument de confirmation est aligné avec le scénario."
      },
      {
        "code": "DIVERGES_FROM",
        "field": "intermarket",
        "description": "L’instrument de confirmation diverge du scénario."
      },
      {
        "code": "EVENT_ACTIVE",
        "field": "event",
        "description": "Une fenêtre événementielle bloquante est active."
      },
      {
        "code": "EVENT_CLEAR",
        "field": "event",
        "description": "Aucune fenêtre événementielle bloquante n’est active."
      }
    ],
    "predicate_types": [
      {
        "code": "PRICE_RELATION",
        "required_parameters": [
          "threshold"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Prix de référence explicite du plan."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Bougie canonique clôturée de l’instrument."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_price_relation"
      },
      {
        "code": "PRICE_CROSS",
        "required_parameters": [
          "threshold"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Prix traversé après armement."
          }
        ],
        "allowed_operators": [
          "CROSS_ABOVE",
          "CROSS_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Deux clôtures canoniques consécutives au minimum."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": true,
        "backend_evaluator": "evaluate_price_cross"
      },
      {
        "code": "ZONE_TOUCH",
        "required_parameters": [
          "zone_lower",
          "zone_upper"
        ],
        "parameter_definitions": [
          {
            "name": "zone_lower",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Borne basse inclusive."
          },
          {
            "name": "zone_upper",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Borne haute inclusive."
          }
        ],
        "allowed_operators": [
          "TOUCH_ABOVE",
          "TOUCH_BELOW"
        ],
        "evaluation_field": "high_low",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "High/low canoniques de la bougie clôturée."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_zone_touch"
      },
      {
        "code": "BREAKOUT_CLOSE",
        "required_parameters": [
          "threshold"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Niveau que la clôture doit casser."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Clôture canonique, jamais une mèche seule."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_breakout_close"
      },
      {
        "code": "BREAK_RETEST_SEQUENCE",
        "required_parameters": [
          "break_condition_id",
          "retest_level",
          "tolerance_points",
          "max_bars",
          "require_rejection_confirmation"
        ],
        "parameter_definitions": [
          {
            "name": "break_condition_id",
            "type": "IDENTIFIER",
            "unit": "IDENTIFIER",
            "source": "CONDITION_REFERENCE",
            "description": "Condition de cassure antérieure dans le même plan."
          },
          {
            "name": "retest_level",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Niveau déterministe du retest."
          },
          {
            "name": "tolerance_points",
            "type": "NUMBER",
            "unit": "POINTS",
            "source": "GPT_PINNED",
            "description": "Tolérance non négative autour du niveau."
          },
          {
            "name": "max_bars",
            "type": "POSITIVE_INTEGER",
            "unit": "BARS",
            "source": "GPT_PINNED",
            "description": "Fenêtre maximale après cassure."
          },
          {
            "name": "require_rejection_confirmation",
            "type": "BOOLEAN",
            "unit": "BOOLEAN",
            "source": "GPT_PINNED",
            "description": "Impose ou non une clôture de rejet."
          }
        ],
        "allowed_operators": [
          "REJECT_ABOVE",
          "REJECT_BELOW",
          "REJECT_RESISTANCE",
          "REJECT_SUPPORT"
        ],
        "evaluation_field": "ohlc_pattern",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Séquence de bougies canoniques depuis l’armement."
          },
          {
            "source_code": "CONDITION_MEMORY",
            "kind": "CONDITION_MEMORY",
            "required": true,
            "description": "État et heure de la cassure référencée."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": true,
        "backend_evaluator": "evaluate_break_retest_sequence"
      },
      {
        "code": "REJECTION_PATTERN",
        "required_parameters": [
          "threshold",
          "tolerance_points"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Niveau rejeté."
          },
          {
            "name": "tolerance_points",
            "type": "NUMBER",
            "unit": "POINTS",
            "source": "GPT_PINNED",
            "description": "Tolérance non négative."
          }
        ],
        "allowed_operators": [
          "REJECT_ABOVE",
          "REJECT_BELOW",
          "REJECT_RESISTANCE",
          "REJECT_SUPPORT"
        ],
        "evaluation_field": "ohlc_pattern",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "OHLC canonique nécessaire au rejet."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_rejection_pattern"
      },
      {
        "code": "VWAP_RELATION",
        "required_parameters": [
          "reference_code"
        ],
        "parameter_definitions": [
          {
            "name": "reference_code",
            "type": "IDENTIFIER",
            "unit": "IDENTIFIER",
            "source": "PACK_REFERENCE",
            "description": "Référence VWAP explicite du snapshot, par exemple SESSION_VWAP."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Clôture canonique comparée."
          },
          {
            "source_code": "SESSION_VWAP",
            "kind": "SESSION_SNAPSHOT",
            "required": true,
            "description": "Valeur VWAP correspondant à reference_code et au cutoff."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_vwap_relation"
      },
      {
        "code": "RSI_THRESHOLD",
        "required_parameters": [
          "threshold",
          "indicator_period"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "NONE",
            "source": "GPT_PINNED",
            "description": "Seuil RSI entre 0 et 100, vérifié par le backend."
          },
          {
            "name": "indicator_period",
            "type": "POSITIVE_INTEGER",
            "unit": "PERIODS",
            "source": "GPT_PINNED",
            "description": "Période du RSI épinglée."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW",
          "CROSS_ABOVE",
          "CROSS_BELOW"
        ],
        "evaluation_field": "indicator_value",
        "source_requirements": [
          {
            "source_code": "RSI_SERIES",
            "kind": "TECHNICAL_INDICATOR",
            "required": true,
            "description": "Série RSI canonique du timeframe demandé."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": true,
        "backend_evaluator": "evaluate_rsi_threshold"
      },
      {
        "code": "TIME_WINDOW",
        "required_parameters": [
          "window_start_paris",
          "window_end_paris"
        ],
        "parameter_definitions": [
          {
            "name": "window_start_paris",
            "type": "TIME_OF_DAY",
            "unit": "TIME_PARIS",
            "source": "GPT_PINNED",
            "description": "Début inclusif en heure de Paris."
          },
          {
            "name": "window_end_paris",
            "type": "TIME_OF_DAY",
            "unit": "TIME_PARIS",
            "source": "GPT_PINNED",
            "description": "Fin exclusive en heure de Paris."
          }
        ],
        "allowed_operators": [
          "WITHIN_WINDOW",
          "OUTSIDE_WINDOW"
        ],
        "evaluation_field": "clock",
        "source_requirements": [
          {
            "source_code": "PARIS_CLOCK",
            "kind": "CLOCK",
            "required": true,
            "description": "Horloge du checkpoint en Europe/Paris."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_time_window"
      },
      {
        "code": "INTERMARKET_CONFIRMATION",
        "required_parameters": [
          "reference_instrument"
        ],
        "parameter_definitions": [
          {
            "name": "reference_instrument",
            "type": "INSTRUMENT_REF",
            "unit": "SYMBOL",
            "source": "PACK_REFERENCE",
            "description": "Instrument de confirmation présent dans le pack épinglé."
          }
        ],
        "allowed_operators": [
          "ALIGNS_WITH",
          "DIVERGES_FROM"
        ],
        "evaluation_field": "intermarket",
        "source_requirements": [
          {
            "source_code": "REFERENCE_INSTRUMENT_SNAPSHOT",
            "kind": "INTERMARKET_SNAPSHOT",
            "required": true,
            "description": "Snapshot canonique de reference_instrument au même cutoff."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_intermarket_confirmation"
      },
      {
        "code": "EVENT_BLACKOUT",
        "required_parameters": [
          "event_window_ref"
        ],
        "parameter_definitions": [
          {
            "name": "event_window_ref",
            "type": "IDENTIFIER",
            "unit": "IDENTIFIER",
            "source": "PACK_REFERENCE",
            "description": "Identifiant immuable de la fenêtre événementielle du calendrier."
          }
        ],
        "allowed_operators": [
          "EVENT_ACTIVE",
          "EVENT_CLEAR"
        ],
        "evaluation_field": "event",
        "source_requirements": [
          {
            "source_code": "MACRO_EVENT_WINDOW",
            "kind": "MACRO_CALENDAR",
            "required": true,
            "description": "Fenêtre calendrier référencée par event_window_ref."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_event_blackout"
      }
    ],
    "importance_values": [
      "HARD_BLOCKER",
      "MANDATORY",
      "PRIMARY",
      "SECONDARY",
      "OPTIONAL",
      "ADVISORY"
    ],
    "memory_policies": [
      "LATCH_UNTIL_TRIGGER",
      "LATEST_ONLY",
      "INVALIDATE_TERMINAL"
    ],
    "memory_policy_semantics": {
      "LATCH_UNTIL_TRIGGER": "REQUIRE_TRUE activation or confirmation only; forbidden for BLOCK_IF_TRUE.",
      "LATEST_ONLY": "Temporary VETO and blackout/window/intermarket/volatility blocker; re-evaluated on each eligible closed M1 bar and cleared when false.",
      "INVALIDATE_TERMINAL": "Explicit structural INVALIDATION only; terminal for the setup identity."
    },
    "temporal_modes": [
      "LATEST_CLOSED",
      "ANY_SINCE_ARM",
      "CONSECUTIVE_CLOSED",
      "CROSS_AFTER_ARM"
    ],
    "hard_gates": [
      {
        "code": "ANTI_LOOKAHEAD_FAILED",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "PLAN_COMPILE",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Une donnée postérieure au cutoff a influencé le plan."
      },
      {
        "code": "SCOPE_CONTRACT_MISMATCH",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "PLAN_COMPILE",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le scope ou les contrats épinglés ne correspondent pas au travail réclamé."
      },
      {
        "code": "CANONICAL_TRIGGER_DATA_MISSING",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "La donnée canonique nécessaire au trigger déterministe est absente à l’entrée; le candidat peut exister avant cette phase."
      },
      {
        "code": "GEOMETRY_INVALID",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Entrée, stop ou objectifs sont incohérents avec la direction au moment d’armer."
      },
      {
        "code": "RR_BELOW_MINIMUM",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le RR déterministe est inférieur à 2 au moment d’armer."
      },
      {
        "code": "STOP_INVALID",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le stop est absent, non coté ou placé du mauvais côté au moment d’armer."
      },
      {
        "code": "TARGET_INVALID",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le premier objectif est absent, non coté ou placé du mauvais côté au moment d’armer."
      },
      {
        "code": "SETUP_EXPIRED_OR_TERMINAL",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le setup est expiré ou déjà terminal au trigger."
      },
      {
        "code": "DETERMINISTIC_VETO_ACTIVE",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Une condition VETO structurée est vraie selon sa règle temporelle au trigger."
      },
      {
        "code": "BROKER_SAFETY_FAILED",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "BROKER_SUBMIT",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Un contrôle broker, compte, quantité ou duplication a échoué à la soumission; il ne bloque pas la création du candidat."
      },
      {
        "code": "MAJOR_EVENT_ENTRY_BLOCK",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "La politique calendrier interdit l’entrée au trigger sans supprimer le candidat futur."
      },
      {
        "code": "MANDATORY_INDICATOR_MISSING",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Un indicateur explicitement requis pour le trigger est absent à cette phase."
      }
    ],
    "soft_gates": [
      {
        "code": "PACK_DEGRADED",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le pack est dégradé mais les données canoniques du setup restent évaluables."
      },
      {
        "code": "MEGA_CAPS_MISSING_FOR_NQ",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le contexte mégacaps NQ est manquant sans supprimer la donnée de trigger canonique."
      },
      {
        "code": "PRICE_MID_RANGE",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le prix est au milieu du range et exige une géométrie ou confirmation supérieure."
      },
      {
        "code": "CROSS_ASSET_PARTIAL",
        "severity": "SOFT",
        "effect": "REDUCE_RISK",
        "description": "Le cross-asset est partiel mais non invalidant."
      },
      {
        "code": "MACRO_NEUTRAL",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le macro est neutre et exige une confirmation technique renforcée."
      },
      {
        "code": "NQ_ES_DIVERGENCE",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "La divergence impose de sélectionner le leader ou d’attendre."
      },
      {
        "code": "HIGH_VOLATILITY",
        "severity": "SOFT",
        "effect": "REDUCE_RISK",
        "description": "La volatilité augmente la prudence sans veto automatique."
      },
      {
        "code": "LEVEL_CONSUMED",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le niveau a été consommé et exige une confirmation supplémentaire."
      },
      {
        "code": "CONTEXTUAL_DATA_GAP",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Une donnée contextuelle non canonique est absente."
      },
      {
        "code": "OPTIONAL_INDICATOR_MISSING",
        "severity": "SOFT",
        "effect": "INFORMATIONAL",
        "description": "Un indicateur non requis pour le trigger est absent."
      }
    ],
    "setup_patterns": [
      "PULLBACK",
      "BREAKOUT_RETEST",
      "BREAKDOWN_RETEST",
      "REJECTION",
      "SWEEP_RECLAIM",
      "RANGE_ROTATION",
      "FAKEOUT_REVERSAL",
      "CONTINUATION"
    ]
  },
  "condition-catalog-v1-2.json": {
    "contract_name": "DeskConditionCatalogContract",
    "schema_version": "1.2.0",
    "catalog_id": "condition_catalog_v1_2",
    "profile": "OPPORTUNITY_SEEKING_CONTROLLED",
    "profile_defaults": {
      "min_weighted_confirmation_ratio": 0.55,
      "max_risk_pct": 0.25,
      "min_rr": 2,
      "hard_gate_policy": "FAIL_CLOSED",
      "contextual_gap_policy": "SOFT_REQUIRE_CONFIRMATION"
    },
    "condition_roles": [
      "ACTIVATION",
      "CONFIRMATION",
      "INVALIDATION",
      "VETO"
    ],
    "condition_effects": [
      "REQUIRE_TRUE",
      "BLOCK_IF_TRUE"
    ],
    "operators": [
      {
        "code": "CLOSE_ABOVE",
        "field": "close",
        "description": "Dernière clôture éligible au-dessus du seuil."
      },
      {
        "code": "CLOSE_BELOW",
        "field": "close",
        "description": "Dernière clôture éligible sous le seuil."
      },
      {
        "code": "CROSS_ABOVE",
        "field": "close",
        "description": "Croisement haussier du seuil après armement."
      },
      {
        "code": "CROSS_BELOW",
        "field": "close",
        "description": "Croisement baissier du seuil après armement."
      },
      {
        "code": "TOUCH_ABOVE",
        "field": "high_low",
        "description": "Le plus haut touche ou dépasse le seuil."
      },
      {
        "code": "TOUCH_BELOW",
        "field": "high_low",
        "description": "Le plus bas touche ou traverse le seuil."
      },
      {
        "code": "REJECT_ABOVE",
        "field": "ohlc_pattern",
        "description": "Test au-dessus puis clôture de rejet sous le seuil."
      },
      {
        "code": "REJECT_BELOW",
        "field": "ohlc_pattern",
        "description": "Test sous le seuil puis clôture de rejet au-dessus."
      },
      {
        "code": "REJECT_RESISTANCE",
        "field": "ohlc_pattern",
        "description": "Rejet déterministe d’une résistance référencée."
      },
      {
        "code": "REJECT_SUPPORT",
        "field": "ohlc_pattern",
        "description": "Rejet déterministe d’un support référencé."
      },
      {
        "code": "WITHIN_WINDOW",
        "field": "clock",
        "description": "Le checkpoint est inclus dans la fenêtre autorisée."
      },
      {
        "code": "OUTSIDE_WINDOW",
        "field": "clock",
        "description": "Le checkpoint est hors de la fenêtre définie."
      },
      {
        "code": "ALIGNS_WITH",
        "field": "intermarket",
        "description": "L’instrument de confirmation est aligné avec le scénario."
      },
      {
        "code": "DIVERGES_FROM",
        "field": "intermarket",
        "description": "L’instrument de confirmation diverge du scénario."
      },
      {
        "code": "EVENT_ACTIVE",
        "field": "event",
        "description": "Une fenêtre événementielle bloquante est active."
      },
      {
        "code": "EVENT_CLEAR",
        "field": "event",
        "description": "Aucune fenêtre événementielle bloquante n’est active."
      }
    ],
    "predicate_types": [
      {
        "code": "PRICE_RELATION",
        "required_parameters": [
          "threshold"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Prix de référence explicite du plan."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Bougie canonique clôturée de l’instrument."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_price_relation"
      },
      {
        "code": "PRICE_CROSS",
        "required_parameters": [
          "threshold"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Prix traversé après armement."
          }
        ],
        "allowed_operators": [
          "CROSS_ABOVE",
          "CROSS_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Deux clôtures canoniques consécutives au minimum."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": true,
        "backend_evaluator": "evaluate_price_cross"
      },
      {
        "code": "ZONE_TOUCH",
        "required_parameters": [
          "zone_lower",
          "zone_upper"
        ],
        "parameter_definitions": [
          {
            "name": "zone_lower",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Borne basse inclusive."
          },
          {
            "name": "zone_upper",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Borne haute inclusive."
          }
        ],
        "allowed_operators": [
          "TOUCH_ABOVE",
          "TOUCH_BELOW"
        ],
        "evaluation_field": "high_low",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "High/low canoniques de la bougie clôturée."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_zone_touch"
      },
      {
        "code": "BREAKOUT_CLOSE",
        "required_parameters": [
          "threshold"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Niveau que la clôture doit casser."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Clôture canonique, jamais une mèche seule."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_breakout_close"
      },
      {
        "code": "BREAK_RETEST_SEQUENCE",
        "required_parameters": [
          "break_condition_id",
          "retest_level",
          "tolerance_points",
          "max_bars",
          "require_rejection_confirmation"
        ],
        "parameter_definitions": [
          {
            "name": "break_condition_id",
            "type": "IDENTIFIER",
            "unit": "IDENTIFIER",
            "source": "CONDITION_REFERENCE",
            "description": "Condition de cassure antérieure dans le même plan."
          },
          {
            "name": "retest_level",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Niveau déterministe du retest."
          },
          {
            "name": "tolerance_points",
            "type": "NUMBER",
            "unit": "POINTS",
            "source": "GPT_PINNED",
            "description": "Tolérance non négative autour du niveau."
          },
          {
            "name": "max_bars",
            "type": "POSITIVE_INTEGER",
            "unit": "BARS",
            "source": "GPT_PINNED",
            "description": "Fenêtre maximale après cassure."
          },
          {
            "name": "require_rejection_confirmation",
            "type": "BOOLEAN",
            "unit": "BOOLEAN",
            "source": "GPT_PINNED",
            "description": "Impose ou non une clôture de rejet."
          }
        ],
        "allowed_operators": [
          "REJECT_ABOVE",
          "REJECT_BELOW",
          "REJECT_RESISTANCE",
          "REJECT_SUPPORT"
        ],
        "evaluation_field": "ohlc_pattern",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Séquence de bougies canoniques depuis l’armement."
          },
          {
            "source_code": "CONDITION_MEMORY",
            "kind": "CONDITION_MEMORY",
            "required": true,
            "description": "État et heure de la cassure référencée."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": true,
        "backend_evaluator": "evaluate_break_retest_sequence"
      },
      {
        "code": "REJECTION_PATTERN",
        "required_parameters": [
          "threshold",
          "tolerance_points"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Niveau rejeté."
          },
          {
            "name": "tolerance_points",
            "type": "NUMBER",
            "unit": "POINTS",
            "source": "GPT_PINNED",
            "description": "Tolérance non négative."
          }
        ],
        "allowed_operators": [
          "REJECT_ABOVE",
          "REJECT_BELOW",
          "REJECT_RESISTANCE",
          "REJECT_SUPPORT"
        ],
        "evaluation_field": "ohlc_pattern",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "OHLC canonique nécessaire au rejet."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_rejection_pattern"
      },
      {
        "code": "VWAP_RELATION",
        "required_parameters": [
          "reference_code"
        ],
        "parameter_definitions": [
          {
            "name": "reference_code",
            "type": "IDENTIFIER",
            "unit": "IDENTIFIER",
            "source": "PACK_REFERENCE",
            "description": "Référence VWAP explicite du snapshot, par exemple SESSION_VWAP."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Clôture canonique comparée."
          },
          {
            "source_code": "SESSION_VWAP",
            "kind": "SESSION_SNAPSHOT",
            "required": true,
            "description": "Valeur VWAP correspondant à reference_code et au cutoff."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_vwap_relation"
      },
      {
        "code": "RSI_THRESHOLD",
        "required_parameters": [
          "threshold",
          "indicator_period"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "NONE",
            "source": "GPT_PINNED",
            "description": "Seuil RSI entre 0 et 100, vérifié par le backend."
          },
          {
            "name": "indicator_period",
            "type": "POSITIVE_INTEGER",
            "unit": "PERIODS",
            "source": "GPT_PINNED",
            "description": "Période du RSI épinglée."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW",
          "CROSS_ABOVE",
          "CROSS_BELOW"
        ],
        "evaluation_field": "indicator_value",
        "source_requirements": [
          {
            "source_code": "RSI_SERIES",
            "kind": "TECHNICAL_INDICATOR",
            "required": true,
            "description": "Série RSI canonique du timeframe demandé."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": true,
        "backend_evaluator": "evaluate_rsi_threshold"
      },
      {
        "code": "TIME_WINDOW",
        "required_parameters": [
          "window_start_paris",
          "window_end_paris"
        ],
        "parameter_definitions": [
          {
            "name": "window_start_paris",
            "type": "TIME_OF_DAY",
            "unit": "TIME_PARIS",
            "source": "GPT_PINNED",
            "description": "Début inclusif en heure de Paris."
          },
          {
            "name": "window_end_paris",
            "type": "TIME_OF_DAY",
            "unit": "TIME_PARIS",
            "source": "GPT_PINNED",
            "description": "Fin exclusive en heure de Paris."
          }
        ],
        "allowed_operators": [
          "WITHIN_WINDOW",
          "OUTSIDE_WINDOW"
        ],
        "evaluation_field": "clock",
        "source_requirements": [
          {
            "source_code": "PARIS_CLOCK",
            "kind": "CLOCK",
            "required": true,
            "description": "Horloge du checkpoint en Europe/Paris."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_time_window"
      },
      {
        "code": "INTERMARKET_CONFIRMATION",
        "required_parameters": [
          "reference_instrument"
        ],
        "parameter_definitions": [
          {
            "name": "reference_instrument",
            "type": "INSTRUMENT_REF",
            "unit": "SYMBOL",
            "source": "PACK_REFERENCE",
            "description": "Instrument de confirmation présent dans le pack épinglé."
          }
        ],
        "allowed_operators": [
          "ALIGNS_WITH",
          "DIVERGES_FROM"
        ],
        "evaluation_field": "intermarket",
        "source_requirements": [
          {
            "source_code": "REFERENCE_INSTRUMENT_SNAPSHOT",
            "kind": "INTERMARKET_SNAPSHOT",
            "required": true,
            "description": "Snapshot canonique de reference_instrument au même cutoff."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_intermarket_confirmation"
      },
      {
        "code": "EVENT_BLACKOUT",
        "required_parameters": [
          "event_window_ref"
        ],
        "parameter_definitions": [
          {
            "name": "event_window_ref",
            "type": "IDENTIFIER",
            "unit": "IDENTIFIER",
            "source": "PACK_REFERENCE",
            "description": "Identifiant immuable de la fenêtre événementielle du calendrier."
          }
        ],
        "allowed_operators": [
          "EVENT_ACTIVE",
          "EVENT_CLEAR"
        ],
        "evaluation_field": "event",
        "source_requirements": [
          {
            "source_code": "MACRO_EVENT_WINDOW",
            "kind": "MACRO_CALENDAR",
            "required": true,
            "description": "Fenêtre calendrier référencée par event_window_ref."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_event_blackout"
      }
    ],
    "importance_values": [
      "HARD_BLOCKER",
      "MANDATORY",
      "PRIMARY",
      "SECONDARY",
      "OPTIONAL",
      "ADVISORY"
    ],
    "memory_policies": [
      "LATCH_UNTIL_TRIGGER",
      "LATEST_ONLY",
      "INVALIDATE_TERMINAL"
    ],
    "memory_policy_semantics": {
      "LATCH_UNTIL_TRIGGER": "REQUIRE_TRUE activation or confirmation only; forbidden for BLOCK_IF_TRUE.",
      "LATEST_ONLY": "Temporary VETO and blackout/window/intermarket/volatility blocker; re-evaluated on each eligible closed M1 bar and cleared when false.",
      "INVALIDATE_TERMINAL": "Explicit structural INVALIDATION only; terminal for the setup identity."
    },
    "temporal_modes": [
      "LATEST_CLOSED",
      "ANY_SINCE_ARM",
      "CONSECUTIVE_CLOSED",
      "CROSS_AFTER_ARM"
    ],
    "hard_gates": [
      {
        "code": "ANTI_LOOKAHEAD_FAILED",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "PLAN_COMPILE",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Une donnée postérieure au cutoff a influencé le plan."
      },
      {
        "code": "SCOPE_CONTRACT_MISMATCH",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "PLAN_COMPILE",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le scope ou les contrats épinglés ne correspondent pas au travail réclamé."
      },
      {
        "code": "CANONICAL_TRIGGER_DATA_MISSING",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "La donnée canonique nécessaire au trigger déterministe est absente à l’entrée; le candidat peut exister avant cette phase."
      },
      {
        "code": "GEOMETRY_INVALID",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Entrée, stop ou objectifs sont incohérents avec la direction au moment d’armer."
      },
      {
        "code": "RR_BELOW_MINIMUM",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le RR déterministe est inférieur à 2 au moment d’armer."
      },
      {
        "code": "STOP_INVALID",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le stop est absent, non coté ou placé du mauvais côté au moment d’armer."
      },
      {
        "code": "TARGET_INVALID",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le premier objectif est absent, non coté ou placé du mauvais côté au moment d’armer."
      },
      {
        "code": "SETUP_EXPIRED_OR_TERMINAL",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le setup est expiré ou déjà terminal au trigger."
      },
      {
        "code": "DETERMINISTIC_VETO_ACTIVE",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Une condition VETO structurée est vraie selon sa règle temporelle au trigger."
      },
      {
        "code": "BROKER_SAFETY_FAILED",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "BROKER_SUBMIT",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Un contrôle broker, compte, quantité ou duplication a échoué à la soumission; il ne bloque pas la création du candidat."
      },
      {
        "code": "MAJOR_EVENT_ENTRY_BLOCK",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "La politique calendrier interdit l’entrée au trigger sans supprimer le candidat futur."
      },
      {
        "code": "MANDATORY_INDICATOR_MISSING",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Un indicateur explicitement requis pour le trigger est absent à cette phase."
      }
    ],
    "soft_gates": [
      {
        "code": "PACK_DEGRADED",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le pack est dégradé mais les données canoniques du setup restent évaluables."
      },
      {
        "code": "MEGA_CAPS_MISSING_FOR_NQ",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le contexte mégacaps NQ est manquant sans supprimer la donnée de trigger canonique."
      },
      {
        "code": "PRICE_MID_RANGE",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le prix est au milieu du range et exige une géométrie ou confirmation supérieure."
      },
      {
        "code": "CROSS_ASSET_PARTIAL",
        "severity": "SOFT",
        "effect": "REDUCE_RISK",
        "description": "Le cross-asset est partiel mais non invalidant."
      },
      {
        "code": "MACRO_NEUTRAL",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le macro est neutre et exige une confirmation technique renforcée."
      },
      {
        "code": "NQ_ES_DIVERGENCE",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "La divergence impose de sélectionner le leader ou d’attendre."
      },
      {
        "code": "HIGH_VOLATILITY",
        "severity": "SOFT",
        "effect": "REDUCE_RISK",
        "description": "La volatilité augmente la prudence sans veto automatique."
      },
      {
        "code": "LEVEL_CONSUMED",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le niveau a été consommé et exige une confirmation supplémentaire."
      },
      {
        "code": "CONTEXTUAL_DATA_GAP",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Une donnée contextuelle non canonique est absente."
      },
      {
        "code": "OPTIONAL_INDICATOR_MISSING",
        "severity": "SOFT",
        "effect": "INFORMATIONAL",
        "description": "Un indicateur non requis pour le trigger est absent."
      }
    ],
    "setup_patterns": [
      "PULLBACK",
      "BREAKOUT_RETEST",
      "BREAKDOWN_RETEST",
      "REJECTION",
      "SWEEP_RECLAIM",
      "RANGE_ROTATION",
      "FAKEOUT_REVERSAL",
      "CONTINUATION"
    ]
  },
  "condition-catalog-v1.json": {
    "contract_name": "DeskConditionCatalogContract",
    "schema_version": "1.0.0",
    "catalog_id": "condition_catalog_v1",
    "profile": "OPPORTUNITY_SEEKING_CONTROLLED",
    "profile_defaults": {
      "min_weighted_confirmation_ratio": 0.55,
      "max_risk_pct": 0.25,
      "min_rr": 2,
      "hard_gate_policy": "FAIL_CLOSED",
      "contextual_gap_policy": "SOFT_REQUIRE_CONFIRMATION"
    },
    "condition_roles": [
      "ACTIVATION",
      "CONFIRMATION",
      "INVALIDATION",
      "VETO"
    ],
    "condition_effects": [
      "REQUIRE_TRUE",
      "BLOCK_IF_TRUE"
    ],
    "operators": [
      {
        "code": "CLOSE_ABOVE",
        "field": "close",
        "description": "Dernière clôture éligible au-dessus du seuil."
      },
      {
        "code": "CLOSE_BELOW",
        "field": "close",
        "description": "Dernière clôture éligible sous le seuil."
      },
      {
        "code": "CROSS_ABOVE",
        "field": "close",
        "description": "Croisement haussier du seuil après armement."
      },
      {
        "code": "CROSS_BELOW",
        "field": "close",
        "description": "Croisement baissier du seuil après armement."
      },
      {
        "code": "TOUCH_ABOVE",
        "field": "high_low",
        "description": "Le plus haut touche ou dépasse le seuil."
      },
      {
        "code": "TOUCH_BELOW",
        "field": "high_low",
        "description": "Le plus bas touche ou traverse le seuil."
      },
      {
        "code": "REJECT_ABOVE",
        "field": "ohlc_pattern",
        "description": "Test au-dessus puis clôture de rejet sous le seuil."
      },
      {
        "code": "REJECT_BELOW",
        "field": "ohlc_pattern",
        "description": "Test sous le seuil puis clôture de rejet au-dessus."
      },
      {
        "code": "REJECT_RESISTANCE",
        "field": "ohlc_pattern",
        "description": "Rejet déterministe d’une résistance référencée."
      },
      {
        "code": "REJECT_SUPPORT",
        "field": "ohlc_pattern",
        "description": "Rejet déterministe d’un support référencé."
      },
      {
        "code": "WITHIN_WINDOW",
        "field": "clock",
        "description": "Le checkpoint est inclus dans la fenêtre autorisée."
      },
      {
        "code": "OUTSIDE_WINDOW",
        "field": "clock",
        "description": "Le checkpoint est hors de la fenêtre définie."
      },
      {
        "code": "ALIGNS_WITH",
        "field": "intermarket",
        "description": "L’instrument de confirmation est aligné avec le scénario."
      },
      {
        "code": "DIVERGES_FROM",
        "field": "intermarket",
        "description": "L’instrument de confirmation diverge du scénario."
      },
      {
        "code": "EVENT_ACTIVE",
        "field": "event",
        "description": "Une fenêtre événementielle bloquante est active."
      },
      {
        "code": "EVENT_CLEAR",
        "field": "event",
        "description": "Aucune fenêtre événementielle bloquante n’est active."
      }
    ],
    "predicate_types": [
      {
        "code": "PRICE_RELATION",
        "required_parameters": [
          "threshold"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Prix de référence explicite du plan."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Bougie canonique clôturée de l’instrument."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_price_relation"
      },
      {
        "code": "PRICE_CROSS",
        "required_parameters": [
          "threshold"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Prix traversé après armement."
          }
        ],
        "allowed_operators": [
          "CROSS_ABOVE",
          "CROSS_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Deux clôtures canoniques consécutives au minimum."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": true,
        "backend_evaluator": "evaluate_price_cross"
      },
      {
        "code": "ZONE_TOUCH",
        "required_parameters": [
          "zone_lower",
          "zone_upper"
        ],
        "parameter_definitions": [
          {
            "name": "zone_lower",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Borne basse inclusive."
          },
          {
            "name": "zone_upper",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Borne haute inclusive."
          }
        ],
        "allowed_operators": [
          "TOUCH_ABOVE",
          "TOUCH_BELOW"
        ],
        "evaluation_field": "high_low",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "High/low canoniques de la bougie clôturée."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_zone_touch"
      },
      {
        "code": "BREAKOUT_CLOSE",
        "required_parameters": [
          "threshold"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Niveau que la clôture doit casser."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Clôture canonique, jamais une mèche seule."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_breakout_close"
      },
      {
        "code": "BREAK_RETEST_SEQUENCE",
        "required_parameters": [
          "break_condition_id",
          "retest_level",
          "tolerance_points",
          "max_bars",
          "require_rejection_confirmation"
        ],
        "parameter_definitions": [
          {
            "name": "break_condition_id",
            "type": "IDENTIFIER",
            "unit": "IDENTIFIER",
            "source": "CONDITION_REFERENCE",
            "description": "Condition de cassure antérieure dans le même plan."
          },
          {
            "name": "retest_level",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Niveau déterministe du retest."
          },
          {
            "name": "tolerance_points",
            "type": "NUMBER",
            "unit": "POINTS",
            "source": "GPT_PINNED",
            "description": "Tolérance non négative autour du niveau."
          },
          {
            "name": "max_bars",
            "type": "POSITIVE_INTEGER",
            "unit": "BARS",
            "source": "GPT_PINNED",
            "description": "Fenêtre maximale après cassure."
          },
          {
            "name": "require_rejection_confirmation",
            "type": "BOOLEAN",
            "unit": "BOOLEAN",
            "source": "GPT_PINNED",
            "description": "Impose ou non une clôture de rejet."
          }
        ],
        "allowed_operators": [
          "REJECT_ABOVE",
          "REJECT_BELOW",
          "REJECT_RESISTANCE",
          "REJECT_SUPPORT"
        ],
        "evaluation_field": "ohlc_pattern",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Séquence de bougies canoniques depuis l’armement."
          },
          {
            "source_code": "CONDITION_MEMORY",
            "kind": "CONDITION_MEMORY",
            "required": true,
            "description": "État et heure de la cassure référencée."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": true,
        "backend_evaluator": "evaluate_break_retest_sequence"
      },
      {
        "code": "REJECTION_PATTERN",
        "required_parameters": [
          "threshold",
          "tolerance_points"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "PRICE",
            "source": "GPT_PINNED",
            "description": "Niveau rejeté."
          },
          {
            "name": "tolerance_points",
            "type": "NUMBER",
            "unit": "POINTS",
            "source": "GPT_PINNED",
            "description": "Tolérance non négative."
          }
        ],
        "allowed_operators": [
          "REJECT_ABOVE",
          "REJECT_BELOW",
          "REJECT_RESISTANCE",
          "REJECT_SUPPORT"
        ],
        "evaluation_field": "ohlc_pattern",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "OHLC canonique nécessaire au rejet."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_rejection_pattern"
      },
      {
        "code": "VWAP_RELATION",
        "required_parameters": [
          "reference_code"
        ],
        "parameter_definitions": [
          {
            "name": "reference_code",
            "type": "IDENTIFIER",
            "unit": "IDENTIFIER",
            "source": "PACK_REFERENCE",
            "description": "Référence VWAP explicite du snapshot, par exemple SESSION_VWAP."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW"
        ],
        "evaluation_field": "close",
        "source_requirements": [
          {
            "source_code": "PRIMARY_OHLC",
            "kind": "OHLC_CANDLES",
            "required": true,
            "description": "Clôture canonique comparée."
          },
          {
            "source_code": "SESSION_VWAP",
            "kind": "SESSION_SNAPSHOT",
            "required": true,
            "description": "Valeur VWAP correspondant à reference_code et au cutoff."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_vwap_relation"
      },
      {
        "code": "RSI_THRESHOLD",
        "required_parameters": [
          "threshold",
          "indicator_period"
        ],
        "parameter_definitions": [
          {
            "name": "threshold",
            "type": "NUMBER",
            "unit": "NONE",
            "source": "GPT_PINNED",
            "description": "Seuil RSI entre 0 et 100, vérifié par le backend."
          },
          {
            "name": "indicator_period",
            "type": "POSITIVE_INTEGER",
            "unit": "PERIODS",
            "source": "GPT_PINNED",
            "description": "Période du RSI épinglée."
          }
        ],
        "allowed_operators": [
          "CLOSE_ABOVE",
          "CLOSE_BELOW",
          "CROSS_ABOVE",
          "CROSS_BELOW"
        ],
        "evaluation_field": "indicator_value",
        "source_requirements": [
          {
            "source_code": "RSI_SERIES",
            "kind": "TECHNICAL_INDICATOR",
            "required": true,
            "description": "Série RSI canonique du timeframe demandé."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": true,
        "backend_evaluator": "evaluate_rsi_threshold"
      },
      {
        "code": "TIME_WINDOW",
        "required_parameters": [
          "window_start_paris",
          "window_end_paris"
        ],
        "parameter_definitions": [
          {
            "name": "window_start_paris",
            "type": "TIME_OF_DAY",
            "unit": "TIME_PARIS",
            "source": "GPT_PINNED",
            "description": "Début inclusif en heure de Paris."
          },
          {
            "name": "window_end_paris",
            "type": "TIME_OF_DAY",
            "unit": "TIME_PARIS",
            "source": "GPT_PINNED",
            "description": "Fin exclusive en heure de Paris."
          }
        ],
        "allowed_operators": [
          "WITHIN_WINDOW",
          "OUTSIDE_WINDOW"
        ],
        "evaluation_field": "clock",
        "source_requirements": [
          {
            "source_code": "PARIS_CLOCK",
            "kind": "CLOCK",
            "required": true,
            "description": "Horloge du checkpoint en Europe/Paris."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_time_window"
      },
      {
        "code": "INTERMARKET_CONFIRMATION",
        "required_parameters": [
          "reference_instrument"
        ],
        "parameter_definitions": [
          {
            "name": "reference_instrument",
            "type": "INSTRUMENT_REF",
            "unit": "SYMBOL",
            "source": "PACK_REFERENCE",
            "description": "Instrument de confirmation présent dans le pack épinglé."
          }
        ],
        "allowed_operators": [
          "ALIGNS_WITH",
          "DIVERGES_FROM"
        ],
        "evaluation_field": "intermarket",
        "source_requirements": [
          {
            "source_code": "REFERENCE_INSTRUMENT_SNAPSHOT",
            "kind": "INTERMARKET_SNAPSHOT",
            "required": true,
            "description": "Snapshot canonique de reference_instrument au même cutoff."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_intermarket_confirmation"
      },
      {
        "code": "EVENT_BLACKOUT",
        "required_parameters": [
          "event_window_ref"
        ],
        "parameter_definitions": [
          {
            "name": "event_window_ref",
            "type": "IDENTIFIER",
            "unit": "IDENTIFIER",
            "source": "PACK_REFERENCE",
            "description": "Identifiant immuable de la fenêtre événementielle du calendrier."
          }
        ],
        "allowed_operators": [
          "EVENT_ACTIVE",
          "EVENT_CLEAR"
        ],
        "evaluation_field": "event",
        "source_requirements": [
          {
            "source_code": "MACRO_EVENT_WINDOW",
            "kind": "MACRO_CALENDAR",
            "required": true,
            "description": "Fenêtre calendrier référencée par event_window_ref."
          }
        ],
        "enforcement_phase": "ENTRY_TRIGGER",
        "stateful": false,
        "backend_evaluator": "evaluate_event_blackout"
      }
    ],
    "importance_values": [
      "HARD_BLOCKER",
      "MANDATORY",
      "PRIMARY",
      "SECONDARY",
      "OPTIONAL",
      "ADVISORY"
    ],
    "memory_policies": [
      "LATCH_UNTIL_TRIGGER",
      "LATEST_ONLY",
      "INVALIDATE_TERMINAL"
    ],
    "temporal_modes": [
      "LATEST_CLOSED",
      "ANY_SINCE_ARM",
      "CONSECUTIVE_CLOSED",
      "CROSS_AFTER_ARM"
    ],
    "hard_gates": [
      {
        "code": "ANTI_LOOKAHEAD_FAILED",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "PLAN_COMPILE",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Une donnée postérieure au cutoff a influencé le plan."
      },
      {
        "code": "SCOPE_CONTRACT_MISMATCH",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "PLAN_COMPILE",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le scope ou les contrats épinglés ne correspondent pas au travail réclamé."
      },
      {
        "code": "CANONICAL_TRIGGER_DATA_MISSING",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "La donnée canonique nécessaire au trigger déterministe est absente à l’entrée; le candidat peut exister avant cette phase."
      },
      {
        "code": "GEOMETRY_INVALID",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Entrée, stop ou objectifs sont incohérents avec la direction au moment d’armer."
      },
      {
        "code": "RR_BELOW_MINIMUM",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le RR déterministe est inférieur à 2 au moment d’armer."
      },
      {
        "code": "STOP_INVALID",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le stop est absent, non coté ou placé du mauvais côté au moment d’armer."
      },
      {
        "code": "TARGET_INVALID",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "SETUP_ARM",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le premier objectif est absent, non coté ou placé du mauvais côté au moment d’armer."
      },
      {
        "code": "SETUP_EXPIRED_OR_TERMINAL",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Le setup est expiré ou déjà terminal au trigger."
      },
      {
        "code": "DETERMINISTIC_VETO_ACTIVE",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Une condition VETO structurée est vraie selon sa règle temporelle au trigger."
      },
      {
        "code": "BROKER_SAFETY_FAILED",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "BROKER_SUBMIT",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Un contrôle broker, compte, quantité ou duplication a échoué à la soumission; il ne bloque pas la création du candidat."
      },
      {
        "code": "MAJOR_EVENT_ENTRY_BLOCK",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "La politique calendrier interdit l’entrée au trigger sans supprimer le candidat futur."
      },
      {
        "code": "MANDATORY_INDICATOR_MISSING",
        "severity": "HARD",
        "effect": "BLOCK_ENTRY",
        "enforcement_phase": "ENTRY_TRIGGER",
        "pass_semantics": "FAILURE_ABSENT",
        "description": "Un indicateur explicitement requis pour le trigger est absent à cette phase."
      }
    ],
    "soft_gates": [
      {
        "code": "PACK_DEGRADED",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le pack est dégradé mais les données canoniques du setup restent évaluables."
      },
      {
        "code": "MEGA_CAPS_MISSING_FOR_NQ",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le contexte mégacaps NQ est manquant sans supprimer la donnée de trigger canonique."
      },
      {
        "code": "PRICE_MID_RANGE",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le prix est au milieu du range et exige une géométrie ou confirmation supérieure."
      },
      {
        "code": "CROSS_ASSET_PARTIAL",
        "severity": "SOFT",
        "effect": "REDUCE_RISK",
        "description": "Le cross-asset est partiel mais non invalidant."
      },
      {
        "code": "MACRO_NEUTRAL",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le macro est neutre et exige une confirmation technique renforcée."
      },
      {
        "code": "NQ_ES_DIVERGENCE",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "La divergence impose de sélectionner le leader ou d’attendre."
      },
      {
        "code": "HIGH_VOLATILITY",
        "severity": "SOFT",
        "effect": "REDUCE_RISK",
        "description": "La volatilité augmente la prudence sans veto automatique."
      },
      {
        "code": "LEVEL_CONSUMED",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Le niveau a été consommé et exige une confirmation supplémentaire."
      },
      {
        "code": "CONTEXTUAL_DATA_GAP",
        "severity": "SOFT",
        "effect": "REQUIRE_CONFIRMATION",
        "description": "Une donnée contextuelle non canonique est absente."
      },
      {
        "code": "OPTIONAL_INDICATOR_MISSING",
        "severity": "SOFT",
        "effect": "INFORMATIONAL",
        "description": "Un indicateur non requis pour le trigger est absent."
      }
    ],
    "setup_patterns": [
      "PULLBACK",
      "BREAKOUT_RETEST",
      "BREAKDOWN_RETEST",
      "REJECTION",
      "SWEEP_RECLAIM",
      "RANGE_ROTATION",
      "FAKEOUT_REVERSAL",
      "CONTINUATION"
    ]
  }
} as const;



export type ActiveThesisUpdate = {
  "thesis_id": string;
  "status"?: "NO_ACTIVE_THESIS" | "THESIS_ACTIVE" | "THESIS_CONDITIONAL" | "WAIT_MONITORED" | "THESIS_WEAKENED" | "THESIS_AT_RISK" | "THESIS_INVALIDATED" | "SETUP_ARMED" | "SETUP_TRIGGERED" | "REPLAN_REQUIRED" | "EXPIRED";
  "health_score"?: number;
  "confidence_pct"?: number;
  "last_monitor_id"?: string;
  "dominant_scenario"?: string;
  "secondary_scenario"?: string;
  "notes"?: string;
  [key: string]: unknown;
};

export type ActiveThesis = {
  "thesis_id"?: string;
  "linked_master_analysis_id": string;
  "status": "NO_ACTIVE_THESIS" | "THESIS_ACTIVE" | "THESIS_CONDITIONAL" | "WAIT_MONITORED" | "THESIS_WEAKENED" | "THESIS_AT_RISK" | "THESIS_INVALIDATED" | "SETUP_ARMED" | "SETUP_TRIGGERED" | "REPLAN_REQUIRED" | "EXPIRED";
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "direction": "long" | "short" | "neutral" | "wait";
  "dominant_scenario": string;
  "secondary_scenario"?: string;
  "confidence_pct": number;
  "health_score": number;
  "valid_from": string;
  "valid_until"?: string;
  "setup_expiry_time"?: string;
  "requires_replan_after"?: string;
  "key_levels"?: unknown[];
  "wait_to_go_conditions"?: unknown[];
  "invalidation_conditions"?: unknown[];
  "expected_path"?: {
  [key: string]: unknown;
};
  "failure_path"?: {
  [key: string]: unknown;
};
  "scenario_transformation_map"?: unknown[];
  "monitoring_playbook"?: unknown[];
  "last_monitor_id"?: string;
  [key: string]: unknown;
};

export type Analysis = {
  "schema_version": "1.0.0" | "1.1.0";
  "contract_name": "DeskFuturesAnalysisContract";
  "analysis_id": string;
  "created_at_paris": string;
  "mode": "live" | "backtest" | "replay" | "paper";
  "analysis_type": "asia_open" | "london_session" | "ny_open" | "work_forward" | "live_position" | "post_event_replan" | "position_monitor" | "weekly_brief" | "daily_brief";
  "pack_id": string;
  "report_id"?: string;
  "decision_id"?: string;
  "created_at"?: string;
  "session": "asia_open" | "asia_to_london" | "ny_open";
  "date": string;
  "timezone": "Europe/Paris";
  "title"?: string;
  "status"?: "draft" | "generated" | "ready" | "sent" | "archived";
  "scope": {
  [key: string]: unknown;
};
  "source_pack": {
  [key: string]: unknown;
};
  "executive_summary": {
  "summary": string;
  "final_decision": "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "final_instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "final_direction": "long" | "short" | "neutral" | "wait";
  "primary_setup_id"?: string;
  [key: string]: unknown;
};
  "context": {
  [key: string]: unknown;
};
  "market_funnel": {
  [key: string]: unknown;
};
  "levels": {
  [key: string]: unknown;
};
  "strategic_brief": {
  [key: string]: unknown;
};
  "decision_gates": {
  [key: string]: unknown;
};
  "summary"?: string;
  "primary_setup_id"?: string;
  "final_decision"?: "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "final_instrument"?: "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "final_direction"?: "long" | "short" | "neutral" | "wait";
  "setups": ({
  "setup_id": string;
  "label": string;
  "rank"?: number;
  "priority"?: number;
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "decision"?: "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "direction": "long" | "short" | "neutral" | "wait";
  "setup_type": "buy_limit_pullback" | "sell_limit_pullback" | "buy_stop_breakout" | "sell_stop_breakdown" | "sell_stop_breakdown_retest" | "buy_stop_breakout_retest" | "wait" | "wait_only" | "no_trade" | "management_only";
  "order_type"?: "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop" | "sell_stop_or_retest" | "buy_stop_or_retest" | "market" | "conditional" | "wait" | "cancel";
  "status"?: "active" | "secondary" | "inactive" | "cancelled" | "wait" | "management_only";
  "entry_zone"?: {
  "from": number;
  "to": number;
};
  "entry_trigger"?: string | {
  [key: string]: unknown;
};
  "stop_loss"?: number;
  "take_profits"?: ({
  "name": string;
  "target": number | {
  "from": number;
  "to": number;
};
  "condition"?: string;
  "action"?: string;
})[];
  "extension_target"?: number | {
  "from": number;
  "to": number;
};
  "invalidation": string | {
  [key: string]: unknown;
};
  "risk_pct": number;
  "confidence_pct": number;
  "rr_minimum"?: number;
  "reason": string;
  "conditions"?: string[];
  "management_rules"?: string[];
  "management"?: {
  [key: string]: unknown;
};
  "executable"?: boolean;
  [key: string]: unknown;
})[];
  "executable_decision": {
  "decision_id"?: string;
  "pack_id"?: string;
  "report_id"?: string;
  "analysis_id"?: string;
  "created_at"?: string;
  "session": "asia_open" | "asia_to_london" | "ny_open";
  "date": string;
  "timezone"?: "Europe/Paris";
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "asset_class"?: "futures";
  "decision": "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "direction": "long" | "short" | "neutral" | "wait";
  "setup_id"?: string;
  "setup_type": "buy_limit_pullback" | "sell_limit_pullback" | "buy_stop_breakout" | "sell_stop_breakdown" | "sell_stop_breakdown_retest" | "buy_stop_breakout_retest" | "wait" | "wait_only" | "no_trade" | "management_only";
  "order_type"?: string;
  "confidence_pct": number;
  "risk_pct": number;
  "rr_minimum": number;
  "entry_zone"?: {
  "from": number;
  "to": number;
};
  "entry_trigger"?: string;
  "stop_loss"?: number;
  "take_profits"?: {
  "tp1"?: number | {
  "from": number;
  "to": number;
};
  "tp2"?: number | {
  "from": number;
  "to": number;
};
  "tp3"?: number | {
  "from": number;
  "to": number;
};
};
  "extension_target"?: number | {
  "from": number;
  "to": number;
};
  "invalidation": string;
  "action_now"?: string;
  "no_trade_condition"?: string;
  "management_rules"?: string[];
  "time_rules"?: {
  "earliest_entry_time"?: string;
  "latest_entry_time"?: string;
  "reduce_before"?: string;
  "flatten_before"?: string;
};
  "macro_bias"?: string;
  "technical_bias"?: string;
  "cross_asset_bias"?: string;
  "reason_summary": string;
  "detailed_reason"?: string;
  "status"?: "draft" | "active" | "triggered" | "cancelled" | "tp1_hit" | "tp2_hit" | "tp3_hit" | "stopped" | "expired" | "archived";
  "decision_audit": {
  "contract_name"?: "DeskDecisionAuditContract";
  "schema_version"?: "1.0.0";
  "timezone"?: "Europe/Paris";
  "decision_timestamp_paris": string;
  "data_cutoff_paris": string;
  "available_data_until": string;
  "future_data_used": false;
  "entry_sl_tp_frozen": true;
  "datasets_used": string[];
  "macro_actuals_visible": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "macro_actuals_blocked": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "source_pack_id": string;
  "simulation_id"?: string | null;
  "mission_id"?: string | null;
  "decision_id"?: string;
  "thesis_id"?: string;
  "decision_timestamp_utc"?: string;
  "data_cutoff_utc"?: string;
  "available_data_until_utc"?: string;
  "entry_sl_tp_frozen_at_paris"?: string;
  "notes"?: string;
};
};
  "session_matrix": {
  [key: string]: unknown;
}[];
  "authorized_windows_summary": {
  [key: string]: unknown;
}[];
  "update_agenda": {
  [key: string]: unknown;
}[];
  "risk_management": {
  [key: string]: unknown;
};
  "monitoring_rules": {
  [key: string]: unknown;
};
  "final_sections": {
  "decision_executable": string;
  "regle_finale": string;
  [key: string]: unknown;
};
  "markdown"?: string;
};

export type AnalyticalResearchProgressV1 = {
  "schema_version": "desk_analytical_research_progress_v1";
  "status": unknown;
  "current_phase": unknown | null;
  "started_at_utc": string | null;
  "updated_at_utc": string;
  "phases": unknown[];
  "coverage": unknown;
  "tool_calls_count": number;
  "evidence_receipts_count": number;
};

export type CompiledExecutionPlanV11 = {
  "schema_version": "deterministic_execution_plan_v1_1";
  "plan_id": string;
  "compiler_version": "1.1.0";
  "disposition": "SETUP_READY" | "SETUP_CONDITIONAL" | "WAIT_BETTER_PRICE" | "WAIT_NO_SETUP" | "MANAGEMENT_ONLY" | "FORBIDDEN" | "REPLAN_REQUIRED";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "gates": unknown;
  "thesis_plan": unknown;
  "ranked_setups": unknown[];
  "no_setup_proof": null | unknown;
  "opportunity_diagnostic": "EXECUTABLE_OPPORTUNITIES_COMPILED" | "VALID_NO_OPPORTUNITY_PROOF" | "INVALID_NO_EXECUTABLE_SETUP";
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type CompiledExecutionPlanV12 = {
  "schema_version": "deterministic_execution_plan_v1_2";
  "plan_id": string;
  "compiler_version": "1.2.0";
  "disposition": "SETUP_READY" | "SETUP_CONDITIONAL" | "WAIT_BETTER_PRICE" | "WAIT_NO_SETUP" | "MANAGEMENT_ONLY" | "FORBIDDEN" | "REPLAN_REQUIRED";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "gates": unknown;
  "thesis_plan": unknown;
  "ranked_setups": unknown[];
  "no_setup_proof": null | unknown;
  "opportunity_diagnostic": "EXECUTABLE_OPPORTUNITIES_COMPILED" | "VALID_NO_OPPORTUNITY_PROOF" | "INVALID_NO_EXECUTABLE_SETUP";
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type CompiledExecutionPlanV13 = {
  "schema_version": "deterministic_execution_plan_v1_3";
  "plan_id": string;
  "compiler_version": "1.3.0";
  "disposition": "SETUP_READY" | "SETUP_CONDITIONAL" | "WAIT_BETTER_PRICE" | "WAIT_NO_SETUP" | "MANAGEMENT_ONLY" | "FORBIDDEN" | "REPLAN_REQUIRED";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "gates": unknown;
  "thesis_plan": unknown;
  "ranked_setups": unknown[];
  "no_setup_proof": null | unknown;
  "opportunity_diagnostic": "EXECUTABLE_OPPORTUNITIES_COMPILED" | "VALID_NO_OPPORTUNITY_PROOF" | "INVALID_NO_EXECUTABLE_SETUP";
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type CompiledExecutionPlanV14 = {
  "schema_version": "deterministic_execution_plan_v1_4";
  "plan_id": string;
  "compiler_version": "1.4.0";
  "disposition": "SETUP_READY" | "SETUP_CONDITIONAL" | "WAIT_BETTER_PRICE" | "WAIT_NO_SETUP" | "MANAGEMENT_ONLY" | "FORBIDDEN" | "REPLAN_REQUIRED";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "gates": unknown;
  "thesis_plan": unknown;
  "ranked_setups": unknown[];
  "no_setup_proof": null | unknown;
  "opportunity_diagnostic": "EXECUTABLE_OPPORTUNITIES_COMPILED" | "VALID_NO_OPPORTUNITY_PROOF" | "INVALID_NO_EXECUTABLE_SETUP";
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type CompiledExecutionPlanV1 = {
  "schema_version": "deterministic_execution_plan_v1";
  "plan_id": string;
  "compiler_version": "1.0.0";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "thesis_plan": unknown;
  "ranked_setups": unknown[];
  "no_setup_proof": null | unknown;
  "opportunity_diagnostic": "EXECUTABLE_OPPORTUNITIES_COMPILED" | "VALID_NO_OPPORTUNITY_PROOF" | "INVALID_NO_EXECUTABLE_SETUP";
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type CompiledMonitorCommandV11 = {
  "schema_version": "desk_monitor_command_v1_1";
  "plan_id": string;
  "compiler_version": "1.1.0";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "gates": unknown;
  "source_action": unknown;
  "canonical_action": unknown;
  "thesis_command": unknown;
  "setup_command": unknown;
  "position_request": unknown;
  "replan_request": unknown;
  "transitions": {
  "thesis": unknown;
  "setup": unknown;
  "replan": unknown;
};
  "alert": null | unknown;
  "context_transmission": null | unknown;
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type CompiledMonitorCommandV12 = {
  "schema_version": "desk_monitor_command_v1_2";
  "plan_id": string;
  "compiler_version": "1.2.0";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "gates": unknown;
  "source_action": unknown;
  "canonical_action": unknown;
  "thesis_command": unknown;
  "setup_command": unknown;
  "position_request": unknown;
  "replan_request": unknown;
  "transitions": {
  "thesis": unknown;
  "setup": unknown;
  "replan": unknown;
};
  "alert": null | unknown;
  "context_transmission": null | unknown;
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type CompiledMonitorCommandV13 = {
  "schema_version": "desk_monitor_command_v1_3";
  "plan_id": string;
  "compiler_version": "1.3.0";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "gates": unknown;
  "source_action": unknown;
  "canonical_action": unknown;
  "thesis_command": unknown;
  "setup_command": unknown;
  "position_request": unknown;
  "replan_request": unknown;
  "transitions": {
  "thesis": unknown;
  "setup": unknown;
  "replan": unknown;
};
  "alert": null | unknown;
  "context_transmission": null | unknown;
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type CompiledMonitorCommandV14 = {
  "schema_version": "desk_monitor_command_v1_4";
  "plan_id": string;
  "compiler_version": "1.4.0";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "gates": unknown;
  "source_action": unknown;
  "canonical_action": unknown;
  "thesis_command": unknown;
  "setup_command": unknown;
  "position_request": unknown;
  "replan_request": unknown;
  "transitions": {
  "thesis": unknown;
  "setup": unknown;
  "replan": unknown;
};
  "alert": null | unknown;
  "context_transmission": null | unknown;
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type CompiledMonitorCommandV1 = {
  "schema_version": "desk_monitor_command_v1";
  "plan_id": string;
  "compiler_version": "1.0.0";
  "source_reference": unknown;
  "analytical_scope": unknown;
  "policy": unknown;
  "source_action": unknown;
  "canonical_action": unknown;
  "thesis_command": unknown;
  "setup_command": unknown;
  "position_request": unknown;
  "replan_request": unknown;
  "transitions": {
  "thesis": unknown;
  "setup": unknown;
  "replan": unknown;
};
  "alert": null | unknown;
  "context_transmission": null | unknown;
  "diagnostics": unknown;
  "canonical_hash": string;
  "valid": boolean;
  "transport_context": {
  "source_mode": "LIVE" | "REPLAY" | "BACK_FORWARD" | "PAPER" | null;
};
};

export type ConditionCatalogV11 = {
  "contract_name": "DeskConditionCatalogContract";
  "schema_version": "1.1.0";
  "catalog_id": "condition_catalog_v1_1";
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "profile_defaults": {
  "min_weighted_confirmation_ratio": 0.55;
  "max_risk_pct": 0.25;
  "min_rr": 2;
  "hard_gate_policy": "FAIL_CLOSED";
  "contextual_gap_policy": "SOFT_REQUIRE_CONFIRMATION";
};
  "condition_roles": ("ACTIVATION" | "CONFIRMATION" | "INVALIDATION" | "VETO")[];
  "condition_effects": ("REQUIRE_TRUE" | "BLOCK_IF_TRUE")[];
  "operators": ({
  "code": "CLOSE_ABOVE" | "CLOSE_BELOW" | "CROSS_ABOVE" | "CROSS_BELOW" | "TOUCH_ABOVE" | "TOUCH_BELOW" | "REJECT_ABOVE" | "REJECT_BELOW" | "REJECT_RESISTANCE" | "REJECT_SUPPORT" | "WITHIN_WINDOW" | "OUTSIDE_WINDOW" | "ALIGNS_WITH" | "DIVERGES_FROM" | "EVENT_ACTIVE" | "EVENT_CLEAR";
  "field": "close" | "high_low" | "ohlc_pattern" | "clock" | "intermarket" | "event";
  "description": string;
})[];
  "predicate_types": ({
  "code": "PRICE_RELATION" | "PRICE_CROSS" | "ZONE_TOUCH" | "BREAKOUT_CLOSE" | "BREAK_RETEST_SEQUENCE" | "REJECTION_PATTERN" | "VWAP_RELATION" | "RSI_THRESHOLD" | "TIME_WINDOW" | "INTERMARKET_CONFIRMATION" | "EVENT_BLACKOUT";
  "required_parameters": string[];
  "parameter_definitions": ({
  "name": string;
  "type": "NUMBER" | "POSITIVE_INTEGER" | "BOOLEAN" | "IDENTIFIER" | "TIME_OF_DAY" | "INSTRUMENT_REF";
  "unit": "PRICE" | "POINTS" | "BARS" | "PERIODS" | "BOOLEAN" | "IDENTIFIER" | "TIME_PARIS" | "SYMBOL" | "NONE";
  "source": "GPT_PINNED" | "PACK_REFERENCE" | "CONDITION_REFERENCE" | "POLICY";
  "description": string;
})[];
  "allowed_operators": ("CLOSE_ABOVE" | "CLOSE_BELOW" | "CROSS_ABOVE" | "CROSS_BELOW" | "TOUCH_ABOVE" | "TOUCH_BELOW" | "REJECT_ABOVE" | "REJECT_BELOW" | "REJECT_RESISTANCE" | "REJECT_SUPPORT" | "WITHIN_WINDOW" | "OUTSIDE_WINDOW" | "ALIGNS_WITH" | "DIVERGES_FROM" | "EVENT_ACTIVE" | "EVENT_CLEAR")[];
  "evaluation_field": "close" | "high_low" | "ohlc_pattern" | "indicator_value" | "clock" | "intermarket" | "event";
  "source_requirements": ({
  "source_code": string;
  "kind": "OHLC_CANDLES" | "SESSION_SNAPSHOT" | "TECHNICAL_INDICATOR" | "CLOCK" | "INTERMARKET_SNAPSHOT" | "MACRO_CALENDAR" | "CONDITION_MEMORY";
  "required": boolean;
  "description": string;
})[];
  "enforcement_phase": "ENTRY_TRIGGER";
  "stateful": boolean;
  "backend_evaluator": string;
})[];
  "importance_values": ("HARD_BLOCKER" | "MANDATORY" | "PRIMARY" | "SECONDARY" | "OPTIONAL" | "ADVISORY")[];
  "memory_policies": ("LATCH_UNTIL_TRIGGER" | "LATEST_ONLY" | "INVALIDATE_TERMINAL")[];
  "memory_policy_semantics": {
  "LATCH_UNTIL_TRIGGER": "REQUIRE_TRUE activation or confirmation only; forbidden for BLOCK_IF_TRUE.";
  "LATEST_ONLY": "Temporary VETO and blackout/window/intermarket/volatility blocker; re-evaluated on each eligible closed M1 bar and cleared when false.";
  "INVALIDATE_TERMINAL": "Explicit structural INVALIDATION only; terminal for the setup identity.";
};
  "temporal_modes": ("LATEST_CLOSED" | "ANY_SINCE_ARM" | "CONSECUTIVE_CLOSED" | "CROSS_AFTER_ARM")[];
  "hard_gates": ({
  "code": "ANTI_LOOKAHEAD_FAILED";
  "enforcement_phase": "PLAN_COMPILE";
} | {
  "code": "SCOPE_CONTRACT_MISMATCH";
  "enforcement_phase": "PLAN_COMPILE";
} | {
  "code": "CANONICAL_TRIGGER_DATA_MISSING";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "GEOMETRY_INVALID";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "RR_BELOW_MINIMUM";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "STOP_INVALID";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "TARGET_INVALID";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "SETUP_EXPIRED_OR_TERMINAL";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "DETERMINISTIC_VETO_ACTIVE";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "BROKER_SAFETY_FAILED";
  "enforcement_phase": "BROKER_SUBMIT";
} | {
  "code": "MAJOR_EVENT_ENTRY_BLOCK";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "MANDATORY_INDICATOR_MISSING";
  "enforcement_phase": "ENTRY_TRIGGER";
})[];
  "soft_gates": ({
  "code": "PACK_DEGRADED" | "MEGA_CAPS_MISSING_FOR_NQ" | "PRICE_MID_RANGE" | "CROSS_ASSET_PARTIAL" | "MACRO_NEUTRAL" | "NQ_ES_DIVERGENCE" | "HIGH_VOLATILITY" | "LEVEL_CONSUMED" | "CONTEXTUAL_DATA_GAP" | "OPTIONAL_INDICATOR_MISSING";
  "severity": "SOFT";
  "effect": "REDUCE_RISK" | "REQUIRE_CONFIRMATION" | "INFORMATIONAL";
  "description": string;
})[];
  "setup_patterns": ("PULLBACK" | "BREAKOUT_RETEST" | "BREAKDOWN_RETEST" | "REJECTION" | "SWEEP_RECLAIM" | "RANGE_ROTATION" | "FAKEOUT_REVERSAL" | "CONTINUATION")[];
};

export type ConditionCatalogV12 = {
  "contract_name": "DeskConditionCatalogContract";
  "schema_version": "1.2.0";
  "catalog_id": "condition_catalog_v1_2";
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "profile_defaults": {
  "min_weighted_confirmation_ratio": 0.55;
  "max_risk_pct": 0.25;
  "min_rr": 2;
  "hard_gate_policy": "FAIL_CLOSED";
  "contextual_gap_policy": "SOFT_REQUIRE_CONFIRMATION";
};
  "condition_roles": ("ACTIVATION" | "CONFIRMATION" | "INVALIDATION" | "VETO")[];
  "condition_effects": ("REQUIRE_TRUE" | "BLOCK_IF_TRUE")[];
  "operators": ({
  "code": "CLOSE_ABOVE" | "CLOSE_BELOW" | "CROSS_ABOVE" | "CROSS_BELOW" | "TOUCH_ABOVE" | "TOUCH_BELOW" | "REJECT_ABOVE" | "REJECT_BELOW" | "REJECT_RESISTANCE" | "REJECT_SUPPORT" | "WITHIN_WINDOW" | "OUTSIDE_WINDOW" | "ALIGNS_WITH" | "DIVERGES_FROM" | "EVENT_ACTIVE" | "EVENT_CLEAR";
  "field": "close" | "high_low" | "ohlc_pattern" | "clock" | "intermarket" | "event";
  "description": string;
})[];
  "predicate_types": ({
  "code": "PRICE_RELATION" | "PRICE_CROSS" | "ZONE_TOUCH" | "BREAKOUT_CLOSE" | "BREAK_RETEST_SEQUENCE" | "REJECTION_PATTERN" | "VWAP_RELATION" | "RSI_THRESHOLD" | "TIME_WINDOW" | "INTERMARKET_CONFIRMATION" | "EVENT_BLACKOUT";
  "required_parameters": string[];
  "parameter_definitions": ({
  "name": string;
  "type": "NUMBER" | "POSITIVE_INTEGER" | "BOOLEAN" | "IDENTIFIER" | "TIME_OF_DAY" | "INSTRUMENT_REF";
  "unit": "PRICE" | "POINTS" | "BARS" | "PERIODS" | "BOOLEAN" | "IDENTIFIER" | "TIME_PARIS" | "SYMBOL" | "NONE";
  "source": "GPT_PINNED" | "PACK_REFERENCE" | "CONDITION_REFERENCE" | "POLICY";
  "description": string;
})[];
  "allowed_operators": ("CLOSE_ABOVE" | "CLOSE_BELOW" | "CROSS_ABOVE" | "CROSS_BELOW" | "TOUCH_ABOVE" | "TOUCH_BELOW" | "REJECT_ABOVE" | "REJECT_BELOW" | "REJECT_RESISTANCE" | "REJECT_SUPPORT" | "WITHIN_WINDOW" | "OUTSIDE_WINDOW" | "ALIGNS_WITH" | "DIVERGES_FROM" | "EVENT_ACTIVE" | "EVENT_CLEAR")[];
  "evaluation_field": "close" | "high_low" | "ohlc_pattern" | "indicator_value" | "clock" | "intermarket" | "event";
  "source_requirements": ({
  "source_code": string;
  "kind": "OHLC_CANDLES" | "SESSION_SNAPSHOT" | "TECHNICAL_INDICATOR" | "CLOCK" | "INTERMARKET_SNAPSHOT" | "MACRO_CALENDAR" | "CONDITION_MEMORY";
  "required": boolean;
  "description": string;
})[];
  "enforcement_phase": "ENTRY_TRIGGER";
  "stateful": boolean;
  "backend_evaluator": string;
})[];
  "importance_values": ("HARD_BLOCKER" | "MANDATORY" | "PRIMARY" | "SECONDARY" | "OPTIONAL" | "ADVISORY")[];
  "memory_policies": ("LATCH_UNTIL_TRIGGER" | "LATEST_ONLY" | "INVALIDATE_TERMINAL")[];
  "memory_policy_semantics": {
  "LATCH_UNTIL_TRIGGER": "REQUIRE_TRUE activation or confirmation only; forbidden for BLOCK_IF_TRUE.";
  "LATEST_ONLY": "Temporary VETO and blackout/window/intermarket/volatility blocker; re-evaluated on each eligible closed M1 bar and cleared when false.";
  "INVALIDATE_TERMINAL": "Explicit structural INVALIDATION only; terminal for the setup identity.";
};
  "temporal_modes": ("LATEST_CLOSED" | "ANY_SINCE_ARM" | "CONSECUTIVE_CLOSED" | "CROSS_AFTER_ARM")[];
  "hard_gates": ({
  "code": "ANTI_LOOKAHEAD_FAILED";
  "enforcement_phase": "PLAN_COMPILE";
} | {
  "code": "SCOPE_CONTRACT_MISMATCH";
  "enforcement_phase": "PLAN_COMPILE";
} | {
  "code": "CANONICAL_TRIGGER_DATA_MISSING";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "GEOMETRY_INVALID";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "RR_BELOW_MINIMUM";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "STOP_INVALID";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "TARGET_INVALID";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "SETUP_EXPIRED_OR_TERMINAL";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "DETERMINISTIC_VETO_ACTIVE";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "BROKER_SAFETY_FAILED";
  "enforcement_phase": "BROKER_SUBMIT";
} | {
  "code": "MAJOR_EVENT_ENTRY_BLOCK";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "MANDATORY_INDICATOR_MISSING";
  "enforcement_phase": "ENTRY_TRIGGER";
})[];
  "soft_gates": ({
  "code": "PACK_DEGRADED" | "MEGA_CAPS_MISSING_FOR_NQ" | "PRICE_MID_RANGE" | "CROSS_ASSET_PARTIAL" | "MACRO_NEUTRAL" | "NQ_ES_DIVERGENCE" | "HIGH_VOLATILITY" | "LEVEL_CONSUMED" | "CONTEXTUAL_DATA_GAP" | "OPTIONAL_INDICATOR_MISSING";
  "severity": "SOFT";
  "effect": "REDUCE_RISK" | "REQUIRE_CONFIRMATION" | "INFORMATIONAL";
  "description": string;
})[];
  "setup_patterns": ("PULLBACK" | "BREAKOUT_RETEST" | "BREAKDOWN_RETEST" | "REJECTION" | "SWEEP_RECLAIM" | "RANGE_ROTATION" | "FAKEOUT_REVERSAL" | "CONTINUATION")[];
};

export type ConditionCatalogV1 = {
  "contract_name": "DeskConditionCatalogContract";
  "schema_version": "1.0.0";
  "catalog_id": "condition_catalog_v1";
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "profile_defaults": {
  "min_weighted_confirmation_ratio": 0.55;
  "max_risk_pct": 0.25;
  "min_rr": 2;
  "hard_gate_policy": "FAIL_CLOSED";
  "contextual_gap_policy": "SOFT_REQUIRE_CONFIRMATION";
};
  "condition_roles": ("ACTIVATION" | "CONFIRMATION" | "INVALIDATION" | "VETO")[];
  "condition_effects": ("REQUIRE_TRUE" | "BLOCK_IF_TRUE")[];
  "operators": ({
  "code": "CLOSE_ABOVE" | "CLOSE_BELOW" | "CROSS_ABOVE" | "CROSS_BELOW" | "TOUCH_ABOVE" | "TOUCH_BELOW" | "REJECT_ABOVE" | "REJECT_BELOW" | "REJECT_RESISTANCE" | "REJECT_SUPPORT" | "WITHIN_WINDOW" | "OUTSIDE_WINDOW" | "ALIGNS_WITH" | "DIVERGES_FROM" | "EVENT_ACTIVE" | "EVENT_CLEAR";
  "field": "close" | "high_low" | "ohlc_pattern" | "clock" | "intermarket" | "event";
  "description": string;
})[];
  "predicate_types": ({
  "code": "PRICE_RELATION" | "PRICE_CROSS" | "ZONE_TOUCH" | "BREAKOUT_CLOSE" | "BREAK_RETEST_SEQUENCE" | "REJECTION_PATTERN" | "VWAP_RELATION" | "RSI_THRESHOLD" | "TIME_WINDOW" | "INTERMARKET_CONFIRMATION" | "EVENT_BLACKOUT";
  "required_parameters": string[];
  "parameter_definitions": ({
  "name": string;
  "type": "NUMBER" | "POSITIVE_INTEGER" | "BOOLEAN" | "IDENTIFIER" | "TIME_OF_DAY" | "INSTRUMENT_REF";
  "unit": "PRICE" | "POINTS" | "BARS" | "PERIODS" | "BOOLEAN" | "IDENTIFIER" | "TIME_PARIS" | "SYMBOL" | "NONE";
  "source": "GPT_PINNED" | "PACK_REFERENCE" | "CONDITION_REFERENCE" | "POLICY";
  "description": string;
})[];
  "allowed_operators": ("CLOSE_ABOVE" | "CLOSE_BELOW" | "CROSS_ABOVE" | "CROSS_BELOW" | "TOUCH_ABOVE" | "TOUCH_BELOW" | "REJECT_ABOVE" | "REJECT_BELOW" | "REJECT_RESISTANCE" | "REJECT_SUPPORT" | "WITHIN_WINDOW" | "OUTSIDE_WINDOW" | "ALIGNS_WITH" | "DIVERGES_FROM" | "EVENT_ACTIVE" | "EVENT_CLEAR")[];
  "evaluation_field": "close" | "high_low" | "ohlc_pattern" | "indicator_value" | "clock" | "intermarket" | "event";
  "source_requirements": ({
  "source_code": string;
  "kind": "OHLC_CANDLES" | "SESSION_SNAPSHOT" | "TECHNICAL_INDICATOR" | "CLOCK" | "INTERMARKET_SNAPSHOT" | "MACRO_CALENDAR" | "CONDITION_MEMORY";
  "required": boolean;
  "description": string;
})[];
  "enforcement_phase": "ENTRY_TRIGGER";
  "stateful": boolean;
  "backend_evaluator": string;
})[];
  "importance_values": ("HARD_BLOCKER" | "MANDATORY" | "PRIMARY" | "SECONDARY" | "OPTIONAL" | "ADVISORY")[];
  "memory_policies": ("LATCH_UNTIL_TRIGGER" | "LATEST_ONLY" | "INVALIDATE_TERMINAL")[];
  "temporal_modes": ("LATEST_CLOSED" | "ANY_SINCE_ARM" | "CONSECUTIVE_CLOSED" | "CROSS_AFTER_ARM")[];
  "hard_gates": ({
  "code": "ANTI_LOOKAHEAD_FAILED";
  "enforcement_phase": "PLAN_COMPILE";
} | {
  "code": "SCOPE_CONTRACT_MISMATCH";
  "enforcement_phase": "PLAN_COMPILE";
} | {
  "code": "CANONICAL_TRIGGER_DATA_MISSING";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "GEOMETRY_INVALID";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "RR_BELOW_MINIMUM";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "STOP_INVALID";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "TARGET_INVALID";
  "enforcement_phase": "SETUP_ARM";
} | {
  "code": "SETUP_EXPIRED_OR_TERMINAL";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "DETERMINISTIC_VETO_ACTIVE";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "BROKER_SAFETY_FAILED";
  "enforcement_phase": "BROKER_SUBMIT";
} | {
  "code": "MAJOR_EVENT_ENTRY_BLOCK";
  "enforcement_phase": "ENTRY_TRIGGER";
} | {
  "code": "MANDATORY_INDICATOR_MISSING";
  "enforcement_phase": "ENTRY_TRIGGER";
})[];
  "soft_gates": ({
  "code": "PACK_DEGRADED" | "MEGA_CAPS_MISSING_FOR_NQ" | "PRICE_MID_RANGE" | "CROSS_ASSET_PARTIAL" | "MACRO_NEUTRAL" | "NQ_ES_DIVERGENCE" | "HIGH_VOLATILITY" | "LEVEL_CONSUMED" | "CONTEXTUAL_DATA_GAP" | "OPTIONAL_INDICATOR_MISSING";
  "severity": "SOFT";
  "effect": "REDUCE_RISK" | "REQUIRE_CONFIRMATION" | "INFORMATIONAL";
  "description": string;
})[];
  "setup_patterns": ("PULLBACK" | "BREAKOUT_RETEST" | "BREAKDOWN_RETEST" | "REJECTION" | "SWEEP_RECLAIM" | "RANGE_ROTATION" | "FAKEOUT_REVERSAL" | "CONTINUATION")[];
};

export type ContextTransmission = {
  "context_id"?: string;
  "linked_analysis_id"?: string;
  "linked_monitor_id"?: string;
  "date"?: string;
  "session"?: string;
  [key: string]: unknown;
};

export type ContractActivation = {
  "contract_name": "DeskMasterAnalysisContract" | "DeskHourlyThesisMonitorContract" | "DeskFrontProjectionContract" | "DeskDeterministicExecutionPolicy" | "DeskExecutionPlanContract" | "DeskMonitorCommandContract" | "DeskConditionCatalogContract";
  "schema_version": string;
};

export type ContractList = {
  "contract_name": "DeskMasterAnalysisContract" | "DeskHourlyThesisMonitorContract" | "DeskFrontProjectionContract" | "DeskDeterministicExecutionPolicy" | "DeskExecutionPlanContract" | "DeskMonitorCommandContract" | "DeskConditionCatalogContract";
};

export type ContractLookup = {
  "contract_name": "DeskMasterAnalysisContract" | "DeskHourlyThesisMonitorContract" | "DeskFrontProjectionContract" | "DeskDeterministicExecutionPolicy" | "DeskExecutionPlanContract" | "DeskMonitorCommandContract" | "DeskConditionCatalogContract";
  "schema_version": string;
};

export type ContractRegistry = {
  "registry_version": "3.1.0";
  "active_contracts": {
  "master_contract": unknown;
  "monitor_contract": unknown;
  "front_projection_contract": unknown;
  "execution_policy_contract": unknown;
  "execution_plan_contract": unknown;
  "monitor_command_contract": unknown;
  "condition_catalog_contract": unknown;
};
  "legacy_contracts": {
  "master_contract_v4": unknown;
  "master_contract_v5_0": unknown;
  "master_contract_v5_1": unknown;
  "master_contract_v5_2": unknown;
  "master_contract_v5_3": unknown;
  "monitor_contract_v1": unknown;
  "monitor_contract_v2_0": unknown;
  "monitor_contract_v2_1": unknown;
  "monitor_contract_v2_2": unknown;
  "monitor_contract_v2_3": unknown;
  "execution_plan_contract_v1_0": unknown;
  "execution_plan_contract_v1_1": unknown;
  "execution_plan_contract_v1_2": unknown;
  "execution_plan_contract_v1_3": unknown;
  "monitor_command_contract_v1_0": unknown;
  "monitor_command_contract_v1_1": unknown;
  "monitor_command_contract_v1_2": unknown;
  "monitor_command_contract_v1_3": unknown;
  "condition_catalog_contract_v1_0": unknown;
  "condition_catalog_contract_v1_1": unknown;
  "execution_policy_contract_v2": unknown;
  "execution_policy_contract_v3": unknown;
  "execution_policy_contract_v4_0": unknown;
  "execution_policy_contract_v4_1": unknown;
  "execution_policy_contract_v4_2": unknown;
};
  "entity_contracts": {
  "decision_audit_contract": unknown;
  "simulation_run_contract": unknown;
  "simulation_step_contract": unknown;
  "worker_mission_contract": unknown;
  "dashboard_state_contract": unknown;
  "front_projection_contract": unknown;
};
  "lifecycle_policy": {
  "statuses": ["draft","active","archived"];
  "runtime_exposed": "all_active_contracts";
  "breaking_change_rule": string;
};
};

export type Contract = {
  "contract_id"?: string;
  "contract_name": "DeskMasterAnalysisContract" | "DeskHourlyThesisMonitorContract" | "DeskFrontProjectionContract" | "DeskDeterministicExecutionPolicy" | "DeskExecutionPlanContract" | "DeskMonitorCommandContract" | "DeskConditionCatalogContract";
  "schema_version": string;
  "status"?: "draft" | "active" | "archived";
  "content_markdown": string;
  "schema_json"?: {
  [key: string]: unknown;
};
  "hash"?: string;
  "is_active"?: boolean;
  "replaced_by"?: string | null;
  "force"?: boolean;
  [key: string]: unknown;
};

export type DashboardState = {
  "contract_name"?: "DeskDashboardState";
  "schema_version"?: "1.0.0";
  "state_id": string;
  "screen_id": "live_desk" | "session_matrix" | "master_analysis" | "setup_validation" | "management_console" | "decision_journal" | "simulation_lab" | "paper_trading" | "mission_control" | "review_center" | "system_health" | "settings" | "audit_view";
  "as_of_paris": string;
  "source_modules": string[];
  "required_data_status": ({
  "name": string;
  "status": "available" | "missing" | "stale" | "blocked" | "error";
  "source": string;
})[];
  "empty_state"?: string;
  "error_state"?: string;
  "blocked_state"?: string;
  "audit_requirement": "none" | "optional" | "required" | "blocking";
  "refresh_rule": string;
  "payload"?: {
  [key: string]: unknown;
};
};

export type DecisionAudit = {
  "contract_name"?: "DeskDecisionAuditContract";
  "schema_version"?: "1.0.0";
  "timezone"?: "Europe/Paris";
  "decision_timestamp_paris": string;
  "data_cutoff_paris": string;
  "available_data_until": string;
  "future_data_used": boolean;
  "entry_sl_tp_frozen": boolean;
  "datasets_used": string[];
  "macro_actuals_visible": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "macro_actuals_blocked": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "source_pack_id": string;
  "simulation_id"?: string | null;
  "mission_id"?: string | null;
  "decision_id"?: string;
  "thesis_id"?: string;
  "decision_timestamp_utc"?: string;
  "data_cutoff_utc"?: string;
  "available_data_until_utc"?: string;
  "entry_sl_tp_frozen_at_paris"?: string;
  "notes"?: string;
};

export type Decision = {
  "schema_version"?: "decision_v2";
  "decision_model"?: "single_decision_chain_v1";
  "source_type"?: "dashboard" | "gpt" | "strategy" | "worker" | "manual" | "system";
  "source_role"?: "proposer";
  "source_ref"?: string;
  "proposer_id"?: string;
  "gate_status"?: "green" | "audit_required" | "review_required" | "blocked";
  "domain_status"?: "accepted" | "rejected" | "review_required";
  "thesis_id"?: string;
  "mission_id"?: string;
  "position_id"?: string;
  "outcome_id"?: string;
  "audit_id"?: string;
  "chain"?: {
  "thesis_id"?: string;
  "mission_id"?: string;
  "gate_status"?: "green" | "audit_required" | "review_required" | "blocked";
  "decision_id"?: string;
  "position_id"?: string;
  "outcome_id"?: string;
  "audit_id"?: string;
};
  "source_payload"?: {
  [key: string]: unknown;
};
  "decision_id"?: string;
  "pack_id"?: string;
  "report_id"?: string;
  "analysis_id"?: string;
  "created_at"?: string;
  "session": "asia_open" | "asia_to_london" | "ny_open";
  "date": string;
  "timezone"?: "Europe/Paris";
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "asset_class"?: "futures";
  "decision": "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "direction": "long" | "short" | "neutral" | "wait";
  "setup_id"?: string;
  "setup_type": "buy_limit_pullback" | "sell_limit_pullback" | "buy_stop_breakout" | "sell_stop_breakdown" | "sell_stop_breakdown_retest" | "buy_stop_breakout_retest" | "wait" | "wait_only" | "no_trade" | "management_only";
  "order_type"?: string;
  "confidence_pct": number;
  "risk_pct": number;
  "rr_minimum": number;
  "entry_zone"?: {
  "from": number;
  "to": number;
};
  "entry_trigger"?: string;
  "stop_loss"?: number;
  "take_profits"?: {
  "tp1"?: number | {
  "from": number;
  "to": number;
};
  "tp2"?: number | {
  "from": number;
  "to": number;
};
  "tp3"?: number | {
  "from": number;
  "to": number;
};
};
  "extension_target"?: number | {
  "from": number;
  "to": number;
};
  "invalidation": string;
  "action_now"?: string;
  "no_trade_condition"?: string;
  "management_rules"?: string[];
  "time_rules"?: {
  "earliest_entry_time"?: string;
  "latest_entry_time"?: string;
  "reduce_before"?: string;
  "flatten_before"?: string;
};
  "macro_bias"?: string;
  "technical_bias"?: string;
  "cross_asset_bias"?: string;
  "reason_summary": string;
  "detailed_reason"?: string;
  "status"?: "draft" | "active" | "triggered" | "cancelled" | "tp1_hit" | "tp2_hit" | "tp3_hit" | "stopped" | "expired" | "archived";
  "decision_audit": {
  "contract_name"?: "DeskDecisionAuditContract";
  "schema_version"?: "1.0.0";
  "timezone"?: "Europe/Paris";
  "decision_timestamp_paris": string;
  "data_cutoff_paris": string;
  "available_data_until": string;
  "future_data_used": false;
  "entry_sl_tp_frozen": true;
  "datasets_used": string[];
  "macro_actuals_visible": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "macro_actuals_blocked": ({
  "event": string;
  "importance"?: "low" | "medium" | "high";
  "scheduled_at_paris"?: string;
  "published_at_paris"?: string;
})[];
  "source_pack_id": string;
  "simulation_id"?: string | null;
  "mission_id"?: string | null;
  "decision_id"?: string;
  "thesis_id"?: string;
  "decision_timestamp_utc"?: string;
  "data_cutoff_utc"?: string;
  "available_data_until_utc"?: string;
  "entry_sl_tp_frozen_at_paris"?: string;
  "notes"?: string;
};
};

export type DeskFrontProjection = {
  "contractName": "DeskFrontProjectionContract";
  "schemaVersion": "1.0.0";
  "source": {
  "sourceType": "MASTER" | "MONITOR";
  "sourceId": string;
  "masterId": string;
  "monitorId": string | null;
  "thesisId": string;
  "strategyId": "asia_open" | "ny_open_1530";
  "session": "asia_open" | "ny_open";
  "mode": "live" | "paper";
  "tradingDate": string;
  "runId": string;
  "timestampParis": string;
  "asOfUtc": string;
  "sequence": number;
  "revision": number;
};
  "status": {
  "deskStatus": string;
  "decision": string;
  "actionCode": string;
  "alertLevel": "info" | "watch" | "warning" | "action" | "critical" | "positive";
  "thesisStatus": string;
  "setupStatus": string;
  "positionStatus": string;
  "confidencePct": number;
  "healthScore": number;
  "riskPct": number;
};
  "briefs": {
  "headline": string;
  "oneLiner": string;
  "marketBrief": string;
  "thesisBrief": string;
  "deltaBrief": string;
  "whyNow": string;
  "actionNow": string;
  "nextFocus": string;
};
  "latestChange": {
  "stateTransition": {
  "from": string;
  "to": string;
};
  "scoreTransition": {
  "from": number;
  "to": number;
  "delta": number;
};
  "validatedElements": string[];
  "weakenedElements": string[];
  "invalidatedElements": string[];
};
  "expectedVsRealized": {
  "label": string;
  "expected": string;
  "realized": string;
  "verdict": string;
  "impact": string;
}[];
  "conditions": {
  "go": {
  [key: string]: unknown;
}[];
  "invalidations": {
  [key: string]: unknown;
}[];
};
  "setup": {
  [key: string]: unknown;
};
  "position": {
  [key: string]: unknown;
};
  "marketContext": {
  [key: string]: unknown;
};
  "timelineEvent": {
  [key: string]: unknown;
};
  "drilldownRefs": {
  [key: string]: unknown;
};
};

export type DeterministicExecutionSetupV2 = unknown | unknown;

export type DeterministicExecutionSetupV3 = unknown | unknown;

export type ExecutionPlanV11 = {
  "contract": {
  "name": "DeskExecutionPlanContract";
  "version": "1.1.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_1";
  "plan_id": string;
  "source": {
  "master_analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "disposition": "SETUP_READY" | "SETUP_CONDITIONAL" | "WAIT_BETTER_PRICE" | "WAIT_NO_SETUP" | "MANAGEMENT_ONLY" | "FORBIDDEN" | "REPLAN_REQUIRED";
  "primary_setup_id": string | null;
  "execution_authority": "BACKEND_ONLY";
  "validity": {
  "valid_from_paris": string;
  "expires_at_paris": string;
};
  "gates": {
  "hard": unknown[];
  "soft": unknown[];
};
  "risk": {
  "capital_basis": "NET_EQUITY";
  "risk_pct_requested": number;
  "min_rr": 2;
  "min_weighted_confirmation_ratio": 0.55;
};
  "setups": unknown[];
  "no_setup_proof": null | unknown;
  "monitoring": {
  "engine_cadence": "M1";
  "gpt_cadence": "M5";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
};
  "audit": unknown;
};

export type ExecutionPlanV12 = {
  "contract": {
  "name": "DeskExecutionPlanContract";
  "version": "1.2.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_2";
  "plan_id": string;
  "source": {
  "master_analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "disposition": "SETUP_READY" | "SETUP_CONDITIONAL" | "WAIT_BETTER_PRICE" | "WAIT_NO_SETUP" | "MANAGEMENT_ONLY" | "FORBIDDEN" | "REPLAN_REQUIRED";
  "primary_setup_id": string | null;
  "execution_authority": "BACKEND_ONLY";
  "validity": {
  "valid_from_paris": string;
  "expires_at_paris": string;
};
  "gates": {
  "hard": unknown[];
  "soft": unknown[];
};
  "risk": {
  "capital_basis": "NET_EQUITY";
  "risk_pct_requested": number;
  "min_rr": 2;
  "min_weighted_confirmation_ratio": 0.55;
};
  "setups": unknown[];
  "no_setup_proof": null | unknown;
  "monitoring": {
  "engine_cadence": "M1";
  "gpt_cadence": "M5";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
};
  "audit": unknown;
};

export type ExecutionPlanV13 = {
  "contract": {
  "name": "DeskExecutionPlanContract";
  "version": "1.3.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_2";
  "plan_id": string;
  "source": {
  "master_analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "disposition": "SETUP_READY" | "SETUP_CONDITIONAL" | "WAIT_BETTER_PRICE" | "WAIT_NO_SETUP" | "MANAGEMENT_ONLY" | "FORBIDDEN" | "REPLAN_REQUIRED";
  "primary_setup_id": string | null;
  "execution_authority": "BACKEND_ONLY";
  "validity": {
  "valid_from_paris": string;
  "expires_at_paris": string;
};
  "gates": {
  "hard": unknown[];
  "soft": unknown[];
};
  "risk": {
  "capital_basis": "NET_EQUITY";
  "risk_pct_requested": number;
  "min_rr": 2;
  "min_weighted_confirmation_ratio": 0.55;
};
  "setups": unknown[];
  "no_setup_proof": null | unknown;
  "monitoring": {
  "engine_cadence": "M1";
  "gpt_cadence": "M15";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
};
  "audit": unknown;
};

export type ExecutionPlanV14 = {
  "contract": {
  "name": "DeskExecutionPlanContract";
  "version": "1.4.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_2";
  "plan_id": string;
  "source": {
  "master_analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "disposition": "SETUP_READY" | "SETUP_CONDITIONAL" | "WAIT_BETTER_PRICE" | "WAIT_NO_SETUP" | "MANAGEMENT_ONLY" | "FORBIDDEN" | "REPLAN_REQUIRED";
  "primary_setup_id": string | null;
  "execution_authority": "BACKEND_ONLY";
  "validity": {
  "valid_from_paris": string;
  "expires_at_paris": string;
};
  "gates": {
  "hard": unknown[];
  "soft": unknown[];
};
  "risk": {
  "capital_basis": "NET_EQUITY";
  "risk_pct_requested": number;
  "min_rr": 2;
  "min_weighted_confirmation_ratio": 0.55;
};
  "setups": unknown[];
  "no_setup_proof": null | unknown;
  "monitoring": {
  "engine_cadence": "M1";
  "gpt_cadence": "M15";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
};
  "audit": unknown;
};

export type ExecutionPlanV1 = {
  "contract": {
  "name": "DeskExecutionPlanContract";
  "version": "1.0.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1";
  "plan_id": string;
  "source": {
  "master_analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "disposition": "SETUP_READY" | "SETUP_CONDITIONAL" | "WAIT_BETTER_PRICE" | "WAIT_NO_SETUP" | "MANAGEMENT_ONLY" | "FORBIDDEN" | "REPLAN_REQUIRED";
  "primary_setup_id": string | null;
  "execution_authority": "BACKEND_ONLY";
  "validity": {
  "valid_from_paris": string;
  "expires_at_paris": string;
};
  "gates": {
  "hard": unknown[];
  "soft": unknown[];
};
  "risk": {
  "capital_basis": "NET_EQUITY";
  "risk_pct_requested": number;
  "min_rr": 2;
  "min_weighted_confirmation_ratio": 0.55;
};
  "setups": unknown[];
  "no_setup_proof": null | unknown;
  "monitoring": {
  "engine_cadence": "M1";
  "gpt_cadence": "M5";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
};
  "audit": unknown;
};

export type HourlyMonitorV21 = {
  "contract": {
  "name": "DeskHourlyThesisMonitorContract";
  "version": "2.1.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_1";
  "source": {
  "monitor_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "links": {
  "master_analysis_id": string;
  "plan_id": string;
  "active_thesis_id": string;
  "previous_monitor_id": unknown;
  "setup_id": unknown;
  "position_id": unknown;
};
  "checkpoint": {
  "checkpoint_paris": string;
  "gpt_cadence": "M5";
  "engine_cadence": "M1";
  "window_start_paris": string;
  "window_end_paris": string;
};
  "delta_summary": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "new_risks": string[];
  "new_opportunities": string[];
};
  "assessment": {
  "expected_path": string[];
  "realized_path": string[];
  "failure_path": string[];
  "causality_summary": string;
};
  "checks": {
  "expected_vs_realized": unknown;
  "macro_update": unknown;
  "cross_asset_delta": unknown;
  "technical_delta": unknown;
  "weak_signals": unknown;
  "scenario_transformation": unknown;
  "time_decay": unknown;
  "position": unknown;
};
  "condition_evaluations": ({
  "condition_id": string;
  "state": "NOT_STARTED" | "PENDING" | "SATISFIED" | "FAILED" | "INVALIDATED" | "EXPIRED" | "UNKNOWN";
  "observed_at_paris": string | null;
  "authority": "BACKEND_SNAPSHOT";
  "evaluator_version": string;
  "evidence_refs": string[];
  "reason": string;
})[];
  "thesis_health": {
  "state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "score": number;
  "previous_score": number | null;
  "drivers": string[];
};
  "command": unknown;
  "active_thesis_update": {
  "thesis_id": string;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "health_score": number;
  "summary": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
};
  "data_quality": {
  "status": "CANONICAL" | "DEGRADED" | "UNUSABLE";
  "hard_gate_states": unknown[];
  "soft_gate_states": unknown[];
  "notes": string[];
};
  "catchup": {
  "policy": "LATEST_SETTLED_CLOSED_M5";
  "cumulative_window_start_paris": string;
  "cumulative_window_end_paris": string;
  "superseded_checkpoints": string[];
};
  "alert": null | {
  "level": "INFO" | "WATCH" | "WARNING" | "ACTION" | "CRITICAL";
  "code": string;
  "message": string;
};
  "next_handoff": {
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "priorities": string[];
  "context_summary": string;
};
  "audit": unknown;
};

export type HourlyMonitorV22 = {
  "contract": {
  "name": "DeskHourlyThesisMonitorContract";
  "version": "2.2.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_2";
  "source": {
  "monitor_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "links": {
  "master_analysis_id": string;
  "plan_id": string;
  "active_thesis_id": string;
  "previous_monitor_id": unknown;
  "setup_id": unknown;
  "position_id": unknown;
};
  "checkpoint": {
  "checkpoint_paris": string;
  "gpt_cadence": "M5";
  "engine_cadence": "M1";
  "window_start_paris": string;
  "window_end_paris": string;
};
  "delta_summary": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "new_risks": string[];
  "new_opportunities": string[];
};
  "assessment": {
  "expected_path": string[];
  "realized_path": string[];
  "failure_path": string[];
  "causality_summary": string;
};
  "checks": {
  "expected_vs_realized": unknown;
  "macro_update": unknown;
  "cross_asset_delta": unknown;
  "technical_delta": unknown;
  "weak_signals": unknown;
  "scenario_transformation": unknown;
  "time_decay": unknown;
  "position": unknown;
};
  "condition_evaluations": ({
  "condition_id": string;
  "state": "NOT_STARTED" | "PENDING" | "SATISFIED" | "FAILED" | "INVALIDATED" | "EXPIRED" | "UNKNOWN";
  "observed_at_paris": string | null;
  "authority": "BACKEND_SNAPSHOT";
  "evaluator_version": string;
  "evidence_refs": string[];
  "reason": string;
})[];
  "thesis_health": {
  "state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "score": number;
  "previous_score": number | null;
  "drivers": string[];
};
  "command": unknown;
  "active_thesis_update": {
  "thesis_id": string;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "health_score": number;
  "summary": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
};
  "data_quality": {
  "status": "CANONICAL" | "DEGRADED" | "UNUSABLE";
  "hard_gate_states": unknown[];
  "soft_gate_states": unknown[];
  "notes": string[];
};
  "catchup": {
  "policy": "LATEST_SETTLED_CLOSED_M5";
  "cumulative_window_start_paris": string;
  "cumulative_window_end_paris": string;
  "superseded_checkpoints": string[];
};
  "alert": null | {
  "level": "INFO" | "WATCH" | "WARNING" | "ACTION" | "CRITICAL";
  "code": string;
  "message": string;
};
  "next_handoff": {
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "priorities": string[];
  "context_summary": string;
};
  "audit": unknown;
};

export type HourlyMonitorV23 = {
  "contract": {
  "name": "DeskHourlyThesisMonitorContract";
  "version": "2.3.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_2";
  "source": {
  "monitor_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "links": {
  "master_analysis_id": string;
  "plan_id": string;
  "active_thesis_id": string;
  "previous_monitor_id": unknown;
  "setup_id": unknown;
  "position_id": unknown;
};
  "checkpoint": {
  "checkpoint_paris": string;
  "gpt_cadence": "M15";
  "engine_cadence": "M1";
  "window_start_paris": string;
  "window_end_paris": string;
};
  "delta_summary": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "new_risks": string[];
  "new_opportunities": string[];
};
  "assessment": {
  "expected_path": string[];
  "realized_path": string[];
  "failure_path": string[];
  "causality_summary": string;
};
  "checks": {
  "expected_vs_realized": unknown;
  "macro_update": unknown;
  "cross_asset_delta": unknown;
  "technical_delta": unknown;
  "weak_signals": unknown;
  "scenario_transformation": unknown;
  "time_decay": unknown;
  "position": unknown;
};
  "condition_evaluations": ({
  "condition_id": string;
  "state": "NOT_STARTED" | "PENDING" | "SATISFIED" | "FAILED" | "INVALIDATED" | "EXPIRED" | "UNKNOWN";
  "observed_at_paris": string | null;
  "authority": "BACKEND_SNAPSHOT";
  "evaluator_version": string;
  "evidence_refs": string[];
  "reason": string;
})[];
  "thesis_health": {
  "state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "score": number;
  "previous_score": number | null;
  "drivers": string[];
};
  "command": unknown;
  "active_thesis_update": {
  "thesis_id": string;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "health_score": number;
  "summary": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
};
  "data_quality": {
  "status": "CANONICAL" | "DEGRADED" | "UNUSABLE";
  "hard_gate_states": unknown[];
  "soft_gate_states": unknown[];
  "notes": string[];
};
  "catchup": {
  "policy": "LATEST_SETTLED_CLOSED_M15";
  "cumulative_window_start_paris": string;
  "cumulative_window_end_paris": string;
  "superseded_checkpoints": string[];
};
  "alert": null | {
  "level": "INFO" | "WATCH" | "WARNING" | "ACTION" | "CRITICAL";
  "code": string;
  "message": string;
};
  "next_handoff": {
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "priorities": string[];
  "context_summary": string;
};
  "audit": unknown;
};

export type HourlyMonitorV24 = {
  "contract": {
  "name": "DeskHourlyThesisMonitorContract";
  "version": "2.4.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_2";
  "source": {
  "monitor_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "links": {
  "master_analysis_id": string;
  "plan_id": string;
  "active_thesis_id": string;
  "previous_monitor_id": unknown;
  "setup_id": unknown;
  "position_id": unknown;
};
  "checkpoint": {
  "checkpoint_paris": string;
  "gpt_cadence": "M15";
  "engine_cadence": "M1";
  "window_start_paris": string;
  "window_end_paris": string;
};
  "delta_summary": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "new_risks": string[];
  "new_opportunities": string[];
};
  "assessment": {
  "expected_path": string[];
  "realized_path": string[];
  "failure_path": string[];
  "causality_summary": string;
};
  "checks": {
  "expected_vs_realized": unknown;
  "macro_update": unknown;
  "cross_asset_delta": unknown;
  "technical_delta": unknown;
  "weak_signals": unknown;
  "scenario_transformation": unknown;
  "time_decay": unknown;
  "position": unknown;
};
  "condition_evaluations": ({
  "condition_id": string;
  "state": "NOT_STARTED" | "PENDING" | "SATISFIED" | "FAILED" | "INVALIDATED" | "EXPIRED" | "UNKNOWN";
  "observed_at_paris": string | null;
  "authority": "BACKEND_SNAPSHOT";
  "evaluator_version": string;
  "evidence_refs": string[];
  "reason": string;
})[];
  "thesis_health": {
  "state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "score": number;
  "previous_score": number | null;
  "drivers": string[];
};
  "command": unknown;
  "active_thesis_update": {
  "thesis_id": string;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "health_score": number;
  "summary": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
};
  "data_quality": {
  "status": "CANONICAL" | "DEGRADED" | "UNUSABLE";
  "hard_gate_states": unknown[];
  "soft_gate_states": unknown[];
  "notes": string[];
};
  "catchup": {
  "policy": "LATEST_SETTLED_CLOSED_M15";
  "cumulative_window_start_paris": string;
  "cumulative_window_end_paris": string;
  "superseded_checkpoints": string[];
};
  "alert": null | {
  "level": "INFO" | "WATCH" | "WARNING" | "ACTION" | "CRITICAL";
  "code": string;
  "message": string;
};
  "next_handoff": {
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "priorities": string[];
  "context_summary": string;
};
  "audit": unknown;
};

export type HourlyMonitorV2 = {
  "contract": {
  "name": "DeskHourlyThesisMonitorContract";
  "version": "2.0.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1";
  "source": {
  "monitor_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "links": {
  "master_analysis_id": string;
  "plan_id": string;
  "active_thesis_id": string;
  "previous_monitor_id": unknown;
  "setup_id": unknown;
  "position_id": unknown;
};
  "checkpoint": {
  "checkpoint_paris": string;
  "gpt_cadence": "M5";
  "engine_cadence": "M1";
  "window_start_paris": string;
  "window_end_paris": string;
};
  "delta_summary": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "new_risks": string[];
  "new_opportunities": string[];
};
  "assessment": {
  "expected_path": string[];
  "realized_path": string[];
  "failure_path": string[];
  "causality_summary": string;
};
  "checks": {
  "expected_vs_realized": unknown;
  "macro_update": unknown;
  "cross_asset_delta": unknown;
  "technical_delta": unknown;
  "weak_signals": unknown;
  "scenario_transformation": unknown;
  "time_decay": unknown;
  "position": unknown;
};
  "condition_evaluations": ({
  "condition_id": string;
  "state": "NOT_STARTED" | "PENDING" | "SATISFIED" | "FAILED" | "INVALIDATED" | "EXPIRED" | "UNKNOWN";
  "observed_at_paris": string | null;
  "authority": "BACKEND_SNAPSHOT";
  "evaluator_version": string;
  "evidence_refs": string[];
  "reason": string;
})[];
  "thesis_health": {
  "state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "score": number;
  "previous_score": number | null;
  "drivers": string[];
};
  "command": unknown;
  "active_thesis_update": {
  "thesis_id": string;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "health_score": number;
  "summary": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
};
  "data_quality": {
  "status": "CANONICAL" | "DEGRADED" | "UNUSABLE";
  "hard_gate_states": unknown[];
  "soft_gate_states": unknown[];
  "notes": string[];
};
  "catchup": {
  "policy": "LATEST_SETTLED_CLOSED_M5";
  "cumulative_window_start_paris": string;
  "cumulative_window_end_paris": string;
  "superseded_checkpoints": string[];
};
  "alert": null | {
  "level": "INFO" | "WATCH" | "WARNING" | "ACTION" | "CRITICAL";
  "code": string;
  "message": string;
};
  "next_handoff": {
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "priorities": string[];
  "context_summary": string;
};
  "audit": unknown;
};

export type HourlyMonitor = {
  "monitor_id"?: string;
  "contract_name"?: "DeskHourlyThesisMonitorContract";
  "schema_version"?: "1.0.0";
  "contract_hash": string;
  "timestamp_paris": string;
  "linked_master_analysis_id": string;
  "linked_active_thesis_id": string;
  "linked_previous_monitor_id"?: string;
  "monitor_decision": {
  [key: string]: unknown;
};
  "thesis_health_score": {
  [key: string]: unknown;
};
  "expected_vs_realized"?: unknown[];
  "macro_update"?: {
  [key: string]: unknown;
};
  "cross_asset_delta"?: {
  [key: string]: unknown;
};
  "technical_delta"?: {
  [key: string]: unknown;
};
  "wait_to_go_check"?: unknown[];
  "invalidation_check"?: unknown[];
  "weak_signals"?: unknown[];
  "monitor_context_transmission"?: {
  [key: string]: unknown;
};
  "front_projection"?: unknown;
  [key: string]: unknown;
};

export type MasterAnalysisV51 = {
  "contract": {
  "name": "DeskMasterAnalysisContract";
  "version": "5.1.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "source": {
  "analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "analysis_sections": {
  "facts": unknown[];
  "interpretations": unknown[];
  "macro": unknown;
  "cross_asset": unknown;
  "technical": unknown;
  "levels": unknown;
  "asset_selection": unknown;
  "opportunities": string[];
  "risks": string[];
  "decision_summary": string;
};
  "market_context": {
  "global_regime": "RISK_ON_EXPANSION" | "RISK_OFF_STRESS" | "TECH_ROTATION" | "BROAD_MARKET_ROTATION" | "COMPRESSION" | "RANGE" | "EXHAUSTION" | "NEUTRAL";
  "regime_status": "DOMINANT" | "SECONDARY" | "ELIMINATED" | "UNCONFIRMED";
  "volatility_regime": "LOW" | "NORMAL" | "HIGH" | "EXTREME" | "UNKNOWN";
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "cross_asset_reading": string;
  "macro_reading": string;
};
  "hypotheses": unknown[];
  "selected_hypothesis": {
  "hypothesis_id": string;
  "kind": "BULL" | "BEAR" | "RANGE" | "BEST_LONG" | "BEST_SHORT" | "WAIT";
  "reason": string;
};
  "execution_plan": unknown;
  "active_thesis": {
  "thesis_id": string;
  "plan_id": string;
  "selected_hypothesis_id": string;
  "primary_setup_id": string | null;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "instrument": string;
  "direction": "long" | "short" | "neutral" | "wait";
  "valid_from_paris": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
  "health_state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "summary": string;
  "expected_path": unknown[];
  "failure_path": unknown[];
  "scenario_transformations": unknown[];
  "level_watchlist": unknown[];
  "invalidation_condition_ids": string[];
};
  "monitor_handoff": {
  "gpt_cadence": "M5";
  "engine_cadence": "M1";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "thesis_health_baseline": number;
  "context_transmission": unknown;
  "session_matrix": unknown[];
  "allowed_windows": unknown[];
  "update_agenda": unknown[];
  "monitoring_priorities": string[];
  "monitoring_playbook": unknown[];
  "handoff_summary": string;
};
  "audit": unknown;
};

export type MasterAnalysisV52 = {
  "contract": {
  "name": "DeskMasterAnalysisContract";
  "version": "5.2.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "source": {
  "analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "analysis_sections": {
  "facts": unknown[];
  "interpretations": unknown[];
  "macro": unknown;
  "cross_asset": unknown;
  "technical": unknown;
  "levels": unknown;
  "asset_selection": unknown;
  "opportunities": string[];
  "risks": string[];
  "decision_summary": string;
};
  "market_context": {
  "global_regime": "RISK_ON_EXPANSION" | "RISK_OFF_STRESS" | "TECH_ROTATION" | "BROAD_MARKET_ROTATION" | "COMPRESSION" | "RANGE" | "EXHAUSTION" | "NEUTRAL";
  "regime_status": "DOMINANT" | "SECONDARY" | "ELIMINATED" | "UNCONFIRMED";
  "volatility_regime": "LOW" | "NORMAL" | "HIGH" | "EXTREME" | "UNKNOWN";
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "cross_asset_reading": string;
  "macro_reading": string;
};
  "hypotheses": unknown[];
  "selected_hypothesis": {
  "hypothesis_id": string;
  "kind": "BULL" | "BEAR" | "RANGE" | "BEST_LONG" | "BEST_SHORT" | "WAIT";
  "reason": string;
};
  "execution_plan": unknown;
  "active_thesis": {
  "thesis_id": string;
  "plan_id": string;
  "selected_hypothesis_id": string;
  "primary_setup_id": string | null;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "instrument": string;
  "direction": "long" | "short" | "neutral" | "wait";
  "valid_from_paris": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
  "health_state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "summary": string;
  "expected_path": unknown[];
  "failure_path": unknown[];
  "scenario_transformations": unknown[];
  "level_watchlist": unknown[];
  "invalidation_condition_ids": string[];
};
  "monitor_handoff": {
  "gpt_cadence": "M5";
  "engine_cadence": "M1";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "thesis_health_baseline": number;
  "context_transmission": unknown;
  "session_matrix": unknown[];
  "allowed_windows": unknown[];
  "update_agenda": unknown[];
  "monitoring_priorities": string[];
  "monitoring_playbook": unknown[];
  "handoff_summary": string;
};
  "audit": unknown;
};

export type MasterAnalysisV53 = {
  "contract": {
  "name": "DeskMasterAnalysisContract";
  "version": "5.3.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "source": {
  "analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "analysis_sections": {
  "facts": unknown[];
  "interpretations": unknown[];
  "macro": unknown;
  "cross_asset": unknown;
  "technical": unknown;
  "levels": unknown;
  "asset_selection": unknown;
  "opportunities": string[];
  "risks": string[];
  "decision_summary": string;
};
  "market_context": {
  "global_regime": "RISK_ON_EXPANSION" | "RISK_OFF_STRESS" | "TECH_ROTATION" | "BROAD_MARKET_ROTATION" | "COMPRESSION" | "RANGE" | "EXHAUSTION" | "NEUTRAL";
  "regime_status": "DOMINANT" | "SECONDARY" | "ELIMINATED" | "UNCONFIRMED";
  "volatility_regime": "LOW" | "NORMAL" | "HIGH" | "EXTREME" | "UNKNOWN";
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "cross_asset_reading": string;
  "macro_reading": string;
};
  "hypotheses": unknown[];
  "selected_hypothesis": {
  "hypothesis_id": string;
  "kind": "BULL" | "BEAR" | "RANGE" | "BEST_LONG" | "BEST_SHORT" | "WAIT";
  "reason": string;
};
  "execution_plan": unknown;
  "active_thesis": {
  "thesis_id": string;
  "plan_id": string;
  "selected_hypothesis_id": string;
  "primary_setup_id": string | null;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "instrument": string;
  "direction": "long" | "short" | "neutral" | "wait";
  "valid_from_paris": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
  "health_state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "summary": string;
  "expected_path": unknown[];
  "failure_path": unknown[];
  "scenario_transformations": unknown[];
  "level_watchlist": unknown[];
  "invalidation_condition_ids": string[];
};
  "monitor_handoff": {
  "gpt_cadence": "M15";
  "engine_cadence": "M1";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "thesis_health_baseline": number;
  "context_transmission": unknown;
  "session_matrix": unknown[];
  "allowed_windows": unknown[];
  "update_agenda": unknown[];
  "monitoring_priorities": string[];
  "monitoring_playbook": unknown[];
  "handoff_summary": string;
};
  "audit": unknown;
};

export type MasterAnalysisV54 = {
  "contract": {
  "name": "DeskMasterAnalysisContract";
  "version": "5.4.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "source": {
  "analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "analysis_sections": {
  "facts": unknown[];
  "interpretations": unknown[];
  "macro": unknown;
  "cross_asset": unknown;
  "technical": unknown;
  "levels": unknown;
  "asset_selection": unknown;
  "opportunities": string[];
  "risks": string[];
  "decision_summary": string;
};
  "market_context": {
  "global_regime": "RISK_ON_EXPANSION" | "RISK_OFF_STRESS" | "TECH_ROTATION" | "BROAD_MARKET_ROTATION" | "COMPRESSION" | "RANGE" | "EXHAUSTION" | "NEUTRAL";
  "regime_status": "DOMINANT" | "SECONDARY" | "ELIMINATED" | "UNCONFIRMED";
  "volatility_regime": "LOW" | "NORMAL" | "HIGH" | "EXTREME" | "UNKNOWN";
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "cross_asset_reading": string;
  "macro_reading": string;
};
  "hypotheses": unknown[];
  "selected_hypothesis": {
  "hypothesis_id": string;
  "kind": "BULL" | "BEAR" | "RANGE" | "BEST_LONG" | "BEST_SHORT" | "WAIT";
  "reason": string;
};
  "execution_plan": unknown;
  "active_thesis": {
  "thesis_id": string;
  "plan_id": string;
  "selected_hypothesis_id": string;
  "primary_setup_id": string | null;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "instrument": string;
  "direction": "long" | "short" | "neutral" | "wait";
  "valid_from_paris": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
  "health_state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "summary": string;
  "expected_path": unknown[];
  "failure_path": unknown[];
  "scenario_transformations": unknown[];
  "level_watchlist": unknown[];
  "invalidation_condition_ids": string[];
};
  "monitor_handoff": {
  "gpt_cadence": "M15";
  "engine_cadence": "M1";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "thesis_health_baseline": number;
  "context_transmission": unknown;
  "session_matrix": unknown[];
  "allowed_windows": unknown[];
  "update_agenda": unknown[];
  "monitoring_priorities": string[];
  "monitoring_playbook": unknown[];
  "handoff_summary": string;
};
  "audit": unknown;
};

export type MasterAnalysisV5 = {
  "contract": {
  "name": "DeskMasterAnalysisContract";
  "version": "5.0.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "source": {
  "analysis_id": string;
  "bundle_id": string;
  "pack_id": string;
  "pack_build_id": string;
};
  "scope": unknown;
  "analysis_sections": {
  "facts": unknown[];
  "interpretations": unknown[];
  "macro": unknown;
  "cross_asset": unknown;
  "technical": unknown;
  "levels": unknown;
  "asset_selection": unknown;
  "opportunities": string[];
  "risks": string[];
  "decision_summary": string;
};
  "market_context": {
  "global_regime": "RISK_ON_EXPANSION" | "RISK_OFF_STRESS" | "TECH_ROTATION" | "BROAD_MARKET_ROTATION" | "COMPRESSION" | "RANGE" | "EXHAUSTION" | "NEUTRAL";
  "regime_status": "DOMINANT" | "SECONDARY" | "ELIMINATED" | "UNCONFIRMED";
  "volatility_regime": "LOW" | "NORMAL" | "HIGH" | "EXTREME" | "UNKNOWN";
  "primary_bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "cross_asset_reading": string;
  "macro_reading": string;
};
  "hypotheses": unknown[];
  "selected_hypothesis": {
  "hypothesis_id": string;
  "kind": "BULL" | "BEAR" | "RANGE" | "BEST_LONG" | "BEST_SHORT" | "WAIT";
  "reason": string;
};
  "execution_plan": unknown;
  "active_thesis": {
  "thesis_id": string;
  "plan_id": string;
  "selected_hypothesis_id": string;
  "primary_setup_id": string | null;
  "state": "NO_ACTIVE" | "WAIT_MONITORED" | "CONDITIONAL" | "ACTIVE" | "WEAKENED" | "AT_RISK" | "POST_EVENT" | "INVALIDATED" | "EXPIRED" | "REPLAN_REQUIRED" | "SUPERSEDED";
  "bias": "BULLISH" | "BEARISH" | "NEUTRAL" | "MIXED" | "UNKNOWN";
  "instrument": string;
  "direction": "long" | "short" | "neutral" | "wait";
  "valid_from_paris": string;
  "valid_until_paris": string;
  "requires_replan_after_paris": string;
  "health_state": "STRONG" | "VALID" | "FRAGILE" | "VERY_FRAGILE" | "NON_EXECUTABLE";
  "summary": string;
  "expected_path": unknown[];
  "failure_path": unknown[];
  "scenario_transformations": unknown[];
  "level_watchlist": unknown[];
  "invalidation_condition_ids": string[];
};
  "monitor_handoff": {
  "gpt_cadence": "M5";
  "engine_cadence": "M1";
  "next_checkpoint_paris": string;
  "watch_condition_ids": string[];
  "thesis_health_baseline": number;
  "context_transmission": unknown;
  "session_matrix": unknown[];
  "allowed_windows": unknown[];
  "update_agenda": unknown[];
  "monitoring_priorities": string[];
  "monitoring_playbook": unknown[];
  "handoff_summary": string;
};
  "audit": unknown;
};

export type MasterAnalysis = {
  "analysis_id"?: string;
  "contract_name"?: "DeskMasterAnalysisContract";
  "schema_version"?: "4.0.0";
  "contract_hash": string;
  "pack_id": string;
  "date": string;
  "session": "asia_open" | "london_session" | "ny_open" | "work_forward" | "post_event_replan";
  "active_thesis_id"?: string;
  "report_id"?: string;
  "decision_id"?: string;
  "status"?: "ready" | "archived";
  "created_at_paris": string;
  "full_analysis": {
  [key: string]: unknown;
};
  "context_transmission"?: {
  [key: string]: unknown;
};
  "decision_journal"?: {
  [key: string]: unknown;
};
  "front_projection"?: unknown;
  [key: string]: unknown;
};

export type MonitorAlert = {
  "alert_id"?: string;
  "timestamp_paris"?: string;
  "alert_level": "info" | "watch" | "warning" | "action" | "critical";
  "title": string;
  "message": string;
  "linked_monitor_id"?: string;
  "linked_thesis_id"?: string;
  "action_required"?: string;
  "send_to_telegram"?: boolean;
  [key: string]: unknown;
};

export type MonitorCommandV11 = {
  "contract": {
  "name": "DeskMonitorCommandContract";
  "version": "1.1.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_1";
  "command_id": string;
  "expected_revision": number;
  "created_at_paris": string;
  "plan_id": string;
  "monitor_id": string;
  "scope": unknown;
  "requested_action": "NO_ACTION" | "APPLY_ORTHOGONAL_COMMANDS";
  "setup_transition": null | unknown;
  "transformation": null | unknown;
  "replan_request": null | unknown;
  "management_request": null | unknown;
  "evidence": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "source_references": string[];
};
  "backend_authority": "BACKEND_ONLY";
  "audit": unknown;
};

export type MonitorCommandV12 = {
  "contract": {
  "name": "DeskMonitorCommandContract";
  "version": "1.2.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_2";
  "command_id": string;
  "expected_revision": number;
  "created_at_paris": string;
  "plan_id": string;
  "monitor_id": string;
  "scope": unknown;
  "requested_action": "NO_ACTION" | "APPLY_ORTHOGONAL_COMMANDS";
  "setup_transition": null | unknown;
  "transformation": null | unknown;
  "replan_request": null | unknown;
  "management_request": null | unknown;
  "evidence": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "source_references": string[];
};
  "backend_authority": "BACKEND_ONLY";
  "audit": unknown;
};

export type MonitorCommandV13 = {
  "contract": {
  "name": "DeskMonitorCommandContract";
  "version": "1.3.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_2";
  "command_id": string;
  "expected_revision": number;
  "created_at_paris": string;
  "plan_id": string;
  "monitor_id": string;
  "scope": unknown;
  "requested_action": "NO_ACTION" | "APPLY_ORTHOGONAL_COMMANDS";
  "setup_transition": null | unknown;
  "transformation": null | unknown;
  "replan_request": null | unknown;
  "management_request": null | unknown;
  "evidence": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "source_references": string[];
};
  "backend_authority": "BACKEND_ONLY";
  "audit": unknown;
};

export type MonitorCommandV14 = {
  "contract": {
  "name": "DeskMonitorCommandContract";
  "version": "1.4.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1_2";
  "command_id": string;
  "expected_revision": number;
  "created_at_paris": string;
  "plan_id": string;
  "monitor_id": string;
  "scope": unknown;
  "requested_action": "NO_ACTION" | "APPLY_ORTHOGONAL_COMMANDS";
  "setup_transition": null | unknown;
  "transformation": null | unknown;
  "replan_request": null | unknown;
  "management_request": null | unknown;
  "evidence": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "source_references": string[];
};
  "backend_authority": "BACKEND_ONLY";
  "audit": unknown;
};

export type MonitorCommandV1 = {
  "contract": {
  "name": "DeskMonitorCommandContract";
  "version": "1.0.0";
};
  "profile": "OPPORTUNITY_SEEKING_CONTROLLED";
  "catalog_id": "condition_catalog_v1";
  "command_id": string;
  "expected_revision": number;
  "created_at_paris": string;
  "plan_id": string;
  "monitor_id": string;
  "scope": unknown;
  "requested_action": "NO_ACTION" | "APPLY_ORTHOGONAL_COMMANDS";
  "setup_transition": null | unknown;
  "transformation": null | unknown;
  "replan_request": null | unknown;
  "management_request": null | unknown;
  "evidence": {
  "facts": string[];
  "interpretations": string[];
  "thesis_evolution": string;
  "source_references": string[];
};
  "backend_authority": "BACKEND_ONLY";
  "audit": unknown;
};

export type PositionManagement = {
  "position_id"?: string;
  "instrument"?: "MNQ" | "NQ" | "MES" | "ES";
  "direction"?: "long" | "short";
  "entry_price"?: number;
  "stop_loss"?: number;
  "take_profits"?: unknown[];
  "risk_pct"?: number;
  "status"?: "active" | "protected" | "partial_taken" | "closed" | "cancelled";
  "linked_thesis_id"?: string;
  "linked_decision_id"?: string;
  "management_action"?: "create" | "update" | "break_even" | "partial" | "reduce" | "exit" | "cancel";
  "notes"?: string;
  [key: string]: unknown;
};

export type Report = {
  "report_id"?: string;
  "pack_id"?: string;
  "decision_id"?: string;
  "date": string;
  "session": "asia_open" | "asia_to_london" | "ny_open";
  "timezone"?: "Europe/Paris";
  "title": string;
  "markdown": string;
  "summary"?: string;
  "sections"?: {
  [key: string]: unknown;
};
  "status"?: "generated" | "sent" | "archived";
};

export type Setup = {
  "setup_id": string;
  "label": string;
  "rank"?: number;
  "priority"?: number;
  "instrument": "MNQ" | "NQ" | "MES" | "ES" | "WAIT";
  "decision"?: "prendre" | "ne_pas_prendre" | "wait" | "gestion_seule";
  "direction": "long" | "short" | "neutral" | "wait";
  "setup_type": "buy_limit_pullback" | "sell_limit_pullback" | "buy_stop_breakout" | "sell_stop_breakdown" | "sell_stop_breakdown_retest" | "buy_stop_breakout_retest" | "wait" | "wait_only" | "no_trade" | "management_only";
  "order_type"?: "buy_limit" | "sell_limit" | "buy_stop" | "sell_stop" | "sell_stop_or_retest" | "buy_stop_or_retest" | "market" | "conditional" | "wait" | "cancel";
  "status"?: "active" | "secondary" | "inactive" | "cancelled" | "wait" | "management_only";
  "entry_zone"?: {
  "from": number;
  "to": number;
};
  "entry_trigger"?: string | {
  [key: string]: unknown;
};
  "stop_loss"?: number;
  "take_profits"?: ({
  "name": string;
  "target": number | {
  "from": number;
  "to": number;
};
  "condition"?: string;
  "action"?: string;
})[];
  "extension_target"?: number | {
  "from": number;
  "to": number;
};
  "invalidation": string | {
  [key: string]: unknown;
};
  "risk_pct": number;
  "confidence_pct": number;
  "rr_minimum"?: number;
  "reason": string;
  "conditions"?: string[];
  "management_rules"?: string[];
  "management"?: {
  [key: string]: unknown;
};
  "executable"?: boolean;
  [key: string]: unknown;
};

export type SimulationRun = {
  "contract_name"?: "DeskSimulationRun";
  "schema_version"?: "1.0.0";
  "simulation_id": string;
  "date": string;
  "session": "asia_open" | "asia_to_london" | "ny_open" | "custom";
  "timezone": "Europe/Paris";
  "mode": "backtest" | "replay" | "simulation" | "paper";
  "status": "draft" | "running" | "paused" | "completed" | "failed" | "archived";
  "source_pack_id": string;
  "initial_cutoff_paris": string;
  "current_cutoff_paris": string;
  "created_at_paris": string;
  "completed_at_paris"?: string | null;
  "step_ids": string[];
  "decision_ids": string[];
  "audit_ids": string[];
  "outcome_ids"?: string[];
  "review_id"?: string | null;
  "notes"?: string;
};

export type SimulationStep = {
  "contract_name"?: "DeskSimulationStep";
  "schema_version"?: "1.0.0";
  "step_id": string;
  "simulation_id": string;
  "step_index": number;
  "step_type": "next_5m" | "next_15m" | "next_hour" | "next_event" | "end_session";
  "status": "pending" | "applied" | "blocked" | "failed";
  "started_at_paris": string;
  "ended_at_paris": string;
  "data_cutoff_paris": string;
  "available_data_until": string;
  "visible_dataset_refs": {
  "dataset_id": string;
  "source": string;
  "available_until_paris"?: string;
}[];
  "blocked_dataset_refs": {
  "dataset_id": string;
  "source": string;
  "blocked_reason": string;
}[];
  "decision_id"?: string | null;
  "audit_id": string;
  "outcome_id"?: string | null;
  "action": {
  "type": "generate_master" | "generate_monitor" | "validate_setup" | "wait" | "replay_outcome" | "review" | "none";
  "summary"?: string;
};
  "notes"?: string;
};

export type WorkerMission = {
  "contract_name"?: "DeskWorkerMission";
  "schema_version"?: "1.0.0";
  "mission_id": string;
  "objective": string;
  "allowed_window": {
  "start_paris": string;
  "end_paris": string;
  "timezone": "Europe/Paris";
};
  "required_gates": string[];
  "dod": string[];
  "forbidden_actions": string[];
  "risk_rules": string[];
  "escalation_rules": string[];
  "expires_at_paris": string;
  "status": "draft" | "active" | "waiting" | "completed" | "expired" | "cancelled" | "escalated" | "failed";
  "result_schema_version"?: string;
  "audit_id"?: string | null;
};

