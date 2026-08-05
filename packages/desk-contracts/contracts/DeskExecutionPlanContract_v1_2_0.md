# DeskExecutionPlanContract — v1.2.0

## 1. Statut et portée

Ce contrat définit la proposition d’exécution structurée produite par le Master GPT **avant** compilation déterministe. Le schéma normatif est `schemas/entities/execution-plan-v1-2.schema.json`.

- `contract.name` : `DeskExecutionPlanContract`
- `contract.version` : `1.2.0`
- profil : `OPPORTUNITY_SEEKING_CONTROLLED`
- catalogue : `condition_catalog_v1_2`
- autorité d’exécution : `BACKEND_ONLY`

Ce document ne décrit ni un fill, ni une position ouverte, ni un résultat. GPT propose; le backend valide, compile, arme, déclenche, exécute et matérialise.

## 2. Scope et provenance

Le backend épingle `plan_id` avant l’appel GPT. GPT doit le recopier exactement. Le plan doit aussi référencer exactement l’analyse Master, le bundle, le pack et son `pack_build_id`. Son scope comprend `mode`, `trading_date`, `session`, `run_id`, `cutoff_paris` et `Europe/Paris`. Aucun identifiant ne peut être inventé.

LIVE et REPLAY utilisent le même contrat et la même sémantique. Seule la construction temporelle du pack diffère. Toute donnée postérieure au cutoff est interdite.

## 3. Disposition

Une et une seule disposition est requise :

- `SETUP_READY` ;
- `SETUP_CONDITIONAL` ;
- `WAIT_BETTER_PRICE` ;
- `WAIT_NO_SETUP` ;
- `MANAGEMENT_ONLY` ;
- `FORBIDDEN` ;
- `REPLAN_REQUIRED`.

Les trois dispositions de setup exigent au moins un setup et un `primary_setup_id`. Le schéma impose la présence et le type; le compilateur backend impose l’appartenance exacte de `primary_setup_id` à `setups[].setup_id` et l’unicité des `setup_id`. `WAIT_NO_SETUP` interdit tout setup et exige `no_setup_proof`. `MANAGEMENT_ONLY`, `FORBIDDEN` et `REPLAN_REQUIRED` ne transportent aucun nouveau setup.

## 4. Profil d’opportunité contrôlée

Le plan vise davantage d’opportunités exécutables sans rendre les risques permissifs :

- confirmation contextuelle pondérée minimale : `0.55` ;
- risque demandé : strictement positif et inférieur ou égal à `0.25 %` de la `NET_EQUITY` ;
- RR attendu par setup et RR minimum de politique : `>= 2` ;
- une lacune contextuelle non canonique est soft ;
- une donnée nécessaire au trigger déterministe est hard et fail-closed.

Le milieu de range, un contexte macro neutre, un cross-asset partiel ou une donnée facultative absente ne suffisent pas seuls à interdire une opportunité. Ils imposent confirmation, information ou réduction de risque selon le catalogue.

Le plan peut transporter de zéro à cinq setups distincts, classés par `rank` unique de `1` à `5`. Il n’existe aucune obligation de remplir les cinq places. Le compilateur traite chaque candidat indépendamment pour les diagnostics de géométrie et de conditions : un candidat secondaire invalide est rejeté sans transformer automatiquement un candidat principal valide en `WAIT_NO_SETUP`. Les invariants globaux de scope, identité, contrat et anti-lookahead restent atomiques.

Le backend arbitre le portefeuille par rang puis priorité, avec au maximum une position simultanée. Le risque global demandé reste plafonné à `0.25 %` de la net equity : plusieurs scénarios ne cumulent jamais plusieurs budgets de risque concurrents. Les scénarios éligibles non retenus sont différés et réévalués, jamais remplis rétroactivement.

