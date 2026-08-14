# Audit de convergence vers l'architecture cible — 2026-08-07

Objet : auditer l'existant au regard du plan directeur « Évolution du Trading
Desk vers une architecture data-driven, multi-agent, scalable et
event-driven », et établir le chemin de convergence.

Méthode : lecture du code, du schéma PostgreSQL et des contrats ; interrogation
directe de la base de production sur le VPS ; inspection de l'infrastructure.
Aucun code n'a été modifié. Chaque constat est référencé `fichier:ligne`.

---

## 1. Constat central

**La section 1.1 du plan directeur décrit une architecture antérieure au
cutover « Deterministic Strategy V5.1 » du 2026-08-01.**

Le plan pose comme prémisse « analyse directe par des workers Codex ou LLM »,
avec pour corollaire que tout le déterminisme reste à construire. Le code dit
autre chose. Le desk a déjà franchi l'étape conceptuellement la plus difficile :
**séparer « le LLM propose un plan typé » de « le moteur déterministe évalue et
exécute »**.

Ce qui existe et qui est directement au service de la cible :

| Brique | Emplacement | Volume |
|---|---|---|
| DSL de conditions machine-évaluable | `packages/desk-contracts/catalogs/condition-catalog-v1-2.json` | 11 prédicats, 16 opérateurs, 12 hard gates, 10 soft gates, 8 patterns |
| Évaluateurs déterministes | `packages/desk-domain/src/deterministic-predicate-registry-v1.js` | ~1 000 lignes, machine à 7 états |
| Compilateurs de plan | `packages/desk-domain/src/deterministic-compilers-v1.js` + `deterministic-compiler-entry-v1.js` | ~1 900 lignes |
| Feature Engine | `mcp_gpt_desk/src/desk-market-feature-algorithms.js` | 1 322 lignes |
| Rééchantillonnage M1→M5/M15/H1/H4 sans look-ahead | `mcp_gpt_desk/src/canonical-market-resampler.js` | cutoff-correct, versionné |
| Moteur d'outcome déterministe | `packages/desk-replay-engine/src/outcome-engine.js` | 545 lignes, testé |
| Garde anti-look-ahead | `packages/desk-audit/src/anti-lookahead-guard.js` | 206 lignes |
| Horloge injectable | `packages/desk-time/src/clock.js` | `ClockPort` / `FixedClock` |
| Exécution + risque déterministes | `packages/desk-domain/src/broker-execution.js` | 655 lignes, fonction pure |
| Contrats scellés par hash | `packages/desk-contracts/registry.json` | 7 contrats actifs, 25 legacy |

Plusieurs « principes non négociables » de la section 32 sont **déjà appliqués
et testés** : absence de look-ahead, dataset épinglé par pack immuable, code et
contrats versionnés, décisions auditables, idempotence, backend source de
vérité, risque indépendant du LLM.

**Conséquence sur la nature du chantier.** La question n'est pas « comment
introduire du déterminisme » mais :

> **Comment faire passer le système d'un modèle mono-stratégie où le LLM
> ré-émet un plan à chaque checkpoint, à un modèle multi-stratégies où des
> spécifications persistées tournent sans LLM ?**

---

## 2. Le verrou principal

Le système actuel n'a **pas** de Strategy Specification persistée. Il a un
*plan d'instance* : à chaque checkpoint M15, le LLM ré-émet un
`execution_plan` complet, qui est validé, compilé, exécuté — puis meurt avec le
checkpoint.

Trois mécanismes verrouillent ce modèle :

1. **`ACTIVE_STRATEGY_RUNTIME_VERSIONS`** (`mcp_gpt_desk/src/strategy-runtime-versioning.js:3-14`)
   fige 10 versions (`strategy_version:"autopilot_v5"`, `autopilot_version:"5.4.0"`,
   `master_contract:"5.4.0"`, …).
2. **`assertActiveStrategyRuntimePins`** rejette tout payload non épinglé sur ce
   tuple, avec `repin_forbidden: true` (`:183-188`).
3. **`desk_replay_autopilot_configs`** appelle cette assertion
   (`desk-replay-service.js:1091` et `:1670`).

