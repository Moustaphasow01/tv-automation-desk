# 03 — AS-IS to Target Gap Map

- **Titre** : Carte des écarts entre l'existant vérifié et l'architecture cible
- **Statut** : `COMPLET`
- **Version** : 1.0.0
- **Date** : 2026-08-07
- **Auteur/agent** : Claude
- **Sources** : `02-VERIFIED-AS-IS-SUMMARY.md`, `01-NORTH-STAR-AND-SUCCESS-CRITERIA.md`, prompt maître §7 (architecture cible)
- **Documents supersédés** : `docs/audit-2026-08-07/03-PLAN-EVOLUTION.md` en tant que plan (ses constats restent valides et sont repris ici ; sa numérotation de phases est remplacée par celle de §1 ci-dessous)
- **Dernière vérification code** : voir `02-VERIFIED-AS-IS-SUMMARY.md` §9
- **Portée** : ce document liste, domaine par domaine, ce qui existe (§AS-IS), ce qui est requis par la cible (§CIBLE), et la nature de l'écart. Il ne détaille pas l'architecture cible elle-même (voir `04`) ni le séquencement (voir `16`).

---

## 1. Réconciliation de la numérotation de phases

Deux numérotations de phases coexistent dans les documents produits pendant cette mission. **La numérotation du prompt maître fait foi à partir de ce document et pour tout le reste du dossier** ; l'ancienne numérotation de `docs/audit-2026-08-07/03-PLAN-EVOLUTION.md` est mise en correspondance ci-dessous puis abandonnée.

