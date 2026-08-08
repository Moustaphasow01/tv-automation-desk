# 24 — Backlog d'implémentation corrigé V2

- **Statut** : `CANONIQUE — PRÊT POUR BASELINE`
- **Version** : `2.2.0`
- **Date** : 2026-08-08
- **Source** : audit Codex du code local, de la documentation cible et du runtime VPS, décisions opérateur du 2026-08-08, plan directeur initial, standards Nakili adaptés dans `docs/engineering/` et Prompt Registry décrit dans `26-PROMPT-AND-INSTRUCTION-REGISTRY.md`
- **Machine-readable** : `implementation-backlog-v2.yaml`
- **Supersède pour l'ordre d'exécution** : `16-END-TO-END-MIGRATION-ROADMAP.md`, `17-EXECUTABLE-BACKLOG.md`, `22-GPT-CODEX-IMPLEMENTATION-RUNBOOK.md` et `implementation-backlog.yaml`

Les documents supersédés restent des sources d'architecture et d'historique. En cas de contradiction sur l'ordre des phases, les dépendances, les états métier ou le contenu d'un ticket, ce document et `implementation-backlog-v2.yaml` prévalent.

---

## 1. Décisions opérateur intégrées

### D1 — Le backend devient propriétaire de la recherche d'opportunités en runtime

Les stratégies publiées sont compilées et exécutées par le moteur déterministe. Elles produisent des signaux et des candidats sans attendre une génération LLM. Le LLM ne remplace ni le calcul des conditions, ni le sizing, ni les contrôles de risque, ni la construction d'un ordre.

### D2 — Les workers IA restent des workers Codex durables supervisés par Windows

Les services Windows restent disponibles sans consommer de tokens lorsqu'ils sont inactifs. Ils réveillent une invocation IA uniquement lorsqu'une tâche durable est éligible. Chaque mission conserve, autant que possible, son `conversation_ref` et reprend la même conversation avec `codex exec resume` ou son successeur contrôlé.

La continuité est bornée : un changement de mission, de version de contrat, de politique de sécurité ou une dérive excessive de contexte force une nouvelle conversation liée à la précédente par un événement explicite. La conversation n'est jamais l'unique source de continuité ; PostgreSQL reste la source de vérité.

### D3 — Le modèle et le niveau de raisonnement sont routés par politique

Le modèle, le niveau de raisonnement, le budget, le délai et les fallbacks ne sont pas codés dans chaque prompt. Une `Agent Execution Policy` versionnée les choisit selon le type de tâche, la criticité, l'incertitude et le coût attendu.

Profils initiaux :

| Profil | Usage | Raisonnement attendu |
|---|---|---|
| `FAST_CLASSIFY` | triage, extraction, normalisation | faible à moyen |
| `STANDARD_RESEARCH` | recherche structurée, synthèse d'expérience | élevé |
| `DEEP_STRATEGY_REVIEW` | conception/critique de stratégie, analyse contradictoire | très élevé |
| `CONTEXT_DECISION` | avis contextuel sur un candidat déjà déterministe | élevé, délai borné |
| `SAFETY_REVIEW` | revue d'une promotion ou d'un incident critique | très élevé, fail-closed |

Le nom exact des modèles reste une configuration opérateur afin de ne pas coupler le domaine à une génération particulière de modèles.

### D4 — L'IA conserve deux responsabilités distinctes

1. **Research AI** : propose, teste, critique et documente des Strategy Versions candidates.
2. **AI Context Decision Gate** : produit `TAKE`, `TAKE_REDUCED`, `WAIT` ou `REJECT` sur un candidat déjà déterministe.

Le gate commence en `SHADOW`, puis peut devenir bloquant après validation. Il ne crée jamais d'`OrderIntent`. Le Global Risk Engine conserve un veto supérieur et le sizing final reste déterministe.

### D5 — NinjaTrader est un provider transitoire ; PickMyTrade est le candidat cloud identifié

