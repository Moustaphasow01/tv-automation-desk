# Diagram 01 — Strategy Identity Relationships

Référencé par `05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §2 et ADR-0001, ADR-0002.

```mermaid
erDiagram
    STRATEGY_DEFINITION ||--o{ STRATEGY_VERSION : "a des versions"
    STRATEGY_VERSION ||--o{ STRATEGY_INSTANCE : "instanciée par"
    RUNTIME_CONTRACT_BUNDLE ||--o{ STRATEGY_VERSION : "compatible avec (orthogonal, singulier)"
    STRATEGY_INSTANCE ||--o{ SIGNAL : "émet"
    STRATEGY_INSTANCE ||--o{ TRADE_LEGACY : "trades.strategy_id (legacy, non réinterprété)"
    STRATEGY_INSTANCE ||--o{ TRADE_NEW : "trades.strategy_instance_id (nouveau, sans backfill)"

    STRATEGY_DEFINITION {
        uuid id
        string name
        string owner
    }
    STRATEGY_VERSION {
        uuid id
        uuid strategy_definition_id
        string version_label
        string status "DRAFT | IN_SIMULATION | VALIDATED | PUBLISHED | DEPRECATED"
        string dsl_source_hash
    }
    STRATEGY_INSTANCE {
        uuid id
        uuid strategy_version_id
        string runtime_state "axe A"
        string execution_mode "axe B: SHADOW | PAPER | LIVE"
    }
    RUNTIME_CONTRACT_BUNDLE {
        string catalog_version
        string engine_version
    }
```

**Point structurant** (ADR-0001) : `RUNTIME_CONTRACT_BUNDLE` (= `ACTIVE_STRATEGY_RUNTIME_VERSIONS`) reste **singulier par déploiement** — la relation avec `STRATEGY_VERSION` est une lecture de compatibilité, jamais une clé de sélection de stratégie active.
