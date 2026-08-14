# Dataset Temporal Splits V1

> Ticket : `TD2-308`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

`Dataset Temporal Splits V1` scelle les périodes train, validation et out-of-sample pour éviter les fuites temporelles dans la recherche stratégique.

Le split n'est pas une convention implicite dans un notebook : c'est un manifest hashé, persistable et référençable par les runs.

## Implémentation

- Module pur : `packages/desk-replay-engine/src/dataset-temporal-split-v1.js`.
- Migration : `infra/postgres/init/035_dataset_temporal_splits.sql`.
- Tests :
  - `packages/desk-replay-engine/test/dataset-temporal-split.test.js` ;
  - `mcp_gpt_desk/test/dataset_temporal_split_sql_schema.test.js`.

## Version

- `schema_version` : `dataset_temporal_split_manifest_v1`.
- `policy_id` : `desk_dataset_temporal_split_policy_v1`.
- `policy_version` : `1.0.0`.

## Convention temporelle

Chaque période utilise `[start_utc, end_utc)` :

- début inclus ;
- fin exclue.

Cette convention évite les doubles appartenances à la frontière entre train, validation et out-of-sample.

## Règles anti-fuite

- `TRAIN` ne peut lire que les données du split train.
- `VALIDATION` peut être évalué après entraînement, mais `training_cutoff_utc` ne doit pas dépasser la fin train.
- `OUT_OF_SAMPLE` ne peut pas influencer la sélection candidate : `candidate_selection_cutoff_utc` doit rester inférieur ou égal à la fin validation.
- Les rows explicitement taguées avec un rôle sont rejetées si leur timestamp tombe dans un autre split.

## Persistance

`dataset_temporal_splits` stocke :

- le manifest complet ;
- `split_policy_hash` ;
- `split_hash` ;
- les bornes temporelles train, validation et out-of-sample ;
- la couverture.

`simulation_run_split_usage` relie un run à un split et conserve :

- le rôle utilisé ;
- le cutoff ;
- la fin réelle des données source ;
- le rapport de fuite.

## Invariant produit

Research Lab et les futures expériences doivent afficher la couverture de validation depuis ce manifest et son `split_hash`, jamais depuis une convention front ou un libellé libre.
