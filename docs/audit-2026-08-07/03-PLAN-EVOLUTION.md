# Plan d'évolution — séquencé, jusqu'au niveau ticket

Ce document est le livrable principal de la mission d'audit. Il traduit le
constat de `01-CARTOGRAPHIE-ET-FLUX.md` et `02-REPONSES-SECTION-31.md` en
travail exploitable directement par Codex, épic par épic, ticket par ticket,
avec dépendances et critères d'acceptation.

## Principe de séquencement

L'audit du 07:51 a établi une reséquentialisation correcte de la roadmap
§29 du plan directeur, vérifiée indépendamment ici : le point de départ réel
est **plus avancé** que ce que suppose le plan directeur sur l'axe
« rigueur déterministe », mais **bloqué** sur l'axe « pluralité » (une seule
stratégie, une seule position, un seul fournisseur à la fois). Le
séquencement ci-dessous respecte trois principes non négociables :

1. **Ce qui ne consomme aucun token LLM passe en premier**, indépendamment de
   la disponibilité de crédits Codex — c'est la quasi-totalité de la Phase 0
   et de la Phase 1.
2. **Le verrou de version de stratégie unique est le pivot** : rien dans les
   phases 3/4/5 n'est atteignable tant qu'il tient, quel que soit l'effort
   investi ailleurs.
3. **Aucun ticket de sûreté d'exécution ne passe après un chantier
   d'ambition** : les trois défauts de sûreté broker (protection après fill,
   réconciliation, bug multi-position) doivent être corrigés avant qu'une
   deuxième stratégie ne puisse jamais tourner en parallèle, sans quoi ils se
   déclenchent en production silencieusement.

## Phase 0 — Immédiat, sans LLM, sans dépendance

### Épic 0.A — Sécuriser l'acquisition de données

**Priorité : critique. C'est le seul risque de tout cet audit qui s'aggrave
avec le temps, indépendamment de tout token Codex.**

