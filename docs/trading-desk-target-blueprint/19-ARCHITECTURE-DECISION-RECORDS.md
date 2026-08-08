# 19 — Architecture Decision Records (Index)

- **Titre** : Registre des décisions d'architecture
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : synthèse de `01`-`05`, addendum et errata de sûreté déjà validés (`docs/audit-2026-08-07/04-ADDENDUM-PASSATION.md` v2)
- **Documents supersédés** : aucun
- **Dernière vérification code** : voir chaque ADR individuellement, section « Preuve AS-IS »
- **Portée** : ce document indexe les 25 ADR détaillés dans `adr/`. Chaque ADR suit le même gabarit : Contexte, Décision, Alternatives rejetées, Conséquences, Statut. Les décisions marquées `TRANCHÉE` sont actées par ce dossier ; celles marquées `À DÉCIDER (OPÉRATEUR)` renvoient vers `operator-decisions.yaml`.

---

## Index

| ADR | Titre | Statut | Fichier |
|---|---|---|---|
| ADR-01 | `ACTIVE_STRATEGY_RUNTIME_VERSIONS` reste un verrou singulier, orthogonal aux Strategy Instances | TRANCHÉE | [adr/0001-strategy-runtime-versions-remains-singular.md](adr/0001-strategy-runtime-versions-remains-singular.md) |
| ADR-02 | Strategy Instance modélisée sur deux axes indépendants (état runtime / mode d'exécution) | TRANCHÉE | [adr/0002-strategy-instance-two-axis-model.md](adr/0002-strategy-instance-two-axis-model.md) |
| ADR-03 | Clé d'agrégation de position étendue et prouvée par test avant connexion au chemin réel | TRANCHÉE | [adr/0003-position-aggregation-key-proven-by-test.md](adr/0003-position-aggregation-key-proven-by-test.md) |
| ADR-04 | `strategy_instance_id` introduit en FK nouvelle, sans backfill des lignes historiques | TRANCHÉE | [adr/0004-strategy-instance-id-no-backfill.md](adr/0004-strategy-instance-id-no-backfill.md) |
| ADR-05 | Déclenchement périodique de la réconciliation séquencé strictement après le correctif d'agrégation | TRANCHÉE | [adr/0005-reconciliation-trigger-sequenced-after-map-fix.md](adr/0005-reconciliation-trigger-sequenced-after-map-fix.md) |
| ADR-06 | Simulation Engine construit sur `desk-replay-engine` déterministe, pas sur le replay orchestré GPT | TRANCHÉE | [adr/0006-simulation-engine-on-deterministic-replay.md](adr/0006-simulation-engine-on-deterministic-replay.md) |
| ADR-07 | Passage PAPER→LIVE : garde technique obligatoire, jamais de promotion automatique par seuil seul | TRANCHÉE | [adr/0007-live-promotion-requires-explicit-operator-action.md](adr/0007-live-promotion-requires-explicit-operator-action.md) |
| ADR-08 | Portfolio Arbitration + Global Risk + Broker Netting positionnés en verrou avant toute activation réelle multi-stratégie | TRANCHÉE | [adr/0008-portfolio-arbitration-as-mandatory-gate.md](adr/0008-portfolio-arbitration-as-mandatory-gate.md) |
| ADR-09 | AI Context Gate limité à des sorties SHADOW/ADVISORY, jamais décisionnelles | TRANCHÉE | [adr/0009-ai-context-gate-advisory-only.md](adr/0009-ai-context-gate-advisory-only.md) |
| ADR-10 | Un seul moteur d'évaluation canonique, partagé simulation et exécution réelle | TRANCHÉE | [adr/0010-single-canonical-runtime-shared.md](adr/0010-single-canonical-runtime-shared.md) |
| ADR-11 | Strategy DSL compile vers le moteur déterministe existant, pas de second moteur d'exécution | TRANCHÉE | [adr/0011-strategy-dsl-compiles-to-existing-engine.md](adr/0011-strategy-dsl-compiles-to-existing-engine.md) |
| ADR-12 | Event Envelope standardisé construit au-dessus du transport LISTEN/NOTIFY + outbox existant | TRANCHÉE | [adr/0012-event-envelope-on-existing-transport.md](adr/0012-event-envelope-on-existing-transport.md) |
| ADR-13 | Les 3 pipelines LLM existants migrent vers un Multi-Agent Runtime générique sans perte de valeur métier | TRANCHÉE | [adr/0013-three-llm-pipelines-migrate-to-generic-runtime.md](adr/0013-three-llm-pipelines-migrate-to-generic-runtime.md) |
| ADR-14 | Politique de batch par défaut `TIMEOUT_WITH_PARTIAL_RESULTS` pour les pipelines à haute fréquence | TRANCHÉE | [adr/0014-default-batch-policy-timeout-partial.md](adr/0014-default-batch-policy-timeout-partial.md) |
| ADR-15 | Lease/Lock généralisent `pg_try_advisory_lock` existant, pas de nouvelle primitive de verrouillage | TRANCHÉE | [adr/0015-lease-lock-generalize-advisory-lock.md](adr/0015-lease-lock-generalize-advisory-lock.md) |
| ADR-16 | Execution Gateway encapsule l'AddOn NinjaTrader existant comme premier provider, sans réécriture | TRANCHÉE | [adr/0016-execution-gateway-wraps-existing-ninjatrader.md](adr/0016-execution-gateway-wraps-existing-ninjatrader.md) |
| ADR-17 | PickMyTrade traité en due diligence + pilote (Phase 10), pas en intégration engagée | À DÉCIDER (OPÉRATEUR — OP-7) | [adr/0017-pickmytrade-due-diligence-not-committed.md](adr/0017-pickmytrade-due-diligence-not-committed.md) |
| ADR-18 | Stratégie de rollback feature-flag-first pour tout changement du chemin d'exécution réel | TRANCHÉE | [adr/0018-feature-flag-first-rollback.md](adr/0018-feature-flag-first-rollback.md) |
| ADR-19 | Discipline expand/contract obligatoire pour toute migration de schéma touchant des données de production | TRANCHÉE | [adr/0019-expand-contract-migration-discipline.md](adr/0019-expand-contract-migration-discipline.md) |
| ADR-20 | Pipeline GPT-first maintenu en parallèle jusqu'au cutover opérateur explicite (Phase 11) | TRANCHÉE | [adr/0020-gpt-first-kept-alive-until-explicit-cutover.md](adr/0020-gpt-first-kept-alive-until-explicit-cutover.md) |
| ADR-21 | Ambiguïté de version des contrats (5.4.0 vs 5.1.0) résolue par vérification opérateur, pas par supposition | À DÉCIDER (OPÉRATEUR — OP-2) | [adr/0021-contract-version-ambiguity-resolved-by-operator.md](adr/0021-contract-version-ambiguity-resolved-by-operator.md) |
| ADR-22 | Data Acquisition & Provenance introduit en Phase 2, prérequis à un Simulation Engine reproductible | TRANCHÉE | [adr/0022-data-acquisition-phase-2-prerequisite.md](adr/0022-data-acquisition-phase-2-prerequisite.md) |
| ADR-23 | Run Registry intégré au chantier Simulation Engine (Phase 3), pas différé | TRANCHÉE | [adr/0023-run-registry-part-of-simulation-phase.md](adr/0023-run-registry-part-of-simulation-phase.md) |
| ADR-24 | Topologie de déploiement (Windows Server/WinSW/Postgres) conservée jusqu'à Phase 9, aucune migration d'infrastructure mandatée | TRANCHÉE | [adr/0024-deployment-topology-retained-through-phase-9.md](adr/0024-deployment-topology-retained-through-phase-9.md) |
| ADR-25 | Discipline de statuts (CONFIRMÉ/INFÉRÉ/INCERTAIN/ABSENT, CIBLE/RECOMMANDATION/DÉCISION OPÉRATEUR/À REVALIDER) contraignante pour tout le dossier | TRANCHÉE | [adr/0025-documentation-status-discipline-binding.md](adr/0025-documentation-status-discipline-binding.md) |

## Comment lire ce registre

- Les ADR `TRANCHÉE` sont des décisions d'architecture actées par ce dossier — un agent d'implémentation les applique sans revalidation, sauf découverte d'un fait contredisant leur « Preuve AS-IS ».
- Les ADR `À DÉCIDER (OPÉRATEUR)` documentent l'option par défaut sûre recommandée, mais restent bloquées tant que l'opérateur n'a pas tranché dans `operator-decisions.yaml`.
- Chaque ADR référence explicitement l'invariant (`01` §3) ou le critère de succès (`01` §5-6) qu'elle protège, pour permettre la traçabilité vérifiée dans `23-TRACEABILITY-AND-COMPLETENESS-MATRIX.md`.
