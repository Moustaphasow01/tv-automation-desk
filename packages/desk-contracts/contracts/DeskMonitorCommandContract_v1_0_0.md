# DeskMonitorCommandContract — v1.0.0

## 1. Objet

Ce contrat décrit les intentions orthogonales émises par un Monitor GPT. Le schéma normatif est `schemas/entities/monitor-command-v1.schema.json`.

- `contract.name` : `DeskMonitorCommandContract`
- `contract.version` : `1.0.0`
- profil : `OPPORTUNITY_SEEKING_CONTROLLED`
- catalogue : `condition_catalog_v1`
- autorité : `BACKEND_ONLY`

## 2. Une commande n’est pas un fait d’exécution

GPT peut demander une transition analytique; il ne peut pas :

- déclarer un setup `TRIGGERED` ;
- déclarer un fill ou un prix d’exécution ;
- ouvrir, fermer ou réconcilier une position ;
- produire un résultat en R ;
- contourner un gate, une machine d’état ou le broker safety.

Ces faits sont produits exclusivement par le moteur et le broker gateway.

## 3. Taxonomie orthogonale

`requested_action` vaut `NO_ACTION` ou `APPLY_ORTHOGONAL_COMMANDS`. Il ne remplace pas les commandes métier et ne constitue pas une action composite.

Les quatre domaines sont indépendants :

Chaque commande porte `command_id`, `expected_revision` et `created_at_paris`. Le backend applique idempotence et contrôle optimiste; une révision obsolète n’est jamais écrasée silencieusement.

### 3.1 Thèse — `transformation.command`

`NOOP`, `CREATE_WAIT`, `MAKE_CONDITIONAL`, `ACTIVATE`, `MAINTAIN`, `WEAKEN`, `MARK_AT_RISK`, `MARK_POST_EVENT`, `INVALIDATE`, `EXPIRE`, `REQUIRE_REPLAN`, `SUPERSEDE`.

### 3.2 Setup — `setup_transition.command`

`NOOP`, `UPSERT_CANDIDATE`, `PRE_ARM`, `ARM`, `CANCEL`, `EXPIRE`, `INVALIDATE`, `REPLACE`.

`UPSERT_CANDIDATE`, `PRE_ARM`, `ARM` et `REPLACE` exigent un setup complet conforme à Plan V1. `REPLACE` identifie séparément l’ancien et le nouveau setup; le backend impose `replaces_setup_id != setup_id`, invariant relationnel non exprimé par le JSON Schema. `ARM` signifie uniquement « armer conditionnellement ». `ENGINE_TRIGGER` est volontairement absent du vocabulaire GPT.

### 3.3 Position — `management_request.type`

`NONE`, `REDUCE_RISK`, `MOVE_STOP_BE`, `TAKE_PARTIAL`, `EXIT_POSITION`.

Ces valeurs sont des demandes `GPT_REQUEST_ONLY`; le moteur valide l’existence de la position, son état et la géométrie avant toute mutation. `REDUCE_RISK` et `TAKE_PARTIAL` exigent une fraction; `MOVE_STOP_BE` exige un stop demandé déterministe.

### 3.4 Replan — `replan_request.command`

`NOOP` ou `REQUEST`. La file, le démarrage, la complétion, l’échec et la déduplication de workflow appartiennent au backend.

## 4. Combinaisons

`NO_ACTION` exige les quatre payloads à `null`. `APPLY_ORTHOGONAL_COMMANDS` exige au moins un payload non nul et permet plusieurs commandes compatibles dans un même Monitor, par exemple maintenir une thèse tout en armant un setup.

Le compilateur valide séparément chaque machine d’état. Une transition invalide invalide la commande complète; aucune demi-écriture n’est autorisée.

## 5. Evidence, scope et audit

La commande référence le plan, le Monitor, le run, la session, le cutoff et les sources. Les faits, interprétations et évolution de thèse doivent être distincts. L’anti-lookahead est obligatoire.

Les versions épinglées sont Monitor V2, Monitor Command V1, Execution Policy V4 et Condition Catalog V1.
