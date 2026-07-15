# DeskFrontProjectionContract v1.0.0

## Rôle

Ce contrat décrit la projection de présentation produite par un Master ou un
Monitor pour le nouveau front Desk Futures. Il est additif : les documents
canoniques `desk_master_analyses`, `desk_active_theses`, `desk_setups`,
`desk_positions` et les Monitors restent les sources de vérité métier.

## Identité

- `contractName` vaut toujours `DeskFrontProjectionContract` ;
- `schemaVersion` vaut toujours `1.0.0` ;
- `source` identifie le document canonique, son scope opérationnel et son ordre ;
- `revision` et `sequence` sont des entiers positifs monotones dans un même scope.

Le scope courant est défini par `strategyId`, `session`, `mode`, `tradingDate`
et `runId`. Une projection ne peut pas être déplacée vers un autre scope lors
de sa matérialisation.

## Source Master

Pour une projection `MASTER` :

- `sourceId` et `masterId` correspondent à `analysis_id` ;
- `monitorId` vaut `null` ;
- `thesisId` correspond à `active_thesis_id` ;
- le timestamp correspond à la création du Master.

## Source Monitor

Pour une projection `MONITOR` :

- `sourceId` et `monitorId` correspondent à `monitor_id` ;
- `masterId` correspond à `linked_master_analysis_id` ;
- `thesisId` correspond à `linked_active_thesis_id` ;
- le timestamp correspond à `timestamp_paris`.

## Matérialisation

Une projection valide produit dans la même mutation de persistance :

- l'état courant stable dans `desk_front_current_states` ;
- un snapshot immuable dans `desk_front_snapshots` ;
- un événement de timeline dans `desk_front_events`.

Une projection invalide ou en retard ne remplace jamais l'état courant. La
source canonique peut être conservée et l'échec est écrit dans
`desk_front_projection_errors` avec son code, ses détails et la référence de
source.

Une répétition byte-for-byte de la même révision est idempotente. Une même
révision portant un contenu ou une source différente est un conflit.

## Priorités

Les champs narratifs de cette projection servent à l'affichage. Ils ne doivent
jamais remplacer :

1. un prix provenant du market feed ;
2. une position provenant du backend d'exécution ;
3. un setup canonique ;
4. une thèse active canonique ;
5. une décision canonique de Monitor.

Le front et le BFF doivent conserver ces priorités lorsqu'ils combinent la
projection avec les read models spécialisés.
