# 00 — Master Index

- **Titre** : Dossier canonique de transformation du Trading Desk
- **Statut** : `COMPLET` — voir §8 « État d'avancement » et `MISSION-REPORT.md` pour le rapport de clôture
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude (session d'audit et de conception, lecture seule / documentation uniquement)
- **Sources** : voir §2
- **Documents supersédés** : voir §3
- **Dernière vérification code** : 2026-08-07 (voir `02-VERIFIED-AS-IS-SUMMARY.md` pour le détail des vérifications ciblées et leur date)
- **Portée** : ce document est le point d'entrée unique du dossier `docs/trading-desk-target-blueprint/`. Aucun code fonctionnel n'a été modifié pour produire ce dossier.

> **Addendum canonique V2.2.1 — 2026-08-08** : l'audit de reprise Codex, les décisions opérateur et le plan directeur initial sont consolidés dans `24-CORRECTED-IMPLEMENTATION-BACKLOG-V2.md`, `25-DIRECTOR-PLAN-CONVERGENCE-ADDENDUM.md` et `implementation-backlog-v2.yaml`. Le socle obligatoire est défini par `AGENTS.md`, `docs/engineering/TRADING_DESK_ENGINEERING_STANDARDS.md` et les documents associés. Toute zone legacy touchée doit maintenant réduire une dette mesurable et le dernier gate exige la conformité complète du dépôt. Le registre cible des prompts est décrit dans `26-PROMPT-AND-INSTRUCTION-REGISTRY.md`. Ces fichiers supersèdent `16`, `17`, `22` et `implementation-backlog.yaml` pour l'ordre d'exécution, les dépendances, les états Strategy, les workers IA durables, le routage modèle/raisonnement, le Research Lab scientifique, la trajectoire PickMyTrade/provider-neutral et la préparation du Front V3.

---

## 1. Ordre de lecture recommandé

1. **Ce document** (`00-MASTER-INDEX.md`) — navigation et hiérarchie de vérité.
2. `01-NORTH-STAR-AND-SUCCESS-CRITERIA.md` — la destination finale, non négociable.
3. `02-VERIFIED-AS-IS-SUMMARY.md` — l'état réel du système aujourd'hui, vérifié et cité.
4. `03-AS-IS-TO-TARGET-GAP-MAP.md` — l'écart entre 2 et 1, domaine par domaine.
5. `04-TARGET-SYSTEM-ARCHITECTURE.md` — l'architecture cible complète.
6. `05-DOMAIN-MODEL-AND-STATE-MACHINES.md` — les entités et leurs cycles de vie.
7. `06` à `15` — spécifications détaillées par domaine (data, DSL/runtime, simulation, research, live runtime, portfolio/risk, AI gate, execution, events/MCP, sécurité/observabilité/scalabilité).
8. `16-END-TO-END-MIGRATION-ROADMAP.md` — la trajectoire Phase -1 à Phase 12.
9. `17-EXECUTABLE-BACKLOG.md` + `implementation-backlog.yaml` — le backlog exploitable.
10. `18-TEST-AND-VALIDATION-STRATEGY.md` — la stratégie de tests complète.
11. `19-ARCHITECTURE-DECISION-RECORDS.md` + `adr/` — les décisions d'architecture tranchées ou à trancher.
12. `20-RISK-REGISTER.md` — le registre de risques consolidé.
13. `21-CUTOVER-AND-GPT-FIRST-DECOMMISSION.md` — la sortie du pipeline GPT-first.
14. `22-GPT-CODEX-IMPLEMENTATION-RUNBOOK.md` — le protocole autonome pour l'agent d'implémentation.
15. `23-TRACEABILITY-AND-COMPLETENESS-MATRIX.md` — la preuve qu'aucune exigence de la North Star ne reste orpheline.
16. `24-CORRECTED-IMPLEMENTATION-BACKLOG-V2.md` + `implementation-backlog-v2.yaml` — le backlog V2.2.1 exécutable, précédé de l'Engineering Foundation.
17. `26-PROMPT-AND-INSTRUCTION-REGISTRY.md` — le registre versionné des prompts, instructions, bindings, évaluations et rollbacks.

Avant toute implémentation, lire également `AGENTS.md`, `docs/engineering/TRADING_DESK_ENGINEERING_STANDARDS.md`, `docs/engineering/module-catalog.md` et `docs/engineering/naming-glossary.md`.

**Pour démarrer immédiatement l'implémentation** : `22-GPT-CODEX-IMPLEMENTATION-RUNBOOK.md` renvoie directement au premier ticket exécutable (Phase -1, Ticket -1.1), déjà spécifié au niveau fichier dans `17-EXECUTABLE-BACKLOG.md`.

---

## 2. Sources consolidées dans ce dossier

Ce dossier consolide, sans les dupliquer intégralement, les documents suivants déjà produits dans `docs/audit-2026-08-07/` :

| Document source | Rôle dans le nouveau dossier |
|---|---|
| `docs/audit-2026-08-07/00-INDEX-ET-METHODE.md` | Méthode reprise et étendue ici même (§4) |
| `docs/audit-2026-08-07/01-CARTOGRAPHIE-ET-FLUX.md` | Base factuelle de `02-VERIFIED-AS-IS-SUMMARY.md` |
| `docs/audit-2026-08-07/02-REPONSES-SECTION-31.md` | Base factuelle de `02-VERIFIED-AS-IS-SUMMARY.md` |
| `docs/audit-2026-08-07/03-PLAN-EVOLUTION.md` | Première version de roadmap — **supersédée** par `16-END-TO-END-MIGRATION-ROADMAP.md`, qui corrige notamment la nature d'`ACTIVE_STRATEGY_RUNTIME_VERSIONS` (voir §3) |
| `docs/audit-2026-08-07/04-ADDENDUM-PASSATION.md` (v2, avec errata) | Base factuelle et corrections intégrées dans `02`, `03`, `05`, `11`, `19` |
| `docs/audit-2026-08-07/05-CODEX-HANDOFF.md` (v2, avec errata) | Base du niveau fichier/fonction des Phases -1/0/1 dans `17-EXECUTABLE-BACKLOG.md` |
| `docs/TARGET_ARCHITECTURE_CONVERGENCE_AUDIT_2026-08-07.md` (audit externe, 07:51) | Vérifié indépendamment par l'audit ci-dessus, intégré via `02` |
| Le « plan directeur » initial (« architecture data-driven, multi-agent, scalable et event-driven ») | Sert de vision cible, décrit la destination — voir hiérarchie de vérité §5 |
| Le prompt maître ayant produit ce dossier (`prompt_maitre_claude_trading_desk.md`) | Cahier des charges structurel de ce dossier lui-même, non un document de vérité sur le système |

## 3. Documents antérieurs supersédés ou corrigés

- `docs/audit-2026-08-07/03-PLAN-EVOLUTION.md`, Ticket 1.3 original (« remplacer `ACTIVE_STRATEGY_RUNTIME_VERSIONS` par un ensemble ») — **retiré**, corrigé dans `04-ADDENDUM-PASSATION.md` §1 puis repris ici dans `19-ARCHITECTURE-DECISION-RECORDS.md`, ADR-01.
- `docs/archive/2026-07-15/AUDIT_ARCHITECTURE_NETTOYAGE_2026-07-15.md` — décrit une architecture GCP/Firebase/Python legacy qui n'existe plus (migration terminée juillet 2026). Conservé comme mémoire historique uniquement, aucune valeur AS-IS actuelle.
- Les versions 1 (sans errata) de `04-ADDENDUM-PASSATION.md` et `05-CODEX-HANDOFF.md` — remplacées par leurs versions 2, elles-mêmes consolidées ici.

Aucun autre document antérieur n'est contredit par ce dossier ; le reste de la documentation runtime récente (`docs/CODEX_WINDOWS_AI_WORKERS_RUNBOOK.md`, `docs/DETERMINISTIC_STRATEGY_V5_1_CUTOVER_2026-08-01.md`, etc.) reste une source secondaire valide, citée où pertinent dans `02-VERIFIED-AS-IS-SUMMARY.md`.

---

## 4. Méthode et statuts

Statuts utilisés pour tout constat AS-IS :

- **CONFIRMÉ** : démontré directement par le code, la configuration ou un test.
- **INFÉRÉ** : déduction logique solide mais non explicitement garantie.
- **INCERTAIN** : information incomplète ou contradictoire.
- **ABSENT** : composant ou comportement recherché mais non trouvé.

Statuts utilisés pour tout constat relatif à la cible :

- **CIBLE REQUISE** : exigée par la North Star, non négociable.
- **RECOMMANDATION D'ARCHITECTURE** : choix technique tranché par ce dossier, avec justification et alternative documentée.
- **DÉCISION OPÉRATEUR** : décision réellement externe (financière, contractuelle, légale, ou d'appétit au risque) — ce dossier fournit systématiquement une option par défaut sûre.
- **À REVALIDER À L'ENTRÉE DE PHASE** : une hypothèse d'architecture encore raisonnable aujourd'hui mais qui doit être reconfirmée avant que la phase concernée ne démarre, parce qu'elle dépend d'un état du système qui aura changé d'ici là.

Citations systématiques `fichier:ligne` pour tout constat AS-IS testable. Aucun comportement n'est inventé pour combler une zone inconnue — les zones inconnues sont marquées comme telles plutôt que devinées.

## 5. Hiérarchie des sources de vérité

1. Comportement réel du code actuel.
2. Schéma et migrations réellement présents.
3. Configurations et scripts de déploiement actuels.
4. Tests existants.
5. Documentation runtime récente.
6. Audit vérifié déjà produit (`docs/audit-2026-08-07/`).
7. Documentation ancienne et archives.
8. Plan directeur cible — décrit la **destination**, jamais l'état actuel.

Lorsque deux sources se contredisent, la source la plus haute dans cette liste l'emporte, une vérification ciblée est effectuée sur le point litigieux, et la conclusion consolidée est consignée avec mention explicite du document corrigé (voir §3 pour les corrections déjà connues).

## 6. Navigation par intention

| Je veux... | J'ouvre... |
|---|---|
| Comprendre la destination finale en 5 minutes | `01-NORTH-STAR-AND-SUCCESS-CRITERIA.md` |
| Savoir ce qui existe réellement aujourd'hui | `02-VERIFIED-AS-IS-SUMMARY.md` |
| Savoir ce qu'il reste à construire | `03-AS-IS-TO-TARGET-GAP-MAP.md` |
| Commencer à coder maintenant | `AGENTS.md` → `docs/engineering/TRADING_DESK_ENGINEERING_STANDARDS.md` → `24-CORRECTED-IMPLEMENTATION-BACKLOG-V2.md`, phase P-1 |
| Comprendre pourquoi une décision d'architecture a été prise | `19-ARCHITECTURE-DECISION-RECORDS.md` |
| Savoir si mon ticket est prêt à démarrer | `implementation-backlog-v2.yaml` + `operator-decisions.yaml` |
| Savoir quand une phase est terminée | `phase-gates.yaml` |
| Vérifier qu'aucune exigence n'est oubliée | `23-TRACEABILITY-AND-COMPLETENESS-MATRIX.md` |
| Comprendre le plan de sortie du pipeline GPT-first | `21-CUTOVER-AND-GPT-FIRST-DECOMMISSION.md` |

## 7. Matrice phases → livrables

| Phase | Nom | Document(s) principal(aux) | Niveau de détail |
|---|---|---|---|
| -1 | Baseline et caractérisation | `17-EXECUTABLE-BACKLOG.md` | Fichier/fonction |
| 0 | Sûreté immédiate et données | `17-EXECUTABLE-BACKLOG.md` | Fichier/fonction |
| 1 | Strategy Definition/Version/Instance | `17-EXECUTABLE-BACKLOG.md`, `05` | Fichier/fonction |
| 2 | Data Foundation and Provenance | `06-DATA-ACQUISITION-FEATURES-AND-PROVENANCE.md` | Architecture cible + arborescence proposée |
| 3 | Strategy DSL, Canonical Runtime, Simulation Engine | `07`, `08` | Architecture cible + arborescence proposée |
| 4 | Experiment Registry and Research Lab | `08`, `09` | Architecture cible + arborescence proposée |
| 5 | Generalized Multi-Agent Runtime | `09` | Architecture cible + arborescence proposée |
| 6 | Live Strategy Runtime (SHADOW/PAPER) | `10` | Architecture cible + arborescence proposée |
| 7 | Portfolio Arbitration, Global Risk, Broker Netting | `11` | Architecture cible + arborescence proposée |
| 8 | AI Context Gate (SHADOW/ADVISORY) | `12` | Architecture cible + arborescence proposée |
| 9 | Execution Gateway and NinjaTrader Adapter | `13` | Architecture cible + arborescence proposée |
| 10 | PickMyTrade Due Diligence and Pilot | `13` | Due diligence + critères Go/No-Go, pas de code provider |
| 11 | Production Cutover | `21` | Trajectoire et gates, pas de fichiers |
| 12 | GPT-First Decommission and Legacy Retirement | `21` | Trajectoire et gates, pas de fichiers |

**Rappel explicite (conforme à la consigne du prompt maître)** : pour les phases 2 à 12, ce dossier propose des arborescences cibles, identifie les modules existants réutilisables, et distingue ce qui est tranché de ce qui doit être revalidé à l'entrée de phase — **il ne fabrique aucun chemin de fichier comme s'il existait déjà**. Seules les Phases -1, 0 et 1 conservent le niveau fichier/fonction déjà établi par l'audit et son addendum.

## 8. État d'avancement de ce dossier

**Livré intégralement le 2026-08-07.** Les 23 documents markdown (`00` à `23`), les 25 ADR (`adr/0001`-`0025`), les 18 contrats avec exemples JSON (`contracts/`), les 15 diagrammes Mermaid (10 intégrés dans les documents + 5 dans `diagrams/`), et les 4 fichiers YAML machine-readable (`implementation-backlog.yaml`, `phase-gates.yaml`, `operator-decisions.yaml`, `traceability-matrix.yaml`) sont tous produits et consolidés. Les sous-dossiers `examples/` et `backlog/` sont intentionnellement réservés pour un usage futur (voir leurs `README.md` respectifs) plutôt que remplis artificiellement.

Voir `MISSION-REPORT.md` (à la racine de ce dossier) pour le rapport de clôture complet : documents créés, contradictions résolues, décisions recommandées vs. laissées à l'opérateur, chemin critique, travaux parallélisables, premier ticket exécutable, portes humaines, zones non prouvées, commandes/tests exécutés, limitations, prochaine action exacte.

Aucun code fonctionnel n'a été modifié pour produire ce dossier — conforme à la contrainte absolue de toute la mission.