Le domaine ne dépend plus directement de NinjaTrader. Un `Execution Provider Port` reçoit les `OrderIntent` et normalise acknowledgements, fills, protections, positions et erreurs. L'adaptateur NinjaTrader reste utilisé pendant la transition.

Le fournisseur candidat est **PickMyTrade**, comme passerelle potentielle vers Rithmic et/ou Tradovate, notamment pour le multi-compte et la réduction de la dépendance Windows. PickMyTrade reste un candidat soumis à due diligence, pas encore le provider principal certifié. Son intégration exige : authentification backend-to-backend officielle, fonctionnement sans TradingView, ordres et brackets supportés, callbacks/statuts, rate limits, idempotence, protection serveur, partial fills, symbol mapping, rollover, sessions Rithmic, compatibilité Apex/prop firms, copie de comptes, SLA, coûts et réconciliation.

La cible long terme conserve aussi un `FutureDirectBrokerProvider` : l'Execution Gateway ne doit pas remplacer une dépendance NinjaTrader par une dépendance irréversible à PickMyTrade.

### D6 — Le front actuel accompagne la migration ; le futur front dépend d'API stables

Le front actuel reste la console opérateur de transition. Chaque vertical slice backend ajoute sa projection BFF et son écran minimal dans ce front afin que le système reste pilotable.

En parallèle, les capacités métier sont exposées sous des contrats REST versionnés et, pour les événements temps réel, sous SSE ou WebSocket derrière un event contract commun. Une refonte Front V3 séparée pourra ensuite remplacer entièrement parcours, UI et UX sans réécrire le backend.

### D7 — Git est la source de vérité ; Jira sera la vue de pilotage

Les identifiants `TD2-*` sont stables. Tant que le connecteur Jira n'est pas installé et vérifié, aucun projet Jira n'est créé. Après connexion, les Epics et tickets sont importés depuis `implementation-backlog-v2.yaml`. Toute transition de ticket doit être synchronisée avec le changement Git correspondant, sans stocker de secret dans Jira.

### D8 — Architecture technique hybride sans réécriture prématurée

Le backend Node.js/PostgreSQL actuel reste le **control plane** : API, contrats, identité Strategy, orchestration, audit, risque, événements et exécution. Il n'est pas réécrit en Spring Boot sans preuve qu'une limite réelle l'exige.

Un **compute plane Python** isolé est ajouté pour les traitements quantitatifs lourds : préparation Parquet, recherche statistique, batches, walk-forward, bootstrap, Monte-Carlo et optimisation. Il consomme des contrats versionnés et ne possède pas une seconde interprétation autonome de la stratégie. La sémantique de décision reste celle du Canonical Runtime partagé.

Le transport initial reste PostgreSQL outbox + `LISTEN/NOTIFY` avec polling durable. RabbitMQ, Kafka ou Redis Streams ne sont introduits qu'après mesure d'un besoin de débit, de rétention ou de distribution que PostgreSQL ne satisfait plus. TimescaleDB, Redis, object storage et Parquet sont des options ciblées, pas des prérequis imposés à tout le desk.

### D9 — Le Research Lab suit un processus scientifique explicite

Le Research Lab ne se limite pas à lancer des backtests. Il porte une taxonomie d'agents, des hypothèses falsifiables, une baseline, des itérations contrôlées, des datasets train/validation/out-of-sample, des tests de robustesse, une mémoire des échecs, une détection de doublons et des budgets tokens/CPU/temps. Le cycle `IDEA → ... → REJECTED/RETIRED` appartient aux **candidates de recherche** et ne remplace pas les trois axes d'état Definition/Version/Instance.

---

## 2. Corrections apportées au dossier V1

1. Les Strategy Definition, Version et Instance ne sont plus de simples JSON Schemas : elles possèdent des tables PostgreSQL, migrations, repositories, services, API, projection front et audit.
2. Les trois axes d'état sont séparés :
   - Strategy Version : `DRAFT → IN_SIMULATION → VALIDATED → PUBLISHED → DEPRECATED` ;
   - Strategy Instance runtime : `CREATED → STARTING → RUNNING ↔ PAUSED → STOPPING → STOPPED`, avec `ERROR` et `RETIRED` ;
   - mode d'exécution : `SHADOW → PAPER → LIVE`, promotions manuelles et auditées.
