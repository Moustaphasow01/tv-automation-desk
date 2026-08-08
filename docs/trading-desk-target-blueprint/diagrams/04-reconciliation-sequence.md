# Diagram 04 — Reconciliation Sequence (Gouvernée, Post Ticket 0.4)

Référencé par `13-EXECUTION-GATEWAY-PROVIDERS-AND-RECONCILIATION.md` §5, ADR-0005.

```mermaid
sequenceDiagram
    participant Scheduler as run_broker_management_worker.mjs
    participant Service as broker-execution-service.js
    participant Broker as NinjaTrader (réel)
    participant Op as Opérateur

    Note over Scheduler,Service: Actif seulement après Ticket 0.4 fusionné (ADR-0005)
    Scheduler->>Service: reconcile(accountId) [déclenchement SCHEDULED]
    Service->>Service: reconciliationSnapshot(accountId)
    Service->>Broker: lecture des positions réelles
    Broker-->>Service: positions broker
    Service->>Service: compareSnapshots (agrégation signée corrigée, 0.4)
    alt divergence détectée
        Service->>Op: alerte (comportement par défaut, OP-10)
        Note over Service,Op: Jamais de correction automatique de position par défaut
    else pas de divergence
        Service->>Service: Reconciliation Snapshot journalisé, aucune action
    end
```

**Point structurant** (errata point 1, ADR-0005) : ce déclenchement `SCHEDULED` ne peut être activé qu'après que le Ticket 0.4 (correction de l'agrégation) soit terminé et fusionné — sinon la réconciliation convertirait un bug latent en verrouillages automatiques périodiques.
