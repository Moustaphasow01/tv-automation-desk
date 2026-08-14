# Broker progressive reconciliation

Date: 2026-08-09
Ticket: TD2-013

## But

La réconciliation NinjaTrader/PostgreSQL devient planifiable sans transformer une divergence observée en blocage automatique trop tôt.

Le mode cible est progressif :

1. `alert_only` par défaut pour les runners périodiques.
2. Observation des divergences dans `broker_reconciliation_runs`.
3. Promotion explicite vers `blocking` uniquement après décision opérateur.
4. Rollback immédiat possible vers `alert_only`.

## Modes

| Mode | Verrou sur divergence | Usage |
| --- | --- | --- |
| `disabled` | non | Pause opérateur ou maintenance. |
| `alert_only` | non | Mode par défaut des jobs planifiés. Mesure et journalise les divergences sans couper l’exécution. |
| `blocking` | oui | Mode dur après observation. Requiert la confirmation `PROMOTE_RECONCILIATION_BLOCKING` lorsqu’il est déclenché par un scheduler. |

## Politique d’audit

Chaque run écrit dans `broker_reconciliation_runs.metadata.reconciliation_policy` :

- `mode` ;
- `triggeredBy` ;
- `lockOnDivergence` ;
- `alertOnly` ;
- `blockingPromotionConfirmed` ;
- `rollbackMode`.

En cas de divergence bloquante, le chemin existant reste inchangé : `broker_accounts` passe en lecture seule et un verrou `broker_execution_locks` est posé au scope compte.

## Runners

Les scripts existants acceptent maintenant :

- `DESK_BROKER_RECONCILIATION_MODE=alert_only|blocking|disabled`
- `DESK_BROKER_RECONCILIATION_CONFIRMATION=PROMOTE_RECONCILIATION_BLOCKING`

Par défaut :

- `scripts/reconcile_ninja_snapshot.mjs` utilise `alert_only`.
- `scripts/watch_ninja_outgoing.mjs --reconcile` utilise `alert_only`.

## Critères d’exploitation

Avant de passer en `blocking`, l’opérateur doit vérifier :

- plusieurs runs `alert_only` consécutifs sans faux positif ;
- les snapshots AddOn/ATI sont frais ;
- TD2-011 et TD2-012 restent verts ;
- le rollback vers `alert_only` est testé.