3. Le noyau Multi-Agent est construit avant la migration du Research Lab.
4. Run Registry est livré avec le Simulation Engine, pas après.
5. La projection BFF et le front de transition font partie de chaque vertical slice.
6. L'AI Context Gate est optionnel dans l'arbitrage tant que sa phase n'est pas livrée ; sa dépendance est explicite.
7. La correction d'agrégation broker précède toute concurrence multi-stratégie et toute réconciliation planifiée.
8. Les API métier sont conçues provider-neutral et front-neutral dès le premier vertical slice.
9. Le Simulation Engine cible étend les primitives déterministes existantes, mais le package `desk-replay-engine` actuel n'est pas considéré comme un simulateur de portefeuille complet : il fournit surtout un outcome replayer réutilisable.
10. Les conversations persistantes et le routage du raisonnement déjà présents sont généralisés ; ils ne sont pas réécrits sans raison.
11. La priorité des ressources est codée : `Execution > Risk > Live Signals > Monitoring > Validation > Research`.

---

## 3. Invariants non négociables

- Aucun ordre réel pendant les phases de construction et de validation sans décision opérateur distincte.
- Aucun LLM ne soumet, dimensionne ou modifie directement un ordre.
- PostgreSQL est la source de continuité ; une conversation IA est un contexte de travail, jamais une base métier.
- Toute Strategy Version publiée est immuable et scellée par hash.
- Toute donnée de simulation possède provenance, cutoff, timezone et hash.
- Replay, SHADOW, PAPER et LIVE utilisent le même compilateur et le même moteur de conditions.
- Toute migration DB est additive jusqu'au cutover final.
- `ACTIVE_STRATEGY_RUNTIME_VERSIONS` reste un verrou singulier de compatibilité.
- Une protection broker doit être positivement confirmée après fill ; sinon fermeture d'urgence et verrouillage.
- Plusieurs stratégies ne peuvent partager un compte réel avant validation de Portfolio Arbitration, Global Risk et Broker Netting.
- Toute capacité nouvelle est derrière un feature flag désactivé par défaut et possède un rollback testé.

---

## 4. Roadmap exécutable V2

### P-1 — Engineering Foundation obligatoire

**Objectif** : rendre les règles d'architecture, de nommage, de placement et de qualité obligatoires avant toute nouvelle évolution fonctionnelle.

- `TD2-ARCH-001` — Publier `AGENTS.md` et les standards d'ingénierie adaptés au desk.
- `TD2-ARCH-002` — Publier le catalogue des bounded contexts et le glossaire canonique.
- `TD2-ARCH-003` — Capturer la baseline des violations historiques et interdire leur aggravation.
- `TD2-ARCH-004` — Ajouter les tests automatiques de frontières, cycles et imports interdits.
- `TD2-ARCH-005` — Ajouter les guards taille, complexité, paramètres, duplication et code mort.
- `TD2-ARCH-006` — Décomposer progressivement le host MCP plat en modules par vertical slices.
- `TD2-ARCH-007` — Unifier taxonomie d'erreurs, codes stables et Problem Details.
- `TD2-ARCH-008` — Automatiser standards SQL, migrations, ownership, contraintes et index.
- `TD2-ARCH-009` — Auditer horloge, timezone, idempotence, optimistic locking et concurrence.
- `TD2-ARCH-010` — Faire converger le front vers features/data-access/ViewModels et gates a11y/visual/real-data.
- `TD2-ARCH-011` — Ajouter scans secrets, dépendances, licences, SBOM et images.
- `TD2-ARCH-012` — Automatiser le registre de dérogations, expirations et burn-down.
- `TD2-ARCH-013` — Ajouter CODEOWNERS, template de PR et compte rendu architectural obligatoire.

**Gate P-1** : standards versionnés et lus par les agents ; catalogue et baseline présents ; toute règle non automatisée possède un ticket ; aucune nouvelle violation de blocage n'est acceptée.

