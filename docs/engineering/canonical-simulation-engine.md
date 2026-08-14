# Canonical Simulation Engine V1

> Ticket : `TD2-301`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Placement

Le moteur de simulation canonique est porté par le bounded context `simulation`, dans `packages/desk-replay-engine`.

Il expose `runCanonicalSimulationV1` via l’export public du package. Le moteur réutilise volontairement `@tv-automation/desk-domain` pour l’évaluation des conditions, gates, politiques et hashes canoniques. Ce choix applique :

- `ADR-0006` : le Simulation Engine étend `desk-replay-engine`, pas le replay GPT-in-the-loop ;
- `ADR-0010` : un seul runtime canonique partagé simulation/live ;
- `ADR-0011` : le Strategy DSL compile vers le runtime déterministe existant.

## Entrées canoniques

`runCanonicalSimulationV1` attend :

- un plan compilé `deterministic_execution_plan` ou un `compiled_artifact` contenant ce plan ;
- un dataset scellé : `sealed=true` ou `status=READY` ;
- un hash de dataset/provenance/contenu ;
- des bougies OHLC fermées ;
- un cutoff explicite Paris ou UTC ;
- des paramètres et une graine de reproductibilité.

Les lignes postérieures au cutoff sont filtrées avant la boucle chaude et comptabilisées dans `data_quality.ignored_post_cutoff_rows`.

## Sortie

La sortie est immuable et hashée :

- `schema_version=canonical_simulation_result_v1` ;
- `simulation_engine_version=1.0.0` ;
- `events` explicatifs : démarrage, conditions évaluées, setup éligible, ouverture, clôture, invalidation, expiration ou revue ;
- `positions` déterministes ;
- `metrics` versionnées ;
- `metrics_hash` et `content_hash`.

## Garanties

- aucune dépendance LLM dans la boucle chaude ;
- pas de lecture live pour un run historique ;
- aucune fabrication de résultat lorsqu’une bougie touche stop et target dans la même fenêtre : le run passe en `REVIEW_REQUIRED` ;
- pas d’entrée sur la même bougie que la première confirmation d’éligibilité ;
- setup évalués par rang déterministe ;
- un seul open position simultané pour cette V1.

## Hors périmètre TD2-301

- persistance Run Registry et artifacts : `TD2-302` ;
- simulateur d’ordres, frais, slippage et partial fills : `TD2-305` ;
- métriques avancées et segmentation : `TD2-306` ;
- workers Python/research de masse : `TD2-309` ;
- exposition front/API du futur lab simulation.

## Rollback

Le rollback est simple : retirer l’export `runCanonicalSimulationV1` et revenir au seul `outcome-engine` existant. Aucune migration SQL ni activation live n’est introduite par ce ticket.