| Ancienne numérotation (`03-PLAN-EVOLUTION.md` / `04-ADDENDUM-PASSATION.md`) | Numérotation canonique (ce dossier, à partir d'ici) |
|---|---|
| Phase -1 — Baseline et caractérisation | **Phase -1** — Baseline et caractérisation (inchangé) |
| Phase 0 — Sûreté immédiate | **Phase 0** — Sûreté immédiate et fondations de données (inchangé) |
| Phase 1 — Strategy Definition/Version/Instance | **Phase 1** — Strategy Definition/Version/Instance (inchangé) |
| Chantier « Data Acquisition » (non numéroté, parallèle) | **Phase 2** — Data Foundation and Provenance |
| Phase 2 — Simulation Engine (incluant Run Registry) | **Phase 3** — Strategy DSL, Canonical Runtime, Simulation Engine |
| Phase 3 — Experiment Registry | **Phase 4** — Experiment Registry and Research Lab (fusionnée avec le chantier Research Lab ci-dessous) |
| Chantier « migration du rôle du LLM » (non numéroté) | Réparti entre **Phase 4** (Experiment Registry / Research Lab) et **Phase 5** (Multi-Agent Runtime) |
| — (non présent dans l'ancien plan) | **Phase 5** — Generalized Multi-Agent Runtime |
| Chantier « Live Strategy Runtime » (ajouté par l'addendum) | **Phase 6** — Live Strategy Runtime (SHADOW/PAPER) |
| Chantier « Portfolio Arbitration / Global Risk » (ajouté par l'addendum, en verrou) | **Phase 7** — Portfolio Arbitration, Global Risk, Broker Netting |
| — (non présent dans l'ancien plan) | **Phase 8** — AI Context Gate (SHADOW/ADVISORY) |
| — (non présent dans l'ancien plan) | **Phase 9** — Execution Gateway and NinjaTrader Adapter |
| — (non présent dans l'ancien plan) | **Phase 10** — PickMyTrade Due Diligence and Pilot |
| — (non présent dans l'ancien plan) | **Phase 11** — Production Cutover |
| — (non présent dans l'ancien plan) | **Phase 12** — GPT-First Decommission |

Raison de la réconciliation : l'ancien plan s'arrêtait à l'Experiment Registry car il n'avait pas encore intégré la demande explicite du prompt maître de spécifier un Multi-Agent Runtime généralisé, un AI Context Gate isolé du Live Strategy Runtime, et une sortie de cutover en deux temps (Production Cutover puis Decommission). Aucun contenu n'est perdu dans cette réconciliation — seule la numérotation change ; le contenu technique déjà validé (Phases -1/0/1) est repris à l'identique dans `17-EXECUTABLE-BACKLOG.md`.

## 2. Méthode de lecture de la carte

Pour chaque domaine : **AS-IS** (résumé, renvoi à `02`) → **CIBLE** (résumé, renvoi à `01` et au document de domaine détaillé `06`-`15`) → **NATURE DE L'ÉCART** (`ABSENT` = à construire entièrement, `PARTIEL` = base réutilisable existe, `CONFORME` = déjà aligné, rien à faire) → **DOCUMENT DE DOMAINE**.

## 3. Domaine : Moteur d'exécution déterministe

- **AS-IS** : catalogue de conditions mature (11/12/10), state machines, `evaluateBrokerPolicy`, gates réels actifs. `02` §3, §6.
- **CIBLE** : reste le cœur inchangé de l'exécution réelle ; étendu pour consommer un `strategy_instance_id` (Phase 1) et pour être appelable par un Execution Gateway généralisé (Phase 9) sans réécriture de ses règles internes.
- **ÉCART** : `PARTIEL` — le moteur existe et n'est pas remis en cause ; ce qui manque est l'intégration en amont (identité de stratégie) et en aval (abstraction multi-provider), pas le moteur lui-même.
- **Document** : `04-TARGET-SYSTEM-ARCHITECTURE.md`, `13-EXECUTION-GATEWAY-PROVIDERS-AND-RECONCILIATION.md`.

## 4. Domaine : Identité de stratégie (Strategy Definition/Version/Instance)

- **AS-IS** : `ACTIVE_STRATEGY_RUNTIME_VERSIONS` est un verrou schéma/moteur singulier (`02` §7) ; `strategy_id` sur `trades` est une clé de session/lane legacy, pas une identité canonique (`02` §6).
- **CIBLE** : trois axes séparés — Strategy Definition (le « quoi »), Strategy Version (une révision figée testable), Strategy Instance (une exécution paramétrée avec un état runtime et un mode SHADOW/PAPER/LIVE). Voir `01` §1.3, `05-DOMAIN-MODEL-AND-STATE-MACHINES.md`.
- **ÉCART** : `ABSENT` pour le modèle à trois axes lui-même ; `PARTIEL` pour l'infrastructure de stockage (une colonne `strategy_id` existe déjà et peut être étendue via une FK `strategy_instance_id` sans backfill destructif, voir `17`, Ticket 1.4).
- **Document** : `05-DOMAIN-MODEL-AND-STATE-MACHINES.md`.

## 5. Domaine : Agrégation de position et réconciliation

- **AS-IS** : collision confirmée sur les Maps clé `instrument` seul (`02` §6) ; réconciliation codée mais jamais déclenchée automatiquement.
- **CIBLE** : agrégation correcte sous concurrence multi-instance, clé de regroupement prouvée par test (pas présumée), réconciliation périodique activable seulement après la correction (séquencement obligatoire, voir INV-8 dans `01`).
- **ÉCART** : `PARTIEL` — la logique de comparaison (`compareSnapshots`) existe et est correcte pour un scope mono-stratégie ; ce qui manque est la désambiguïsation multi-instance et l'activation gouvernée du déclenchement périodique.
- **Document** : `17-EXECUTABLE-BACKLOG.md` (Tickets 0.4/0.5), `13-EXECUTION-GATEWAY-PROVIDERS-AND-RECONCILIATION.md`.

## 6. Domaine : Acquisition et provenance des données

- **AS-IS** : aucun composant dédié identifié comme « Data Acquisition Layer » — les données de marché alimentent directement les pipelines existants sans registre de provenance formalisé. `ABSENT` au sens strict du composant cible.
- **CIBLE** : Data Acquisition Layer avec provenance tracée (source, horodatage d'ingestion, version de schéma), Feature Engine consommant ces données de façon versionnée et reproductible.
- **ÉCART** : `ABSENT` — chantier à construire, priorité haute car bloquant pour un Simulation Engine fiable (données non tracées = simulations non reproductibles, contradiction avec SC-3 de `01`).
- **Document** : `06-DATA-ACQUISITION-FEATURES-AND-PROVENANCE.md`.

## 7. Domaine : DSL de stratégie et runtime canonique

- **AS-IS** : le catalogue de conditions et les compilateurs de plan constituent une forme de DSL implicite, mais couplée au format de sortie du LLM (plan typé), pas un DSL déclaratif indépendant pouvant être écrit/édité directement par un chercheur.
- **CIBLE** : Strategy DSL déclaratif, compilé vers le même moteur d'évaluation déterministe que celui déjà en production, garantissant que « ce qui est simulé » et « ce qui s'exécute réellement » partagent le même runtime canonique (pas deux moteurs divergents).
- **ÉCART** : `PARTIEL` — le moteur d'évaluation cible existe déjà (c'est le moteur actuel) ; ce qui manque est la couche DSL/compilation en amont.
- **Document** : `07-STRATEGY-DSL-AND-CANONICAL-RUNTIME.md`.

## 8. Domaine : Simulation Engine et Experiment Registry

- **AS-IS** : `packages/desk-replay-engine` (déterministe, zéro LLM) est une base directement réutilisable ; aucun Run Registry, aucun Experiment Registry structuré. `02` §5.
- **CIBLE** : Dataset Builder, Event-Driven Simulator, Order/Portfolio/Risk Simulator, Metrics Engine, Run Registry (Phase 3) ; Experiment Registry pour comparer des runs entre eux (Phase 4).
- **ÉCART** : `PARTIEL` pour le cœur de simulation (base existante réutilisable) ; `ABSENT` pour Run Registry, Metrics Engine formalisé, Experiment Registry.
- **Document** : `08-SIMULATION-AND-EXPERIMENT-PLATFORM.md`.

## 9. Domaine : Research Lab et Multi-Agent Runtime

- **AS-IS** : trois pipelines LLM identifiés (analyse horaire, moniteur de thèse, orchestration de replay), chacun un appel direct point-à-point à Codex CLI, sans registre d'agents/missions/tâches généralisé. `02` §4.
- **CIBLE** : Agent/Mission/Conversation/Task/Batch/Event/Lease/Lock comme entités génériques, Event Envelope avec `correlation_id`/`causation_id`, politiques de batch (ALL/ANY/FIRST_SOCK/QUORUM/TIMEOUT_WITH_PARTIAL_RESULTS) ; les 3 pipelines existants migrent vers ce runtime générique sans changer leur valeur métier.
- **ÉCART** : `ABSENT` pour le runtime généralisé ; `PARTIEL` pour chaque pipeline individuel (la logique métier existe, l'orchestration générique n'existe pas).
- **Document** : `09-RESEARCH-LAB-AND-MULTI-AGENT-RUNTIME.md`.

## 10. Domaine : Live Strategy Runtime

- **AS-IS** : aucune notion de Strategy Instance runtime avec état SHADOW/PAPER/LIVE — l'exécution est binaire (le pipeline GPT-first tourne ou non), pas per-instance.
- **CIBLE** : chaque Strategy Instance a un cycle de vie explicite et indépendant, capable de tourner en SHADOW (calcule, n'exécute rien), PAPER (exécute sur compte simulé), LIVE (exécute réellement), avec isolation des pannes entre instances (SC voir `01` §6).
- **ÉCART** : `ABSENT`.
- **Document** : `10-LIVE-STRATEGY-RUNTIME.md`.

## 11. Domaine : Portfolio Arbitration, Global Risk, Broker Netting

- **AS-IS** : aucun composant d'arbitrage inter-stratégies ; le risque est évalué par la politique broker existante mais à l'échelle d'une décision, pas à l'échelle du portefeuille consolidé.
- **CIBLE** : verrou obligatoire (§1.4 de `01`) avant toute activation LIVE multi-stratégie réelle — Portfolio Arbitration Engine consolide les signaux candidats, Global Risk Engine applique les limites de portefeuille, Broker Netting Engine résout la position nette cible par instrument avant soumission.
- **ÉCART** : `ABSENT` — chantier bloquant, positionné explicitement **avant** toute activation réelle multi-stratégie dans la roadmap (`16`).
- **Document** : `11-PORTFOLIO-ARBITRATION-GLOBAL-RISK-AND-NETTING.md`.

## 12. Domaine : AI Context Gate

- **AS-IS** : aucun composant équivalent ; les recommandations LLM actuelles, quand elles existent, ne sont pas cloisonnées dans un statut SHADOW/ADVISORY formel avant intégration à la décision réelle.
- **CIBLE** : l'AI Context Gate ne peut retourner que TAKE/TAKE_REDUCED/WAIT/REJECT en tant qu'avis, jamais en tant que décision — voir invariant INV-1/SC-6 de `01`.
- **ÉCART** : `ABSENT`.
- **Document** : `12-AI-CONTEXT-GATE.md`.

## 13. Domaine : Execution Gateway, providers, réconciliation

- **AS-IS** : chemin d'exécution actuel couplé directement à NinjaTrader AddOn (HTTP+HMAC) ; absence confirmée de `PickMyTrade`/`ExecutionGateway` généralisé (corroboré par l'audit du 07:51).
- **CIBLE** : Execution Gateway abstrait, Execution Provider(s) interchangeables (NinjaTrader existant, PickMyTrade en due diligence Phase 10, futur broker direct en option), Reconciliation Engine activé de façon gouvernée.
- **ÉCART** : `PARTIEL` — le provider NinjaTrader existant devient le premier provider concret derrière la nouvelle abstraction, pas remplacé.
- **Document** : `13-EXECUTION-GATEWAY-PROVIDERS-AND-RECONCILIATION.md`.

## 14. Domaine : Événements, APIs, MCP

- **AS-IS** : LISTEN/NOTIFY Postgres comme accélérateur, table de tâches durable comme source de vérité, outbox à bail pour l'exécution broker (`02` §4) ; pas d'Event Envelope standardisé transverse à tout le système.
- **CIBLE** : Event Envelope standardisé (`correlation_id`/`causation_id`) traversant tous les domaines (SC-7 de `01`), API front et outils MCP alignés sur ce contrat d'événement.
- **ÉCART** : `PARTIEL` — les mécanismes de transport bas niveau (LISTEN/NOTIFY, outbox) sont réutilisables ; ce qui manque est la structure d'enveloppe uniforme au-dessus.
- **Document** : `14-EVENTS-APIS-AND-MCP-SURFACE.md`.

## 15. Domaine : Sécurité, observabilité, scalabilité

- **AS-IS** : sandboxing Codex CLI et allowlist d'environnement existants (`02` §4) ; pas d'inventaire formalisé de observabilité/scalabilité au niveau système.
- **CIBLE** : voir `15-SECURITY-OBSERVABILITY-AND-SCALABILITY.md` — recommandations, pas engagement de capacité (hors non-objectifs, `01` §7).
- **ÉCART** : `PARTIEL`.
- **Document** : `15-SECURITY-OBSERVABILITY-AND-SCALABILITY.md`.

## 16. Synthèse — écarts bloquants avant toute activation réelle multi-stratégie

Ces trois écarts, une fois résolus dans l'ordre indiqué, conditionnent le passage à une activation réelle multi-stratégie (Phase 7+) :

1. Correction de l'agrégation de position (§5) — sans cela, toute activation multi-instance corrompt silencieusement l'état de position agrégé.
2. Modèle Strategy Definition/Version/Instance (§4) — sans cela, il n'existe pas d'identité stable à laquelle rattacher une exposition, un risque, ou une gate de cycle de vie.
3. Portfolio Arbitration / Global Risk / Broker Netting (§11) — sans cela, plusieurs stratégies actives peuvent dépasser collectivement une limite de risque qu'aucune n'aurait dépassée individuellement.

Ce constat justifie directement le séquencement de `16-END-TO-END-MIGRATION-ROADMAP.md`, où ces trois chantiers sont placés avant la Phase 7 et non concurremment.