### P0 — Baseline, gouvernance et import Jira

**Objectif** : rendre l'état de départ reproductible et la cible versionnée.

- `TD2-000` — Versionner le blueprint V2 et ses décisions.
- `TD2-001` — Capturer git, release VPS, schéma DB, services, lanes, locks et travaux actifs.
- `TD2-002` — Exécuter CI complète, Docker, E2E et établir le rapport de baseline.
- `TD2-003` — Classifier les scripts legacy et les dépendances vulnérables, sans suppression aveugle.
- `TD2-004` — Connecter Jira et importer le YAML lorsque le MCP sera disponible.

**Gate P0** : baseline reproductible, aucun secret versionné, tickets Jira liés aux `TD2-*` si le connecteur est disponible.

### P1 — Sûreté broker et restauration des données

**Objectif** : corriger les risques qui invalideraient une architecture multi-stratégie.

- `TD2-010` — Rétablir l'acquisition après le 31 juillet et produire un rapport de couverture.
- `TD2-011` — Corriger l'agrégation signée compte/instrument avant réconciliation.
- `TD2-012` — Exiger la confirmation de la protection broker après fill et fermer en urgence en cas d'échec.
- `TD2-013` — Planifier la réconciliation en mode alert-only, puis bloquant après observation.
- `TD2-014` — Versionner le vrai ATR et renommer la moyenne de range historique.
- `TD2-015` — Ajouter les KPI de fraîcheur, divergence et protection au front de transition.

**Gate P1** : aucun écrasement de positions de même instrument, scénario sans stop protégé, données fraîches et observables.

### P2 — Strategy Kernel : premier vertical slice

**Objectif** : matérialiser Definition → Version → Instance sans modifier le chemin V5 actif.

- `TD2-100` — Migrations SQL et contraintes des trois agrégats.
- `TD2-101` — JSON Schemas, hashes et validations cross-field.
- `TD2-102` — Repositories, services et journal de transitions.
- `TD2-103` — API REST `/api/v2/strategy-definitions`, `/strategy-versions`, `/strategy-instances`.
- `TD2-104` — Projection BFF et écrans minimaux dans le front actuel.
- `TD2-105` — Lier `trades.strategy_instance_id` de manière nullable, sans backfill sémantique.
- `TD2-106` — Compiler une première Strategy Version `BREAKOUT_RETEST` vers le plan déterministe existant.

**Gate P2** : une version immuable est publiée, instanciée en SHADOW et visible depuis le front sans affecter V5.

### P2A — Prompt & Instruction Registry

**Objectif** : centraliser et versionner tous les prompts et instructions avant la généralisation des agents, sans modifier silencieusement le comportement Live/Replay existant.

- `TD2-PRM-001` — Inventorier prompts, instructions, contrats, versions, hashes et consommateurs existants.
- `TD2-PRM-002` — Créer les migrations PostgreSQL du catalogue, des versions immuables, compositions, bindings, déploiements et évaluations.
- `TD2-PRM-003` — Construire le renderer/composer déterministe et les schémas de variables.
- `TD2-PRM-004` — Implémenter bindings par agent/mission/environnement, canary, last-known-good et rollback.
- `TD2-PRM-005` — Créer les seeds Git et migrer les prompts Live/Replay `2.4.0` avec parité octet/hash.
- `TD2-PRM-006` — Ajouter évaluations de non-régression, sécurité, qualité, coût et latence.
- `TD2-PRM-007` — Exposer API contrôlée et écran opérateur de consultation, comparaison et déploiement.
- `TD2-PRM-008` — Appliquer permissions, audit, interdiction des secrets et guard contre les prompts hors registre.

**Gate P2A** : Live et Replay résolvent la même composition que l'existant avec parité prouvée ; version publiée immuable ; run épinglé ; rollback last-known-good testé ; aucun futur agent ne peut contourner le registre.

### P3 — Data Foundation et Feature Registry

