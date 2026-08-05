# DeskConditionCatalogContract — v1.0.0

## 1. Source normative

Le catalogue machine est `catalogs/condition-catalog-v1.json`; son schéma est `schemas/entities/condition-catalog-v1.schema.json`. Le JSON, et non le texte libre d’un analyste, définit les prédicats exécutables.

- contrat : `DeskConditionCatalogContract`
- version : `1.0.0`
- catalogue : `condition_catalog_v1`
- profil : `OPPORTUNITY_SEEKING_CONTROLLED`

## 2. Paramètres de politique

- confirmation pondérée : `0.55` ;
- risque maximal : `0.25 %` de la net equity ;
- RR minimum : `2` ;
- hard gates : `FAIL_CLOSED` ;
- lacunes contextuelles : `SOFT_REQUIRE_CONFIRMATION`.

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

## 5. Opérateurs

Les 16 opérateurs autorisés sont :

`CLOSE_ABOVE`, `CLOSE_BELOW`, `CROSS_ABOVE`, `CROSS_BELOW`, `TOUCH_ABOVE`, `TOUCH_BELOW`, `REJECT_ABOVE`, `REJECT_BELOW`, `REJECT_RESISTANCE`, `REJECT_SUPPORT`, `WITHIN_WINDOW`, `OUTSIDE_WINDOW`, `ALIGNS_WITH`, `DIVERGES_FROM`, `EVENT_ACTIVE`, `EVENT_CLEAR`.

## 6. Gates

Les 12 hard gates et 10 soft gates sont ceux du fichier JSON; aucun alias libre n’est exécutable. Chaque hard gate possède une phase fixe `PLAN_COMPILE`, `SETUP_ARM`, `ENTRY_TRIGGER` ou `BROKER_SUBMIT`. Un `FAIL`/`UNKNOWN` bloque seulement cette phase. `PASS` sur un code `*_FAILED` signifie `FAILURE_ABSENT`. Un code absent du catalogue doit être rejeté ou traité comme diagnostic non exécutable, jamais comme une confirmation implicite.

## 7. Versionnage

Toute modification d’un code, d’un paramètre obligatoire ou d’un évaluateur constitue une évolution de contrat et exige une nouvelle version et un nouveau hash. Le catalogue V1 reste disponible pour les runs épinglés.
