# Desk Deterministic Execution Policy v3.0.0

Statut : complément d’exécution partagé par le LIVE et le Replay.

Cette politique ne remplace et ne modifie ni
`DeskMasterAnalysisContract_v4_0_0` ni
`DeskHourlyThesisMonitorContract_v1_0_0`. Les contrats analytiques restent la
source de la stratégie. Cette politique définit la représentation exécutable et
l’autorité du moteur déterministe.

## 1. Autorité unique

- GPT analyse, propose, arme, maintient, invalide ou demande un replan.
- GPT ne confirme jamais un fill et ne crée jamais directement une position.
- `TRIGGER_GO` émis par GPT est interdit. Un ancien `TRIGGER_GO` est normalisé
  en demande `ARMED_CONDITIONAL`.
- Seul le moteur déterministe, alimenté par des bougies clôturées, peut produire
  `TRIGGERED`, `POSITION_CREATED`, les fills, la gestion et le résultat en R.
- LIVE et Replay appellent la même fonction d’évaluation et diffèrent seulement
  par la source des bougies : PostgreSQL clôturé pour LIVE, pack immuable au
  cutoff pour Replay.

## 2. Master exécutable

Un Master fournit obligatoirement :

1. au moins un setup structuré complet ; ou
2. un `no_setup_proof` structuré contenant :
   `best_long`, `best_short`, `blocking_reasons`,
   `wait_to_go_conditions` et `revalidation_triggers`.

Chaque branche et chaque transformation possède sa propre géométrie. Une
transformation en prose ou un placeholder vide est refusé.

## 3. Setup canonique

Seul `ARMED_CONDITIONAL` est déclenchable. `SETUP_CANDIDATE` et `PRE_ARMED`
restent visibles mais non exécutables.

Un setup armé fournit :

- `setup_id`, `instrument`, `direction` ;
- `entry_mode` ;
- une `entry_zone.lower/upper` ou un `entry_price` ;
- `stop_loss`, `take_profit_1` et `rr_minimum` ;
- `valid_from_paris`, `expires_at_paris` ;
- une liste non vide de conditions structurées ;
- `trigger_policy.min_score` compris entre `0` et `1` ;
- une politique de gestion déterministe.

`valid_from_paris` est immuable pendant le cycle de vie d’une même identité.
Une transformation remplace atomiquement l’ancien setup et utilise une nouvelle
identité ; l’ancien devient terminal.

## 4. Condition canonique

Chaque condition fournit :

- `condition_id` ;
- `role` : `ACTIVATION`, `CONFIRMATION`, `INVALIDATION` ou `VETO` ;
- `effect` : `REQUIRE_TRUE` ou `BLOCK_IF_TRUE` ;
- `instrument`, `timeframe`, `operator`, `threshold` ;
- `importance`, `required_for_trigger`, `memory_policy` ;
- facultativement `sequence`, `tolerance_points` et `temporal_rule`.

Un veto ou une invalidation :

- utilise `effect=BLOCK_IF_TRUE` ;
- utilise `required_for_trigger=false` ;
- ne participe jamais au score d’activation.

La combinaison `HARD_BLOCKER + required_for_trigger=true` est invalide.
L’opérateur est souverain : la direction du setup ne peut pas inverser
silencieusement `REJECT_ABOVE` ou `REJECT_BELOW`.

## 5. Temps et mémoire

Politiques mémoire :

- `LATCH_UNTIL_TRIGGER` : une confirmation reste vraie jusqu’au trigger ou à
  l’expiration ;
- `LATEST_ONLY` : la condition doit rester vraie sur la dernière bougie
  clôturée ;
- `INVALIDATE_TERMINAL` : un veto observé terminalise le setup.

Les événements d’une condition sont persistés avec
`observed_at_paris`, `last_evaluated_at_paris` et, pour une invalidation,
`invalidated_at_paris`.

La règle temporelle précise `LATEST_CLOSED`, `ANY_SINCE_ARM`,
`CONSECUTIVE_CLOSED` ou `CROSS_AFTER_ARM`. Une confirmation observée après une
entrée ne peut jamais autoriser rétroactivement cette entrée.

## 6. Données et absence de source

- Une condition instrumentée n’utilise jamais les bougies d’un autre actif.
- Une source absente produit `CONDITION_DATA_UNAVAILABLE`/`UNKNOWN`.
- Une donnée secondaire absente peut dégrader l’analyse, mais ne doit bloquer
  l’exécution que si la condition a été déclarée déterministe et obligatoire.
- M1 clôturé est la cadence normale du moteur. Tout fallback M5/M15 est signalé
  dans l’audit et ne doit pas être silencieux.

## 7. Entrée et gestion

`entry_mode` vaut :

- `NEXT_BAR_MARKET_AFTER_CONFIRMATION` ;
- `RETEST_ZONE_AFTER_CONFIRMATION` ;
- `STOP_CROSS` ;
- `LIMIT_TOUCH`.

La règle same-bar découle de `entry_mode`; aucun second retest implicite ne peut
être inventé. Le prix simulé appartient toujours à la plage observée.

Le moteur continue d’évaluer toutes les bougies d’un batch après TP1. Un stop
break-even ou une cible ultérieure dans le même batch ne peut pas être perdu.
Les quantités et les fills partiels sont entiers et auditables.

## 8. Continuité et replan

- Un setup ou une position reste suivi pendant le run journalier, y compris au
  passage Asia/New York.
- Une thèse absente, expirée, invalidée ou arrivée à
  `requires_replan_after` contourne le debounce de replan.
- Un replan simplement dupliqué conserve `pending_replan_at_paris` et est
  dédupliqué par sa raison.

## 9. Certification

Un run sans trade publie exactement l’un des diagnostics :

- `VALID_NO_OPPORTUNITY` : Master et Monitors ont produit une preuve structurée
  et aucun setup valide n’a déclenché ;
- `INVALID_NO_EXECUTABLE_SETUP` : aucune géométrie exploitable ou preuve
  structurée n’a été fournie.

Les résultats ne sont éligibles aux agrégats que si toutes les positions sont
terminales et tarifées, aucun lookahead n’est détecté et chaque setup déclenché
référence une position créée par le moteur.