- `TD2-200` — Data Source et Ingestion Batch.
- `TD2-201` — Dataset Registry, cutoff, hash et provenance.
- `TD2-202` — Feature Definition/Version et calcul reproductible.
- `TD2-203` — Calendrier, timezone, sessions et rollover futures.
- `TD2-204` — API data/feature en lecture contrôlée pour simulation et agents.
- `TD2-205` — Écrans de couverture et lineage dans le front actuel.
- `TD2-206` — Profiler profondeur historique, OHLCV, ticks, bid/ask, open interest et granularités réellement disponibles.
- `TD2-207` — Définir les tiers de stockage brut immuable, Parquet/object storage et séries chaudes sur preuve de besoin.
- `TD2-208` — Construire le catalogue initial VWAP/POC/VAH/VAL/IB/overnight/intermarket/macro point-in-time.

**Gate P3** : le même Dataset scellé produit les mêmes Features et le même hash.

### P4 — Strategy DSL, Simulation Engine et Run Registry

- `TD2-300` — DSL versionné compilant vers le moteur de conditions actuel.
- `TD2-301` — Simulation canonique sans dépendance LLM synchrone.
- `TD2-302` — Run Registry, artifacts, métriques, signaux, rejets et trades.
- `TD2-303` — Tests de reproductibilité bit-à-bit et anti-lookahead.
- `TD2-304` — API runs/compare/artifacts et évolution du Replay Lab actuel.
- `TD2-305` — Simuler market/limit/stop/stop-limit, spread, slippage, commissions, latence, gaps, partial fills, cancel/replace et ambiguïtés intrabar.
- `TD2-306` — Versionner les métriques R, PF, drawdown, Sharpe, Sortino, Calmar, MAE, MFE, exposition et segmentations.
- `TD2-307` — Ajouter walk-forward, bootstrap, Monte-Carlo, stress coûts/slippage et perturbation de paramètres.
- `TD2-308` — Gérer les splits train/validation/out-of-sample sans fuite temporelle.
- `TD2-309` — Ajouter le compute worker Python contractuel pour les calculs lourds, sans dupliquer la sémantique Strategy.

**Gate P4** : deux exécutions identiques produisent les mêmes résultats et preuves.

### P5 — Noyau Multi-Agent durable et model routing

- `TD2-400` — Tables Agent, Mission, Conversation, Task, Lease et Agent Event.
- `TD2-401` — Superviseur Windows event-driven avec polling de secours, sans consommation LLM à vide.
- `TD2-402` — Affinité mission/conversation, reprise et politique de rotation de contexte.
- `TD2-403` — Agent Execution Policy et routage modèle/raisonnement/budget/délai.
- `TD2-404` — Idempotence, retries, dead letters, annulation et reprise après redémarrage.
- `TD2-405` — Observabilité coût, latence, tokens, conversation et résultat.
- `TD2-406` — API/MCP d'administration sans accès SQL libre ni secrets.
- `TD2-407` — Écran Opérations Agents dans le front actuel.
- `TD2-408` — Scheduler de ressources CPU/RAM/stockage/GPU, quotas et priorité live absolue.
- `TD2-409` — Batch joins `ALL`, `ANY`, `FIRST_SUCCESS`, `QUORUM`, `TIMEOUT_WITH_PARTIAL_RESULTS`.
- `TD2-410` — Pools isolés research/backtest/robustness/reviewer/live/context/execution/monitoring.
- `TD2-411` — Port superviseur indépendant de l'OS et adaptateur Windows initial.

**Gate P5** : une mission survit à un redémarrage Windows, reprend sa conversation et ne double pas ses effets.

### P6 — Experiment Registry et Research Lab

