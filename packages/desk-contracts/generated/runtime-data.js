/* Generated from packages/desk-contracts JSON sources. Do not edit manually. */

export const enums = {
  "SESSION_VALUES": [
    "asia_open",
    "asia_to_london",
    "ny_open",
    "custom"
  ],
  "VNEXT_SESSIONS": [
    "asia_open",
    "london_session",
    "ny_open",
    "work_forward",
    "post_event_replan"
  ],
  "DECISION_SESSIONS": [
    "asia_open",
    "asia_to_london",
    "ny_open"
  ],
  "DESK_INSTRUMENTS": [
    "MNQ",
    "NQ",
    "MES",
    "ES",
    "WAIT"
  ],
  "TRADE_INSTRUMENTS": [
    "MNQ",
    "NQ",
    "MES",
    "ES"
  ],
  "THESIS_STATUSES": [
    "NO_ACTIVE_THESIS",
    "THESIS_ACTIVE",
    "THESIS_CONDITIONAL",
    "WAIT_MONITORED",
    "THESIS_WEAKENED",
    "THESIS_AT_RISK",
    "THESIS_INVALIDATED",
    "SETUP_ARMED",
    "SETUP_TRIGGERED",
    "REPLAN_REQUIRED",
    "EXPIRED"
  ],
  "ANALYSIS_TYPES": [
    "asia_open",
    "london_session",
    "ny_open",
    "work_forward",
    "live_position",
    "post_event_replan",
    "position_monitor",
    "weekly_brief",
    "daily_brief"
  ],
  "DATASETS": [
    "MNQ_M5",
    "MES_M5",
    "NQ_M15",
    "NQ_H1",
    "ES_M15",
    "ES_H1",
    "MNQ_H4",
    "MES_H4",
    "NQ_H4",
    "ES_H4",
    "US10Y_US02Y",
    "US10Y_US02Y_H4",
    "DXY_CL_GC_VIX",
    "DXY_CL_GC_VIX_H4",
    "indices_asie_europe",
    "indices_asie_europe_H4",
    "ny_close_mega_caps",
    "mega_caps_premarket",
    "mega_caps_premarket_H4",
    "macro_calendar",
    "news_digest"
  ]
};

export const registry = {
  "registry_version": "2.0.0",
  "active_contracts": {
    "master_contract": {
      "contract_id": "DeskMasterAnalysisContract_v4_0_0",
      "contract_name": "DeskMasterAnalysisContract",
      "schema_version": "4.0.0",
      "hash": "702f9fe325f61fdb53e913592da268b5a4aa2bafe5dd879ece915adc64d1c8e8",
      "markdown_path": "contracts/DeskMasterAnalysisContract_v4_0_0.md",
      "schema_path": "schemas/entities/master-analysis.schema.json",
      "status": "active",
      "runtime_exposed": true
    },
    "monitor_contract": {
      "contract_id": "DeskHourlyThesisMonitorContract_v1_0_0",
      "contract_name": "DeskHourlyThesisMonitorContract",
      "schema_version": "1.0.0",
      "hash": "be807ab3cb0450d0c84817d882a4b6dea70ea3ccae377d07da545798d80a6bd0",
      "markdown_path": "contracts/DeskHourlyThesisMonitorContract_v1_0_0.md",
      "schema_path": "schemas/entities/hourly-monitor.schema.json",
      "status": "active",
      "runtime_exposed": true
    },
    "front_projection_contract": {
      "contract_id": "DeskFrontProjectionContract_v1_0_0",
      "contract_name": "DeskFrontProjectionContract",
      "schema_version": "1.0.0",
      "hash": "f1109aa76401e53da560d682ff03fedeef12bc12717c47e67ce2b107ccd399d6",
      "markdown_path": "contracts/DeskFrontProjectionContract_v1_0_0.md",
      "schema_path": "schemas/entities/desk-front-projection.schema.json",
      "status": "active",
      "runtime_exposed": true
    }
  },
  "entity_contracts": {
    "decision_audit_contract": {
      "contract_id": "DeskDecisionAuditContract_v1_0_0",
      "contract_name": "DeskDecisionAuditContract",
      "schema_version": "1.0.0",
      "schema_path": "schemas/entities/decision-audit.schema.json",
      "example_path": "examples/decision-audit.example.json",
      "status": "active",
      "runtime_exposed": false,
      "owner_milestone": "M7.2 Contracts foundation"
    },
    "simulation_run_contract": {
      "contract_id": "DeskSimulationRun_v1_0_0",
      "contract_name": "DeskSimulationRun",
      "schema_version": "1.0.0",
      "schema_path": "schemas/entities/simulation-run.schema.json",
      "example_path": "examples/simulation-run.example.json",
      "status": "active",
      "runtime_exposed": false,
      "owner_milestone": "M7.2 Contracts foundation"
    },
    "simulation_step_contract": {
      "contract_id": "DeskSimulationStep_v1_0_0",
      "contract_name": "DeskSimulationStep",
      "schema_version": "1.0.0",
      "schema_path": "schemas/entities/simulation-step.schema.json",
      "example_path": "examples/simulation-step.example.json",
      "status": "active",
      "runtime_exposed": false,
      "owner_milestone": "M7.2 Contracts foundation"
    },
    "worker_mission_contract": {
      "contract_id": "DeskWorkerMission_v1_0_0",
      "contract_name": "DeskWorkerMission",
      "schema_version": "1.0.0",
      "schema_path": "schemas/entities/worker-mission.schema.json",
      "example_path": "examples/worker-mission.example.json",
      "status": "active",
      "runtime_exposed": false,
      "owner_milestone": "M11 Simulation/paper/worker"
    },
    "dashboard_state_contract": {
      "contract_id": "DeskDashboardState_v1_0_0",
      "contract_name": "DeskDashboardState",
      "schema_version": "1.0.0",
      "schema_path": "schemas/entities/dashboard-state.schema.json",
      "example_path": "examples/dashboard-state.example.json",
      "status": "active",
      "runtime_exposed": false,
      "owner_milestone": "M9 Read-only dashboard"
    },
    "front_projection_contract": {
      "contract_id": "DeskFrontProjectionContract_v1_0_0",
      "contract_name": "DeskFrontProjectionContract",
      "schema_version": "1.0.0",
      "schema_path": "schemas/entities/desk-front-projection.schema.json",
      "example_path": "examples/desk-front-projection.example.json",
      "status": "active",
      "runtime_exposed": true,
      "owner_milestone": "New React front Lot 1"
    }
  },
  "lifecycle_policy": {
    "statuses": [
      "draft",
      "active",
      "archived"
    ],
    "runtime_exposed": "all_active_contracts",
    "breaking_change_rule": "Any incompatible schema change must create a new schema_version and keep the previous schema available."
  }
};

