# ADR-0019 — Discipline expand/contract obligatoire pour toute migration de schéma touchant des données de production

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : INV-3 (`01` §3)

## Contexte

Le système possède déjà 21 migrations Postgres appliquées en production (`02` §2). Toute évolution future du schéma (ex. ajout de `strategy_instance_id`, ADR-0004) risque, si elle est mal séquencée, de causer une interruption de service ou une perte de données si elle mélange ajout et suppression dans une seule migration irréversible.

## Décision

Toute migration de schéma touchant une table de production suit la discipline expand/contract en trois temps : (1) **expand** — ajouter les nouvelles colonnes/tables en parallèle des anciennes, nullable ou avec valeur par défaut sûre, sans toucher aux anciennes ; (2) **migrate** — faire migrer le code applicatif pour écrire (et progressivement lire) la nouvelle structure, en double-écriture si nécessaire ; (3) **contract** — retirer l'ancienne structure seulement après une période d'observation et une validation opérateur explicite que plus rien ne la lit. Aucune migration ne combine `DROP`/`DELETE` destructeur avec l'ajout de nouvelles structures dans le même changement.

## Alternatives rejetées

- **Migration directe en une étape (ajout + suppression combinés)** : rejetée — viole INV-3 directement, ne laisse aucune fenêtre de validation ni de rollback simple.
- **Ne jamais retirer l'ancienne structure (accumulation indéfinie)** : rejetée comme politique par défaut — acceptable temporairement (voir ADR-0004, `strategy_id` conservé sans suppression), mais le retrait final doit rester une option gouvernée, pas explicitement interdite pour toujours.

## Conséquences

- Chaque migration de schéma listée dans `17-EXECUTABLE-BACKLOG.md` précise explicitement à quelle étape (expand/migrate/contract) elle correspond.
- La phase « contract » de toute migration passe systématiquement par `operator-decisions.yaml` avant exécution.

## Preuve AS-IS

21 migrations Postgres confirmées dans le schéma actuel (`02` §2) — aucune n'a été auditée individuellement pour conformité à cette discipline (hors scope de cet audit, qui porte sur l'AS-IS et non sur l'historique des migrations) ; la discipline s'applique à partir de ce dossier pour toute nouvelle migration.