- `TD2-500` — Experiment, Hypothesis, Candidate et Evaluation Report.
- `TD2-501` — Workflow IA de génération de stratégie candidate.
- `TD2-502` — Workflow contradictoire critique/validation.
- `TD2-503` — Matrice de promotion quantitative et approbation opérateur.
- `TD2-504` — API et espace Research/Experiments du front actuel.
- `TD2-505` — Catalogue Research Planner, Pattern Miner, Strategy Builder, Experiment Agent, Validator, Robustness Auditor, Regime Analyst, Reviewer et Live Performance Monitor.
- `TD2-506` — Processus hypothèse/baseline/itération contrôlée/budget/arrêt.
- `TD2-507` — Génome, taxonomie, score de nouveauté et détection de doublons structurels/comportementaux.
- `TD2-508` — Mémoire des échecs et connaissance négative requêtable.
- `TD2-509` — Graphe logique de relations patterns/features/régimes/instruments/expériences sans imposer une graph DB.
- `TD2-510` — Cycle de vie des candidates de recherche, distinct des états Strategy Version/Instance.
- `TD2-511` — Score de couverture et priorisation des zones de recherche.

**Gate P6** : l'IA peut produire une candidate reproductible, mais ne peut ni la publier ni la promouvoir seule en LIVE.

### P7 — Live Strategy Runtime SHADOW/PAPER

- `TD2-600` — Scheduler continu par Strategy Instance.
- `TD2-601` — Signal Bus sur outbox PostgreSQL + `LISTEN/NOTIFY` avec polling de secours.
- `TD2-602` — Parité Simulation/SHADOW sur données équivalentes.
- `TD2-603` — Promotion manuelle SHADOW → PAPER et rollback.
- `TD2-604` — API temps réel et écran Instances/Signals dans le front actuel.
- `TD2-605` — Live Performance Monitor et détection de dérive, recommandant réduction/suspension/retraite.

**Gate P7** : une instance PAPER tourne plusieurs séances sans intervention et reste explicable signal par signal.

### P8 — Portfolio Arbitration, Global Risk et Broker Netting

- `TD2-700` — Candidate Allocation et portefeuille virtuel par stratégie.
- `TD2-701` — budgets de risque compte/stratégie/instrument/corrélation.
- `TD2-702` — résolution de conflits et Target Position nette.
- `TD2-703` — Broker Netting et génération déterministe d'OrderIntent.
- `TD2-704` — tests concurrence, partial fills, redémarrage et divergence.
- `TD2-705` — cockpit Portfolio/Risk dans le front actuel.
- `TD2-706` — Attribution du PnL virtuel par stratégie et similarité comportementale/corrélation.
- `TD2-707` — Contraintes prop firm, trailing drawdown, multi-compte et groupes de comptes.

**Gate P8** : plusieurs stratégies PAPER concurrentes convergent vers une position broker nette auditable.

### P9 — AI Context Decision Gate

- `TD2-800` — contrat d'entrée/sortie et preuves contextuelles.
- `TD2-801` — profil `CONTEXT_DECISION` dans le model router.
- `TD2-802` — mode SHADOW et mesure des faux rejets/acceptations.
- `TD2-803` — politiques opérateur pour rendre `REJECT`, `WAIT` ou `TAKE_REDUCED` contraignants.
- `TD2-804` — timeout/fallback explicite sans blocage indéfini du marché.
- `TD2-805` — visualisation des décisions et explications dans le front actuel.

**Gate P9** : le gate est mesuré, borné, auditable et ne peut produire d'OrderIntent.

### P10 — Execution Gateway et évacuation progressive de NinjaTrader

- `TD2-900` — interface provider-neutral et modèle normalisé des événements broker.
- `TD2-901` — envelopper l'AddOn NinjaTrader existant dans l'adaptateur.
- `TD2-902` — Due diligence PickMyTrade/Rithmic/Tradovate/Apex et décision Go/No-Go.
- `TD2-903` — Adaptateur PickMyTrade PAPER si la due diligence est approuvée.
- `TD2-904` — tests de contrat communs aux providers.
- `TD2-905` — shadow reconciliation et bascule provider avec rollback.
- `TD2-906` — retrait de NinjaTrader uniquement après certification du remplacement.
- `TD2-907` — Circuit breaker et fallback provider sans double envoi, après réconciliation certaine.

**Gate P10** : changer de provider ne modifie ni stratégie, ni risque, ni OrderIntent.

### P11 — API publique interne stable et préparation Front V3

