# Strategy Front — Instances & Signals V1

TD2-604 branche le front transitoire sur les données réelles du Strategy Kernel V2.

## Objectif

La page `/strategies` n’est plus seulement un catalogue de définitions. Elle devient une vue opérateur courte pour vérifier :

- les Strategy Instances persistées en `SHADOW`, `PAPER` ou `LIVE` ;
- leur état runtime réel ;
- les signaux en attente dans `strategy_signal_outbox` ;
- l’action protégée permettant de marquer un signal consommé.

## Sources canoniques

| Bloc front | Source |
|---|---|
| Catalogue stratégies | `GET /api/v1/strategy-v2/overview` |
| Instances runtime | `StrategyV2Overview.instances` |
| Signal Bus | `GET /api/v1/strategy-v2/signals` |
| Consommation opérateur | `POST /api/v1/strategy-v2/signals/{signalOutboxId}/actions` |

Le front ne crée pas de signal. L’émission reste la responsabilité du runtime stratégie.

## Garde-fous

- Aucun mock n’est ajouté.
- Si le Signal Bus est indisponible, le front affiche la gouvernance Strategy V2 et signale l’erreur.
- Le bouton `Consommer` n’est disponible que pour les statuts `PENDING` ou `PUBLISHED`.
- La consommation passe par l’auth opérateur/API key existante et exige `idempotencyKey` + `reason`.
- Les identifiants techniques sont affichés sous forme courte pour audit sans rendre l’écran illisible.

## Contrat UI transitoire

La page `/strategies` affiche désormais trois niveaux :

1. KPIs Strategy Kernel : définitions, versions, instances, couverture runtime, instances running, signaux pending.
2. Vue runtime : instance, stratégie, mode, état, dérive de performance, scope, compte, approval et heartbeat.
3. Vue signal : outbox item, mode, instrument/direction, statut, résumé payload, fenêtre d’expiration et action de consommation.

Cette UI reste transitoire : elle sert à piloter la nouvelle architecture sans attendre la refonte front complète.

## Addendum TD2-605 — dérive visible sur les instances

La vue runtime affiche désormais la dérive live/paper/shadow de chaque instance.

Le front lit d’abord `instance.performance_drift` si le backend fournit un rapport déterministe complet. Sinon, il calcule une projection transitoire depuis les métriques réelles disponibles dans `metadata` :

- baseline : `performance_baseline`, `baseline_metrics`, `validated_metrics`;
- observé : `performance_observed`, `observed_metrics`, `paper_metrics`, `shadow_metrics`, `live_metrics`.

Si une donnée manque, le front affiche `Baseline absente` ou `Observation insuff.`. Aucun statut `OK` n’est inventé.