Les futures imposent des quantités entières. Le broker calcule la quantité par arrondi supérieur, publie le risque réel et l’excédent d’arrondi, puis refuse `BROKER_SUBMIT` lorsque `rounding_excess_percent > max_rounding_excess_pct`. Ce plafond broker est distinct du `risk_pct_requested <= 0.25 %`; GPT ne choisit ni la quantité ni un dépassement.

Les effets de soft gate ne sont jamais des règles backend cachées. `REQUIRE_CONFIRMATION` devient exécutable uniquement si GPT ajoute au setup une condition explicite du Catalog V1 avec tous ses `parameters`, son poids et sa règle temporelle; sinon il reste audit/advisory. `REDUCE_RISK` devient exécutable uniquement si un Master ou replan abaisse explicitement `execution_plan.risk.risk_pct_requested` avant compilation, puis le setup compilé hérite de cette valeur. Un Monitor ne peut pas modifier silencieusement le risque du plan : sans nouveau plan, l’effet reste advisory; sur une position ouverte, `management_request.type=REDUCE_RISK` est une demande distincte `GPT_REQUEST_ONLY`. Aucun de ces effets ne devient un veto implicite.

## 5. Gates

Le plan évalue une fois chacun des 12 hard gates :

`ANTI_LOOKAHEAD_FAILED`, `SCOPE_CONTRACT_MISMATCH`, `CANONICAL_TRIGGER_DATA_MISSING`, `GEOMETRY_INVALID`, `RR_BELOW_MINIMUM`, `STOP_INVALID`, `TARGET_INVALID`, `SETUP_EXPIRED_OR_TERMINAL`, `DETERMINISTIC_VETO_ACTIVE`, `BROKER_SAFETY_FAILED`, `MAJOR_EVENT_ENTRY_BLOCK`, `MANDATORY_INDICATOR_MISSING`.

Chaque hard gate porte une phase d’enforcement. `FAIL` ou `UNKNOWN` est fail-closed **uniquement lorsque cette phase est atteinte** :

| Phase | Hard gates |
|---|---|
| `PLAN_COMPILE` | `ANTI_LOOKAHEAD_FAILED`, `SCOPE_CONTRACT_MISMATCH` |
| `SETUP_ARM` | `GEOMETRY_INVALID`, `RR_BELOW_MINIMUM`, `STOP_INVALID`, `TARGET_INVALID` |
| `ENTRY_TRIGGER` | `CANONICAL_TRIGGER_DATA_MISSING`, `SETUP_EXPIRED_OR_TERMINAL`, `DETERMINISTIC_VETO_ACTIVE`, `MAJOR_EVENT_ENTRY_BLOCK`, `MANDATORY_INDICATOR_MISSING` |
| `BROKER_SUBMIT` | `BROKER_SAFETY_FAILED` |

Ainsi, une donnée canonique de trigger encore absente, une fenêtre macro bloquante future ou un contrôle broker non encore exécutable n’interdit pas de conserver `SETUP_CANDIDATE` ou `PRE_ARMED`. Ils bloquent respectivement le trigger ou la soumission lorsque leur phase arrive. `FORBIDDEN` doit être justifié par au moins un hard gate `FAIL` ou `UNKNOWN`.

Pour tous les codes formulés en `*_FAILED`, l’état `PASS` signifie explicitement **absence de l’échec** (`pass_semantics=FAILURE_ABSENT`), jamais présence de la condition négative.

Les 10 soft gates possibles sont :

`PACK_DEGRADED`, `MEGA_CAPS_MISSING_FOR_NQ`, `PRICE_MID_RANGE`, `CROSS_ASSET_PARTIAL`, `MACRO_NEUTRAL`, `NQ_ES_DIVERGENCE`, `HIGH_VOLATILITY`, `LEVEL_CONSUMED`, `CONTEXTUAL_DATA_GAP`, `OPTIONAL_INDICATOR_MISSING`.

## 6. Setup structuré

Chaque setup contient : identité/rang, état demandé, pattern, instrument, direction, type d’ordre, mode d’entrée, prix unique ou bornes de zone séparées, stop typé/prix, objectifs typés, `rr_expected`, gestion, validité, justification et références de preuve.

