# Robustness Engine V1

> Ticket : `TD2-307`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

Le `Robustness Engine V1` décide si une Strategy Version candidate peut être promue après simulation.

Il ne cherche pas les trades et ne redéfinit pas la stratégie. Il consomme des résultats canoniques déjà calculés par le moteur de simulation, puis produit une preuve de robustesse versionnée et hashée.

## Implémentation

- Module pur : `packages/desk-replay-engine/src/robustness-engine-v1.js`.
- Exports package :
  - `buildRobustnessReportV1` ;
  - `evaluateRobustnessGateV1` ;
  - `bootstrapRSeriesV1` ;
  - `monteCarloRSeriesV1` ;
  - `buildRobustnessReportArtifactV1`.
- Tests : `packages/desk-replay-engine/test/robustness-engine.test.js`.

## Version

- `schema_version` : `strategy_robustness_report_v1`.
- `robustness_engine_version` : `1.0.0`.
- `policy_id` : `desk_robustness_policy_core_v1`.
- `policy_version` : `1.0.0`.

## Tests couverts

Le rapport inclut :

- acceptance baseline ;
- walk-forward ;
- bootstrap ;
- Monte-Carlo ;
- stress coûts/slippage ;
- perturbation de paramètres.

Chaque test retourne `PASS`, `FAIL` ou `REVIEW`.

## Gate de promotion

Le champ `gate.promotion_allowed` vaut `true` uniquement si tous les tests obligatoires passent.

Un échec bloque la promotion. Une preuve manquante place le rapport en `REVIEW` et bloque aussi la promotion, afin d'éviter qu'une Strategy Version soit mise en production sans robustesse prouvée.

## Observabilité

Le rapport expose :

- durée calcul si fournie par le compute worker ;
- coût estimé si fourni ;
- nombre de runs simulés ;
- nombre d'échantillons bootstrap et Monte-Carlo ;
- génération automatique ou fournie des distributions.

## Persistance

Le type d'artifact `ROBUSTNESS_REPORT` est ajouté au Run Registry.

Migration :

- `infra/postgres/init/034_robustness_report_artifact_kind.sql`.

Le rapport peut aussi être attaché à une Strategy Version candidate via `buildRobustnessReportArtifactV1`, avec un `content_hash` stable.

## Invariant produit

Research Lab doit lire le rapport de robustesse persisté. Il ne doit pas recalculer côté front les seuils de promotion, les distributions ou la décision `promotion_allowed`.
