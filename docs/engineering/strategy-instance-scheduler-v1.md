# Strategy Instance Scheduler V1

Date: 2026-08-09
Ticket: TD2-600

## Décision

Le scheduler V1 est déterministe et attaché aux `Strategy Instance`, pas aux workers IA.

Il calcule les ticks dus à partir de :

- `runtime_state` (`RUNNING`/`STARTING` seulement) ;
- `execution_mode` (`LIVE` prioritaire, puis `PAPER`, puis `SHADOW`) ;
- `metadata.scheduler.cadence_seconds` ;
- `metadata.scheduler.next_due_at_utc` ou le dernier tick connu ;
- `last_scheduled_at_by_instance` fourni au redémarrage par l’orchestrateur.

## Invariants

- Une instance `PAUSED`, `STOPPED`, `ERRORED` ou `FAILED_TO_START` ne produit aucun tick.
- Un tick déjà planifié ne doit pas être réémis après redémarrage : le `scheduler_run_key` contient `strategy_instance_id + scheduled_for_utc`.
- Le service écrit un audit `STRATEGY_INSTANCE_SCHEDULER_TICK_DUE` idempotent par tick.
- Le scheduler ne déclenche pas de LLM synchrone et ne génère pas encore de signal broker : TD2-601 ajoute l’outbox/signal bus.

## Stockage

Aucune migration SQL n’est ajoutée pour TD2-600.

La configuration est portée par `strategy_instances.metadata.scheduler` afin de rester additive :

```json
{
  "scheduler": {
    "enabled": true,
    "cadence_seconds": 60,
    "max_lag_seconds": 120,
    "next_due_at_utc": "2026-08-09T08:01:00.000Z",
    "last_scheduled_at_utc": "2026-08-09T08:00:00.000Z"
  }
}
```

## Livrables code

- Domaine pur : `planStrategyInstanceSchedulerCycleV1`.
- Service applicatif : `StrategyKernelService.planInstanceSchedulerCycle`.
- Audit idempotent via `strategy_kernel_audit_events`.
- Tests pause, reprise/redémarrage, retard et priorité LIVE.