Le JSON Schema valide les formes et domaines. Le compilateur backend valide les invariants relationnels non exprimables de façon portable : unicité des identifiants, borne basse `<=` borne haute, `valid_from_paris < expires_at_paris`, stop/cibles orientés selon la direction, RR recalculé `>= 2` et cohérence avec `rr_expected`.

Les patterns sont limités au catalogue. Un setup GPT ne peut demander que `SETUP_CANDIDATE`, `PRE_ARMED` ou `ARMED_CONDITIONAL`. Il ne peut jamais déclarer `TRIGGERED`.

Toutes les cibles sont explicites et portent une action machine. La prose (`rationale`, labels et explications) documente mais n’exécute rien. `NEXT_BAR_MARKET_AFTER_CONFIRMATION` interdit toute entrée sur la bougie qui a confirmé; le moteur attend la prochaine bougie M1 fermée éligible. `RETEST_ZONE_AFTER_CONFIRMATION` exige une présence ou une réacquisition de zone prouvée par les prédicats structurés au moment du trigger.

## 7. Conditions déterministes

Chaque condition référence un type de prédicat et un opérateur du catalogue, avec paramètres dans `parameters`, rôle, effet, importance, mémoire, poids, séquence, règle temporelle et preuves.

- `ACTIVATION` / `CONFIRMATION` impliquent `REQUIRE_TRUE` ;
- `INVALIDATION` / `VETO` impliquent `BLOCK_IF_TRUE`, `required_for_trigger=false`, `weight=0` ;
- `HARD_BLOCKER` implique les mêmes contraintes de blocage ;
- `MANDATORY` d’activation/confirmation implique `required_for_trigger=true`.

`BREAK_RETEST_SEQUENCE` exige `break_condition_id`, `retest_level`, `tolerance_points`, `max_bars` et `require_rejection_confirmation`. La cassure et le retest restent deux états ordonnés; leur présence textuelle ne vaut jamais satisfaction.

Mémoire normative : `role=VETO` désigne un blocage temporaire (notamment `EVENT_BLACKOUT`, fenêtre horaire, intermarket ou volatilité) et impose `effect=BLOCK_IF_TRUE`, `memory_policy=LATEST_ONLY`, `required_for_trigger=false`, `weight=0`. Il bloque seulement l’entrée tant qu’il est vrai, se lève lorsqu’il redevient faux et impose alors une confirmation fraîche sur M1 fermée. `role=INVALIDATION` est réservé à une rupture structurelle explicite et impose `memory_policy=INVALIDATE_TERMINAL`. `LATCH_UNTIL_TRIGGER` est interdit à tout `BLOCK_IF_TRUE`; il reste réservé aux activations/confirmations `REQUIRE_TRUE`.

`EVENT_BLACKOUT` exige `event_window_ref`. Si cette donnée obligatoire est absente ou indécidable, la condition et la gate `MAJOR_EVENT_ENTRY_BLOCK` restent `UNKNOWN` et bloquent seulement `ENTRY_TRIGGER`. Les données contextuelles non référencées par une condition obligatoire restent soft et ne sont jamais promues en veto implicite.

## 8. Absence d’opportunité

`WAIT_NO_SETUP` n’est valide qu’avec la preuve structurée du meilleur long et du meilleur short, leurs motifs de rejet, les blocages, les conditions WAIT→GO et les déclencheurs de réévaluation. Un simple « attendre » est invalide.

## 9. Cadences et audit

- évaluation moteur : `M1` ;
- analyse GPT : `M5` ;
- anti-lookahead vérifié : `true` ;
- contextes épinglés : Master V5.2, Plan V1.2, Policy V4.2, Catalog V1.2.

Le backend doit rejeter toute propriété inconnue et compiler ce document vers un artefact interne distinct comportant diagnostics et hash canonique.
