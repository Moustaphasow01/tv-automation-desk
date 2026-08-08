# Diagram 03 — Multi-Agent Runtime Entity Relationships

Référencé par `09-RESEARCH-LAB-AND-MULTI-AGENT-RUNTIME.md`, `05-DOMAIN-MODEL-AND-STATE-MACHINES.md` §4.

```mermaid
erDiagram
    AGENT ||--o{ MISSION : "exécute"
    MISSION ||--o{ CONVERSATION : "peut avoir"
    MISSION ||--o{ TASK : "décomposée en"
    TASK }o--|| BATCH : "regroupée dans"
    MISSION ||--o{ EVENT : "émet"
    AGENT ||--o{ LEASE : "détient"
    AGENT ||--o{ LOCK : "détient"

    AGENT {
        uuid id
        string type "market-analysis | thesis-monitor | replay-orchestrator"
        string status "IDLE | BUSY | OFFLINE"
    }
    MISSION {
        uuid id
        uuid agent_id
        string correlation_id
        string status
    }
    BATCH {
        uuid id
        string policy "ALL | ANY | FIRST_SOCK | QUORUM | TIMEOUT_WITH_PARTIAL_RESULTS"
        timestamp deadline_at
    }
```

**Point structurant** (ADR-0013, ADR-0014) : chacun des 3 pipelines LLM existants devient un `type` d'`AGENT` — la structure ci-dessus est partagée par les 3, seule la politique de `BATCH` diffère selon leur fréquence.
