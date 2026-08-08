# ADR-0015 — Lease/Lock généralisent `pg_try_advisory_lock` existant, pas de nouvelle primitive de verrouillage

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : ADR-0024 (topologie conservée), cohérence avec l'existant

## Contexte

Le worker actuel (`run_desk_ai_worker.mjs:46-50`) utilise déjà `pg_try_advisory_lock` pour garantir qu'un seul worker traite un travail donné. Le Multi-Agent Runtime généralisé a besoin d'un mécanisme de verrouillage et de bail (lease) applicable à un plus grand nombre de types de ressources (Run, Mission, Task).

## Décision

Les entités `Lease` et `Lock` (`05` §4.7) sont une généralisation logique du mécanisme `pg_try_advisory_lock` déjà en production, pas une nouvelle primitive technique (pas de nouveau système de coordination distribué type Zookeeper/etcd introduit). `Lock` correspond directement à un verrou advisory Postgres appliqué à une ressource typée ; `Lease` ajoute une expiration automatique au-dessus du même mécanisme, pour les ressources qui doivent être libérées automatiquement en cas de crash du détenteur.

## Alternatives rejetées

- **Introduire un système de coordination distribué dédié** : rejetée — hors scope (`01` §7, non-objectifs), le mécanisme Postgres existant n'a démontré aucune limite dans l'AS-IS justifiant ce changement d'infrastructure.
- **Verrouillage uniquement applicatif (variable en mémoire du process)** : rejetée — ne fonctionnerait pas dès qu'un deuxième process/worker est introduit, contraire à l'objectif de scalabilité horizontale de la North Star.

## Conséquences

- L'implémentation de `Lease`/`Lock` (Phase 5) réutilise directement les fonctions Postgres advisory lock existantes, étendues avec une table de suivi pour l'expiration des baux.
- Aucune nouvelle dépendance d'infrastructure n'est introduite pour ce composant.

## Preuve AS-IS

`mcp_gpt_desk/scripts/run_desk_ai_worker.mjs:46-50`, `pg_try_advisory_lock` confirmé par lecture directe intégrale du fichier. Voir `02` §4.