- **Ticket 0.A.1 — Relancer la capture de données de marché.**
  Dépendance : aucune. Constat : dernière bougie capturée 2026-07-31 20:59
  UTC (vérifié en base sur le VPS par l'audit du 07:51) ; l'ingestion s'est
  arrêtée au gel `ENGINE_V5_VALIDATION_HOLD`. Chaque jour non capturé peut
  devenir irrécupérable (historique TradingView glissant).
  Critère d'acceptation : un job d'ingestion actif écrit dans
  `market_candles` avec un délai de retard mesuré et alerté ; vérifier que la
  reprise ne casse pas l'idempotence d'import (`ON CONFLICT DO NOTHING`,
  `tradingview-m1-backfill-importer.js:451-478`).

- **Ticket 0.A.2 — Importer les 33 103 lignes déjà capturées (18-24 juillet)
  qui dorment sur disque.**
  Dépendance : aucune, indépendant de 0.A.1. Ces données existent déjà mais
  n'ont jamais été importées faute d'importeur exécuté. Gain immédiat de
  profondeur d'historique sans attendre une seule nouvelle bougie.
  Critère d'acceptation : les lignes apparaissent dans `market_candles` avec
  la même politique de capture (`settled_closed_bar_v2`) et passent le
  dry-run de vérification par buckets déjà utilisé au cutover du 2026-08-01.

### Épic 0.B — Corriger les trois défauts de sûreté d'exécution broker

**Priorité : critique. Le pivot vers plusieurs stratégies actives (Phase 1+)
rend ces bugs systématiquement déclenchables ; les corriger avant, pas après.**

- **Ticket 0.B.1 — Brancher `PROTECTION_CONFIRMED` sur le chemin broker réel.**
  Dépendance : aucune. La machine à états canonique existe déjà
  (`packages/desk-domain/src/position-state-machine-v1.js:12-91`, y compris
  l'état `PROTECTION_CONFIRMED` et le garde `ENGINE_ONLY_EVENTS`) — elle n'est
  simplement jamais invoquée. Travail : après un fill, interroger l'état réel
  du stop côté broker (via l'AddOn, qui a déjà accès aux objets `Order`
  NinjaTrader natifs) plutôt que de faire confiance à `intent.bracket`
  (`broker-execution-repository.js:1010-1055`) ; émettre l'événement
  `PROTECTION_CONFIRMED` seulement sur confirmation réelle ; définir l'action
  de repli (fermeture d'urgence) si non confirmée dans un délai borné.
  Critère d'acceptation : un test simulant un fill sans stop attaché déclenche
  la fermeture d'urgence et une alerte, pas un `status='open'` silencieux.

- **Ticket 0.B.2 — Déclencher la réconciliation périodiquement.**
  Dépendance : aucune. `compareSnapshots`/`reconcile()`
  (`broker-execution-service.js:882-901,647-680`) sont corrects et
  fail-closed, mais ne sont jamais appelés sauf manuellement, ou via un flag
  que l'AddOn code en dur à `false` (`DeskExecutionAddOn.cs:176-177`).
  Travail : ajouter un déclenchement planifié (le worker
  `run_broker_management_worker.mjs` est le point d'accroche naturel — il
  tourne déjà en continu et ne fait aujourd'hui que de la matérialisation) ;
  décider explicitement de la cadence.
  Critère d'acceptation : une divergence artificiellement introduite en base
  de test est détectée et verrouille le compte dans un délai mesuré, sans
  intervention manuelle.

- **Ticket 0.B.3 — Corriger le bug `Map` d'auto-verrouillage multi-positions.**
  Dépendance : aucune, mais **bloquant absolu avant Phase 1** (dès qu'une
  deuxième stratégie tourne sur le même instrument, ce bug se déclenche).
  `broker-execution-service.js:888-893` construit `deskPositions` comme une
  `Map` clé = instrument ; deux positions ouvertes sur le même instrument
  s'écrasent silencieusement, produisant un faux `POSITION_QUANTITY_MISMATCH`
  qui verrouille le compte. Travail : clé composite
  (instrument + strategy_id) plutôt qu'instrument seul.
  Critère d'acceptation : un test avec deux positions simultanées sur le même
  instrument, stratégies différentes, ne produit aucun faux mismatch.

### Épic 0.C — Corrections ponctuelles à faible risque

- **Ticket 0.C.1 — Corriger ou renommer `atr_14`.**
  Dépendance : aucune. `recentAverageRange()`
  (`desk-market-feature-algorithms.js:780-783`) calcule `moyenne(high−low)`,
  pas un vrai ATR (pas de true range, pas de lissage de Wilder), mais expose
  le résultat sous une clé nommée `atr_14`. Tout consommateur qui fait
  confiance au nom reçoit une valeur trompeuse. Deux options : implémenter un
  vrai ATR, ou renommer la clé pour refléter ce qu'elle calcule réellement.
  Critère d'acceptation : soit la formule Wilder est implémentée et testée,
  soit tous les consommateurs de la clé sont audités et le renommage propagé
  sans casser de contrat existant.

- **Ticket 0.C.2 — Étendre le hachage d'intégrité des packs à macro/news.**
  Dépendance : aucune. `macro_calendar` et `news_digest` sont actuellement
  exclus du hachage d'intégrité (`pack-integrity.js:431`,
  `desk-replay-orchestration-algorithms.js:2340`), donc non couverts par la
  garantie de reproductibilité qui protège les prix. Pertinent seulement si
  la Phase 3 (Research Lab) traite macro/news comme entrées de recherche de
  premier rang — sinon, reporter.

### Épic 0.D — Clarifications opérationnelles préalables (décision opérateur, pas du code)

- **Ticket 0.D.1 — Confirmer l'état exact du hold `ENGINE_V5_VALIDATION_HOLD`
  et la version de contrat réellement active.** Deux jeux de versions de
  contrats sont apparus dans les sources consultées pendant cet audit
  (5.4.0/1.4.0/2.4.0 dans les logs de déploiement récents vs 5.1.0/1.1.0/2.1.0
  dans le runbook de cutover du 2026-08-01) — probablement une progression
  dans le temps, mais à vérifier avant toute planification qui suppose un
  état runtime précis (`get_active_contracts` ou équivalent).
- **Ticket 0.D.2 — Clarifier le mode d'authentification Codex CLI** (clé API
  mesurée vs session d'abonnement plafonnée) — conditionne le dimensionnement
  réel du chantier « réduction de tokens » en Phase 3/4.

---

## Phase 1 — Lever le verrou de version de stratégie unique (le pivot)

**Dépendance : Épic 0.B entièrement complété (sûreté d'exécution) avant
d'activer une deuxième stratégie en conditions réelles ; peut être développé
en parallèle de la Phase 0 sur des branches/environnements isolés.**

C'est le chantier le plus délicat du programme : il touche précisément le
mécanisme qui garantit la sûreté actuelle. Il doit être fait **avec** les
mêmes gardes (hash, contrats, locks), pas contre elles.

- **Ticket 1.1 — Extraire une Strategy Specification persistée du plan
  d'instance actuel.** Aujourd'hui, `execution-plan-v1-4.schema.json` décrit
  un plan qui meurt avec chaque checkpoint M15, pas une entité réutilisable.
  Définir le sous-ensemble de ce plan qui constitue une *stratégie* stable
  (famille de setup, filtres, session, règles de sortie) par opposition à ce
  qui varie à chaque checkpoint (l'instance courante).
  Critère d'acceptation : un schéma de Strategy Specification versionné existe,
  validé par le même pipeline AJV que les contrats existants.

- **Ticket 1.2 — Peupler `strategy_catalog`/`desk_strategy_versions`.**
  Dépendance : 1.1. Ces tables sont **déjà lues** par le backend
  (`front-operations-service.js:1288-1341`) mais **jamais écrites** —
  peuplées aujourd'hui uniquement par des fixtures de test. C'est le bon
  point d'accroche : le modèle de données existe, il est inerte.
  Critère d'acceptation : une stratégie créée via 1.1 apparaît dans ces tables
  et est lisible par le frontend existant sans modification de celui-ci.

- **Ticket 1.3 — Remplacer `ACTIVE_STRATEGY_RUNTIME_VERSIONS` (tuple figé) par
  un ensemble de versions actives.** Dépendance : 1.1, 1.2. C'est le
  déverrouillage littéral. `assertActiveStrategyRuntimePins`
  (`strategy-runtime-versioning.js:183-188`) doit accepter un ensemble
  plutôt qu'un tuple unique, sans affaiblir la garantie qu'un payload donné
  reste épinglé sur une version cohérente et connue.
  Critère d'acceptation : deux versions de stratégie peuvent coexister
  activement en base sans qu'aucune assertion existante ne les rejette
  mutuellement ; toute la suite de tests de contrats existante continue de
  passer sans modification de ses attentes de sûreté.

- **Ticket 1.4 — Cycle de vie minimal de la stratégie.** Dépendance : 1.2.
  Aujourd'hui le seul cycle existant est `draft/active/archived` sur les
  *contrats*, pas sur les stratégies. Implémenter au minimum
  `DRAFT → PAPER → ACTIVE → RETIRED` (sous-ensemble du cycle complet
  `IDEA→…→RETIRED` du plan directeur §11.1 — ne pas construire les 14 états
  d'un coup, ce cycle réduit suffit pour débloquer la Phase 3).

**Ce que la Phase 1 débloque** (chaîne de dépendance confirmée par l'audit du
07:51, non remise en cause) : Strategy Registry → Experiment Registry →
backtests réels indépendants du LLM → signaux multiples → arbitrage de
portefeuille → réduction de la consommation de tokens (le LLM cesse d'émettre
un plan complet toutes les 15 minutes). Tant que ce verrou tient, aucun de ces
chantiers n'est atteignable, quel que soit l'effort investi ailleurs.

---

## Phase 2 — Moteur de simulation historique

**Dépendance : aucune dépendance dure sur la Phase 1** (peut démarrer en
parallèle), mais n'a d'utilité réelle pour le Research Lab qu'une fois la
Phase 1 livrée. Greenfield, mais pas depuis zéro : la sémantique
anti-look-ahead, le rééchantillonnage cutoff-correct, la détection
d'ambiguïté intrabar et le calcul en R existent déjà en JavaScript et
servent de spécification exécutable à porter, pas à réinventer.

**Recommandation architecturale (reprise et confirmée) : ne pas réécrire le
backend Node en Spring Boot.** ~63 500 lignes de backend Node, couvertes par
101 fichiers de tests, plus `desk-domain`/`desk-contracts` avec contrats
scellés par hash — réécrire jetterait précisément les actifs qui rapprochent
le plus le desk de la cible, pour un gain nul (rien dans la cible n'exige la
JVM). Introduire Python **uniquement** pour le moteur de simulation et les
statistiques, là où l'écosystème (numpy/pandas/scipy) est réellement décisif.

- **Ticket 2.1 — Dataset Builder.** Dépendance : aucune. Absent aujourd'hui
  (`dataset_id`, `version`, `rollover_method`, `adjustments` : zéro colonne).
  Analogue le plus proche à généraliser : le profil figé
  `v5-replay-data-profile.js` + les packs immuables déjà content-addressed
  (`desk_pack_objects`).
  Critère d'acceptation : un dataset versionné, immuable, reproductible par
  son id, couvrant au minimum MNQ+MES M1 sur la fenêtre disponible.

- **Ticket 2.2 — Feature Engine, port + extension.** Dépendance : 2.1.
  Porter l'existant (overnight range, previous-NY, session high/low, carte de
  niveaux) vers le nouveau moteur ; ajouter ce qui manque (POC/VAH/VAL — non
  faisable sans ticks, à noter comme limité par 02-REPONSES §« ticks » ; ATR
  réel — réutiliser la correction du Ticket 0.C.1 ; RSI backend ; Initial
  Balance ; bandes VWAP).
  Critère d'acceptation : chaque feature portée produit une valeur identique
  (aux arrondis près) à sa version JavaScript sur un même jeu de données de
  contrôle.

- **Ticket 2.3 — Simulateur événementiel core.** Dépendance : 2.1, 2.2.
  Rejeu chronologique sans jamais voir le futur ; réutiliser la sémantique de
  `rowVisibleAtReplayCutoff`/`replayBarClosedAtCutoff` déjà éprouvée en
  JavaScript comme spécification.

- **Ticket 2.4 — Order Simulator.** Dépendance : 2.3. `outcome-engine.js`
  actuel n'évalue que l'issue d'un setup déjà décidé (entrée/stop/targets
  fixes). Manque : types d'ordres, bid/ask, spread, slippage, commissions,
  latence, fills partiels, annulations/modifications. Pour l'ambiguïté
  intrabar (stop et target touchés dans la même bougie), le mécanisme
  existant escalade en revue humaine
  (`OUTCOME_AMBIGUOUS_CANDLE_PATH`) — acceptable en mode assisté, bloquant en
  backtest de masse. Implémenter la règle pessimiste par défaut (faute de
  ticks pour trancher précisément), avec le comportement actuel conservé
  comme option de revue.

- **Ticket 2.5 — Portfolio + Risk Engine en mode backtest.** Dépendance : 2.4.
  Totalement absent du moteur de simulation actuel — à construire en
  réutilisant les règles déjà déterministes du Risk Engine live
  (`evaluateBrokerPolicy`, `packages/desk-domain/src/broker-execution.js:256-470`,
  fonction pure, directement réutilisable en contexte offline).

- **Ticket 2.6 — Metrics Engine.** Dépendance : 2.4. Métriques standard
  (expectancy en R, profit factor, Sharpe/Sortino/Calmar, drawdown, MAE/MFE),
  analyse segmentée (par régime, session, heure).

---

## Phase 3 — Experiment Registry et Research Lab

**Dépendance dure : Phase 1 (Strategy Spec persistée) et Phase 2 (moteur de
simulation) toutes deux livrées.**

- **Ticket 3.1 — Généraliser `desk_replay_autopilot_configs` en Experiment
  Registry multi-bras.** Ce document fournit déjà le bon patron : épinglage
  immuable de données, priorité, `worker_group`, cycle `READY/PAUSED/ARCHIVED`
  — mais mono-bras, sans hypothèse ni métriques attachées. Généraliser :
  `experiment_id`, hypothèse, dataset (Ticket 2.1), Strategy Spec (Ticket 1.1),
  paramètres, métriques, conclusion, statut.

- **Ticket 3.2 — Mémoire des échecs et détection de doublons.** Dépendance :
  3.1. Absent aujourd'hui. Nécessaire pour éviter que le Research Lab
  re-teste indéfiniment les mêmes combinaisons.

- **Ticket 3.3 — Agents de recherche minimaux.** Dépendance : 3.1, 3.2.
  Ne pas construire les 9 rôles du plan directeur d'un coup (Research
  Planner, Pattern Miner, Strategy Builder, Experiment Agent, Backtest
  Validator, Robustness Auditor, Regime Analyst, Research Reviewer, Live
  Performance Monitor) — commencer par Experiment Agent + Backtest Validator
  seuls, suffisant pour un cycle hypothèse → backtest → décision.

**Note de dimensionnement des données** : 24 jours de M1 suffisent pour bâtir
la mécanique et poser les baselines, mais **pas** pour la robustesse exigée
(walk-forward, multi-régimes, out-of-sample). Traiter l'acquisition d'un
historique profond — y compris l'option d'un fournisseur tiers pour les ticks
— comme un chantier à part entière de cette phase, pas comme un détail.

---

## Phase 4 — Runtime multi-agent généralisé

**Dépendance : aucune dépendance dure sur les phases 1-3**, mais n'a d'utilité
réelle qu'une fois plusieurs expériences/stratégies existent à orchestrer
(Phase 3). Généralise un pattern qui fonctionne déjà pour un seul type
d'agent (voir `01-CARTOGRAPHIE-ET-FLUX.md` §3).

- **Ticket 4.1 — Agent comme entité de première classe.** Aujourd'hui
  l'identité d'agent est `DESK_AI_WORKER_ID`, une variable d'environnement
  utilisée seulement comme jeton de bail — aucun budget, permission ou
  priorité. Modéliser l'agent comme une entité en base avec ces attributs.

- **Ticket 4.2 — Event Envelope avec corrélation causale.** `correlation_id`
  et `causation_id` : **zéro occurrence dans tout le dépôt** (confirmé par
  grep exhaustif). La forme la plus proche existante
  (`trade_events`/`broker_order_events` = `{event_id, aggregate_fk,
  event_type, occurred_at, payload}`) manque précisément ces deux champs —
  les ajouter est un changement additif, pas une réécriture.

- **Ticket 4.3 — Orchestrateur central minimal.** Dépendance : 4.1. Le
  routage actuel est deux lanes fixes (live/replay) codées en dur. Un
  orchestrateur minimal doit au moins savoir router par type d'agent et
  détecter un agent bloqué (bail expiré sans complétion).

- **Ticket 4.4 — Généraliser le pattern Submit-Suspend-Resume au-delà du
  worker d'analyse unique.** Dépendance : 4.1, 4.3. Le pattern existant
  (voir `01-CARTOGRAPHIE-ET-FLUX.md` §3.5) est réel mais spécifique au fil de
  conversation Codex d'un seul type de worker. L'étendre aux futurs agents de
  recherche (Phase 3) sans dupliquer la logique de bail/reprise.

**Sur le choix du bus de messages (décision architecturale explicite, pas une
propriété émergente)** : rester sur PostgreSQL (table de file dédiée +
LISTEN/NOTIFY) tant qu'il n'a pas prouvé son insuffisance. Avec 8 vCPU et une
seule machine, ajouter Kafka ou RabbitMQ apporterait de la charge
d'exploitation sans capacité supplémentaire réelle. Réévaluer seulement sur
preuve de charge, pas par anticipation.

---

## Phase 5 — Portfolio Arbitration, puis Execution Gateway et PickMyTrade

**Dépendance dure sur la partie arbitrage : Phase 1 livrée (l'arbitrage n'a
d'objet que lorsque plusieurs stratégies émettent réellement des signaux).
L'abstraction fournisseur peut être préparée en parallèle, sans dépendance.**

- **Ticket 5.1 — Extraire une interface `ExecutionProvider`.** Dépendance :
  aucune, peut démarrer immédiatement. Aujourd'hui `'ninjatrader'` est un
  littéral SQL dans plusieurs fichiers
  (`broker-execution-repository.js:218,221,317,476,921,926`,
  `broker-position-management.js:256`). Extraire l'interface (submitOrder,
  cancelOrder, replaceOrder, closePosition, modifyProtection, getOrderStatus,
  getPositionStatus, healthCheck, reconcile) et faire de NinjaTrader la
  première implémentation, sans changer son comportement. Compléter au passage
  les opérations aujourd'hui incomplètes : `cancelOrder` est du **code mort**
  (branche jamais appelée), `replaceOrder` ne gère que move_stop,
  `modifyProtection` ne gère jamais le take-profit, `getOrderStatus`/
  `getPositionStatus` n'existent qu'en push, jamais en pull.
  Critère d'acceptation : le comportement NinjaTrader actuel est bit-à-bit
  identique après extraction (tests de non-régression sur Sim101).

- **Ticket 5.2 — Portfolio Arbitration Engine.** Dépendance : Phase 1 (Ticket
  1.3, plusieurs stratégies actives). Construire les règles de conflit
  (même instrument même direction : fusion ; directions opposées : rejet ou
  priorité ; instruments corrélés : exposition directionnelle unique
  reconnue), le budget de risque global (par stratégie/instrument/direction/
  agrégé), le netting (une position broker réelle, comptabilité interne par
  stratégie).

- **Ticket 5.3 — Évaluation externe PickMyTrade (avant tout code).**
  Dépendance : aucune sur le code de ce dépôt, mais **bloquant avant tout
  ticket d'implémentation** de l'adaptateur. Répondre aux 20 questions du
  §21.4 du plan directeur directement auprès du fournisseur (support
  backend-to-backend hors TradingView, limites de fréquence, authentification,
  callbacks, idempotence côté fournisseur, multi-comptes, compatibilité
  Apex/Rithmic, SLA). Rien dans ce dépôt ne peut y répondre — confirmé par
  recherche exhaustive.

- **Ticket 5.4 — Adaptateur PickMyTrade (si 5.3 est concluant).** Dépendance :
  5.1, 5.3. Suivre la migration en 5 phases déjà décrite par le plan
  directeur §21.8 (démo → adaptateur+simulation → shadow execution → live
  réduit avec NinjaTrader en secours → PickMyTrade principal).

---

## Ce qui n'est délibérément pas planifié ici

Conforme au périmètre de la mission : aucun ticket ci-dessus ne doit être
exécuté par cette session d'audit elle-même. Ce plan est un intrant pour une
intervention Codex future, pas un carnet de tâches auto-exécutable. Les
décisions marquées « opérateur » dans `02-REPONSES-SECTION-31.md` (nombre de
workers, instrument MVP, stratégie de référence, charge cible) doivent être
tranchées avant que la Phase 1 ne soit chiffrée dans le détail — elles ne
bloquent pas la Phase 0, qui peut démarrer sans elles.
