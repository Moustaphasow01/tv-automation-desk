# DeskConditionCatalogContract — v1.2.0

V1.2 conserve les familles de prédicats V1.1 et précise leur composition atomique. Lorsqu’un `BREAK_RETEST_SEQUENCE` exige déjà la cassure, le retest et la confirmation de rejet, les conditions `ZONE_TOUCH` et `REJECTION_PATTERN` équivalentes deviennent des preuves auditables rattachées à la séquence ; elles ne bloquent pas une seconde fois le trigger.

Le timeframe déclaré par chaque condition est normatif. Le moteur doit charger la série canonique correspondante et retourner `UNKNOWN` si elle manque, sans substituer silencieusement une autre granularité.

## 1. Source normative

Le catalogue machine est `catalogs/condition-catalog-v1-2.json`; son schéma est `schemas/entities/condition-catalog-v1-2.schema.json`. Le JSON, et non le texte libre d’un analyste, définit les prédicats exécutables.

- contrat : `DeskConditionCatalogContract`
- version : `1.2.0`
- catalogue : `condition_catalog_v1_2`
- profil : `OPPORTUNITY_SEEKING_CONTROLLED`

## 2. Paramètres de politique

- confirmation pondérée : `0.55` ;
- risque maximal : `0.25 %` de la net equity ;
- RR minimum : `2` ;
- hard gates : `FAIL_CLOSED` ;
- lacunes contextuelles : `SOFT_REQUIRE_CONFIRMATION`.

Le plan peut classer jusqu’à trois candidats. La quantité de contrats est calculée hors de ce catalogue par le broker en entiers avec arrondi supérieur; l’excédent doit rester sous le `max_rounding_excess_pct` de la policy broker.

## 3. Rôles et effets

Rôles : `ACTIVATION`, `CONFIRMATION`, `INVALIDATION`, `VETO`.

Effets : `REQUIRE_TRUE`, `BLOCK_IF_TRUE`.

États d’évaluation : `NOT_STARTED`, `PENDING`, `SATISFIED`, `FAILED`, `INVALIDATED`, `EXPIRED`, `UNKNOWN`.

## 4. Prédicats exécutables

Le catalogue contient exactement 11 types :

`PRICE_RELATION`, `PRICE_CROSS`, `ZONE_TOUCH`, `BREAKOUT_CLOSE`, `BREAK_RETEST_SEQUENCE`, `REJECTION_PATTERN`, `VWAP_RELATION`, `RSI_THRESHOLD`, `TIME_WINDOW`, `INTERMARKET_CONFIRMATION`, `EVENT_BLACKOUT`.

Chaque entrée définit ses paramètres requis, la définition typée de chaque paramètre, sa source d’autorité, son unité, ses opérateurs autorisés, son champ évalué, ses datasets obligatoires, sa phase d’enforcement, son caractère stateful et le nom unique de son évaluateur backend.

`BREAK_RETEST_SEQUENCE` exige exactement la relation à la cassure, le niveau de retest, la tolérance, la limite de barres et l’exigence éventuelle d’un rejet. Le moteur mémorise l’ordre des étapes et ne déduit jamais un retest d’une phrase GPT.

`VWAP_RELATION` exige `reference_code` et les sources `PRIMARY_OHLC` + `SESSION_VWAP` au même cutoff. `INTERMARKET_CONFIRMATION` exige `reference_instrument` présent dans le pack épinglé. `EVENT_BLACKOUT` exige `event_window_ref` vers une fenêtre immuable du calendrier. Aucun de ces identifiants ne peut être remplacé par une description libre.

Une source obligatoire absente produit `UNKNOWN`, jamais `SATISFIED` ni un faux `PENDING` exploitable. Pour `EVENT_BLACKOUT`, cet `UNKNOWN` alimente `MAJOR_EVENT_ENTRY_BLOCK` et bloque fail-closed uniquement à `ENTRY_TRIGGER`. Une source contextuelle facultative absente reste une soft gate.

Les modes d’entrée qui attendent une confirmation sont causaux : la bougie M1 de confirmation ne peut pas aussi être la bougie d’entrée. Une réacquisition après sortie de zone requiert une nouvelle preuve produite par les évaluateurs du catalogue.

Mémoire normative : `role=VETO` désigne un blocage temporaire (notamment `EVENT_BLACKOUT`, fenêtre horaire, intermarket ou volatilité) et impose `effect=BLOCK_IF_TRUE`, `memory_policy=LATEST_ONLY`, `required_for_trigger=false`, `weight=0`. Il bloque seulement l’entrée tant qu’il est vrai, se lève lorsqu’il redevient faux et impose alors une confirmation fraîche sur M1 fermée. `role=INVALIDATION` est réservé à une rupture structurelle explicite et impose `memory_policy=INVALIDATE_TERMINAL`. `LATCH_UNTIL_TRIGGER` est interdit à tout `BLOCK_IF_TRUE`; il reste réservé aux activations/confirmations `REQUIRE_TRUE`.

Les effets de soft gate ne sont jamais des règles backend cachées. `REQUIRE_CONFIRMATION` devient exécutable uniquement si GPT ajoute au setup une condition explicite du Catalog V1 avec tous ses `parameters`, son poids et sa règle temporelle; sinon il reste audit/advisory. `REDUCE_RISK` devient exécutable uniquement si un Master ou replan abaisse explicitement `execution_plan.risk.risk_pct_requested` avant compilation, puis le setup compilé hérite de cette valeur. Un Monitor ne peut pas modifier silencieusement le risque du plan : sans nouveau plan, l’effet reste advisory; sur une position ouverte, `management_request.type=REDUCE_RISK` est une demande distincte `GPT_REQUEST_ONLY`. Aucun de ces effets ne devient un veto implicite.

## 5. Opérateurs

Les 16 opérateurs autorisés sont :

`CLOSE_ABOVE`, `CLOSE_BELOW`, `CROSS_ABOVE`, `CROSS_BELOW`, `TOUCH_ABOVE`, `TOUCH_BELOW`, `REJECT_ABOVE`, `REJECT_BELOW`, `REJECT_RESISTANCE`, `REJECT_SUPPORT`, `WITHIN_WINDOW`, `OUTSIDE_WINDOW`, `ALIGNS_WITH`, `DIVERGES_FROM`, `EVENT_ACTIVE`, `EVENT_CLEAR`.

## 6. Gates

Les 12 hard gates et 10 soft gates sont ceux du fichier JSON; aucun alias libre n’est exécutable. Chaque hard gate possède une phase fixe `PLAN_COMPILE`, `SETUP_ARM`, `ENTRY_TRIGGER` ou `BROKER_SUBMIT`. Un `FAIL`/`UNKNOWN` bloque seulement cette phase. `PASS` sur un code `*_FAILED` signifie `FAILURE_ABSENT`. Un code absent du catalogue doit être rejeté ou traité comme diagnostic non exécutable, jamais comme une confirmation implicite.

## 7. Versionnage

Toute modification d’un code, d’un paramètre obligatoire ou d’un évaluateur constitue une évolution de contrat et exige une nouvelle version et un nouveau hash. Le catalogue V1.0 reste disponible pour les runs épinglés.