**Une seule version de stratégie peut donc exister à un instant donné.** C'est
exactement ce qui garantit la sûreté aujourd'hui — et exactement ce qui interdit
demain : le A/B, les backtests comparatifs, l'arbitrage de portefeuille, le
Research Lab.

**Lever ce verrou est le pivot du programme.** Il débloque, dans l'ordre :

```
Strategy Spec persistée et versionnée
  → Strategy Registry (§8.2) + cycle de vie (§11)
  → Experiment Registry (§8.1)  [expérience = strategy_version × dataset]
  → Backtests réels (§6)        [une stratégie tourne enfin sans LLM]
  → Signaux multiples (§16)     [plusieurs stratégies actives]
  → Portfolio Arbitration (§17) [il y a enfin des conflits à arbitrer]
  → Réduction des tokens (§24)  [le LLM cesse d'émettre un plan tous les 15 min]
```

Tant que ce verrou tient, les sections 4, 5, 8, 9, 11, 13, 16 et 17 de la cible
sont inatteignables — quel que soit l'effort investi ailleurs.

---

## 3. Cartographie de convergence

Légende : ✅ existe et sert la cible · 🟡 existe partiellement, à étendre ·
🔴 absent, à construire.

### Socle de données (§6.3–6.7)

| Cible | État | Écart et action |
|---|---|---|
| Historical Data Store immuable | 🟡 | `market_candles`, PK `(feed_id, timestamp_utc)`, insert `ON CONFLICT DO NOTHING` — les barres existantes ne sont jamais écrasées (`tradingview-m1-backfill-importer.js:451-478`). Provenance par ligne dans `raw` jsonb. **Manque** : ticks, bid/ask, open interest, contrats futures. |
| Dataset Builder | 🔴 | Aucun `dataset_id`, aucune colonne `version`/`rollover_method`/`adjustments`. Analogue le plus proche : le profil figé `v5-replay-data-profile.js` + les packs immuables. À construire. |
| Feature Engine | 🟡 ~40 % | Existant et réutilisable : overnight range, previous-NY, session high/low, carte de niveaux par clustering de pivots, classification d'événements techniques. **À construire** : POC/VAH/VAL, ATR réel, RSI, Initial Balance, bandes VWAP. |
| Absence de look-ahead | ✅ | `canonical-market-resampler.js` rejette les barres au-delà du cutoff (`:59-97`) ; chaque doc de feature porte `computed_with_cutoff` + `anti_lookahead_compliant`. **À préserver, ne pas reconstruire.** |
| Gestion du temps | ✅ | `packages/desk-time` (Paris/UTC, `ClockPort`/`FixedClock`). Manque : jours fériés, RTH/ETH, fermetures exceptionnelles. |
| Rollover futures | 🔴 | **Zéro code.** Entièrement délégué aux séries `1!` de TradingView. Les dates de roll ne sont pas enregistrées et sont **irrécupérables** pour les lignes existantes. |

**Deux points d'attention factuels :**

- `atr_14` **n'est pas un ATR**. `recentAverageRange()`
  (`desk-market-feature-algorithms.js:780-783`) calcule `moyenne(high − low)`,
  sans true range ni lissage de Wilder, et l'expose sous la clé `atr_14` dans
  `range_state` et `volatility_state`. Tout consommateur qui fait confiance au
  nom consomme autre chose que ce qu'il croit.
- `poc_vah_val: {}` est **codé en dur à vide**
  (`desk-market-feature-algorithms.js:394`), et reste incalculable :
  `market_candles` ne stocke qu'un `volume` scalaire par barre, sans
  répartition par niveau de prix.

### Moteur de simulation (§6.1–6.2, 6.8–6.10)

