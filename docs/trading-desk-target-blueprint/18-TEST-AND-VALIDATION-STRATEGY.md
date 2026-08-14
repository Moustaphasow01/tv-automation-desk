# 18 — Test and Validation Strategy

- **Titre** : Stratégie de test et de validation
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `.github/workflows/local-ci.yml`, `01` (invariants et critères de succès), `17`, tous les ADR
- **Documents supersédés** : aucun
- **Dernière vérification code** : `.github/workflows/local-ci.yml` lu intégralement pendant l'audit initial
- **Portée** : catégories de tests couvrant l'ensemble du dossier, des Phases -1/0/1 (déjà détaillées au niveau test unitaire dans `17`) aux Phases 2-12 (niveau catégorie de test, pas cas de test individuel).

---

## 1. Principe : quatre niveaux de test, systématiques à chaque phase

1. **Non-régression** — le comportement existant (pipeline GPT-first, gates broker-facing, catalogue de conditions) reste inchangé.
2. **Caractérisation** — le nouveau comportement correspond exactement à la spécification du ticket/document de domaine.
3. **Négatif** — la garde de sécurité empêche bien ce qu'elle doit empêcher (ex. promotion LIVE automatique).
4. **Intégration de bout en bout** — la chaîne complète (signal → décision → ordre, ou équivalent) produit le résultat attendu et reste traçable.

## 2. Les ~30 catégories de test du dossier

### Non-régression (fondations existantes, valables à toutes les phases)

1. Catalogue de conditions : les 11 prédicats/12 hard gates/10 soft gates produisent des résultats inchangés sur un jeu de scénarios fixé (SC-10).
2. `evaluateBrokerPolicy` : ses ~40 règles produisent des résultats inchangés.
3. State machine de Position (`position-state-machine-v1.js`), y compris `PROTECTION_CONFIRMED` et `ENGINE_ONLY_EVENTS`.
4. Comportement observable du pipeline GPT-first (INV-4), à chaque ticket des Phases -1 à 10.
5. Mécanisme LISTEN/NOTIFY + `pg_try_advisory_lock` (worker existant), compatibilité multi-worker.
6. Sandbox et allowlist d'environnement de `CodexExecAdapter`.

### Caractérisation (Phases -1/0/1, détail complet dans `17`)

7. Test de caractérisation de bout en bout fill → protection → clôture (Ticket -1.3), horodatage explicite.
8. Idempotence de la reprise d'ingestion (Ticket 0.1).
9. Idempotence de l'import batch de 33 103 lignes (Ticket 0.2).
10. `PROTECTION_CONFIRMED` — 4 tests dont le cas critique « stop local non confirmé » (Ticket 0.3).
11. Agrégation de position par quantités signées — 6 tests dont concurrence et fenêtre de tolérance (Ticket 0.4).
12. Détection de divergence par réconciliation programmée (Ticket 0.5).
13. Non-régression de tout consommateur recensé de `atr_14` (Ticket 0.6).
14. Validation de schéma Strategy Definition contre au moins 2 exemples (Ticket 1.1).
15. Deux Strategy Versions distinctes, statuts différents (Ticket 1.2).
16. Strategy Instance — orthogonalité avec le Runtime Contract Bundle (Ticket 1.3).
17. Intégrité de `trades.strategy_instance_id` sans altération de `strategy_id` (Ticket 1.4).
18. Lecture frontend inchangée après peuplement des tables stratégie (Ticket 1.5).
19. Coexistence de 2 Strategy Instances PAPER sur le même instrument, sans déclenchement de la limite existante (Ticket 1.6).
20. Transitions valides/invalides du cycle de vie runtime à trois axes (Ticket 1.7).

### Caractérisation (Phases 2-12, catégorie de test, pas cas de test individuel)

21. Reproductibilité bit-à-bit d'un `Run` de simulation (même paramètres et seed → mêmes métriques) — SC-3, Phase 3.
22. Non-régression du calcul de Feature migré contre son équivalent actuel — Phase 2.
23. Équivalence fonctionnelle DSL vs plan typé LLM sur un scénario identique — Phase 3.
24. Non-régression métier par pipeline LLM migré (3 jeux de scénarios dédiés) — Phase 5.
25. Isolation des pannes entre Strategy Instances (arrêt forcé de l'une sans effet sur les autres) — Phase 6.
26. Reconstruction de chaîne causale complète via `correlation_id`/`causation_id` — SC-7, Phase 5+.

### Tests négatifs (gardes de sécurité — les plus critiques du dossier)

27. **Aucune combinaison de métriques ne peut déclencher seule une promotion PAPER→LIVE** (ADR-0007) — Phase 6.
28. **Aucune combinaison de réponses de l'AI Context Gate ne peut produire un `Order Intent` directement** (ADR-0009) — Phase 8. TD2-800 couvre le premier niveau par `packages/desk-domain/test/ai-context-advisory-v1.test.js`, incluant les champs broker/ordre/quantité et la preuve `ai_context_advisory_isolation_proof_v1`.
29. **Tentative de passage LIVE d'une Strategy Instance en présence d'une autre déjà LIVE sans triple verrou → rejet testé positivement** (Ticket 1.3, renforcé Phase 7).
30. **Deux Strategy Instances LIVE conformes individuellement ne peuvent dépasser collectivement une limite de portefeuille** (SC-5) — Phase 7.

### Intégration de bout en bout

31. Parité de comportement observable de l'Execution Gateway avant/après introduction de l'abstraction (ADR-0016) — Phase 9.
32. Exercice de bascule/rollback chronométré en environnement de simulation — Phase 11.

## 3. Où chaque catégorie est exécutée

- **Catégories 1-20** : intégrées à la suite CI existante (`.github/workflows/local-ci.yml`), exécutées à chaque PR touchant les fichiers concernés — cohérent avec le DoD de `16` §6.
- **Catégories 21-32** : à intégrer à la suite CI au fur et à mesure de la livraison de chaque phase — ce document fixe la catégorie et l'objectif, l'implémentation précise du test appartient au ticket de la phase concernée (non détaillée au niveau fichier pour les Phases 2-12, cohérent avec `00` §7).

## 4. Priorisation — tests à ne jamais sauter, même sous pression de calendrier

Les catégories 27, 29, 30 (gardes de sécurité contre l'exécution réelle non gouvernée) et 1-6 (non-régression des fondations existantes) sont les seules dont ce dossier affirme explicitement qu'elles ne doivent **jamais** être sautées ou reportées, quelle que soit la pression de calendrier — elles protègent directement les invariants INV-1, INV-2, INV-5 de `01`.

## 5. Ce que cette stratégie ne fait PAS

- Elle ne fixe pas de seuil de couverture de code chiffré (ex. « 80% de couverture ») — la couverture exigée est fonctionnelle (chaque invariant/critère testé explicitement), pas un pourcentage arbitraire.
- Elle ne prescrit pas d'outil de test spécifique au-delà de ceux déjà en usage dans le dépôt (cohérent avec `.github/workflows/local-ci.yml`).