export const entitySchemas = {
  "active-thesis-update.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/active-thesis-update.schema.json",
    "title": "DeskActiveThesisUpdate",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "NO_ACTIVE_THESIS",
          "THESIS_ACTIVE",
          "THESIS_CONDITIONAL",
          "WAIT_MONITORED",
          "THESIS_WEAKENED",
          "THESIS_AT_RISK",
          "THESIS_INVALIDATED",
          "SETUP_ARMED",
          "SETUP_TRIGGERED",
          "REPLAN_REQUIRED",
          "EXPIRED"
        ]
      },
      "health_score": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "confidence_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "last_monitor_id": {
        "type": "string"
      },
      "dominant_scenario": {
        "type": "string"
      },
      "secondary_scenario": {
        "type": "string"
      },
      "notes": {
        "type": "string"
      }
    },
    "required": [
      "thesis_id"
    ],
    "additionalProperties": true
  },
  "active-thesis.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/active-thesis.schema.json",
    "title": "DeskActiveThesis",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "linked_master_analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "NO_ACTIVE_THESIS",
          "THESIS_ACTIVE",
          "THESIS_CONDITIONAL",
          "WAIT_MONITORED",
          "THESIS_WEAKENED",
          "THESIS_AT_RISK",
          "THESIS_INVALIDATED",
          "SETUP_ARMED",
          "SETUP_TRIGGERED",
          "REPLAN_REQUIRED",
          "EXPIRED"
        ]
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES",
          "WAIT"
        ]
      },
      "direction": {
        "type": "string",
        "enum": [
          "long",
          "short",
          "neutral",
          "wait"
        ]
      },
      "dominant_scenario": {
        "type": "string",
        "minLength": 1
      },
      "secondary_scenario": {
        "type": "string"
      },
      "confidence_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "health_score": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "valid_from": {
        "type": "string"
      },
      "valid_until": {
        "type": "string"
      },
      "setup_expiry_time": {
        "type": "string"
      },
      "requires_replan_after": {
        "type": "string"
      },
      "key_levels": {
        "type": "array",
        "items": {}
      },
      "wait_to_go_conditions": {
        "type": "array",
        "items": {}
      },
      "invalidation_conditions": {
        "type": "array",
        "items": {}
      },
      "expected_path": {
        "type": "object",
        "additionalProperties": true
      },
      "failure_path": {
        "type": "object",
        "additionalProperties": true
      },
      "scenario_transformation_map": {
        "type": "array",
        "items": {}
      },
      "monitoring_playbook": {
        "type": "array",
        "items": {}
      },
      "last_monitor_id": {
        "type": "string"
      }
    },
    "required": [
      "linked_master_analysis_id",
      "status",
      "instrument",
      "direction",
      "dominant_scenario",
      "confidence_pct",
      "health_score",
      "valid_from"
    ],
    "additionalProperties": true
  },
  "analysis.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/analysis.schema.json",
    "title": "DeskFuturesAnalysisContract",
    "version": "1.1.0",
    "type": "object",
    "properties": {
      "schema_version": {
        "type": "string",
        "enum": [
          "1.0.0",
          "1.1.0"
        ]
      },
      "contract_name": {
        "type": "string",
        "const": "DeskFuturesAnalysisContract"
      },
      "analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "created_at_paris": {
        "type": "string"
      },
      "mode": {
        "type": "string",
        "enum": [
          "live",
          "backtest",
          "replay",
          "paper"
        ],
        "default": "live"
      },
      "analysis_type": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward",
          "live_position",
          "post_event_replan",
          "position_monitor",
          "weekly_brief",
          "daily_brief"
        ]
      },
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "report_id": {
        "type": "string",
        "minLength": 3
      },
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "created_at": {
        "type": "string"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "asia_to_london",
          "ny_open"
        ]
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "title": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "generated",
          "ready",
          "sent",
          "archived"
        ],
        "default": "ready"
      },
      "scope": {
        "type": "object",
        "additionalProperties": true
      },
      "source_pack": {
        "type": "object",
        "additionalProperties": true
      },
      "executive_summary": {
        "type": "object",
        "properties": {
          "summary": {
            "type": "string",
            "minLength": 1
          },
          "final_decision": {
            "type": "string",
            "enum": [
              "prendre",
              "ne_pas_prendre",
              "wait",
              "gestion_seule"
            ]
          },
          "final_instrument": {
            "type": "string",
            "enum": [
              "MNQ",
              "NQ",
              "MES",
              "ES",
              "WAIT"
            ]
          },
          "final_direction": {
            "type": "string",
            "enum": [
              "long",
              "short",
              "neutral",
              "wait"
            ]
          },
          "primary_setup_id": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "summary",
          "final_decision",
          "final_instrument",
          "final_direction"
        ],
        "additionalProperties": true
      },
      "context": {
        "type": "object",
        "additionalProperties": true
      },
      "market_funnel": {
        "type": "object",
        "additionalProperties": true
      },
      "levels": {
        "type": "object",
        "additionalProperties": true
      },
      "strategic_brief": {
        "type": "object",
        "additionalProperties": true
      },
      "decision_gates": {
        "type": "object",
        "additionalProperties": true
      },
      "summary": {
        "type": "string",
        "minLength": 1
      },
      "primary_setup_id": {
        "type": "string",
        "minLength": 1
      },
      "final_decision": {
        "type": "string",
        "enum": [
          "prendre",
          "ne_pas_prendre",
          "wait",
          "gestion_seule"
        ]
      },
      "final_instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES",
          "WAIT"
        ]
      },
      "final_direction": {
        "type": "string",
        "enum": [
          "long",
          "short",
          "neutral",
          "wait"
        ]
      },
      "setups": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "properties": {
            "setup_id": {
              "type": "string",
              "minLength": 1
            },
            "label": {
              "type": "string",
              "minLength": 1
            },
            "rank": {
              "type": "integer",
              "minimum": 1
            },
            "priority": {
              "type": "integer",
              "minimum": 1
            },
            "instrument": {
              "type": "string",
              "enum": [
                "MNQ",
                "NQ",
                "MES",
                "ES",
                "WAIT"
              ]
            },
            "decision": {
              "type": "string",
              "enum": [
                "prendre",
                "ne_pas_prendre",
                "wait",
                "gestion_seule"
              ],
              "default": "prendre"
            },
            "direction": {
              "type": "string",
              "enum": [
                "long",
                "short",
                "neutral",
                "wait"
              ]
            },
            "setup_type": {
              "type": "string",
              "enum": [
                "buy_limit_pullback",
                "sell_limit_pullback",
                "buy_stop_breakout",
                "sell_stop_breakdown",
                "sell_stop_breakdown_retest",
                "buy_stop_breakout_retest",
                "wait",
                "wait_only",
                "no_trade",
                "management_only"
              ]
            },
            "order_type": {
              "type": "string",
              "enum": [
                "buy_limit",
                "sell_limit",
                "buy_stop",
                "sell_stop",
                "sell_stop_or_retest",
                "buy_stop_or_retest",
                "market",
                "conditional",
                "wait",
                "cancel"
              ]
            },
            "status": {
              "type": "string",
              "enum": [
                "active",
                "secondary",
                "inactive",
                "cancelled",
                "wait",
                "management_only"
              ]
            },
            "entry_zone": {
              "type": "object",
              "properties": {
                "from": {
                  "type": "number"
                },
                "to": {
                  "type": "number"
                }
              },
              "required": [
                "from",
                "to"
              ],
              "additionalProperties": false
            },
            "entry_trigger": {
              "oneOf": [
                {
                  "type": "string"
                },
                {
                  "type": "object",
                  "additionalProperties": true
                }
              ]
            },
            "stop_loss": {
              "type": "number"
            },
            "take_profits": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1
                  },
                  "target": {
                    "oneOf": [
                      {
                        "type": "number"
                      },
                      {
                        "type": "object",
                        "properties": {
                          "from": {
                            "type": "number"
                          },
                          "to": {
                            "type": "number"
                          }
                        },
                        "required": [
                          "from",
                          "to"
                        ],
                        "additionalProperties": false
                      }
                    ]
                  },
                  "condition": {
                    "type": "string"
                  },
                  "action": {
                    "type": "string"
                  }
                },
                "required": [
                  "name",
                  "target"
                ],
                "additionalProperties": false
              },
              "default": []
            },
            "extension_target": {
              "oneOf": [
                {
                  "type": "number"
                },
                {
                  "type": "object",
                  "properties": {
                    "from": {
                      "type": "number"
                    },
                    "to": {
                      "type": "number"
                    }
                  },
                  "required": [
                    "from",
                    "to"
                  ],
                  "additionalProperties": false
                }
              ]
            },
            "invalidation": {
              "oneOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "type": "object",
                  "additionalProperties": true
                }
              ]
            },
            "risk_pct": {
              "type": "number",
              "minimum": 0,
              "maximum": 10
            },
            "confidence_pct": {
              "type": "number",
              "minimum": 0,
              "maximum": 100
            },
            "rr_minimum": {
              "type": "number",
              "minimum": 0
            },
            "reason": {
              "type": "string",
              "minLength": 1
            },
            "conditions": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "default": []
            },
            "management_rules": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "default": []
            },
            "management": {
              "type": "object",
              "additionalProperties": true
            },
            "executable": {
              "type": "boolean",
              "default": false
            }
          },
          "required": [
            "setup_id",
            "label",
            "instrument",
            "direction",
            "setup_type",
            "invalidation",
            "risk_pct",
            "confidence_pct",
            "reason"
          ],
          "additionalProperties": true
        }
      },
      "executable_decision": {
        "type": "object",
        "properties": {
          "decision_id": {
            "type": "string",
            "minLength": 3
          },
          "pack_id": {
            "type": "string",
            "minLength": 3
          },
          "report_id": {
            "type": "string",
            "minLength": 3
          },
          "analysis_id": {
            "type": "string",
            "minLength": 3
          },
          "created_at": {
            "type": "string"
          },
          "session": {
            "type": "string",
            "enum": [
              "asia_open",
              "asia_to_london",
              "ny_open"
            ]
          },
          "date": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
          },
          "timezone": {
            "type": "string",
            "const": "Europe/Paris",
            "default": "Europe/Paris"
          },
          "instrument": {
            "type": "string",
            "enum": [
              "MNQ",
              "NQ",
              "MES",
              "ES",
              "WAIT"
            ]
          },
          "asset_class": {
            "type": "string",
            "const": "futures",
            "default": "futures"
          },
          "decision": {
            "type": "string",
            "enum": [
              "prendre",
              "ne_pas_prendre",
              "wait",
              "gestion_seule"
            ]
          },
          "direction": {
            "type": "string",
            "enum": [
              "long",
              "short",
              "neutral",
              "wait"
            ]
          },
          "setup_id": {
            "type": "string",
            "minLength": 1
          },
          "setup_type": {
            "type": "string",
            "enum": [
              "buy_limit_pullback",
              "sell_limit_pullback",
              "buy_stop_breakout",
              "sell_stop_breakdown",
              "sell_stop_breakdown_retest",
              "buy_stop_breakout_retest",
              "wait",
              "wait_only",
              "no_trade",
              "management_only"
            ]
          },
          "order_type": {
            "type": "string"
          },
          "confidence_pct": {
            "type": "number",
            "minimum": 0,
            "maximum": 100
          },
          "risk_pct": {
            "type": "number",
            "minimum": 0,
            "maximum": 10
          },
          "rr_minimum": {
            "type": "number",
            "minimum": 0
          },
          "entry_zone": {
            "type": "object",
            "properties": {
              "from": {
                "type": "number"
              },
              "to": {
                "type": "number"
              }
            },
            "required": [
              "from",
              "to"
            ],
            "additionalProperties": false
          },
          "entry_trigger": {
            "type": "string"
          },
          "stop_loss": {
            "type": "number"
          },
          "take_profits": {
            "type": "object",
            "properties": {
              "tp1": {
                "oneOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "object",
                    "properties": {
                      "from": {
                        "type": "number"
                      },
                      "to": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "from",
                      "to"
                    ],
                    "additionalProperties": false
                  }
                ]
              },
              "tp2": {
                "oneOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "object",
                    "properties": {
                      "from": {
                        "type": "number"
                      },
                      "to": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "from",
                      "to"
                    ],
                    "additionalProperties": false
                  }
                ]
              },
              "tp3": {
                "oneOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "object",
                    "properties": {
                      "from": {
                        "type": "number"
                      },
                      "to": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "from",
                      "to"
                    ],
                    "additionalProperties": false
                  }
                ]
              }
            },
            "required": [],
            "additionalProperties": false
          },
          "extension_target": {
            "oneOf": [
              {
                "type": "number"
              },
              {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "number"
                  },
                  "to": {
                    "type": "number"
                  }
                },
                "required": [
                  "from",
                  "to"
                ],
                "additionalProperties": false
              }
            ]
          },
          "invalidation": {
            "type": "string",
            "minLength": 1
          },
          "action_now": {
            "type": "string"
          },
          "no_trade_condition": {
            "type": "string"
          },
          "management_rules": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "default": []
          },
          "time_rules": {
            "type": "object",
            "properties": {
              "earliest_entry_time": {
                "type": "string"
              },
              "latest_entry_time": {
                "type": "string"
              },
              "reduce_before": {
                "type": "string"
              },
              "flatten_before": {
                "type": "string"
              }
            },
            "required": [],
            "additionalProperties": false
          },
          "macro_bias": {
            "type": "string",
            "default": "unknown"
          },
          "technical_bias": {
            "type": "string",
            "default": "unknown"
          },
          "cross_asset_bias": {
            "type": "string",
            "default": "unknown"
          },
          "reason_summary": {
            "type": "string",
            "minLength": 1
          },
          "detailed_reason": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "draft",
              "active",
              "triggered",
              "cancelled",
              "tp1_hit",
              "tp2_hit",
              "tp3_hit",
              "stopped",
              "expired",
              "archived"
            ],
            "default": "draft"
          },
          "decision_audit": {
            "type": "object",
            "description": "Required DecisionAudit envelope for a persistable V2 decision. The entity schema can record violations; this embedded gate only accepts usable audits.",
            "properties": {
              "contract_name": {
                "type": "string",
                "const": "DeskDecisionAuditContract",
                "default": "DeskDecisionAuditContract"
              },
              "schema_version": {
                "type": "string",
                "const": "1.0.0",
                "default": "1.0.0"
              },
              "timezone": {
                "type": "string",
                "const": "Europe/Paris",
                "default": "Europe/Paris"
              },
              "decision_timestamp_paris": {
                "type": "string",
                "minLength": 1,
                "description": "Paris-time ISO 8601 instant at which the decision was produced."
              },
              "data_cutoff_paris": {
                "type": "string",
                "minLength": 1,
                "description": "Paris-time cutoff. No market/macro data after this instant may inform the decision."
              },
              "available_data_until": {
                "type": "string",
                "minLength": 1,
                "description": "Timestamp of the latest data point actually consumed. Must be <= data_cutoff_paris."
              },
              "future_data_used": {
                "type": "boolean",
                "description": "True records an anti-lookahead violation. A valid, guard-approved decision is always false. Valid decision payloads must set this to false.",
                "const": false
              },
              "entry_sl_tp_frozen": {
                "type": "boolean",
                "description": "Section 7 rule: entry / stop-loss / take-profit were frozen BEFORE any outcome replay. False means the decision is not replay-safe. Valid decision payloads must set this to true.",
                "const": true
              },
              "datasets_used": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "default": [],
                "description": "Identifiers of datasets consumed (values from the DATASETS enum where applicable, plus market_feeds ids).",
                "minItems": 1
              },
              "macro_actuals_visible": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "event": {
                      "type": "string",
                      "minLength": 1
                    },
                    "importance": {
                      "type": "string",
                      "enum": [
                        "low",
                        "medium",
                        "high"
                      ]
                    },
                    "scheduled_at_paris": {
                      "type": "string"
                    },
                    "published_at_paris": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "event"
                  ],
                  "additionalProperties": false
                },
                "default": [],
                "description": "Macro events whose actuals were legitimately visible (published_at_paris <= data_cutoff_paris)."
              },
              "macro_actuals_blocked": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "event": {
                      "type": "string",
                      "minLength": 1
                    },
                    "importance": {
                      "type": "string",
                      "enum": [
                        "low",
                        "medium",
                        "high"
                      ]
                    },
                    "scheduled_at_paris": {
                      "type": "string"
                    },
                    "published_at_paris": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "event"
                  ],
                  "additionalProperties": false
                },
                "default": [],
                "description": "Macro events blocked because not yet published at the cutoff. Their actuals must NOT influence the decision."
              },
              "source_pack_id": {
                "type": "string",
                "minLength": 1,
                "description": "Pack that seeded the decision context."
              },
              "simulation_id": {
                "oneOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "description": "Set only when the decision was produced inside a simulation run; null in live."
              },
              "mission_id": {
                "oneOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "description": "Set only when the decision was produced under a bounded worker mission; null otherwise."
              },
              "decision_id": {
                "type": "string",
                "minLength": 1
              },
              "thesis_id": {
                "type": "string",
                "minLength": 1
              },
              "decision_timestamp_utc": {
                "type": "string",
                "description": "Optional UTC mirror (forward-compat with T05 time normalization)."
              },
              "data_cutoff_utc": {
                "type": "string",
                "description": "Optional UTC mirror of data_cutoff_paris (forward-compat with T05)."
              },
              "available_data_until_utc": {
                "type": "string",
                "description": "Optional UTC mirror of available_data_until (forward-compat with T05)."
              },
              "entry_sl_tp_frozen_at_paris": {
                "type": "string",
                "description": "Optional Paris-time instant at which entry/SL/TP were frozen."
              },
              "notes": {
                "type": "string"
              }
            },
            "required": [
              "decision_timestamp_paris",
              "data_cutoff_paris",
              "available_data_until",
              "future_data_used",
              "entry_sl_tp_frozen",
              "datasets_used",
              "macro_actuals_visible",
              "macro_actuals_blocked",
              "source_pack_id"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "session",
          "date",
          "instrument",
          "decision",
          "direction",
          "setup_type",
          "confidence_pct",
          "risk_pct",
          "rr_minimum",
          "invalidation",
          "reason_summary",
          "decision_audit"
        ],
        "additionalProperties": false
      },
      "session_matrix": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "authorized_windows_summary": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "update_agenda": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "risk_management": {
        "type": "object",
        "additionalProperties": true
      },
      "monitoring_rules": {
        "type": "object",
        "additionalProperties": true
      },
      "final_sections": {
        "type": "object",
        "properties": {
          "decision_executable": {
            "type": "string",
            "minLength": 1
          },
          "regle_finale": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "decision_executable",
          "regle_finale"
        ],
        "additionalProperties": true
      },
      "markdown": {
        "type": "string"
      }
    },
    "required": [
      "schema_version",
      "contract_name",
      "analysis_id",
      "created_at_paris",
      "mode",
      "analysis_type",
      "pack_id",
      "session",
      "date",
      "timezone",
      "scope",
      "source_pack",
      "executive_summary",
      "context",
      "market_funnel",
      "levels",
      "strategic_brief",
      "decision_gates",
      "setups",
      "executable_decision",
      "session_matrix",
      "authorized_windows_summary",
      "update_agenda",
      "risk_management",
      "monitoring_rules",
      "final_sections"
    ],
    "additionalProperties": false
  },
  "context-transmission.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/context-transmission.schema.json",
    "title": "DeskContextTransmission",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "context_id": {
        "type": "string",
        "minLength": 3
      },
      "linked_analysis_id": {
        "type": "string"
      },
      "linked_monitor_id": {
        "type": "string"
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string"
      }
    },
    "required": [],
    "additionalProperties": true
  },
  "contract-activation.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/contract-activation.schema.json",
    "title": "DeskContractActivation",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "enum": [
          "DeskMasterAnalysisContract",
          "DeskHourlyThesisMonitorContract",
          "DeskFrontProjectionContract"
        ]
      },
      "schema_version": {
        "type": "string"
      }
    },
    "required": [
      "contract_name",
      "schema_version"
    ],
    "additionalProperties": false
  },
  "contract-list.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/contract-list.schema.json",
    "title": "DeskContractList",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "enum": [
          "DeskMasterAnalysisContract",
          "DeskHourlyThesisMonitorContract",
          "DeskFrontProjectionContract"
        ]
      }
    },
    "required": [
      "contract_name"
    ],
    "additionalProperties": false
  },
  "contract-lookup.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/contract-lookup.schema.json",
    "title": "DeskContractLookup",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "enum": [
          "DeskMasterAnalysisContract",
          "DeskHourlyThesisMonitorContract",
          "DeskFrontProjectionContract"
        ]
      },
      "schema_version": {
        "type": "string"
      }
    },
    "required": [
      "contract_name",
      "schema_version"
    ],
    "additionalProperties": false
  },
  "contract-registry.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/contract-registry.schema.json",
    "title": "DeskContractRegistry",
    "version": "1.0.0",
    "description": "Package-level registry for active runtime contracts and V2 entity contract lifecycle. Runtime MCP contract-management tools may expose a smaller subset until their own gate authorizes changes.",
    "type": "object",
    "properties": {
      "registry_version": {
        "type": "string",
        "const": "2.0.0"
      },
      "active_contracts": {
        "type": "object",
        "properties": {
          "master_contract": {
            "type": "object",
            "additionalProperties": true
          },
          "monitor_contract": {
            "type": "object",
            "additionalProperties": true
          },
          "front_projection_contract": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "required": [
          "master_contract",
          "monitor_contract",
          "front_projection_contract"
        ],
        "additionalProperties": true
      },
      "entity_contracts": {
        "type": "object",
        "properties": {
          "decision_audit_contract": {
            "type": "object",
            "additionalProperties": true
          },
          "simulation_run_contract": {
            "type": "object",
            "additionalProperties": true
          },
          "simulation_step_contract": {
            "type": "object",
            "additionalProperties": true
          },
          "worker_mission_contract": {
            "type": "object",
            "additionalProperties": true
          },
          "dashboard_state_contract": {
            "type": "object",
            "additionalProperties": true
          },
          "front_projection_contract": {
            "type": "object",
            "additionalProperties": true
          }
        },
        "required": [
          "decision_audit_contract",
          "simulation_run_contract",
          "simulation_step_contract",
          "worker_mission_contract",
          "dashboard_state_contract",
          "front_projection_contract"
        ],
        "additionalProperties": true
      },
      "lifecycle_policy": {
        "type": "object",
        "properties": {
          "statuses": {
            "type": "array",
            "items": {
              "type": "string",
              "enum": [
                "draft",
                "active",
                "archived"
              ]
            }
          },
          "runtime_exposed": {
            "type": "string",
            "enum": [
              "master_monitor_only",
              "entity_contracts_planned",
              "all_active_contracts"
            ]
          },
          "breaking_change_rule": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "statuses",
          "runtime_exposed",
          "breaking_change_rule"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "registry_version",
      "active_contracts",
      "entity_contracts",
      "lifecycle_policy"
    ],
    "additionalProperties": false
  },
  "contract.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/contract.schema.json",
    "title": "DeskContract",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "contract_id": {
        "type": "string",
        "minLength": 3
      },
      "contract_name": {
        "type": "string",
        "enum": [
          "DeskMasterAnalysisContract",
          "DeskHourlyThesisMonitorContract",
          "DeskFrontProjectionContract"
        ]
      },
      "schema_version": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "active",
          "archived"
        ],
        "default": "active"
      },
      "content_markdown": {
        "type": "string",
        "minLength": 1
      },
      "schema_json": {
        "type": "object",
        "additionalProperties": true,
        "default": {}
      },
      "hash": {
        "type": "string"
      },
      "is_active": {
        "type": "boolean",
        "default": false
      },
      "replaced_by": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "force": {
        "type": "boolean",
        "default": false
      }
    },
    "required": [
      "contract_name",
      "schema_version",
      "content_markdown"
    ],
    "additionalProperties": true
  },
  "dashboard-state.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/dashboard-state.schema.json",
    "title": "DeskDashboardState",
    "version": "1.0.0",
    "description": "Read-only dashboard state contract for future BFF responses. This schema does not implement dashboard runtime.",
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "const": "DeskDashboardState",
        "default": "DeskDashboardState"
      },
      "schema_version": {
        "type": "string",
        "const": "1.0.0",
        "default": "1.0.0"
      },
      "state_id": {
        "type": "string",
        "minLength": 3
      },
      "screen_id": {
        "type": "string",
        "enum": [
          "live_desk",
          "session_matrix",
          "master_analysis",
          "setup_validation",
          "management_console",
          "decision_journal",
          "simulation_lab",
          "paper_trading",
          "mission_control",
          "review_center",
          "system_health",
          "settings",
          "audit_view"
        ]
      },
      "as_of_paris": {
        "type": "string",
        "minLength": 1
      },
      "source_modules": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "required_data_status": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "minLength": 1
            },
            "status": {
              "type": "string",
              "enum": [
                "available",
                "missing",
                "stale",
                "blocked",
                "error"
              ]
            },
            "source": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "name",
            "status",
            "source"
          ],
          "additionalProperties": false
        },
        "default": []
      },
      "empty_state": {
        "type": "string"
      },
      "error_state": {
        "type": "string"
      },
      "blocked_state": {
        "type": "string"
      },
      "audit_requirement": {
        "type": "string",
        "enum": [
          "none",
          "optional",
          "required",
          "blocking"
        ]
      },
      "refresh_rule": {
        "type": "string",
        "minLength": 1
      },
      "payload": {
        "type": "object",
        "additionalProperties": true,
        "default": {}
      }
    },
    "required": [
      "state_id",
      "screen_id",
      "as_of_paris",
      "source_modules",
      "required_data_status",
      "audit_requirement",
      "refresh_rule"
    ],
    "additionalProperties": false
  },
  "decision-audit.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/decision-audit.schema.json",
    "title": "DeskDecisionAuditContract",
    "version": "1.0.0",
    "description": "Anti-lookahead audit envelope attached to every desk decision (mission section 7). Records what data was visible at decision time, the enforced cutoff, and whether any future data leaked. Invariant: the AntiLookaheadGuard (T12) MUST reject any decision whose future_data_used is true. The boolean is kept in the schema so a violation can still be RECORDED and shown in the dashboard audit view (EX-2).",
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "const": "DeskDecisionAuditContract",
        "default": "DeskDecisionAuditContract"
      },
      "schema_version": {
        "type": "string",
        "const": "1.0.0",
        "default": "1.0.0"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "decision_timestamp_paris": {
        "type": "string",
        "minLength": 1,
        "description": "Paris-time ISO 8601 instant at which the decision was produced."
      },
      "data_cutoff_paris": {
        "type": "string",
        "minLength": 1,
        "description": "Paris-time cutoff. No market/macro data after this instant may inform the decision."
      },
      "available_data_until": {
        "type": "string",
        "minLength": 1,
        "description": "Timestamp of the latest data point actually consumed. Must be <= data_cutoff_paris."
      },
      "future_data_used": {
        "type": "boolean",
        "description": "True records an anti-lookahead violation. A valid, guard-approved decision is always false."
      },
      "entry_sl_tp_frozen": {
        "type": "boolean",
        "description": "Section 7 rule: entry / stop-loss / take-profit were frozen BEFORE any outcome replay. False means the decision is not replay-safe."
      },
      "datasets_used": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "default": [],
        "description": "Identifiers of datasets consumed (values from the DATASETS enum where applicable, plus market_feeds ids).",
        "minItems": 1
      },
      "macro_actuals_visible": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "event": {
              "type": "string",
              "minLength": 1
            },
            "importance": {
              "type": "string",
              "enum": [
                "low",
                "medium",
                "high"
              ]
            },
            "scheduled_at_paris": {
              "type": "string"
            },
            "published_at_paris": {
              "type": "string"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        },
        "default": [],
        "description": "Macro events whose actuals were legitimately visible (published_at_paris <= data_cutoff_paris)."
      },
      "macro_actuals_blocked": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "event": {
              "type": "string",
              "minLength": 1
            },
            "importance": {
              "type": "string",
              "enum": [
                "low",
                "medium",
                "high"
              ]
            },
            "scheduled_at_paris": {
              "type": "string"
            },
            "published_at_paris": {
              "type": "string"
            }
          },
          "required": [
            "event"
          ],
          "additionalProperties": false
        },
        "default": [],
        "description": "Macro events blocked because not yet published at the cutoff. Their actuals must NOT influence the decision."
      },
      "source_pack_id": {
        "type": "string",
        "minLength": 1,
        "description": "Pack that seeded the decision context."
      },
      "simulation_id": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "description": "Set only when the decision was produced inside a simulation run; null in live."
      },
      "mission_id": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "description": "Set only when the decision was produced under a bounded worker mission; null otherwise."
      },
      "decision_id": {
        "type": "string",
        "minLength": 1
      },
      "thesis_id": {
        "type": "string",
        "minLength": 1
      },
      "decision_timestamp_utc": {
        "type": "string",
        "description": "Optional UTC mirror (forward-compat with T05 time normalization)."
      },
      "data_cutoff_utc": {
        "type": "string",
        "description": "Optional UTC mirror of data_cutoff_paris (forward-compat with T05)."
      },
      "available_data_until_utc": {
        "type": "string",
        "description": "Optional UTC mirror of available_data_until (forward-compat with T05)."
      },
      "entry_sl_tp_frozen_at_paris": {
        "type": "string",
        "description": "Optional Paris-time instant at which entry/SL/TP were frozen."
      },
      "notes": {
        "type": "string"
      }
    },
    "required": [
      "decision_timestamp_paris",
      "data_cutoff_paris",
      "available_data_until",
      "future_data_used",
      "entry_sl_tp_frozen",
      "datasets_used",
      "macro_actuals_visible",
      "macro_actuals_blocked",
      "source_pack_id"
    ],
    "additionalProperties": false
  },
  "decision.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/decision.schema.json",
    "title": "DeskDecision",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "schema_version": {
        "type": "string",
        "const": "decision_v2",
        "description": "Canonical single Decision model schema marker."
      },
      "decision_model": {
        "type": "string",
        "const": "single_decision_chain_v1",
        "description": "Decision model shared by GPT, strategy, dashboard and worker proposers."
      },
      "source_type": {
        "type": "string",
        "enum": [
          "dashboard",
          "gpt",
          "strategy",
          "worker",
          "manual",
          "system"
        ]
      },
      "source_role": {
        "type": "string",
        "const": "proposer",
        "description": "All upstream systems propose; the domain model produces the canonical decision record."
      },
      "source_ref": {
        "type": "string",
        "minLength": 1
      },
      "proposer_id": {
        "type": "string",
        "minLength": 1
      },
      "gate_status": {
        "type": "string",
        "enum": [
          "green",
          "audit_required",
          "review_required",
          "blocked"
        ]
      },
      "domain_status": {
        "type": "string",
        "enum": [
          "accepted",
          "rejected",
          "review_required"
        ]
      },
      "thesis_id": {
        "type": "string",
        "minLength": 1
      },
      "mission_id": {
        "type": "string",
        "minLength": 1
      },
      "position_id": {
        "type": "string",
        "minLength": 1
      },
      "outcome_id": {
        "type": "string",
        "minLength": 1
      },
      "audit_id": {
        "type": "string",
        "minLength": 1
      },
      "chain": {
        "type": "object",
        "description": "Canonical Thesis -> Mission -> Gate -> Decision -> Position -> Outcome -> Audit linkage.",
        "properties": {
          "thesis_id": {
            "type": "string"
          },
          "mission_id": {
            "type": "string"
          },
          "gate_status": {
            "type": "string",
            "enum": [
              "green",
              "audit_required",
              "review_required",
              "blocked"
            ]
          },
          "decision_id": {
            "type": "string"
          },
          "position_id": {
            "type": "string"
          },
          "outcome_id": {
            "type": "string"
          },
          "audit_id": {
            "type": "string"
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "source_payload": {
        "type": "object",
        "description": "Original proposer payload retained for traceability."
      },
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "report_id": {
        "type": "string",
        "minLength": 3
      },
      "analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "created_at": {
        "type": "string"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "asia_to_london",
          "ny_open"
        ]
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES",
          "WAIT"
        ]
      },
      "asset_class": {
        "type": "string",
        "const": "futures",
        "default": "futures"
      },
      "decision": {
        "type": "string",
        "enum": [
          "prendre",
          "ne_pas_prendre",
          "wait",
          "gestion_seule"
        ]
      },
      "direction": {
        "type": "string",
        "enum": [
          "long",
          "short",
          "neutral",
          "wait"
        ]
      },
      "setup_id": {
        "type": "string",
        "minLength": 1
      },
      "setup_type": {
        "type": "string",
        "enum": [
          "buy_limit_pullback",
          "sell_limit_pullback",
          "buy_stop_breakout",
          "sell_stop_breakdown",
          "sell_stop_breakdown_retest",
          "buy_stop_breakout_retest",
          "wait",
          "wait_only",
          "no_trade",
          "management_only"
        ]
      },
      "order_type": {
        "type": "string"
      },
      "confidence_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "risk_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 10
      },
      "rr_minimum": {
        "type": "number",
        "minimum": 0
      },
      "entry_zone": {
        "type": "object",
        "properties": {
          "from": {
            "type": "number"
          },
          "to": {
            "type": "number"
          }
        },
        "required": [
          "from",
          "to"
        ],
        "additionalProperties": false
      },
      "entry_trigger": {
        "type": "string"
      },
      "stop_loss": {
        "type": "number"
      },
      "take_profits": {
        "type": "object",
        "properties": {
          "tp1": {
            "oneOf": [
              {
                "type": "number"
              },
              {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "number"
                  },
                  "to": {
                    "type": "number"
                  }
                },
                "required": [
                  "from",
                  "to"
                ],
                "additionalProperties": false
              }
            ]
          },
          "tp2": {
            "oneOf": [
              {
                "type": "number"
              },
              {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "number"
                  },
                  "to": {
                    "type": "number"
                  }
                },
                "required": [
                  "from",
                  "to"
                ],
                "additionalProperties": false
              }
            ]
          },
          "tp3": {
            "oneOf": [
              {
                "type": "number"
              },
              {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "number"
                  },
                  "to": {
                    "type": "number"
                  }
                },
                "required": [
                  "from",
                  "to"
                ],
                "additionalProperties": false
              }
            ]
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "extension_target": {
        "oneOf": [
          {
            "type": "number"
          },
          {
            "type": "object",
            "properties": {
              "from": {
                "type": "number"
              },
              "to": {
                "type": "number"
              }
            },
            "required": [
              "from",
              "to"
            ],
            "additionalProperties": false
          }
        ]
      },
      "invalidation": {
        "type": "string",
        "minLength": 1
      },
      "action_now": {
        "type": "string"
      },
      "no_trade_condition": {
        "type": "string"
      },
      "management_rules": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "default": []
      },
      "time_rules": {
        "type": "object",
        "properties": {
          "earliest_entry_time": {
            "type": "string"
          },
          "latest_entry_time": {
            "type": "string"
          },
          "reduce_before": {
            "type": "string"
          },
          "flatten_before": {
            "type": "string"
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "macro_bias": {
        "type": "string",
        "default": "unknown"
      },
      "technical_bias": {
        "type": "string",
        "default": "unknown"
      },
      "cross_asset_bias": {
        "type": "string",
        "default": "unknown"
      },
      "reason_summary": {
        "type": "string",
        "minLength": 1
      },
      "detailed_reason": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "active",
          "triggered",
          "cancelled",
          "tp1_hit",
          "tp2_hit",
          "tp3_hit",
          "stopped",
          "expired",
          "archived"
        ],
        "default": "draft"
      },
      "decision_audit": {
        "type": "object",
        "description": "Required DecisionAudit envelope for a persistable V2 decision. The entity schema can record violations; this embedded gate only accepts usable audits.",
        "properties": {
          "contract_name": {
            "type": "string",
            "const": "DeskDecisionAuditContract",
            "default": "DeskDecisionAuditContract"
          },
          "schema_version": {
            "type": "string",
            "const": "1.0.0",
            "default": "1.0.0"
          },
          "timezone": {
            "type": "string",
            "const": "Europe/Paris",
            "default": "Europe/Paris"
          },
          "decision_timestamp_paris": {
            "type": "string",
            "minLength": 1,
            "description": "Paris-time ISO 8601 instant at which the decision was produced."
          },
          "data_cutoff_paris": {
            "type": "string",
            "minLength": 1,
            "description": "Paris-time cutoff. No market/macro data after this instant may inform the decision."
          },
          "available_data_until": {
            "type": "string",
            "minLength": 1,
            "description": "Timestamp of the latest data point actually consumed. Must be <= data_cutoff_paris."
          },
          "future_data_used": {
            "type": "boolean",
            "description": "True records an anti-lookahead violation. A valid, guard-approved decision is always false. Valid decision payloads must set this to false.",
            "const": false
          },
          "entry_sl_tp_frozen": {
            "type": "boolean",
            "description": "Section 7 rule: entry / stop-loss / take-profit were frozen BEFORE any outcome replay. False means the decision is not replay-safe. Valid decision payloads must set this to true.",
            "const": true
          },
          "datasets_used": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "default": [],
            "description": "Identifiers of datasets consumed (values from the DATASETS enum where applicable, plus market_feeds ids).",
            "minItems": 1
          },
          "macro_actuals_visible": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "event": {
                  "type": "string",
                  "minLength": 1
                },
                "importance": {
                  "type": "string",
                  "enum": [
                    "low",
                    "medium",
                    "high"
                  ]
                },
                "scheduled_at_paris": {
                  "type": "string"
                },
                "published_at_paris": {
                  "type": "string"
                }
              },
              "required": [
                "event"
              ],
              "additionalProperties": false
            },
            "default": [],
            "description": "Macro events whose actuals were legitimately visible (published_at_paris <= data_cutoff_paris)."
          },
          "macro_actuals_blocked": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "event": {
                  "type": "string",
                  "minLength": 1
                },
                "importance": {
                  "type": "string",
                  "enum": [
                    "low",
                    "medium",
                    "high"
                  ]
                },
                "scheduled_at_paris": {
                  "type": "string"
                },
                "published_at_paris": {
                  "type": "string"
                }
              },
              "required": [
                "event"
              ],
              "additionalProperties": false
            },
            "default": [],
            "description": "Macro events blocked because not yet published at the cutoff. Their actuals must NOT influence the decision."
          },
          "source_pack_id": {
            "type": "string",
            "minLength": 1,
            "description": "Pack that seeded the decision context."
          },
          "simulation_id": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "description": "Set only when the decision was produced inside a simulation run; null in live."
          },
          "mission_id": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "description": "Set only when the decision was produced under a bounded worker mission; null otherwise."
          },
          "decision_id": {
            "type": "string",
            "minLength": 1
          },
          "thesis_id": {
            "type": "string",
            "minLength": 1
          },
          "decision_timestamp_utc": {
            "type": "string",
            "description": "Optional UTC mirror (forward-compat with T05 time normalization)."
          },
          "data_cutoff_utc": {
            "type": "string",
            "description": "Optional UTC mirror of data_cutoff_paris (forward-compat with T05)."
          },
          "available_data_until_utc": {
            "type": "string",
            "description": "Optional UTC mirror of available_data_until (forward-compat with T05)."
          },
          "entry_sl_tp_frozen_at_paris": {
            "type": "string",
            "description": "Optional Paris-time instant at which entry/SL/TP were frozen."
          },
          "notes": {
            "type": "string"
          }
        },
        "required": [
          "decision_timestamp_paris",
          "data_cutoff_paris",
          "available_data_until",
          "future_data_used",
          "entry_sl_tp_frozen",
          "datasets_used",
          "macro_actuals_visible",
          "macro_actuals_blocked",
          "source_pack_id"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "session",
      "date",
      "instrument",
      "decision",
      "direction",
      "setup_type",
      "confidence_pct",
      "risk_pct",
      "rr_minimum",
      "invalidation",
      "reason_summary",
      "decision_audit"
    ],
    "additionalProperties": false
  },
  "desk-front-projection.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/desk-front-projection.schema.json",
    "title": "DeskFrontProjectionContract",
    "version": "1.0.0",
    "description": "Versioned presentation projection emitted by a canonical Master or Monitor. It never replaces the canonical analysis, thesis, setup or position documents.",
    "type": "object",
    "properties": {
      "contractName": {
        "type": "string",
        "const": "DeskFrontProjectionContract"
      },
      "schemaVersion": {
        "type": "string",
        "const": "1.0.0"
      },
      "source": {
        "type": "object",
        "properties": {
          "sourceType": {
            "type": "string",
            "enum": [
              "MASTER",
              "MONITOR"
            ]
          },
          "sourceId": {
            "type": "string",
            "minLength": 3
          },
          "masterId": {
            "type": "string",
            "minLength": 3
          },
          "monitorId": {
            "oneOf": [
              {
                "type": "string",
                "minLength": 3
              },
              {
                "type": "null"
              }
            ]
          },
          "thesisId": {
            "type": "string",
            "minLength": 3
          },
          "strategyId": {
            "type": "string",
            "enum": [
              "asia_open",
              "ny_open_1530"
            ]
          },
          "session": {
            "type": "string",
            "enum": [
              "asia_open",
              "ny_open"
            ]
          },
          "mode": {
            "type": "string",
            "enum": [
              "live",
              "paper"
            ]
          },
          "tradingDate": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
          },
          "runId": {
            "type": "string",
            "minLength": 3
          },
          "timestampParis": {
            "type": "string",
            "minLength": 1
          },
          "asOfUtc": {
            "type": "string",
            "format": "date-time"
          },
          "sequence": {
            "type": "integer",
            "minimum": 1
          },
          "revision": {
            "type": "integer",
            "minimum": 1
          }
        },
        "required": [
          "sourceType",
          "sourceId",
          "masterId",
          "monitorId",
          "thesisId",
          "strategyId",
          "session",
          "mode",
          "tradingDate",
          "runId",
          "timestampParis",
          "asOfUtc",
          "sequence",
          "revision"
        ],
        "additionalProperties": false
      },
      "status": {
        "type": "object",
        "properties": {
          "deskStatus": {
            "type": "string",
            "minLength": 1
          },
          "decision": {
            "type": "string",
            "minLength": 1
          },
          "actionCode": {
            "type": "string",
            "minLength": 1
          },
          "alertLevel": {
            "type": "string",
            "enum": [
              "info",
              "watch",
              "warning",
              "action",
              "critical",
              "positive"
            ]
          },
          "thesisStatus": {
            "type": "string",
            "minLength": 1
          },
          "setupStatus": {
            "type": "string",
            "minLength": 1
          },
          "positionStatus": {
            "type": "string",
            "minLength": 1
          },
          "confidencePct": {
            "type": "number",
            "minimum": 0,
            "maximum": 100
          },
          "healthScore": {
            "type": "number",
            "minimum": 0,
            "maximum": 100
          },
          "riskPct": {
            "type": "number",
            "minimum": 0,
            "maximum": 100
          }
        },
        "required": [
          "deskStatus",
          "decision",
          "actionCode",
          "alertLevel",
          "thesisStatus",
          "setupStatus",
          "positionStatus",
          "confidencePct",
          "healthScore",
          "riskPct"
        ],
        "additionalProperties": false
      },
      "briefs": {
        "type": "object",
        "properties": {
          "headline": {
            "type": "string"
          },
          "oneLiner": {
            "type": "string"
          },
          "marketBrief": {
            "type": "string"
          },
          "thesisBrief": {
            "type": "string"
          },
          "deltaBrief": {
            "type": "string"
          },
          "whyNow": {
            "type": "string"
          },
          "actionNow": {
            "type": "string"
          },
          "nextFocus": {
            "type": "string"
          }
        },
        "required": [
          "headline",
          "oneLiner",
          "marketBrief",
          "thesisBrief",
          "deltaBrief",
          "whyNow",
          "actionNow",
          "nextFocus"
        ],
        "additionalProperties": false
      },
      "latestChange": {
        "type": "object",
        "properties": {
          "stateTransition": {
            "type": "object",
            "properties": {
              "from": {
                "type": "string"
              },
              "to": {
                "type": "string"
              }
            },
            "required": [
              "from",
              "to"
            ],
            "additionalProperties": false
          },
          "scoreTransition": {
            "type": "object",
            "properties": {
              "from": {
                "type": "number",
                "minimum": 0,
                "maximum": 100
              },
              "to": {
                "type": "number",
                "minimum": 0,
                "maximum": 100
              },
              "delta": {
                "type": "number",
                "minimum": -100,
                "maximum": 100
              }
            },
            "required": [
              "from",
              "to",
              "delta"
            ],
            "additionalProperties": false
          },
          "validatedElements": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "weakenedElements": {
            "type": "array",
            "items": {
              "type": "string"
            }
          },
          "invalidatedElements": {
            "type": "array",
            "items": {
              "type": "string"
            }
          }
        },
        "required": [
          "stateTransition",
          "scoreTransition",
          "validatedElements",
          "weakenedElements",
          "invalidatedElements"
        ],
        "additionalProperties": false
      },
      "expectedVsRealized": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "label": {
              "type": "string"
            },
            "expected": {
              "type": "string"
            },
            "realized": {
              "type": "string"
            },
            "verdict": {
              "type": "string"
            },
            "impact": {
              "type": "string"
            }
          },
          "required": [
            "label",
            "expected",
            "realized",
            "verdict",
            "impact"
          ],
          "additionalProperties": false
        }
      },
      "conditions": {
        "type": "object",
        "properties": {
          "go": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          },
          "invalidations": {
            "type": "array",
            "items": {
              "type": "object",
              "additionalProperties": true
            }
          }
        },
        "required": [
          "go",
          "invalidations"
        ],
        "additionalProperties": false
      },
      "setup": {
        "type": "object",
        "additionalProperties": true
      },
      "position": {
        "type": "object",
        "additionalProperties": true
      },
      "marketContext": {
        "type": "object",
        "additionalProperties": true
      },
      "timelineEvent": {
        "type": "object",
        "additionalProperties": true
      },
      "drilldownRefs": {
        "type": "object",
        "additionalProperties": {
          "oneOf": [
            {
              "type": "string"
            },
            {
              "type": "null"
            }
          ]
        }
      }
    },
    "required": [
      "contractName",
      "schemaVersion",
      "source",
      "status",
      "briefs",
      "latestChange",
      "expectedVsRealized",
      "conditions",
      "setup",
      "position",
      "marketContext",
      "timelineEvent",
      "drilldownRefs"
    ],
    "additionalProperties": false
  },
  "hourly-monitor.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/hourly-monitor.schema.json",
    "title": "DeskHourlyThesisMonitorContract",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "monitor_id": {
        "type": "string",
        "minLength": 3
      },
      "contract_name": {
        "type": "string",
        "const": "DeskHourlyThesisMonitorContract",
        "default": "DeskHourlyThesisMonitorContract"
      },
      "schema_version": {
        "type": "string",
        "const": "1.0.0",
        "default": "1.0.0"
      },
      "contract_hash": {
        "type": "string",
        "minLength": 1
      },
      "timestamp_paris": {
        "type": "string"
      },
      "linked_master_analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "linked_active_thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "linked_previous_monitor_id": {
        "type": "string"
      },
      "monitor_decision": {
        "type": "object",
        "additionalProperties": true
      },
      "thesis_health_score": {
        "type": "object",
        "additionalProperties": true
      },
      "expected_vs_realized": {
        "type": "array",
        "items": {}
      },
      "macro_update": {
        "type": "object",
        "additionalProperties": true
      },
      "cross_asset_delta": {
        "type": "object",
        "additionalProperties": true
      },
      "technical_delta": {
        "type": "object",
        "additionalProperties": true
      },
      "wait_to_go_check": {
        "type": "array",
        "items": {}
      },
      "invalidation_check": {
        "type": "array",
        "items": {}
      },
      "weak_signals": {
        "type": "array",
        "items": {}
      },
      "monitor_context_transmission": {
        "type": "object",
        "additionalProperties": true
      },
      "front_projection": {
        "$ref": "https://tv-automation.local/contracts/desk-front-projection.schema.json"
      }
    },
    "required": [
      "contract_hash",
      "timestamp_paris",
      "linked_master_analysis_id",
      "linked_active_thesis_id",
      "monitor_decision",
      "thesis_health_score"
    ],
    "additionalProperties": true
  },
  "master-analysis.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/master-analysis.schema.json",
    "title": "DeskMasterAnalysisContract",
    "version": "4.0.0",
    "type": "object",
    "properties": {
      "analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "contract_name": {
        "type": "string",
        "const": "DeskMasterAnalysisContract",
        "default": "DeskMasterAnalysisContract"
      },
      "schema_version": {
        "type": "string",
        "const": "4.0.0",
        "default": "4.0.0"
      },
      "contract_hash": {
        "type": "string",
        "minLength": 1
      },
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward",
          "post_event_replan"
        ]
      },
      "active_thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "report_id": {
        "type": "string",
        "minLength": 3
      },
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "ready",
          "archived"
        ],
        "default": "ready"
      },
      "created_at_paris": {
        "type": "string"
      },
      "full_analysis": {
        "type": "object",
        "additionalProperties": true
      },
      "context_transmission": {
        "type": "object",
        "additionalProperties": true
      },
      "decision_journal": {
        "type": "object",
        "additionalProperties": true
      },
      "front_projection": {
        "$ref": "https://tv-automation.local/contracts/desk-front-projection.schema.json"
      }
    },
    "required": [
      "contract_hash",
      "pack_id",
      "date",
      "session",
      "created_at_paris",
      "full_analysis"
    ],
    "additionalProperties": true
  },
  "monitor-alert.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/monitor-alert.schema.json",
    "title": "DeskMonitorAlert",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "alert_id": {
        "type": "string",
        "minLength": 3
      },
      "timestamp_paris": {
        "type": "string"
      },
      "alert_level": {
        "type": "string",
        "enum": [
          "info",
          "watch",
          "warning",
          "action",
          "critical"
        ]
      },
      "title": {
        "type": "string",
        "minLength": 1
      },
      "message": {
        "type": "string",
        "minLength": 1
      },
      "linked_monitor_id": {
        "type": "string"
      },
      "linked_thesis_id": {
        "type": "string"
      },
      "action_required": {
        "type": "string"
      },
      "send_to_telegram": {
        "type": "boolean",
        "default": false
      }
    },
    "required": [
      "alert_level",
      "title",
      "message"
    ],
    "additionalProperties": true
  },
  "position-management.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/position-management.schema.json",
    "title": "DeskPositionManagement",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "position_id": {
        "type": "string",
        "minLength": 3
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES"
        ]
      },
      "direction": {
        "type": "string",
        "enum": [
          "long",
          "short"
        ]
      },
      "entry_price": {
        "type": "number"
      },
      "stop_loss": {
        "type": "number"
      },
      "take_profits": {
        "type": "array",
        "items": {}
      },
      "risk_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 10
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "protected",
          "partial_taken",
          "closed",
          "cancelled"
        ]
      },
      "linked_thesis_id": {
        "type": "string"
      },
      "linked_decision_id": {
        "type": "string"
      },
      "management_action": {
        "type": "string",
        "enum": [
          "create",
          "update",
          "break_even",
          "partial",
          "reduce",
          "exit",
          "cancel"
        ],
        "default": "update"
      },
      "notes": {
        "type": "string"
      }
    },
    "required": [],
    "additionalProperties": true
  },
  "report.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/report.schema.json",
    "title": "DeskReport",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "report_id": {
        "type": "string",
        "minLength": 3
      },
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "asia_to_london",
          "ny_open"
        ]
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "title": {
        "type": "string",
        "minLength": 3
      },
      "markdown": {
        "type": "string",
        "minLength": 1
      },
      "summary": {
        "type": "string"
      },
      "sections": {
        "type": "object",
        "additionalProperties": true
      },
      "status": {
        "type": "string",
        "enum": [
          "generated",
          "sent",
          "archived"
        ],
        "default": "generated"
      }
    },
    "required": [
      "date",
      "session",
      "title",
      "markdown"
    ],
    "additionalProperties": false
  },
  "setup.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/setup.schema.json",
    "title": "DeskSetup",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "setup_id": {
        "type": "string",
        "minLength": 1
      },
      "label": {
        "type": "string",
        "minLength": 1
      },
      "rank": {
        "type": "integer",
        "minimum": 1
      },
      "priority": {
        "type": "integer",
        "minimum": 1
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES",
          "WAIT"
        ]
      },
      "decision": {
        "type": "string",
        "enum": [
          "prendre",
          "ne_pas_prendre",
          "wait",
          "gestion_seule"
        ],
        "default": "prendre"
      },
      "direction": {
        "type": "string",
        "enum": [
          "long",
          "short",
          "neutral",
          "wait"
        ]
      },
      "setup_type": {
        "type": "string",
        "enum": [
          "buy_limit_pullback",
          "sell_limit_pullback",
          "buy_stop_breakout",
          "sell_stop_breakdown",
          "sell_stop_breakdown_retest",
          "buy_stop_breakout_retest",
          "wait",
          "wait_only",
          "no_trade",
          "management_only"
        ]
      },
      "order_type": {
        "type": "string",
        "enum": [
          "buy_limit",
          "sell_limit",
          "buy_stop",
          "sell_stop",
          "sell_stop_or_retest",
          "buy_stop_or_retest",
          "market",
          "conditional",
          "wait",
          "cancel"
        ]
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "secondary",
          "inactive",
          "cancelled",
          "wait",
          "management_only"
        ]
      },
      "entry_zone": {
        "type": "object",
        "properties": {
          "from": {
            "type": "number"
          },
          "to": {
            "type": "number"
          }
        },
        "required": [
          "from",
          "to"
        ],
        "additionalProperties": false
      },
      "entry_trigger": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "object",
            "additionalProperties": true
          }
        ]
      },
      "stop_loss": {
        "type": "number"
      },
      "take_profits": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "name": {
              "type": "string",
              "minLength": 1
            },
            "target": {
              "oneOf": [
                {
                  "type": "number"
                },
                {
                  "type": "object",
                  "properties": {
                    "from": {
                      "type": "number"
                    },
                    "to": {
                      "type": "number"
                    }
                  },
                  "required": [
                    "from",
                    "to"
                  ],
                  "additionalProperties": false
                }
              ]
            },
            "condition": {
              "type": "string"
            },
            "action": {
              "type": "string"
            }
          },
          "required": [
            "name",
            "target"
          ],
          "additionalProperties": false
        },
        "default": []
      },
      "extension_target": {
        "oneOf": [
          {
            "type": "number"
          },
          {
            "type": "object",
            "properties": {
              "from": {
                "type": "number"
              },
              "to": {
                "type": "number"
              }
            },
            "required": [
              "from",
              "to"
            ],
            "additionalProperties": false
          }
        ]
      },
      "invalidation": {
        "oneOf": [
          {
            "type": "string",
            "minLength": 1
          },
          {
            "type": "object",
            "additionalProperties": true
          }
        ]
      },
      "risk_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 10
      },
      "confidence_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "rr_minimum": {
        "type": "number",
        "minimum": 0
      },
      "reason": {
        "type": "string",
        "minLength": 1
      },
      "conditions": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "default": []
      },
      "management_rules": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "default": []
      },
      "management": {
        "type": "object",
        "additionalProperties": true
      },
      "executable": {
        "type": "boolean",
        "default": false
      }
    },
    "required": [
      "setup_id",
      "label",
      "instrument",
      "direction",
      "setup_type",
      "invalidation",
      "risk_pct",
      "confidence_pct",
      "reason"
    ],
    "additionalProperties": true
  },
  "simulation-run.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/simulation-run.schema.json",
    "title": "DeskSimulationRun",
    "version": "1.0.0",
    "description": "Run-level envelope for replaying one session or trading day with strict cutoffs and attached audit trail. This is a contract only; it does not implement simulation runtime.",
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "const": "DeskSimulationRun",
        "default": "DeskSimulationRun"
      },
      "schema_version": {
        "type": "string",
        "const": "1.0.0",
        "default": "1.0.0"
      },
      "simulation_id": {
        "type": "string",
        "minLength": 3
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "asia_to_london",
          "ny_open",
          "custom"
        ]
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "mode": {
        "type": "string",
        "enum": [
          "backtest",
          "replay",
          "simulation",
          "paper"
        ]
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "running",
          "paused",
          "completed",
          "failed",
          "archived"
        ]
      },
      "source_pack_id": {
        "type": "string",
        "minLength": 1
      },
      "initial_cutoff_paris": {
        "type": "string",
        "minLength": 1
      },
      "current_cutoff_paris": {
        "type": "string",
        "minLength": 1
      },
      "created_at_paris": {
        "type": "string",
        "minLength": 1
      },
      "completed_at_paris": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "default": null
      },
      "step_ids": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "decision_ids": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "audit_ids": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "outcome_ids": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "review_id": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "default": null
      },
      "notes": {
        "type": "string"
      }
    },
    "required": [
      "simulation_id",
      "date",
      "session",
      "timezone",
      "mode",
      "status",
      "source_pack_id",
      "initial_cutoff_paris",
      "current_cutoff_paris",
      "created_at_paris",
      "step_ids",
      "decision_ids",
      "audit_ids"
    ],
    "additionalProperties": false
  },
  "simulation-step.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/simulation-step.schema.json",
    "title": "DeskSimulationStep",
    "version": "1.0.0",
    "description": "One deterministic simulation advance with explicit cutoff, visible datasets, blocked datasets, and audit reference. This contract does not execute replay logic.",
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "const": "DeskSimulationStep",
        "default": "DeskSimulationStep"
      },
      "schema_version": {
        "type": "string",
        "const": "1.0.0",
        "default": "1.0.0"
      },
      "step_id": {
        "type": "string",
        "minLength": 3
      },
      "simulation_id": {
        "type": "string",
        "minLength": 3
      },
      "step_index": {
        "type": "integer",
        "minimum": 0
      },
      "step_type": {
        "type": "string",
        "enum": [
          "next_5m",
          "next_15m",
          "next_hour",
          "next_event",
          "end_session"
        ]
      },
      "status": {
        "type": "string",
        "enum": [
          "pending",
          "applied",
          "blocked",
          "failed"
        ]
      },
      "started_at_paris": {
        "type": "string",
        "minLength": 1
      },
      "ended_at_paris": {
        "type": "string",
        "minLength": 1
      },
      "data_cutoff_paris": {
        "type": "string",
        "minLength": 1
      },
      "available_data_until": {
        "type": "string",
        "minLength": 1
      },
      "visible_dataset_refs": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "dataset_id": {
              "type": "string",
              "minLength": 1
            },
            "source": {
              "type": "string",
              "minLength": 1
            },
            "available_until_paris": {
              "type": "string"
            }
          },
          "required": [
            "dataset_id",
            "source"
          ],
          "additionalProperties": false
        },
        "default": []
      },
      "blocked_dataset_refs": {
        "type": "array",
        "items": {
          "type": "object",
          "properties": {
            "dataset_id": {
              "type": "string",
              "minLength": 1
            },
            "source": {
              "type": "string",
              "minLength": 1
            },
            "blocked_reason": {
              "type": "string",
              "minLength": 1
            }
          },
          "required": [
            "dataset_id",
            "source",
            "blocked_reason"
          ],
          "additionalProperties": false
        },
        "default": []
      },
      "decision_id": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "default": null
      },
      "audit_id": {
        "type": "string",
        "minLength": 1
      },
      "outcome_id": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "default": null
      },
      "action": {
        "type": "object",
        "properties": {
          "type": {
            "type": "string",
            "enum": [
              "generate_master",
              "generate_monitor",
              "validate_setup",
              "wait",
              "replay_outcome",
              "review",
              "none"
            ]
          },
          "summary": {
            "type": "string"
          }
        },
        "required": [
          "type"
        ],
        "additionalProperties": false
      },
      "notes": {
        "type": "string"
      }
    },
    "required": [
      "step_id",
      "simulation_id",
      "step_index",
      "step_type",
      "status",
      "started_at_paris",
      "ended_at_paris",
      "data_cutoff_paris",
      "available_data_until",
      "visible_dataset_refs",
      "blocked_dataset_refs",
      "audit_id",
      "action"
    ],
    "additionalProperties": false
  },
  "worker-mission.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/worker-mission.schema.json",
    "title": "DeskWorkerMission",
    "version": "1.0.0",
    "description": "Bounded worker mission contract. This schema defines limits and required audit references only; worker runtime remains blocked by later gates.",
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "const": "DeskWorkerMission",
        "default": "DeskWorkerMission"
      },
      "schema_version": {
        "type": "string",
        "const": "1.0.0",
        "default": "1.0.0"
      },
      "mission_id": {
        "type": "string",
        "minLength": 3
      },
      "objective": {
        "type": "string",
        "minLength": 1
      },
      "allowed_window": {
        "type": "object",
        "properties": {
          "start_paris": {
            "type": "string",
            "minLength": 1
          },
          "end_paris": {
            "type": "string",
            "minLength": 1
          },
          "timezone": {
            "type": "string",
            "const": "Europe/Paris",
            "default": "Europe/Paris"
          }
        },
        "required": [
          "start_paris",
          "end_paris",
          "timezone"
        ],
        "additionalProperties": false
      },
      "required_gates": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "dod": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "forbidden_actions": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "risk_rules": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "escalation_rules": {
        "type": "array",
        "items": {
          "type": "string",
          "minLength": 1
        },
        "default": []
      },
      "expires_at_paris": {
        "type": "string",
        "minLength": 1
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "active",
          "waiting",
          "completed",
          "expired",
          "cancelled",
          "escalated",
          "failed"
        ]
      },
      "result_schema_version": {
        "type": "string",
        "minLength": 1
      },
      "audit_id": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ],
        "default": null
      }
    },
    "required": [
      "mission_id",
      "objective",
      "allowed_window",
      "required_gates",
      "dod",
      "forbidden_actions",
      "risk_rules",
      "escalation_rules",
      "expires_at_paris",
      "status"
    ],
    "additionalProperties": false
  }
};

