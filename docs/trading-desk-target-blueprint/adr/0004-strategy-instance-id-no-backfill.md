# ADR-0004 — `strategy_instance_id` introduit en FK nouvelle, sans backfill des lignes historiques

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-3 (`01` §3)

## Contexte

La table `trades` possède déjà une colonne `strategy_id text` indexée (`infra/postgres/init/003_trade_automation_schema.sql:336,346`). Une correction naïve consisterait à réinterpréter cette colonne existante comme l'identité canonique de Strategy Instance. Sa sémantique historique exacte reste `INCERTAIN` (`02-VERIFIED-AS-IS-SUMMARY.md` §10) — la deviner pour un backfill serait risqué sur des données de production.

## Décision

Une nouvelle colonne/FK `strategy_instance_id` est ajoutée à `trades` (et aux tables associées le nécessitant), **nullable**, sans tentative de rétro-remplissage (`backfill`) des lignes historiques à partir de `strategy_id`. Les lignes historiques restent identifiées par l'ancien `strategy_id` (marqué déprécié dans la documentation de schéma, jamais supprimé). Seules les nouvelles écritures, à partir de l'introduction du modèle Strategy Instance (Phase 1), renseignent `strategy_instance_id`.

## Alternatives rejetées

- **Backfill automatique de `strategy_instance_id` à partir de `strategy_id`** : rejetée — présumerait une correspondance 1:1 non vérifiée entre une clé de session/lane legacy et une future identité de Strategy Instance, risque de corruption silencieuse de données historiques.
- **Réutiliser `strategy_id` tel quel comme `strategy_instance_id`** : rejetée — mélangerait deux sémantiques différentes sous un même nom, cassant la traçabilité pour toute analyse historique future.

## Conséquences

- Les requêtes historiques (avant Phase 1) continuent d'utiliser `strategy_id`.
- Les requêtes post-Phase 1 utilisent `strategy_instance_id`.
- Toute analyse couvrant les deux périodes doit explicitement gérer cette discontinuité, documentée ici plutôt que masquée.

## Preuve AS-IS

`infra/postgres/init/003_trade_automation_schema.sql:317-346`, lu directement — colonne et index confirmés. Sémantique historique complète de `strategy_id` non vérifiable dans le temps imparti, marquée `INCERTAIN` en `02` §10, à revérifier au Ticket 1.4 (`17`).
