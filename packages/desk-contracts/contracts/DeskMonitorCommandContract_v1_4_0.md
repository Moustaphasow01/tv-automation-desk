# DeskMonitorCommandContract — v1.4.0

## 1. Objet

Ce contrat décrit les intentions orthogonales émises par un Monitor GPT. Le schéma normatif est `schemas/entities/monitor-command-v1-4.schema.json`.

- `contract.name` : `DeskMonitorCommandContract`
- `contract.version` : `1.4.0`
- profil : `OPPORTUNITY_SEEKING_CONTROLLED`
- catalogue : `condition_catalog_v1_2`
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

`expected_revision` est un compare-and-swap strict sur l’agrégat canonique. GPT recopie la valeur fournie; il ne l’incrémente, ne la corrige et ne la devine jamais.

### 3.1 Thèse — `transformation.command`

`NOOP`, `CREATE_WAIT`, `MAKE_CONDITIONAL`, `ACTIVATE`, `MAINTAIN`, `WEAKEN`, `MARK_AT_RISK`, `MARK_POST_EVENT`, `INVALIDATE`, `EXPIRE`, `REQUIRE_REPLAN`, `SUPERSEDE`.

### 3.2 Setup — `setup_transition.command`

`NOOP`, `UPSERT_CANDIDATE`, `PRE_ARM`, `ARM`, `CANCEL`, `EXPIRE`, `INVALIDATE`, `REPLACE`.

`UPSERT_CANDIDATE`, `PRE_ARM`, `ARM` et `REPLACE` exigent un setup complet conforme à Plan V1.4. `REPLACE` identifie séparément l’ancien et le nouveau setup; le backend impose `replaces_setup_id != setup_id`, invariant relationnel non exprimé par le JSON Schema. L’identité `setup_id` et son `setup_record_id` deviennent immuables dès la première écriture. `ARM` signifie uniquement « armer conditionnellement ». `ENGINE_TRIGGER` est volontairement absent du vocabulaire GPT.

Pour `REPLACE`, GPT ne réutilise jamais le `setup_record_id` de l’ancien setup. Même s’il le renvoie par erreur, le backend reconstruit l’identité physique depuis le nouveau `setup_id`, vérifie l’absence de conflit, puis terminalise l’ancien et crée le nouveau dans une mutation unique.

Un setup complet inclut conditions enum + `parameters`, entrée, stop, toutes les cibles/actions, gestion, preuves et validité. Une justification textuelle n’est jamais interprétée comme une condition. La confirmation et la réacquisition sont réévaluées par le moteur M1 fermé; GPT ne peut pas les déclarer acquises pour une bougie future.

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

Les versions épinglées sont Monitor V2.4, Monitor Command V1.4, Execution Policy V4.3 et Condition Catalog V1.2.

Les mêmes commandes et règles CAS s’appliquent en LIVE et REPLAY. Seule l’acquisition temporelle du bundle change.

Mémoire normative : `role=VETO` désigne un blocage temporaire (notamment `EVENT_BLACKOUT`, fenêtre horaire, intermarket ou volatilité) et impose `effect=BLOCK_IF_TRUE`, `memory_policy=LATEST_ONLY`, `required_for_trigger=false`, `weight=0`. Il bloque seulement l’entrée tant qu’il est vrai, se lève lorsqu’il redevient faux et impose alors une confirmation fraîche sur M1 fermée. `role=INVALIDATION` est réservé à une rupture structurelle explicite et impose `memory_policy=INVALIDATE_TERMINAL`. `LATCH_UNTIL_TRIGGER` est interdit à tout `BLOCK_IF_TRUE`; il reste réservé aux activations/confirmations `REQUIRE_TRUE`.

Les effets de soft gate ne créent aucune commande implicite. `REQUIRE_CONFIRMATION` doit être matérialisé dans le setup par une condition Catalog V1 explicite; sinon il reste advisory. `REDUCE_RISK` ne modifie pas silencieusement le plan : il exige un nouveau plan/replan avec `risk.risk_pct_requested` abaissé. `management_request.type=REDUCE_RISK` concerne uniquement une position ouverte et reste une demande `GPT_REQUEST_ONLY`.
