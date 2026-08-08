# ADR-0006 — Simulation Engine construit sur `desk-replay-engine` déterministe, pas sur le replay orchestré GPT

- **Statut** : TRANCHÉE
- **Date** : 2026-08-07
- **Invariant/critère protégé** : SC-3, SC-9 (`01` §5)

## Contexte

Le dépôt contient deux mécanismes distincts nommés « replay » (`02-VERIFIED-AS-IS-SUMMARY.md` §5) : `packages/desk-replay-engine` (déterministe, coût nul en tokens) et le replay orchestré GPT-in-the-loop (`desk-replay-orchestration-algorithms.js`/`desk-replay-service.js`, un appel LLM complet par étape rejouée). L'application elle-même les confond dans `store.js:1588-1595`.

## Décision

Le futur Simulation Engine (Phase 3) étend `packages/desk-replay-engine`. Le replay orchestré GPT reste un outil du Research Lab (Phase 4-5), utilisé pour l'analyse qualitative post-hoc d'un nombre limité d'épisodes, jamais comme moteur de simulation de masse (des milliers de runs pour valider une Strategy Version).

## Alternatives rejetées

- **Construire le Simulation Engine sur le replay orchestré GPT** : rejetée — coût prohibitif (un appel LLM par étape × milliers de runs), latence incompatible avec l'itération rapide de recherche, et non reproductible bit-à-bit (un LLM n'est pas garanti déterministe même à température nulle selon le provider).
- **Fusionner les deux mécanismes en un seul** : rejetée — leurs profils de coût et de déterminisme sont fondamentalement incompatibles ; les fusionner masquerait cette différence critique aux futurs développeurs.

## Conséquences

- `store.js:1588-1595` doit être corrigé (Phase 3) pour distinguer explicitement les deux mécanismes côté frontend/API également, évitant la confusion actuelle.
- Le critère SC-3 (reproductibilité bit-à-bit) n'est atteignable que parce que le Simulation Engine n'a aucune dépendance LLM dans sa boucle chaude.

## Preuve AS-IS

`packages/desk-replay-engine` vs `desk-replay-orchestration-algorithms.js`/`desk-replay-service.js`, distinction confirmée par lecture directe et triangulation multi-agents lors de l'audit du 2026-08-07. Confusion applicative confirmée en `store.js:1588-1595`.