export const commonSchemas = {
  "level-range.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/common/level-range.schema.json",
    "title": "LevelRange",
    "version": "1.0.0",
    "type": "object",
    "properties": {
      "from": {
        "type": "number"
      },
      "to": {
        "type": "number"
      }
    },
    "required": [
      "from",
      "to"
    ],
    "additionalProperties": false
  },
  "target-level.schema.json": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "$id": "https://tv-automation.local/contracts/common/target-level.schema.json",
    "title": "TargetLevel",
    "version": "1.0.0",
    "oneOf": [
      {
        "type": "number"
      },
      {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://tv-automation.local/contracts/common/level-range.schema.json",
        "title": "LevelRange",
        "version": "1.0.0",
        "type": "object",
        "properties": {
          "from": {
            "type": "number"
          },
          "to": {
            "type": "number"
          }
        },
        "required": [
          "from",
          "to"
        ],
        "additionalProperties": false
      }
    ]
  }
};

export const toolInputSchemasByFile = {
  "activate_contract_version.input.schema.json": {
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "enum": [
          "DeskMasterAnalysisContract",
          "DeskHourlyThesisMonitorContract",
          "DeskFrontProjectionContract"
        ]
      },
      "schema_version": {
        "type": "string"
      }
    },
    "required": [
      "contract_name",
      "schema_version"
    ],
    "additionalProperties": false
  },
  "archive_contract_version.input.schema.json": {
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "enum": [
          "DeskMasterAnalysisContract",
          "DeskHourlyThesisMonitorContract",
          "DeskFrontProjectionContract"
        ]
      },
      "schema_version": {
        "type": "string"
      }
    },
    "required": [
      "contract_name",
      "schema_version"
    ],
    "additionalProperties": false
  },
  "archive_expired_theses.input.schema.json": {
    "type": "object",
    "properties": {
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ]
      },
      "dry_run": {
        "type": "boolean",
        "default": false
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "cancel_backtest_run.input.schema.json": {
    "type": "object",
    "properties": {
      "backtest_id": {
        "type": "string",
        "minLength": 3
      },
      "reason": {
        "type": "string"
      }
    },
    "required": [
      "backtest_id"
    ],
    "additionalProperties": false
  },
  "cancel_desk_job.input.schema.json": {
    "type": "object",
    "properties": {
      "job_id": {
        "type": "string",
        "minLength": 3
      },
      "reason": {
        "type": "string"
      }
    },
    "required": [
      "job_id"
    ],
    "additionalProperties": false
  },
  "create_backtest_run.input.schema.json": {
    "type": "object",
    "properties": {
      "backtest_id": {
        "type": "string",
        "minLength": 3
      },
      "label": {
        "type": "string"
      },
      "date_from": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "date_to": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "instrument_mode": {
        "type": "string",
        "enum": [
          "auto",
          "MNQ",
          "MES",
          "NQ",
          "ES"
        ],
        "default": "auto"
      },
      "master_contract": {
        "type": "string",
        "default": "4.0.0"
      },
      "monitor_contract": {
        "type": "string",
        "default": "1.0.0"
      },
      "monitor_cadence": {
        "type": "string",
        "default": "1h"
      },
      "mode": {
        "type": "string",
        "enum": [
          "backforward_strict",
          "setup_replay"
        ],
        "default": "backforward_strict"
      },
      "risk_model": {
        "type": "string",
        "default": "0.5pct_fixed"
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 500,
        "default": 200
      }
    },
    "required": [
      "date_from",
      "date_to"
    ],
    "additionalProperties": false
  },
  "create_desk_job.input.schema.json": {
    "type": "object",
    "properties": {
      "job_id": {
        "type": "string",
        "minLength": 3
      },
      "job_type": {
        "type": "string",
        "enum": [
          "MASTER_ANALYSIS",
          "HOURLY_MONITOR",
          "REPLAN",
          "FEATURE_ENGINE",
          "BACKTEST_RUN",
          "BACKTEST_STEP",
          "SIMULATE_TRADE",
          "AUDIT_CHECK"
        ]
      },
      "status": {
        "type": "string",
        "enum": [
          "QUEUED",
          "PREPARING_DATA",
          "READY_FOR_GPT",
          "RUNNING_GPT",
          "SAVING_RESULT",
          "DONE",
          "FAILED",
          "CANCELLED",
          "REQUIRES_MANUAL_RUN"
        ],
        "default": "QUEUED"
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "mode": {
        "type": "string",
        "enum": [
          "live",
          "paper",
          "replay",
          "backtest"
        ],
        "default": "live"
      },
      "pack_id": {
        "type": "string"
      },
      "bundle_id": {
        "type": "string"
      },
      "contract_name": {
        "type": "string"
      },
      "schema_version": {
        "type": "string"
      },
      "contract_hash": {
        "type": "string"
      },
      "result_ref": {
        "type": [
          "object",
          "string",
          "null"
        ],
        "additionalProperties": true
      },
      "error": {
        "type": [
          "object",
          "string",
          "null"
        ],
        "additionalProperties": true
      },
      "metadata": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "required": [
      "job_type"
    ],
    "additionalProperties": true
  },
  "desk_ping.input.schema.json": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "get_active_contracts.input.schema.json": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "get_active_thesis.input.schema.json": {
    "type": "object",
    "properties": {
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES",
          "WAIT"
        ]
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "any"
        ],
        "default": "active"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_audit_state.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_backtest_results.input.schema.json": {
    "type": "object",
    "properties": {
      "backtest_id": {
        "type": "string",
        "minLength": 3
      }
    },
    "required": [
      "backtest_id"
    ],
    "additionalProperties": false
  },
  "get_backtest_run.input.schema.json": {
    "type": "object",
    "properties": {
      "backtest_id": {
        "type": "string",
        "minLength": 3
      }
    },
    "required": [
      "backtest_id"
    ],
    "additionalProperties": false
  },
  "get_backtest_timeline.input.schema.json": {
    "type": "object",
    "properties": {
      "backtest_id": {
        "type": "string",
        "minLength": 3
      }
    },
    "required": [
      "backtest_id"
    ],
    "additionalProperties": false
  },
  "get_condition_status.input.schema.json": {
    "type": "object",
    "properties": {
      "thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "timestamp_paris": {
        "type": "string"
      }
    },
    "required": [
      "thesis_id"
    ],
    "additionalProperties": false
  },
  "get_contract.input.schema.json": {
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "enum": [
          "DeskMasterAnalysisContract",
          "DeskHourlyThesisMonitorContract",
          "DeskFrontProjectionContract"
        ]
      },
      "schema_version": {
        "type": "string"
      }
    },
    "required": [
      "contract_name",
      "schema_version"
    ],
    "additionalProperties": false
  },
  "get_cross_asset_delta.input.schema.json": {
    "type": "object",
    "properties": {
      "timestamp_paris": {
        "type": "string"
      },
      "window": {
        "type": "string",
        "enum": [
          "15m",
          "1h",
          "4h",
          "session"
        ],
        "default": "1h"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_dataset.input.schema.json": {
    "type": "object",
    "properties": {
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "dataset": {
        "type": "string",
        "enum": [
          "MNQ_M5",
          "MES_M5",
          "NQ_M15",
          "NQ_H1",
          "ES_M15",
          "ES_H1",
          "MNQ_H4",
          "MES_H4",
          "NQ_H4",
          "ES_H4",
          "US10Y_US02Y",
          "US10Y_US02Y_H4",
          "DXY_CL_GC_VIX",
          "DXY_CL_GC_VIX_H4",
          "indices_asie_europe",
          "indices_asie_europe_H4",
          "ny_close_mega_caps",
          "mega_caps_premarket",
          "mega_caps_premarket_H4",
          "macro_calendar",
          "news_digest"
        ]
      },
      "format": {
        "type": "string",
        "enum": [
          "json",
          "csv"
        ],
        "default": "json"
      },
      "max_rows": {
        "type": "integer",
        "minimum": 1,
        "maximum": 5000,
        "default": 1000
      }
    },
    "required": [
      "pack_id",
      "dataset"
    ],
    "additionalProperties": false
  },
  "get_desk_job.input.schema.json": {
    "type": "object",
    "properties": {
      "job_id": {
        "type": "string",
        "minLength": 3
      }
    },
    "required": [
      "job_id"
    ],
    "additionalProperties": false
  },
  "get_desk_methodology.input.schema.json": {
    "type": "object",
    "properties": {},
    "required": [],
    "additionalProperties": false
  },
  "get_desk_pack.input.schema.json": {
    "type": "object",
    "properties": {
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "include_draft": {
        "type": "boolean",
        "default": false,
        "description": "False only allows ready packs. True is dev-only."
      }
    },
    "required": [
      "pack_id"
    ],
    "additionalProperties": false
  },
  "get_desk_setups.input.schema.json": {
    "type": "object",
    "properties": {
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "default": "any"
      },
      "primary_only": {
        "type": "boolean",
        "default": false
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 500,
        "default": 50
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_front_master_state.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_front_monitor_state.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "timestamp_paris": {
        "type": "string"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_latest_asia_open_pack.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$",
        "description": "Paris date YYYY-MM-DD. Defaults to latest ready pack."
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_latest_hourly_monitor.input.schema.json": {
    "type": "object",
    "properties": {
      "thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 50,
        "default": 1
      }
    },
    "required": [
      "thesis_id"
    ],
    "additionalProperties": false
  },
  "get_latest_master_analysis.input.schema.json": {
    "type": "object",
    "properties": {
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "before_date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES",
          "WAIT"
        ]
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_level_map.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES"
        ]
      }
    },
    "required": [
      "date",
      "instrument"
    ],
    "additionalProperties": false
  },
  "get_live_desk_state.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "mode": {
        "type": "string",
        "enum": [
          "live",
          "paper",
          "replay"
        ],
        "default": "live"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_macro_calendar.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "pack_id": {
        "type": "string"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "importance_min": {
        "type": "string",
        "enum": [
          "low",
          "medium",
          "high"
        ],
        "default": "medium"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_market_levels.input.schema.json": {
    "type": "object",
    "properties": {
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "MES",
          "NQ",
          "ES"
        ]
      }
    },
    "required": [
      "pack_id",
      "instrument"
    ],
    "additionalProperties": false
  },
  "get_master_analysis_bundle.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "pack_id": {
        "type": "string"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "include_raw_refs": {
        "type": "boolean",
        "default": true
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_monitor_context_bundle.input.schema.json": {
    "type": "object",
    "properties": {
      "thesis_id": {
        "type": "string"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "timestamp_paris": {
        "type": "string"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "include_raw_refs": {
        "type": "boolean",
        "default": true
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_news_digest.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "pack_id": {
        "type": "string"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "asia_to_london",
          "ny_open"
        ],
        "default": "asia_open"
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_raw_window.input.schema.json": {
    "type": "object",
    "properties": {
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "MES",
          "NQ",
          "ES",
          "DXY",
          "VIX",
          "US10Y",
          "US02Y",
          "GC",
          "CL"
        ]
      },
      "timeframe": {
        "type": "string",
        "enum": [
          "M5",
          "M15",
          "H1",
          "H4"
        ]
      },
      "from": {
        "type": "string"
      },
      "to": {
        "type": "string"
      },
      "max_rows": {
        "type": "integer",
        "minimum": 1,
        "maximum": 500,
        "default": 500
      }
    },
    "required": [
      "instrument",
      "timeframe",
      "from",
      "to"
    ],
    "additionalProperties": false
  },
  "get_replay_state.input.schema.json": {
    "type": "object",
    "properties": {
      "backtest_id": {
        "type": "string",
        "minLength": 3
      },
      "date_from": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "date_to": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ]
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 200,
        "default": 50
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "get_technical_events.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES"
        ]
      },
      "from": {
        "type": "string"
      },
      "to": {
        "type": "string"
      },
      "event_type": {
        "type": "string"
      }
    },
    "required": [
      "date",
      "instrument"
    ],
    "additionalProperties": false
  },
  "list_available_exports.input.schema.json": {
    "type": "object",
    "properties": {
      "date_from": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "date_to": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "asia_to_london",
          "ny_open",
          "custom"
        ],
        "default": "asia_open"
      },
      "status": {
        "type": "string",
        "enum": [
          "ready",
          "draft",
          "any"
        ],
        "default": "ready"
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 500,
        "default": 100
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "list_backtest_runs.input.schema.json": {
    "type": "object",
    "properties": {
      "date_from": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "date_to": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ]
      },
      "status": {
        "type": "string"
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 500,
        "default": 50
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "list_contract_versions.input.schema.json": {
    "type": "object",
    "properties": {
      "contract_name": {
        "type": "string",
        "enum": [
          "DeskMasterAnalysisContract",
          "DeskHourlyThesisMonitorContract",
          "DeskFrontProjectionContract"
        ]
      }
    },
    "required": [
      "contract_name"
    ],
    "additionalProperties": false
  },
  "list_desk_jobs.input.schema.json": {
    "type": "object",
    "properties": {
      "job_type": {
        "type": "string"
      },
      "status": {
        "type": "string"
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ]
      },
      "mode": {
        "type": "string"
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 500,
        "default": 50
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "replay_desk_setups.input.schema.json": {
    "type": "object",
    "properties": {
      "setup_record_id": {
        "type": "string",
        "minLength": 3
      },
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "primary_only": {
        "type": "boolean",
        "default": false
      },
      "write_result": {
        "type": "boolean",
        "default": true
      },
      "timeframe": {
        "type": "string",
        "enum": [
          "M5"
        ],
        "default": "M5"
      },
      "replay_from": {
        "type": "string",
        "description": "Optional replay window start. Defaults to pack cutoff or 00:15 Paris."
      },
      "replay_to": {
        "type": "string",
        "description": "Optional replay window end. Defaults to 22:30 Paris on setup date."
      },
      "limit": {
        "type": "integer",
        "minimum": 1,
        "maximum": 100,
        "default": 25
      }
    },
    "required": [],
    "additionalProperties": false
  },
  "run_backtest_until_done.input.schema.json": {
    "type": "object",
    "properties": {
      "backtest_id": {
        "type": "string",
        "minLength": 3
      },
      "max_steps": {
        "type": "integer",
        "minimum": 1,
        "maximum": 500,
        "default": 100
      },
      "write_result": {
        "type": "boolean",
        "default": true
      }
    },
    "required": [
      "backtest_id"
    ],
    "additionalProperties": false
  },
  "run_feature_engine.input.schema.json": {
    "type": "object",
    "properties": {
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward"
        ],
        "default": "asia_open"
      },
      "cutoff_paris": {
        "type": "string"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "instruments": {
        "type": "array",
        "items": {
          "type": "string",
          "enum": [
            "MNQ",
            "MES",
            "NQ",
            "ES"
          ]
        },
        "minItems": 1,
        "maxItems": 4,
        "default": [
          "MNQ",
          "MES"
        ]
      },
      "save": {
        "type": "boolean",
        "default": true
      }
    },
    "required": [
      "date"
    ],
    "additionalProperties": false
  },
  "run_next_backtest_step.input.schema.json": {
    "type": "object",
    "properties": {
      "backtest_id": {
        "type": "string",
        "minLength": 3
      },
      "write_result": {
        "type": "boolean",
        "default": true
      }
    },
    "required": [
      "backtest_id"
    ],
    "additionalProperties": false
  },
  "save_active_thesis.input.schema.json": {
    "type": "object",
    "properties": {
      "thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "linked_master_analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "NO_ACTIVE_THESIS",
          "THESIS_ACTIVE",
          "THESIS_CONDITIONAL",
          "WAIT_MONITORED",
          "THESIS_WEAKENED",
          "THESIS_AT_RISK",
          "THESIS_INVALIDATED",
          "SETUP_ARMED",
          "SETUP_TRIGGERED",
          "REPLAN_REQUIRED",
          "EXPIRED"
        ]
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES",
          "WAIT"
        ]
      },
      "direction": {
        "type": "string",
        "enum": [
          "long",
          "short",
          "neutral",
          "wait"
        ]
      },
      "dominant_scenario": {
        "type": "string",
        "minLength": 1
      },
      "secondary_scenario": {
        "type": "string"
      },
      "confidence_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "health_score": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "valid_from": {
        "type": "string"
      },
      "valid_until": {
        "type": "string"
      },
      "setup_expiry_time": {
        "type": "string"
      },
      "requires_replan_after": {
        "type": "string"
      },
      "key_levels": {
        "type": "array",
        "items": {}
      },
      "wait_to_go_conditions": {
        "type": "array",
        "items": {}
      },
      "invalidation_conditions": {
        "type": "array",
        "items": {}
      },
      "expected_path": {
        "type": "object",
        "additionalProperties": true
      },
      "failure_path": {
        "type": "object",
        "additionalProperties": true
      },
      "scenario_transformation_map": {
        "type": "array",
        "items": {}
      },
      "monitoring_playbook": {
        "type": "array",
        "items": {}
      },
      "last_monitor_id": {
        "type": "string"
      }
    },
    "required": [
      "linked_master_analysis_id",
      "status",
      "instrument",
      "direction",
      "dominant_scenario",
      "confidence_pct",
      "health_score",
      "valid_from"
    ],
    "additionalProperties": true
  },
  "save_context_transmission.input.schema.json": {
    "type": "object",
    "properties": {
      "context_id": {
        "type": "string",
        "minLength": 3
      },
      "linked_analysis_id": {
        "type": "string"
      },
      "linked_monitor_id": {
        "type": "string"
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string"
      }
    },
    "required": [],
    "additionalProperties": true
  },
  "save_contract.input.schema.json": {
    "type": "object",
    "properties": {
      "contract_id": {
        "type": "string",
        "minLength": 3
      },
      "contract_name": {
        "type": "string",
        "enum": [
          "DeskMasterAnalysisContract",
          "DeskHourlyThesisMonitorContract",
          "DeskFrontProjectionContract"
        ]
      },
      "schema_version": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "active",
          "archived"
        ],
        "default": "active"
      },
      "content_markdown": {
        "type": "string",
        "minLength": 1
      },
      "schema_json": {
        "type": "object",
        "additionalProperties": true,
        "default": {}
      },
      "hash": {
        "type": "string"
      },
      "is_active": {
        "type": "boolean",
        "default": false
      },
      "replaced_by": {
        "oneOf": [
          {
            "type": "string"
          },
          {
            "type": "null"
          }
        ]
      },
      "force": {
        "type": "boolean",
        "default": false
      }
    },
    "required": [
      "contract_name",
      "schema_version",
      "content_markdown"
    ],
    "additionalProperties": true
  },
  "save_desk_analysis.input.schema.json": {
    "type": "object",
    "properties": {
      "schema_version": {
        "type": "string",
        "enum": [
          "1.0.0",
          "1.1.0"
        ]
      },
      "contract_name": {
        "type": "string",
        "const": "DeskFuturesAnalysisContract"
      },
      "analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "created_at_paris": {
        "type": "string"
      },
      "mode": {
        "type": "string",
        "enum": [
          "live",
          "backtest",
          "replay",
          "paper"
        ],
        "default": "live"
      },
      "analysis_type": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward",
          "live_position",
          "post_event_replan",
          "position_monitor",
          "weekly_brief",
          "daily_brief"
        ]
      },
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "report_id": {
        "type": "string",
        "minLength": 3
      },
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "created_at": {
        "type": "string"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "asia_to_london",
          "ny_open"
        ]
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "title": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "generated",
          "ready",
          "sent",
          "archived"
        ],
        "default": "ready"
      },
      "scope": {
        "type": "object",
        "additionalProperties": true
      },
      "source_pack": {
        "type": "object",
        "additionalProperties": true
      },
      "executive_summary": {
        "type": "object",
        "properties": {
          "summary": {
            "type": "string",
            "minLength": 1
          },
          "final_decision": {
            "type": "string",
            "enum": [
              "prendre",
              "ne_pas_prendre",
              "wait",
              "gestion_seule"
            ]
          },
          "final_instrument": {
            "type": "string",
            "enum": [
              "MNQ",
              "NQ",
              "MES",
              "ES",
              "WAIT"
            ]
          },
          "final_direction": {
            "type": "string",
            "enum": [
              "long",
              "short",
              "neutral",
              "wait"
            ]
          },
          "primary_setup_id": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "summary",
          "final_decision",
          "final_instrument",
          "final_direction"
        ],
        "additionalProperties": true
      },
      "context": {
        "type": "object",
        "additionalProperties": true
      },
      "market_funnel": {
        "type": "object",
        "additionalProperties": true
      },
      "levels": {
        "type": "object",
        "additionalProperties": true
      },
      "strategic_brief": {
        "type": "object",
        "additionalProperties": true
      },
      "decision_gates": {
        "type": "object",
        "additionalProperties": true
      },
      "summary": {
        "type": "string",
        "minLength": 1
      },
      "primary_setup_id": {
        "type": "string",
        "minLength": 1
      },
      "final_decision": {
        "type": "string",
        "enum": [
          "prendre",
          "ne_pas_prendre",
          "wait",
          "gestion_seule"
        ]
      },
      "final_instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES",
          "WAIT"
        ]
      },
      "final_direction": {
        "type": "string",
        "enum": [
          "long",
          "short",
          "neutral",
          "wait"
        ]
      },
      "setups": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "properties": {
            "setup_id": {
              "type": "string",
              "minLength": 1
            },
            "label": {
              "type": "string",
              "minLength": 1
            },
            "rank": {
              "type": "integer",
              "minimum": 1
            },
            "priority": {
              "type": "integer",
              "minimum": 1
            },
            "instrument": {
              "type": "string",
              "enum": [
                "MNQ",
                "NQ",
                "MES",
                "ES",
                "WAIT"
              ]
            },
            "decision": {
              "type": "string",
              "enum": [
                "prendre",
                "ne_pas_prendre",
                "wait",
                "gestion_seule"
              ],
              "default": "prendre"
            },
            "direction": {
              "type": "string",
              "enum": [
                "long",
                "short",
                "neutral",
                "wait"
              ]
            },
            "setup_type": {
              "type": "string",
              "enum": [
                "buy_limit_pullback",
                "sell_limit_pullback",
                "buy_stop_breakout",
                "sell_stop_breakdown",
                "sell_stop_breakdown_retest",
                "buy_stop_breakout_retest",
                "wait",
                "wait_only",
                "no_trade",
                "management_only"
              ]
            },
            "order_type": {
              "type": "string",
              "enum": [
                "buy_limit",
                "sell_limit",
                "buy_stop",
                "sell_stop",
                "sell_stop_or_retest",
                "buy_stop_or_retest",
                "market",
                "conditional",
                "wait",
                "cancel"
              ]
            },
            "status": {
              "type": "string",
              "enum": [
                "active",
                "secondary",
                "inactive",
                "cancelled",
                "wait",
                "management_only"
              ]
            },
            "entry_zone": {
              "type": "object",
              "properties": {
                "from": {
                  "type": "number"
                },
                "to": {
                  "type": "number"
                }
              },
              "required": [
                "from",
                "to"
              ],
              "additionalProperties": false
            },
            "entry_trigger": {
              "oneOf": [
                {
                  "type": "string"
                },
                {
                  "type": "object",
                  "additionalProperties": true
                }
              ]
            },
            "stop_loss": {
              "type": "number"
            },
            "take_profits": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "name": {
                    "type": "string",
                    "minLength": 1
                  },
                  "target": {
                    "oneOf": [
                      {
                        "type": "number"
                      },
                      {
                        "type": "object",
                        "properties": {
                          "from": {
                            "type": "number"
                          },
                          "to": {
                            "type": "number"
                          }
                        },
                        "required": [
                          "from",
                          "to"
                        ],
                        "additionalProperties": false
                      }
                    ]
                  },
                  "condition": {
                    "type": "string"
                  },
                  "action": {
                    "type": "string"
                  }
                },
                "required": [
                  "name",
                  "target"
                ],
                "additionalProperties": false
              },
              "default": []
            },
            "extension_target": {
              "oneOf": [
                {
                  "type": "number"
                },
                {
                  "type": "object",
                  "properties": {
                    "from": {
                      "type": "number"
                    },
                    "to": {
                      "type": "number"
                    }
                  },
                  "required": [
                    "from",
                    "to"
                  ],
                  "additionalProperties": false
                }
              ]
            },
            "invalidation": {
              "oneOf": [
                {
                  "type": "string",
                  "minLength": 1
                },
                {
                  "type": "object",
                  "additionalProperties": true
                }
              ]
            },
            "risk_pct": {
              "type": "number",
              "minimum": 0,
              "maximum": 10
            },
            "confidence_pct": {
              "type": "number",
              "minimum": 0,
              "maximum": 100
            },
            "rr_minimum": {
              "type": "number",
              "minimum": 0
            },
            "reason": {
              "type": "string",
              "minLength": 1
            },
            "conditions": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "default": []
            },
            "management_rules": {
              "type": "array",
              "items": {
                "type": "string"
              },
              "default": []
            },
            "management": {
              "type": "object",
              "additionalProperties": true
            },
            "executable": {
              "type": "boolean",
              "default": false
            }
          },
          "required": [
            "setup_id",
            "label",
            "instrument",
            "direction",
            "setup_type",
            "invalidation",
            "risk_pct",
            "confidence_pct",
            "reason"
          ],
          "additionalProperties": true
        }
      },
      "executable_decision": {
        "type": "object",
        "properties": {
          "decision_id": {
            "type": "string",
            "minLength": 3
          },
          "pack_id": {
            "type": "string",
            "minLength": 3
          },
          "report_id": {
            "type": "string",
            "minLength": 3
          },
          "analysis_id": {
            "type": "string",
            "minLength": 3
          },
          "created_at": {
            "type": "string"
          },
          "session": {
            "type": "string",
            "enum": [
              "asia_open",
              "asia_to_london",
              "ny_open"
            ]
          },
          "date": {
            "type": "string",
            "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
          },
          "timezone": {
            "type": "string",
            "const": "Europe/Paris",
            "default": "Europe/Paris"
          },
          "instrument": {
            "type": "string",
            "enum": [
              "MNQ",
              "NQ",
              "MES",
              "ES",
              "WAIT"
            ]
          },
          "asset_class": {
            "type": "string",
            "const": "futures",
            "default": "futures"
          },
          "decision": {
            "type": "string",
            "enum": [
              "prendre",
              "ne_pas_prendre",
              "wait",
              "gestion_seule"
            ]
          },
          "direction": {
            "type": "string",
            "enum": [
              "long",
              "short",
              "neutral",
              "wait"
            ]
          },
          "setup_id": {
            "type": "string",
            "minLength": 1
          },
          "setup_type": {
            "type": "string",
            "enum": [
              "buy_limit_pullback",
              "sell_limit_pullback",
              "buy_stop_breakout",
              "sell_stop_breakdown",
              "sell_stop_breakdown_retest",
              "buy_stop_breakout_retest",
              "wait",
              "wait_only",
              "no_trade",
              "management_only"
            ]
          },
          "order_type": {
            "type": "string"
          },
          "confidence_pct": {
            "type": "number",
            "minimum": 0,
            "maximum": 100
          },
          "risk_pct": {
            "type": "number",
            "minimum": 0,
            "maximum": 10
          },
          "rr_minimum": {
            "type": "number",
            "minimum": 0
          },
          "entry_zone": {
            "type": "object",
            "properties": {
              "from": {
                "type": "number"
              },
              "to": {
                "type": "number"
              }
            },
            "required": [
              "from",
              "to"
            ],
            "additionalProperties": false
          },
          "entry_trigger": {
            "type": "string"
          },
          "stop_loss": {
            "type": "number"
          },
          "take_profits": {
            "type": "object",
            "properties": {
              "tp1": {
                "oneOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "object",
                    "properties": {
                      "from": {
                        "type": "number"
                      },
                      "to": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "from",
                      "to"
                    ],
                    "additionalProperties": false
                  }
                ]
              },
              "tp2": {
                "oneOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "object",
                    "properties": {
                      "from": {
                        "type": "number"
                      },
                      "to": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "from",
                      "to"
                    ],
                    "additionalProperties": false
                  }
                ]
              },
              "tp3": {
                "oneOf": [
                  {
                    "type": "number"
                  },
                  {
                    "type": "object",
                    "properties": {
                      "from": {
                        "type": "number"
                      },
                      "to": {
                        "type": "number"
                      }
                    },
                    "required": [
                      "from",
                      "to"
                    ],
                    "additionalProperties": false
                  }
                ]
              }
            },
            "required": [],
            "additionalProperties": false
          },
          "extension_target": {
            "oneOf": [
              {
                "type": "number"
              },
              {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "number"
                  },
                  "to": {
                    "type": "number"
                  }
                },
                "required": [
                  "from",
                  "to"
                ],
                "additionalProperties": false
              }
            ]
          },
          "invalidation": {
            "type": "string",
            "minLength": 1
          },
          "action_now": {
            "type": "string"
          },
          "no_trade_condition": {
            "type": "string"
          },
          "management_rules": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "default": []
          },
          "time_rules": {
            "type": "object",
            "properties": {
              "earliest_entry_time": {
                "type": "string"
              },
              "latest_entry_time": {
                "type": "string"
              },
              "reduce_before": {
                "type": "string"
              },
              "flatten_before": {
                "type": "string"
              }
            },
            "required": [],
            "additionalProperties": false
          },
          "macro_bias": {
            "type": "string",
            "default": "unknown"
          },
          "technical_bias": {
            "type": "string",
            "default": "unknown"
          },
          "cross_asset_bias": {
            "type": "string",
            "default": "unknown"
          },
          "reason_summary": {
            "type": "string",
            "minLength": 1
          },
          "detailed_reason": {
            "type": "string"
          },
          "status": {
            "type": "string",
            "enum": [
              "draft",
              "active",
              "triggered",
              "cancelled",
              "tp1_hit",
              "tp2_hit",
              "tp3_hit",
              "stopped",
              "expired",
              "archived"
            ],
            "default": "draft"
          },
          "decision_audit": {
            "type": "object",
            "description": "Required DecisionAudit envelope for a persistable V2 decision. The entity schema can record violations; this embedded gate only accepts usable audits.",
            "properties": {
              "contract_name": {
                "type": "string",
                "const": "DeskDecisionAuditContract",
                "default": "DeskDecisionAuditContract"
              },
              "schema_version": {
                "type": "string",
                "const": "1.0.0",
                "default": "1.0.0"
              },
              "timezone": {
                "type": "string",
                "const": "Europe/Paris",
                "default": "Europe/Paris"
              },
              "decision_timestamp_paris": {
                "type": "string",
                "minLength": 1,
                "description": "Paris-time ISO 8601 instant at which the decision was produced."
              },
              "data_cutoff_paris": {
                "type": "string",
                "minLength": 1,
                "description": "Paris-time cutoff. No market/macro data after this instant may inform the decision."
              },
              "available_data_until": {
                "type": "string",
                "minLength": 1,
                "description": "Timestamp of the latest data point actually consumed. Must be <= data_cutoff_paris."
              },
              "future_data_used": {
                "type": "boolean",
                "description": "True records an anti-lookahead violation. A valid, guard-approved decision is always false. Valid decision payloads must set this to false.",
                "const": false
              },
              "entry_sl_tp_frozen": {
                "type": "boolean",
                "description": "Section 7 rule: entry / stop-loss / take-profit were frozen BEFORE any outcome replay. False means the decision is not replay-safe. Valid decision payloads must set this to true.",
                "const": true
              },
              "datasets_used": {
                "type": "array",
                "items": {
                  "type": "string"
                },
                "default": [],
                "description": "Identifiers of datasets consumed (values from the DATASETS enum where applicable, plus market_feeds ids).",
                "minItems": 1
              },
              "macro_actuals_visible": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "event": {
                      "type": "string",
                      "minLength": 1
                    },
                    "importance": {
                      "type": "string",
                      "enum": [
                        "low",
                        "medium",
                        "high"
                      ]
                    },
                    "scheduled_at_paris": {
                      "type": "string"
                    },
                    "published_at_paris": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "event"
                  ],
                  "additionalProperties": false
                },
                "default": [],
                "description": "Macro events whose actuals were legitimately visible (published_at_paris <= data_cutoff_paris)."
              },
              "macro_actuals_blocked": {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "event": {
                      "type": "string",
                      "minLength": 1
                    },
                    "importance": {
                      "type": "string",
                      "enum": [
                        "low",
                        "medium",
                        "high"
                      ]
                    },
                    "scheduled_at_paris": {
                      "type": "string"
                    },
                    "published_at_paris": {
                      "type": "string"
                    }
                  },
                  "required": [
                    "event"
                  ],
                  "additionalProperties": false
                },
                "default": [],
                "description": "Macro events blocked because not yet published at the cutoff. Their actuals must NOT influence the decision."
              },
              "source_pack_id": {
                "type": "string",
                "minLength": 1,
                "description": "Pack that seeded the decision context."
              },
              "simulation_id": {
                "oneOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "description": "Set only when the decision was produced inside a simulation run; null in live."
              },
              "mission_id": {
                "oneOf": [
                  {
                    "type": "string"
                  },
                  {
                    "type": "null"
                  }
                ],
                "description": "Set only when the decision was produced under a bounded worker mission; null otherwise."
              },
              "decision_id": {
                "type": "string",
                "minLength": 1
              },
              "thesis_id": {
                "type": "string",
                "minLength": 1
              },
              "decision_timestamp_utc": {
                "type": "string",
                "description": "Optional UTC mirror (forward-compat with T05 time normalization)."
              },
              "data_cutoff_utc": {
                "type": "string",
                "description": "Optional UTC mirror of data_cutoff_paris (forward-compat with T05)."
              },
              "available_data_until_utc": {
                "type": "string",
                "description": "Optional UTC mirror of available_data_until (forward-compat with T05)."
              },
              "entry_sl_tp_frozen_at_paris": {
                "type": "string",
                "description": "Optional Paris-time instant at which entry/SL/TP were frozen."
              },
              "notes": {
                "type": "string"
              }
            },
            "required": [
              "decision_timestamp_paris",
              "data_cutoff_paris",
              "available_data_until",
              "future_data_used",
              "entry_sl_tp_frozen",
              "datasets_used",
              "macro_actuals_visible",
              "macro_actuals_blocked",
              "source_pack_id"
            ],
            "additionalProperties": false
          }
        },
        "required": [
          "session",
          "date",
          "instrument",
          "decision",
          "direction",
          "setup_type",
          "confidence_pct",
          "risk_pct",
          "rr_minimum",
          "invalidation",
          "reason_summary",
          "decision_audit"
        ],
        "additionalProperties": false
      },
      "session_matrix": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "authorized_windows_summary": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "update_agenda": {
        "type": "array",
        "minItems": 1,
        "items": {
          "type": "object",
          "additionalProperties": true
        }
      },
      "risk_management": {
        "type": "object",
        "additionalProperties": true
      },
      "monitoring_rules": {
        "type": "object",
        "additionalProperties": true
      },
      "final_sections": {
        "type": "object",
        "properties": {
          "decision_executable": {
            "type": "string",
            "minLength": 1
          },
          "regle_finale": {
            "type": "string",
            "minLength": 1
          }
        },
        "required": [
          "decision_executable",
          "regle_finale"
        ],
        "additionalProperties": true
      },
      "markdown": {
        "type": "string"
      }
    },
    "required": [
      "schema_version",
      "contract_name",
      "analysis_id",
      "created_at_paris",
      "mode",
      "analysis_type",
      "pack_id",
      "session",
      "date",
      "timezone",
      "scope",
      "source_pack",
      "executive_summary",
      "context",
      "market_funnel",
      "levels",
      "strategic_brief",
      "decision_gates",
      "setups",
      "executable_decision",
      "session_matrix",
      "authorized_windows_summary",
      "update_agenda",
      "risk_management",
      "monitoring_rules",
      "final_sections"
    ],
    "additionalProperties": false
  },
  "save_desk_decision.input.schema.json": {
    "type": "object",
    "properties": {
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "report_id": {
        "type": "string",
        "minLength": 3
      },
      "analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "created_at": {
        "type": "string"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "asia_to_london",
          "ny_open"
        ]
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES",
          "WAIT"
        ]
      },
      "asset_class": {
        "type": "string",
        "const": "futures",
        "default": "futures"
      },
      "decision": {
        "type": "string",
        "enum": [
          "prendre",
          "ne_pas_prendre",
          "wait",
          "gestion_seule"
        ]
      },
      "direction": {
        "type": "string",
        "enum": [
          "long",
          "short",
          "neutral",
          "wait"
        ]
      },
      "setup_id": {
        "type": "string",
        "minLength": 1
      },
      "setup_type": {
        "type": "string",
        "enum": [
          "buy_limit_pullback",
          "sell_limit_pullback",
          "buy_stop_breakout",
          "sell_stop_breakdown",
          "sell_stop_breakdown_retest",
          "buy_stop_breakout_retest",
          "wait",
          "wait_only",
          "no_trade",
          "management_only"
        ]
      },
      "order_type": {
        "type": "string"
      },
      "confidence_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "risk_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 10
      },
      "rr_minimum": {
        "type": "number",
        "minimum": 0
      },
      "entry_zone": {
        "type": "object",
        "properties": {
          "from": {
            "type": "number"
          },
          "to": {
            "type": "number"
          }
        },
        "required": [
          "from",
          "to"
        ],
        "additionalProperties": false
      },
      "entry_trigger": {
        "type": "string"
      },
      "stop_loss": {
        "type": "number"
      },
      "take_profits": {
        "type": "object",
        "properties": {
          "tp1": {
            "oneOf": [
              {
                "type": "number"
              },
              {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "number"
                  },
                  "to": {
                    "type": "number"
                  }
                },
                "required": [
                  "from",
                  "to"
                ],
                "additionalProperties": false
              }
            ]
          },
          "tp2": {
            "oneOf": [
              {
                "type": "number"
              },
              {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "number"
                  },
                  "to": {
                    "type": "number"
                  }
                },
                "required": [
                  "from",
                  "to"
                ],
                "additionalProperties": false
              }
            ]
          },
          "tp3": {
            "oneOf": [
              {
                "type": "number"
              },
              {
                "type": "object",
                "properties": {
                  "from": {
                    "type": "number"
                  },
                  "to": {
                    "type": "number"
                  }
                },
                "required": [
                  "from",
                  "to"
                ],
                "additionalProperties": false
              }
            ]
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "extension_target": {
        "oneOf": [
          {
            "type": "number"
          },
          {
            "type": "object",
            "properties": {
              "from": {
                "type": "number"
              },
              "to": {
                "type": "number"
              }
            },
            "required": [
              "from",
              "to"
            ],
            "additionalProperties": false
          }
        ]
      },
      "invalidation": {
        "type": "string",
        "minLength": 1
      },
      "action_now": {
        "type": "string"
      },
      "no_trade_condition": {
        "type": "string"
      },
      "management_rules": {
        "type": "array",
        "items": {
          "type": "string"
        },
        "default": []
      },
      "time_rules": {
        "type": "object",
        "properties": {
          "earliest_entry_time": {
            "type": "string"
          },
          "latest_entry_time": {
            "type": "string"
          },
          "reduce_before": {
            "type": "string"
          },
          "flatten_before": {
            "type": "string"
          }
        },
        "required": [],
        "additionalProperties": false
      },
      "macro_bias": {
        "type": "string",
        "default": "unknown"
      },
      "technical_bias": {
        "type": "string",
        "default": "unknown"
      },
      "cross_asset_bias": {
        "type": "string",
        "default": "unknown"
      },
      "reason_summary": {
        "type": "string",
        "minLength": 1
      },
      "detailed_reason": {
        "type": "string"
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "active",
          "triggered",
          "cancelled",
          "tp1_hit",
          "tp2_hit",
          "tp3_hit",
          "stopped",
          "expired",
          "archived"
        ],
        "default": "draft"
      },
      "decision_audit": {
        "type": "object",
        "description": "Required DecisionAudit envelope for a persistable V2 decision. The entity schema can record violations; this embedded gate only accepts usable audits.",
        "properties": {
          "contract_name": {
            "type": "string",
            "const": "DeskDecisionAuditContract",
            "default": "DeskDecisionAuditContract"
          },
          "schema_version": {
            "type": "string",
            "const": "1.0.0",
            "default": "1.0.0"
          },
          "timezone": {
            "type": "string",
            "const": "Europe/Paris",
            "default": "Europe/Paris"
          },
          "decision_timestamp_paris": {
            "type": "string",
            "minLength": 1,
            "description": "Paris-time ISO 8601 instant at which the decision was produced."
          },
          "data_cutoff_paris": {
            "type": "string",
            "minLength": 1,
            "description": "Paris-time cutoff. No market/macro data after this instant may inform the decision."
          },
          "available_data_until": {
            "type": "string",
            "minLength": 1,
            "description": "Timestamp of the latest data point actually consumed. Must be <= data_cutoff_paris."
          },
          "future_data_used": {
            "type": "boolean",
            "description": "True records an anti-lookahead violation. A valid, guard-approved decision is always false. Valid decision payloads must set this to false.",
            "const": false
          },
          "entry_sl_tp_frozen": {
            "type": "boolean",
            "description": "Section 7 rule: entry / stop-loss / take-profit were frozen BEFORE any outcome replay. False means the decision is not replay-safe. Valid decision payloads must set this to true.",
            "const": true
          },
          "datasets_used": {
            "type": "array",
            "items": {
              "type": "string"
            },
            "default": [],
            "description": "Identifiers of datasets consumed (values from the DATASETS enum where applicable, plus market_feeds ids).",
            "minItems": 1
          },
          "macro_actuals_visible": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "event": {
                  "type": "string",
                  "minLength": 1
                },
                "importance": {
                  "type": "string",
                  "enum": [
                    "low",
                    "medium",
                    "high"
                  ]
                },
                "scheduled_at_paris": {
                  "type": "string"
                },
                "published_at_paris": {
                  "type": "string"
                }
              },
              "required": [
                "event"
              ],
              "additionalProperties": false
            },
            "default": [],
            "description": "Macro events whose actuals were legitimately visible (published_at_paris <= data_cutoff_paris)."
          },
          "macro_actuals_blocked": {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "event": {
                  "type": "string",
                  "minLength": 1
                },
                "importance": {
                  "type": "string",
                  "enum": [
                    "low",
                    "medium",
                    "high"
                  ]
                },
                "scheduled_at_paris": {
                  "type": "string"
                },
                "published_at_paris": {
                  "type": "string"
                }
              },
              "required": [
                "event"
              ],
              "additionalProperties": false
            },
            "default": [],
            "description": "Macro events blocked because not yet published at the cutoff. Their actuals must NOT influence the decision."
          },
          "source_pack_id": {
            "type": "string",
            "minLength": 1,
            "description": "Pack that seeded the decision context."
          },
          "simulation_id": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "description": "Set only when the decision was produced inside a simulation run; null in live."
          },
          "mission_id": {
            "oneOf": [
              {
                "type": "string"
              },
              {
                "type": "null"
              }
            ],
            "description": "Set only when the decision was produced under a bounded worker mission; null otherwise."
          },
          "decision_id": {
            "type": "string",
            "minLength": 1
          },
          "thesis_id": {
            "type": "string",
            "minLength": 1
          },
          "decision_timestamp_utc": {
            "type": "string",
            "description": "Optional UTC mirror (forward-compat with T05 time normalization)."
          },
          "data_cutoff_utc": {
            "type": "string",
            "description": "Optional UTC mirror of data_cutoff_paris (forward-compat with T05)."
          },
          "available_data_until_utc": {
            "type": "string",
            "description": "Optional UTC mirror of available_data_until (forward-compat with T05)."
          },
          "entry_sl_tp_frozen_at_paris": {
            "type": "string",
            "description": "Optional Paris-time instant at which entry/SL/TP were frozen."
          },
          "notes": {
            "type": "string"
          }
        },
        "required": [
          "decision_timestamp_paris",
          "data_cutoff_paris",
          "available_data_until",
          "future_data_used",
          "entry_sl_tp_frozen",
          "datasets_used",
          "macro_actuals_visible",
          "macro_actuals_blocked",
          "source_pack_id"
        ],
        "additionalProperties": false
      }
    },
    "required": [
      "session",
      "date",
      "instrument",
      "decision",
      "direction",
      "setup_type",
      "confidence_pct",
      "risk_pct",
      "rr_minimum",
      "invalidation",
      "reason_summary",
      "decision_audit"
    ],
    "additionalProperties": false
  },
  "save_desk_report.input.schema.json": {
    "type": "object",
    "properties": {
      "report_id": {
        "type": "string",
        "minLength": 3
      },
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "asia_to_london",
          "ny_open"
        ]
      },
      "timezone": {
        "type": "string",
        "const": "Europe/Paris",
        "default": "Europe/Paris"
      },
      "title": {
        "type": "string",
        "minLength": 3
      },
      "markdown": {
        "type": "string",
        "minLength": 1
      },
      "summary": {
        "type": "string"
      },
      "sections": {
        "type": "object",
        "additionalProperties": true
      },
      "status": {
        "type": "string",
        "enum": [
          "generated",
          "sent",
          "archived"
        ],
        "default": "generated"
      }
    },
    "required": [
      "date",
      "session",
      "title",
      "markdown"
    ],
    "additionalProperties": false
  },
  "save_hourly_monitor.input.schema.json": {
    "type": "object",
    "properties": {
      "monitor_id": {
        "type": "string",
        "minLength": 3
      },
      "contract_name": {
        "type": "string",
        "const": "DeskHourlyThesisMonitorContract",
        "default": "DeskHourlyThesisMonitorContract"
      },
      "schema_version": {
        "type": "string",
        "const": "1.0.0",
        "default": "1.0.0"
      },
      "contract_hash": {
        "type": "string",
        "minLength": 1
      },
      "timestamp_paris": {
        "type": "string"
      },
      "linked_master_analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "linked_active_thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "linked_previous_monitor_id": {
        "type": "string"
      },
      "monitor_decision": {
        "type": "object",
        "additionalProperties": true
      },
      "thesis_health_score": {
        "type": "object",
        "additionalProperties": true
      },
      "expected_vs_realized": {
        "type": "array",
        "items": {}
      },
      "macro_update": {
        "type": "object",
        "additionalProperties": true
      },
      "cross_asset_delta": {
        "type": "object",
        "additionalProperties": true
      },
      "technical_delta": {
        "type": "object",
        "additionalProperties": true
      },
      "wait_to_go_check": {
        "type": "array",
        "items": {}
      },
      "invalidation_check": {
        "type": "array",
        "items": {}
      },
      "weak_signals": {
        "type": "array",
        "items": {}
      },
      "monitor_context_transmission": {
        "type": "object",
        "additionalProperties": true
      },
      "front_projection": {
        "type": "object",
        "description": "DeskFrontProjectionContract v1.0.0; validated by the runtime against the canonical contract and source scope.",
        "properties": {
          "contractName": {
            "type": "string",
            "const": "DeskFrontProjectionContract"
          },
          "schemaVersion": {
            "type": "string",
            "const": "1.0.0"
          },
          "source": {
            "type": "object"
          }
        },
        "required": [
          "contractName",
          "schemaVersion",
          "source"
        ],
        "additionalProperties": true
      }
    },
    "required": [
      "contract_hash",
      "timestamp_paris",
      "linked_master_analysis_id",
      "linked_active_thesis_id",
      "monitor_decision",
      "thesis_health_score"
    ],
    "additionalProperties": true
  },
  "save_master_analysis.input.schema.json": {
    "type": "object",
    "properties": {
      "analysis_id": {
        "type": "string",
        "minLength": 3
      },
      "contract_name": {
        "type": "string",
        "const": "DeskMasterAnalysisContract",
        "default": "DeskMasterAnalysisContract"
      },
      "schema_version": {
        "type": "string",
        "const": "4.0.0",
        "default": "4.0.0"
      },
      "contract_hash": {
        "type": "string",
        "minLength": 1
      },
      "pack_id": {
        "type": "string",
        "minLength": 3
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string",
        "enum": [
          "asia_open",
          "london_session",
          "ny_open",
          "work_forward",
          "post_event_replan"
        ]
      },
      "active_thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "report_id": {
        "type": "string",
        "minLength": 3
      },
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "ready",
          "archived"
        ],
        "default": "ready"
      },
      "created_at_paris": {
        "type": "string"
      },
      "full_analysis": {
        "type": "object",
        "additionalProperties": true
      },
      "context_transmission": {
        "type": "object",
        "additionalProperties": true
      },
      "decision_journal": {
        "type": "object",
        "additionalProperties": true
      },
      "front_projection": {
        "type": "object",
        "description": "DeskFrontProjectionContract v1.0.0; validated by the runtime against the canonical contract and source scope.",
        "properties": {
          "contractName": {
            "type": "string",
            "const": "DeskFrontProjectionContract"
          },
          "schemaVersion": {
            "type": "string",
            "const": "1.0.0"
          },
          "source": {
            "type": "object"
          }
        },
        "required": [
          "contractName",
          "schemaVersion",
          "source"
        ],
        "additionalProperties": true
      }
    },
    "required": [
      "contract_hash",
      "pack_id",
      "date",
      "session",
      "created_at_paris",
      "full_analysis"
    ],
    "additionalProperties": true
  },
  "save_monitor_alert.input.schema.json": {
    "type": "object",
    "properties": {
      "alert_id": {
        "type": "string",
        "minLength": 3
      },
      "timestamp_paris": {
        "type": "string"
      },
      "alert_level": {
        "type": "string",
        "enum": [
          "info",
          "watch",
          "warning",
          "action",
          "critical"
        ]
      },
      "title": {
        "type": "string",
        "minLength": 1
      },
      "message": {
        "type": "string",
        "minLength": 1
      },
      "linked_monitor_id": {
        "type": "string"
      },
      "linked_thesis_id": {
        "type": "string"
      },
      "action_required": {
        "type": "string"
      },
      "send_to_telegram": {
        "type": "boolean",
        "default": false
      }
    },
    "required": [
      "alert_level",
      "title",
      "message"
    ],
    "additionalProperties": true
  },
  "save_monitor_context_transmission.input.schema.json": {
    "type": "object",
    "properties": {
      "context_id": {
        "type": "string",
        "minLength": 3
      },
      "linked_analysis_id": {
        "type": "string"
      },
      "linked_monitor_id": {
        "type": "string"
      },
      "date": {
        "type": "string",
        "pattern": "^\\d{4}-\\d{2}-\\d{2}$"
      },
      "session": {
        "type": "string"
      }
    },
    "required": [],
    "additionalProperties": true
  },
  "update_active_thesis.input.schema.json": {
    "type": "object",
    "properties": {
      "thesis_id": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "NO_ACTIVE_THESIS",
          "THESIS_ACTIVE",
          "THESIS_CONDITIONAL",
          "WAIT_MONITORED",
          "THESIS_WEAKENED",
          "THESIS_AT_RISK",
          "THESIS_INVALIDATED",
          "SETUP_ARMED",
          "SETUP_TRIGGERED",
          "REPLAN_REQUIRED",
          "EXPIRED"
        ]
      },
      "health_score": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "confidence_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 100
      },
      "last_monitor_id": {
        "type": "string"
      },
      "dominant_scenario": {
        "type": "string"
      },
      "secondary_scenario": {
        "type": "string"
      },
      "notes": {
        "type": "string"
      }
    },
    "required": [
      "thesis_id"
    ],
    "additionalProperties": true
  },
  "update_desk_decision_status.input.schema.json": {
    "type": "object",
    "properties": {
      "decision_id": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "draft",
          "active",
          "triggered",
          "cancelled",
          "tp1_hit",
          "tp2_hit",
          "tp3_hit",
          "stopped",
          "expired",
          "archived"
        ]
      },
      "note": {
        "type": "string"
      },
      "updated_by": {
        "type": "string",
        "default": "user"
      }
    },
    "required": [
      "decision_id",
      "status"
    ],
    "additionalProperties": false
  },
  "update_desk_job_status.input.schema.json": {
    "type": "object",
    "properties": {
      "job_id": {
        "type": "string",
        "minLength": 3
      },
      "status": {
        "type": "string",
        "enum": [
          "QUEUED",
          "PREPARING_DATA",
          "READY_FOR_GPT",
          "RUNNING_GPT",
          "SAVING_RESULT",
          "DONE",
          "FAILED",
          "CANCELLED",
          "REQUIRES_MANUAL_RUN"
        ]
      },
      "result_ref": {
        "type": [
          "object",
          "string",
          "null"
        ],
        "additionalProperties": true
      },
      "error": {
        "type": [
          "object",
          "string",
          "null"
        ],
        "additionalProperties": true
      },
      "metadata": {
        "type": "object",
        "additionalProperties": true
      }
    },
    "required": [
      "job_id",
      "status"
    ],
    "additionalProperties": true
  },
  "update_position_management.input.schema.json": {
    "type": "object",
    "properties": {
      "position_id": {
        "type": "string",
        "minLength": 3
      },
      "instrument": {
        "type": "string",
        "enum": [
          "MNQ",
          "NQ",
          "MES",
          "ES"
        ]
      },
      "direction": {
        "type": "string",
        "enum": [
          "long",
          "short"
        ]
      },
      "entry_price": {
        "type": "number"
      },
      "stop_loss": {
        "type": "number"
      },
      "take_profits": {
        "type": "array",
        "items": {}
      },
      "risk_pct": {
        "type": "number",
        "minimum": 0,
        "maximum": 10
      },
      "status": {
        "type": "string",
        "enum": [
          "active",
          "protected",
          "partial_taken",
          "closed",
          "cancelled"
        ]
      },
      "linked_thesis_id": {
        "type": "string"
      },
      "linked_decision_id": {
        "type": "string"
      },
      "management_action": {
        "type": "string",
        "enum": [
          "create",
          "update",
          "break_even",
          "partial",
          "reduce",
          "exit",
          "cancel"
        ],
        "default": "update"
      },
      "notes": {
        "type": "string"
      }
    },
    "required": [],
    "additionalProperties": true
  }
};