| Cible | État | Écart et action |
|---|---|---|
| Rejeu chronologique | 🟡 | Le « Replay » actuel rejoue le **pipeline LLM** sur dates passées, pas une stratégie déterministe. Coût en tokens identique au live. |
| Order Simulator | 🟡 | `outcome-engine.js` évalue l'issue d'**un** setup (entrée/stop/targets fixes). **Manque** : types d'ordres, bid/ask, spread, slippage, commissions, latence, fills partiels, modifications/annulations. |
| Ambiguïté intrabar (§6.9) | 🟡 | **Détectée** (`OUTCOME_AMBIGUOUS_CANDLE_PATH`, `outcome-engine.js:196-209`) mais escaladée en revue humaine. La cible demande : granularité inférieure → ticks → règle pessimiste. En backtest de masse, l'escalade bloque. |
| Portfolio + Risk en backtest | 🔴 | Absent du moteur de simulation. |
| Reproductibilité | 🟡 | Hachage des résultats et horloge injectable présents. Mais tant que le LLM est dans la boucle, deux runs peuvent diverger. |
| Moteur Python | 🔴 | Aucun code Python applicatif (uniquement des scripts d'import/audit ponctuels dans `scripts/db/`). Greenfield. |

### Stratégies et recherche (§7, §8, §9, §11)

| Cible | État | Écart et action |
|---|---|---|
| Strategy Specification | 🟡 | Le DSL **existe** (`execution-plan-v1-4.schema.json`, 16 propriétés requises ; `$defs.condition` à 16 propriétés) mais décrit un **plan d'instance**, pas une stratégie réutilisable. |
| Bibliothèque de composants (§7.2) | 🟡 ~50 % | Présents : indicateurs (`VWAP_RELATION`, `RSI_THRESHOLD`), comparateurs (16 opérateurs), fonctions temporelles (`TIME_WINDOW`), intermarket (`INTERMARKET_CONFIRMATION`), événements macro (`EVENT_BLACKOUT`). Vocabulaire **fermé** : ajouter un prédicat impose une nouvelle version de contrat + nouveaux hashs. |
| Validation (§7.3) | ✅ | Schéma strict, types validés, look-ahead détecté, phases d'enforcement, paramètres bornés. `check-strategy-v5.mjs` vérifie la cohérence catalogue/enums/schémas. |
| Strategy Registry | 🔴 | `strategy_catalog`, `strategy_configs`, `strategy_runtime_state`, `desk_strategy_versions` sont **déclarés et lus** (`front-operations-service.js:1288-1341`) mais **jamais écrits** par le backend — peuplés uniquement par des fixtures. Coquille inerte, mais c'est le bon point d'accroche. |
| `strategyId` | 🟡 | Chaîne libre à deux valeurs (`asia_open`, `ny_open_1530`). C'est une clé de **partition de session**, pas une entité enregistrée. Aucune FK, aucune validation. |
| `variantId` | 🔴 | Calculé à la projection (`front-operations-service.js:1602`), jamais persisté. Clé de regroupement d'affichage, pas une version. |
| Experiment Registry | 🔴 | Analogue le plus proche : `desk_replay_autopilot_configs` — nommé, adressable, cycle `READY/PAUSED/ARCHIVED`, données épinglées (`pack_id` + `pack_build_id`), `worker_group`, `priority`. Mais mono-bras, sans hypothèse, sans métriques attachées, et épinglé à l'unique runtime actif. |
| Cycle de vie stratégie (§11.1) | 🔴 | Le seul cycle existant est `draft/active/archived` sur les **contrats**. Rien pour `IDEA→…→RETIRED`. |
| Mémoire des échecs, doublons, graphe (§8.4–8.6) | 🔴 | Absents. |

### Runtime multi-agent et événements (§12, §14, §15)

| Cible | État | Écart et action |
|---|---|---|
| Submit–Suspend–Resume | ✅ | Implémenté pour un type d'agent : claim/lease Postgres, `LISTEN/NOTIFY`, reprise de conversation via `thread_id`. **Le pattern est bon, il faut le généraliser.** |
| Service permanent d'écoute | ✅ | `run_desk_ai_worker.mjs` + services Windows. Verrou consultatif Postgres, heartbeats. |
| Conversations persistantes | ✅ | `desk_ai_conversation_sessions` (v2) : réutilisation **bornée** (même scope, `runtime_hash` identique, cutoff strictement monotone, `turn_count` plafonné). L'autorité ne transite jamais par la conversation. Exactement la discipline demandée en §14.4. |
| Agent entité de 1re classe | 🔴 | L'identité d'agent est `DESK_AI_WORKER_ID`, une variable d'environnement, utilisée seulement comme jeton de bail. Aucun budget, aucune permission, aucune priorité. |
| Orchestrateur central | 🔴 | Absent. Routage actuel : deux lanes fixes (live/replay). |
| Event Envelope | 🔴 | `correlation_id` et `causation_id` : **zéro occurrence dans tout le dépôt**. Forme la plus proche : `trade_events` / `broker_order_events` = `{event_id, aggregate_fk, event_type, occurred_at, payload}` — il manque précisément les deux champs de corrélation. |
| Event bus | 🟡 | Un seul canal `pg_notify` : `desk_ai_work_ready`, déclenché pour deux collections seulement. C'est un **signal de réveil**, pas un bus : pas de type, pas d'ordre, pas de persistance de la notification. Aucun Kafka/RabbitMQ/Redis-bus dans les dépendances. |
| Traçabilité causale | 🟡 | Existe, mais **par hash de contenu** (`envelope_hash`, `canonical_hash`, `runtime_hash`) et par tuple de scope, non par chaîne d'identifiants. |

### Exécution et risque (§19, §20, §21, §22)

| Cible | État | Écart et action |
|---|---|---|
| Risk Engine indépendant du LLM | ✅ | `evaluateBrokerPolicy` (`broker-execution.js:256-470`) : fonction **pure**, zéro I/O, ne lit aucun champ rédigé par le LLM. Ré-évaluée à **chaque** étape (évaluation, approbation, claim outbox, claim AddOn). |
| Règles de risque | 🟡 | Présentes : kill switch, verrous d'exécution, allowlist de comptes, sizing (`capital × risk% / (|entrée−stop| × point value)`, plafonné 0,01–0,25 %), 3 plafonds de quantité, RR ≥ 2, fraîcheur de décision, perte journalière. **Absentes** : max drawdown, règles prop firm, trailing drawdown, max trades/jour, exposition agrégée, budget de risque portefeuille. |
| `OrderIntent` | 🟡 | Existe (`createOrderIntent`, `broker-execution.js:472-531`). Présents : id, compte, quantité, type, bracket stop/TP, TIF, expiration, **clé d'idempotence**. **Manquants** : `signal_id`, `strategy_id`, groupe de comptes, provider préféré/de secours. |
| Interface fournisseur | 🔴 | **Aucune abstraction.** `integrations/` ne contient que `ninjatrader`. `'ninjatrader'` est littéral dans le SQL (`broker-execution-repository.js:218,221,317,476,921,926`) et dans une règle de risque (`broker-position-management.js:256`). |
| Opérations fournisseur | 🟡 | `submitOrder` ✅ (2 impl.) · `closePosition` ✅ · `replaceOrder` 🟡 (move_stop uniquement) · `modifyProtection` 🟡 (stop seul, jamais le TP) · `cancelOrder` ⚠️ **code mort** (la branche `CANCEL` existe mais n'est jamais appelée) · `getOrderStatus`/`getPositionStatus` 🔴 (push seul, pas de pull) · `healthCheck` ⚠️ **inversé** (le fournisseur pousse, le desk ne peut pas sonder) · `reconcile` 🟡 (côté desk seulement). |
| États d'exécution (§21.6) | 🟡 | **Huit enums disjoints** couvrent la plupart des états. **Mais** : une FSM canonique avec exactement le vocabulaire cible existe déjà — `packages/desk-domain/src/position-state-machine-v1.js:12-91`, incluant `PROTECTION_CONFIRMED`, `RECONCILIATION_RECOVERED`, et un garde `ENGINE_ONLY_EVENTS` qui interdit au LLM d'émettre ces transitions. **Elle n'est pas branchée sur le chemin broker.** |
| Multi-comptes | 🔴 | Aucun concept de groupe de comptes. |
| PickMyTrade | 🔴 | **Zéro occurrence dans le dépôt.** |

---

## 4. Risques opérationnels actuels

Ces points ne sont pas des écarts vers la cible : ce sont des faiblesses du
système **tel qu'il tournerait aujourd'hui si on le redémarrait**.

### 4.1 Protection après fill non vérifiée — critique

La section 21.7 en fait un non-négociable. Aujourd'hui, **rien ne vérifie
qu'un stop existe réellement chez le broker après un fill**.

`persistEntryFillAndTrade` (`broker-execution-repository.js:1010-1055`) écrit
`status = 'open'` **inconditionnellement** (vérifié ligne 1028), et stocke dans
`initial_stop_price`/`current_stop_price` les valeurs **voulues par le desk**
(`intent.bracket`), jamais des valeurs confirmées par le broker. Aucun
événement `PROTECTION_CONFIRMED`, aucun timer post-fill, aucune action
« fermer si non protégé ».

La protection est bien *créée* (template ATM côté NinjaTrader), mais sa présence
n'est jamais *attestée* côté desk. Le seul mécanisme qui la maintient
(`ResizeActiveProtection`, `DeskExecutionAddOn.cs:391-410`) vit **dans**
NinjaTrader, pas dans le desk.

### 4.2 La réconciliation ne tourne jamais

Les comparateurs existent (`compareSnapshots`, `broker-execution-service.js:882-901`)
et la divergence est fail-closed (compte en lecture seule + verrou).

Mais la réconciliation n'est déclenchée que par un POST manuel, ou par un
snapshot AddOn portant `reconcile: true` — **et l'AddOn code `Reconcile = false`
en dur** (`DeskExecutionAddOn.cs:176`, vérifié). Le seul worker planifié
(`run_broker_management_worker.mjs`) ne l'appelle jamais. **Il n'existe aucune
réconciliation périodique.**

### 4.3 Bug latent d'auto-verrouillage en multi-stratégies

`broker-execution-service.js:888-893` construit `deskPositions` comme une `Map`
**clé = instrument**. Avec deux trades ouverts sur MNQ, le constructeur `Map`
écrase silencieusement tout sauf le dernier, puis compare cette entrée unique à
la quantité **nettée** du broker → faux `POSITION_QUANTITY_MISMATCH` →
`lockOnDivergence` (défaut `true`) passe le compte en lecture seule.

**Le jour où une deuxième stratégie tourne, ce bug se déclenche.** À corriger
avant, pas après.

### 4.4 L'hypothèse mono-position est câblée à cinq endroits

`max_simultaneous_positions: 1` (`live-paper-execution.js:87-95`) ·
`NO_DUPLICATE_POSITION` bloque tout second trade même instrument/session sans
regarder `strategy_id` (`broker-execution.js:439-442`) · le gate AddOn exige le
broker **flat** avant toute entrée (`service:862-865`) · les marks de gestion
exigent une correspondance de quantité **exacte** (`service:826-833`) ·
`CLOSEPOSITION` est **instrument-wide** et fermerait les positions des autres
stratégies (`broker-position-management.js:333-337`).

### 4.5 La capture de données est à l'arrêt depuis le 1er août

Vérifié en base sur le VPS : dernière bougie **2026-07-31 20:59 UTC**.
L'ingestion s'est arrêtée au gel. Chaque jour écoulé est une séance non
capturée, et l'historique TradingView étant glissant, une partie deviendra
irrécupérable.

**C'est le seul risque de cet audit qui s'aggrave avec le temps**, et il ne
dépend d'aucun token LLM.

### 4.6 Reproductibilité incomplète sur macro et news

`macro_calendar` et `news_digest` sont **exclus du hachage d'intégrité des
packs** (`pack-integrity.js:431` ; `desk-replay-orchestration-algorithms.js:2340`).
Ces deux jeux ne sont donc pas couverts par la garantie de reproductibilité qui
protège les prix. Si la cible les traite en entrées de recherche de premier
rang, cette exemption doit tomber.

---

## 5. Réponses aux questions de la section 31

| Question | Réponse |
|---|---|
| Quelles données historiques ? | OHLCV uniquement. MNQ, MES, NQ, ES, DXY, VIX, US10Y, US02Y, GC, CL. Mégacaps et indices Asie/Europe **déclarés mais vides** (20 feeds, zéro bougie). |
| Quelle profondeur ? | **207 281 bougies**, du 2026-05-31 au 2026-07-31. **24 jours M1 distincts** sur MNQ/MES (62 064 lignes), la plupart complets à 1 380 barres/jour. |
| Quelle granularité ? | M1, M5, M15, H1, H4. `30` et `1D` déclarés, jamais peuplés. |
| Ticks disponibles ? | **Non.** Aucun tick, aucun bid/ask, aucun open interest, aucune profondeur. 100 % barres OHLCV. |
| Rollover ? | **Délégué à TradingView** (séries `1!`). Aucun code, aucune date de roll enregistrée. |
| Quelles features existent ? | VWAP (session, sans bandes), niveaux overnight/previous-NY/session, carte de niveaux par clustering, événements techniques, deltas cross-asset. **Absents** : POC/VAH/VAL, ATR réel, RSI, Initial Balance. Les indicateurs `rsi_14`/`atr_14` des bougies viennent de **Pine côté TradingView**. |
| Quelle base ? | PostgreSQL 16 **simple**, sans TimescaleDB. 21 migrations. Un table générique `desk_documents` (JSONB) porte ~132 collections logiques ; 5 seulement sont routées vers des tables relationnelles. |
| Firebase conservé ? | **Non — déjà migré**, juillet 2026. Question close. |
| Services réutilisables ? | API/MCP, feature service, moteur déterministe, `desk-domain`, `desk-contracts`, `desk-replay-engine`, `desk-time`, `desk-audit`, kit de déploiement Windows, 6 services conteneurisés en local. |
| Service Windows ? | WinSW → `run_desk_ai_worker.mjs`. Verrou consultatif Postgres, `LISTEN desk_ai_work_ready`, polling 15 s en repli, heartbeat en base. Modes `disabled`/`shadow`/`active` pilotés par `Set-DeskAiWorkerMode.ps1`. |
| Conversations persistées ? | `desk_ai_conversation_sessions` v2, réutilisation bornée par `runtime_hash` + cutoff monotone + plafond de tours. |
| Réveil des workers ? | `pg_notify('desk_ai_work_ready')` sur deux collections (`desk_live_run_cursor` en `DUE`/`RETRY`, `desk_agent_work_items` en `READY`). |
| Génération des claims ? | Deux lanes distinctes : `desk_live_run_cursor` (curseur avec bail) et `desk_agent_work_items` (file de work items). Compare-and-swap transactionnel + `lease_token`/`lease_expires_at_utc`. |
| Message bus existant ? | **Aucun.** Un canal `pg_notify`, utilisé comme signal de réveil. |
| Infra VPS ? | OVH, Windows Server 2025, **8 vCPU AMD EPYC-Milan, 23,4 Go RAM, ~200 Go disque** (80 Go utilisés). Charge actuelle : 4,9 % CPU, 14,7 Go RAM libre. NinjaTrader résident (~1 Go). |
| Combien de workers ? | **Décision opérateur — non déductible du code.** Contrainte : 8 vCPU. Recommandation de départ : 1 live + 1 replay + 2 à 4 backtest. |
| Charge cible ? | **Décision opérateur.** |
| Instrument MVP ? | MNQ ou MES — seuls instruments avec du M1 exploitable (~24 jours chacun). |
| Stratégie de référence ? | **Décision opérateur.** Le catalogue fournit déjà 8 patterns dont `BREAKOUT_RETEST` et `CONTINUATION`, alignés sur la §28.2. |
| Broker / prop ? | NinjaTrader, comptes `Sim*` uniquement — refus câblé des comptes non-Sim (`broker-execution.js:534,561`). |
| PickMyTrade ? | **Aucune information dans le dépôt.** Les 20 points de la §21.4 sont tous ouverts et relèvent d'une vérification externe auprès du fournisseur. |
| Idempotence bout en bout ? | **Déjà solide** : 5 couches (decision `materializationKey`, intent content-addressed, approbations, intents de gestion, dédup d'événements broker) + concurrence optimiste par `expected_trade_revision`. |
| Éviter le double envoi ? | Mécanique présente (clé d'idempotence + outbox lease). **Manque** : la logique de bascule fournisseur, puisqu'il n'y a qu'un fournisseur. |
| Réconcilier les positions ? | Comparateurs présents, fail-closed correct. **Mais jamais déclenchés** (§4.2). |
| Limites de risque dès le MVP ? | Déjà codées : sizing borné, plafonds de quantité, RR ≥ 2, fraîcheur, kill switch, verrous, perte journalière. **À ajouter** : max drawdown, trailing drawdown, max trades/jour, exposition agrégée. |

---

## 6. Trajectoire recommandée

La roadmap §29 est cohérente, mais son séquencement suppose un point de départ
plus bas que la réalité. Réordonnancement proposé, par dépendances réelles.

### Immédiat — sans LLM, sans attendre quoi que ce soit

**A. Relancer la capture de données.** Risque §4.5, seul risque qui s'aggrave.
Indépendant des tokens Codex. Inclut l'import des **33 103 lignes déjà
capturées** (18–24 juillet) qui dorment sur disque faute d'importeur.

**B. Corriger les trois défauts de sûreté d'exécution.** §4.1 (protection après
fill), §4.2 (réconciliation périodique), §4.3 (bug `Map` multi-positions). Le
travail est cadré : la FSM canonique avec `PROTECTION_CONFIRMED` existe déjà
(`position-state-machine-v1.js`), il s'agit de la brancher sur le chemin broker.

**C. Corriger `atr_14`.** Soit implémenter un vrai ATR, soit renommer la clé.
Aujourd'hui, une valeur trompeuse circule sous un nom normé.

### Phase 1 — Lever le verrou stratégie

Le pivot de la §2. Extraire la Strategy Specification du plan d'instance :
la rendre persistée, nommée, versionnée ; peupler enfin `strategy_catalog` /
`desk_strategy_versions` (le modèle de données existe, il est inerte) ;
remplacer le tuple figé `ACTIVE_STRATEGY_RUNTIME_VERSIONS` par un ensemble de
versions actives.

C'est le chantier le plus délicat du programme, parce qu'il touche précisément
le mécanisme qui garantit la sûreté actuelle. Il doit être fait avec les mêmes
gardes (hash, contrats, locks), pas contre elles.

### Phase 2 — Moteur de simulation Python

Greenfield, mais **pas depuis zéro** : la sémantique anti-look-ahead, le
rééchantillonnage cutoff-correct, la détection d'ambiguïté intrabar et le calcul
en R existent déjà en JavaScript et servent de spécification exécutable.

Ordre interne : Dataset Builder → Feature Engine (porter l'existant, ajouter les
manquants) → simulateur événementiel → Order Simulator (types d'ordres,
slippage, frais) → métriques.

### Phase 3 — Experiment Registry et Research Lab

Dépend des phases 1 et 2. `desk_replay_autopilot_configs` fournit le patron
(épinglage immuable, priorité, worker_group) ; il faut le généraliser au
multi-bras et lui attacher hypothèse, métriques et conclusion.

### Phase 4 — Runtime multi-agent

Généraliser le pattern submit-suspend-resume existant : agent en entité de 1re
classe (budget, permissions, priorité), enveloppe d'événement avec
`correlation_id`/`causation_id`, orchestrateur.

**Sur le bus de messages** : rester sur PostgreSQL tant qu'il n'a pas prouvé son
insuffisance. Avec 8 vCPU et une seule machine, ajouter Kafka ou RabbitMQ
apporterait de l'exploitation sans capacité. Une table de file dédiée +
`LISTEN/NOTIFY` couvre largement la charge du MVP. La décision se prendra sur
mesure, pas par anticipation.

### Phase 5 — Portfolio Arbitration, puis Execution Gateway et PickMyTrade

L'arbitrage n'a d'objet que lorsque plusieurs stratégies émettent. L'abstraction
fournisseur peut être préparée en parallèle (extraire une interface, sortir les
littéraux `'ninjatrader'` du SQL), mais PickMyTrade suppose d'abord de répondre
aux 20 questions de la §21.4 auprès du fournisseur.

---

## 7. Points où je recommande de dévier du plan

### 7.1 Ne pas réécrire le backend en Spring Boot (§25.1)

La section 25.1 confie à Spring Boot l'orchestration, l'API, les registres,
l'arbitrage, le Risk Engine et l'Execution Gateway. **Tout cela existe déjà en
Node**, à hauteur de ~63 500 lignes de backend couvertes par 101 fichiers de
tests, plus les packages `desk-domain`/`desk-contracts` avec contrats scellés
par hash et gates de non-régression en CI.

Réécrire reviendrait à jeter la couche déterministe, le système de contrats,
le moteur de prédicats, la couche d'exécution/risque et le kit de déploiement —
c'est-à-dire précisément les actifs qui rapprochent le plus le desk de la cible.
Le coût serait maximal et le gain nul : rien dans la cible n'exige la JVM.

**Recommandation** : garder Node pour le backend, l'orchestration et les
registres. Introduire Python **uniquement** pour le moteur de simulation et les
statistiques, là où l'écosystème (`numpy`/`pandas`/`scipy`) est réellement
décisif. C'est d'ailleurs ce que dit la §25.2.

### 7.2 Redimensionner l'ambition d'infrastructure

La cible §13.4 vise 1 → 5 → 20 → 100 workers, et la §25.3 empile Parquet +
PostgreSQL + TimescaleDB + object storage + Redis + event store. L'infra
actuelle est **une machine à 8 vCPU et 23 Go**.

Ce n'est pas un obstacle au MVP — 207 000 bougies tiennent largement, et 4 à 6
backtests parallèles sont atteignables. Mais la trajectoire 20–100 workers
suppose une décision d'infrastructure séparée (seconde machine, ou bascule
conteneurs/cloud). À traiter comme une décision explicite, datée, pas comme une
propriété émergente de l'architecture.

### 7.3 Traiter la profondeur de données comme le vrai facteur limitant

24 jours de M1 suffisent pour bâtir le moteur, poser les baselines et valider la
mécanique. Ils **ne suffisent pas** pour la robustesse exigée en §5.5 et §10.3 :
walk-forward, multi-régimes, out-of-sample. Aucune quantité de code ne compense
un historique court.

Deux conséquences : relancer la capture **maintenant** (§4.5), et traiter
l'acquisition d'un historique profond — y compris l'option d'un fournisseur
tiers pour les ticks, sans lesquels ni POC/VAH/VAL ni la résolution fine de
l'ambiguïté intrabar ne sont possibles — comme un chantier à part entière de la
Phase 3 Data Foundation.

---

## 8. Synthèse

Le desk est **plus avancé vers la cible que le plan directeur ne le suppose**,
mais avancé sur un axe différent de celui attendu : la rigueur déterministe,
contractuelle et auditable est là ; c'est la **pluralité** qui manque —
plusieurs stratégies, plusieurs agents, plusieurs expériences, plusieurs
fournisseurs.

Tout le système est construit autour de l'hypothèse « une thèse, une stratégie,
une position, un fournisseur ». Chaque brique de la cible qui suppose le
pluriel bute sur cette hypothèse.

Le programme se résume donc à trois mouvements, dans cet ordre :

1. **Sécuriser et alimenter** — protection après fill, réconciliation, capture
   de données. Sans LLM, immédiatement.
2. **Passer du singulier au pluriel** — Strategy Spec persistée et versionnée.
   C'est le pivot ; tout le reste en dépend.
3. **Construire ce qui manque vraiment** — moteur de simulation Python,
   Experiment Registry, arbitrage de portefeuille, abstraction fournisseur.

La bonne nouvelle pour le calendrier : les mouvements 1 et 2, et la majeure
partie du 3, **ne consomment aucun token LLM**. Le manque de crédits Codex ne
bloque pas la convergence — il bloque seulement le Research Lab, qui arrive de
toute façon en dernier.