- `TD2-1000` — catalogue OpenAPI versionné de toutes les capacités métier.
- `TD2-1001` — contrats d'événements SSE/WebSocket et reprise par cursor.
- `TD2-1002` — scopes d'authentification opérateur/lecture/automation.
- `TD2-1003` — tests de compatibilité et politique de dépréciation.
- `TD2-1004` — cahier de refonte complète du Front V3 fondé sur les API, sans réutilisation obligatoire de l'IA actuelle.
- `TD2-1005` — stratégie de coexistence et migration écran par écran.
- `TD2-1006` — Surface MCP par rôle : recherche, data, live, exécution et administration, avec scopes stricts.

**Gate P11** : un client neuf peut piloter le desk sans accès à `desk_documents` ni connaissance de V4/V5.

### P12 — Cutover et décommission

- `TD2-1100` — exécution parallèle ancien/nouveau runtime et rapport de parité.
- `TD2-1101` — cutover progressif par Strategy Instance avec rollback testé.
- `TD2-1102` — validation opérateur distincte pour toute activation LIVE.
- `TD2-1103` — retrait GPT-first, collections et scripts legacy après période d'observation.
- `TD2-1104` — lancement de la refonte Front V3 comme chantier séparé.

**Gate P12** : aucun consommateur actif ne dépend du pipeline retiré et le rollback de la dernière release reste vérifié.

---

## 5. Definition of Done commune

Un ticket n'est `DONE` que si :

1. le code, les migrations et contrats sont versionnés ;
2. les tests unitaires, intégration et non-régression proportionnés au risque passent ;
3. la télémétrie et les erreurs opérables sont présentes ;
4. le feature flag et le rollback sont documentés et testés ;
5. l'API et la projection front sont mises à jour lorsque le ticket change un comportement visible ;
6. aucun secret ni donnée sensible n'est ajouté au dépôt ou au ticket ;
7. la documentation et, après connexion, le ticket Jira `TD2-*` sont synchronisés ;
8. aucune activation réelle n'est déduite du simple fait que le code est terminé ;
9. les standards d'ingénierie, le catalogue de modules, le glossaire et le registre de dérogations ont été respectés ;
10. tout prompt ou instruction d'agent est versionné et résolu par le Prompt Registry dès que le gate P2A est actif.

## 6. Règles de synchronisation Jira futures

- Un Epic Jira pour `P-1`, `P0` à `P12` et `P2A`.
- La clé externe est le champ `external_id: TD2-*` du YAML ; elle garantit un import idempotent.
- Les descriptions Jira sont générées depuis le Markdown/YAML, jamais l'inverse.
- Statuts recommandés : `Backlog`, `Ready`, `In Progress`, `In Review`, `Validated`, `Blocked`, `Done`.
- `Done` exige la Definition of Done ci-dessus ; `Validated` signifie testé mais pas nécessairement activé.
- Toute décision opérateur est un ticket ou une sous-tâche distincte, jamais une case implicite dans un ticket technique.
- Les liens Git commit/release/rapport de test sont ajoutés au ticket lors de chaque transition.

## 7. Première séquence autorisée

L'ordre de démarrage est :

`TD2-ARCH-001 → TD2-ARCH-002 → TD2-ARCH-003`, puis automatisation progressive `TD2-ARCH-004` à `TD2-ARCH-013` sans aggraver la baseline.

Le gate P-1 autorise ensuite :

`TD2-000 → TD2-001 → TD2-002 → TD2-003`, avec `TD2-004` en parallèle dès que le MCP Jira est installé.

Ensuite seulement :

`TD2-010 → TD2-011 → TD2-012 → TD2-013 → TD2-014 → TD2-015`.

La construction du Strategy Kernel (`P2`) ne commence qu'après passage du gate P1. Le Prompt Registry (`P2A`) démarre après P1 et doit franchir son gate avant le noyau Multi-Agent (`P5`). Aucun changement de lane, service Windows, Replay actif, verrou broker ou déploiement n'est autorisé par ce document seul.
