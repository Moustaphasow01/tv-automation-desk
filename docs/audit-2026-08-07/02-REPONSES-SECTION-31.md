# Réponses aux questions préalables (§31 du plan directeur)

Chaque réponse est vérifiée indépendamment (pas simplement recopiée de l'audit
du 07:51, même quand elle converge avec lui — voir méthode dans
`00-INDEX-ET-METHODE.md`). Statut entre crochets.

**Quelles données historiques sont disponibles ?**
OHLCV uniquement, aucun tick, aucun bid/ask, aucun open interest. Instruments
avec données réelles : MNQ, MES, NQ, ES, DXY, VIX, US10Y, US02Y, GC, CL.
Mégacaps et indices Asie/Europe sont **déclarés dans le schéma mais vides**
(20 feeds, zéro bougie). **CONFIRMÉ** (audit du 07:51, base interrogée
directement sur le VPS ; cohérent avec `002_market_import_schema.sql` qui ne
contraint aucune instrument list en dur).

**Quelle profondeur d'historique existe ?**
207 281 bougies, du 2026-05-31 au 2026-07-31. 24 jours M1 distincts sur
MNQ/MES (62 064 lignes), la plupart complets à 1 380 barres/jour. **CONFIRMÉ**
(interrogation VPS, audit 07:51) — c'est le facteur limitant réel pour toute
robustesse statistique (walk-forward, out-of-sample), pas la mécanique du
moteur.

**Quelle granularité existe ?**
M1, M5, M15, H1, H4 peuplés. `30` et `1D` déclarés dans le schéma mais jamais
peuplés. **CONFIRMÉ**.

**Les ticks sont-ils disponibles ?**
Non. 100 % barres OHLCV. Sans ticks, ni POC/VAH/VAL ni la résolution fine de
l'ambiguïté intrabar (deux niveaux touchés dans la même bougie) ne sont
possibles avec la précision visée par le plan directeur. **CONFIRMÉ** —
`poc_vah_val: {}` est explicitement codé en dur à vide
(`mcp_gpt_desk/src/desk-market-feature-algorithms.js:394`), et
`market_candles` ne stocke qu'un volume scalaire par barre, sans répartition
par niveau de prix.

**Comment les rollovers sont-ils gérés ?**
Entièrement délégués aux séries continues `1!` de TradingView. Aucune date de
roll n'est enregistrée côté desk — **irrécupérable** pour les lignes déjà
importées. **CONFIRMÉ**, zéro code trouvé sur ce point par deux agents
indépendants.

**Quelles features existent déjà ?**
Réutilisables : VWAP (session, sans bandes), niveaux overnight/previous-NY/
session, carte de niveaux par clustering de pivots, classification
d'événements techniques, deltas cross-asset. Absents : POC/VAH/VAL réel, ATR
réel (`atr_14` calcule en fait `moyenne(high−low)`, sans true range ni
lissage de Wilder — `desk-market-feature-algorithms.js:780-783` — un nom
trompeur, pas juste un manque), RSI côté backend (le `rsi_14` des bougies
vient de Pine côté TradingView, pas d'un calcul backend), Initial Balance,
bandes VWAP. **CONFIRMÉ**.

**Quelle base est actuellement utilisée ?**
PostgreSQL 16 simple, sans TimescaleDB, 21 migrations. Un store JSONB
générique (`desk_documents`) porte la majorité des collections applicatives ;
5 domaines seulement sont routés vers des tables relationnelles dédiées
(marché, exécution broker, news, Telegram, packs). **CONFIRMÉ**, voir
inventaire complet dans `01-CARTOGRAPHIE-ET-FLUX.md` §7.

**Firebase doit-il être conservé ?**
Non — déjà retiré du runtime applicatif. Question close, mais avec une nuance
vérifiée indépendamment : un test de régression dédié
(`mcp_gpt_desk/test/document_collections.test.js:25-32`) échoue explicitement
le build si du code Firebase/Firestore est réintroduit dans `store.js`. Les
seules occurrences restantes sont des scripts de migration archivés
(`scripts/db/archive/`), un flag de configuration
(`config/autopilot-v4-scope.json:7`, `"firestore_allowed": false`) et des
champs de provenance historique. **CONFIRMÉ** par grep exhaustif et lecture
du test de garde.

**Quels services sont réutilisables ?**
API/MCP (`mcp_gpt_desk/src/server.js`), le moteur déterministe complet
(`packages/desk-domain`), le système de contrats (`packages/desk-contracts`),
le moteur d'issue de replay (`packages/desk-replay-engine`), l'horloge
injectable (`packages/desk-time`), la garde anti-look-ahead
(`packages/desk-audit`), le kit de déploiement Windows (WinSW + PowerShell),
6 services conteneurisés en local (`docker-compose.yml`). **CONFIRMÉ**, voir
inventaire complet §1 et §6 de `01-CARTOGRAPHIE-ET-FLUX.md`.

**Comment fonctionne exactement le service Windows actuel ?**
Neuf services WinSW distincts, dont trois workers IA (`DeskFuturesCodexLive01/02`,
`DeskFuturesCodexReplay01`) qui exécutent chacun `run_desk_ai_worker.mjs` en
boucle. Détail complet, y compris la distinction précise entre le processus
worker (permanent) et l'appel LLM (nouveau processus par appel), dans
`01-CARTOGRAPHIE-ET-FLUX.md` §3. **CONFIRMÉ**, triangulé par deux agents
indépendants + lecture directe.

**Comment les conversations sont-elles persistées ?**
Les métadonnées de continuité (`thread_id`, `runtime_hash`, `turn_count`
plafonné à 12, cutoff monotone) sont persistées dans
`desk_ai_conversation_sessions` (v2) côté Postgres. Le **contenu** de la
conversation reste géré par le CLI Codex lui-même (`codex exec resume
<thread_id>`) — ce dépôt ne stocke jamais les messages. **CONFIRMÉ**.

**Comment les workers sont-ils réveillés ?**
`pg_notify('desk_ai_work_ready')` sur deux collections
(`desk_live_run_cursor` en `DUE`/`RETRY`, `desk_agent_work_items` en `READY`),
avec repli par polling (défaut 15 s) en cas de notification manquée.
**CONFIRMÉ**.

**Comment les claims sont-ils générés ?**
Deux mécanismes distincts et non unifiés : (1) un store JSONB générique avec
verrous advisory transactionnels pour les workers IA/live/replay, (2) une file
relationnelle dédiée avec bail (`lease_token`/`lease_expires_at`) et un enum
d'état réel pour l'exécution broker uniquement. **CONFIRMÉ**, détail dans
`01-CARTOGRAPHIE-ET-FLUX.md` §3.2.

**Quel message bus existe déjà ?**
Aucun produit de message-queue dédié. Un seul canal `pg_notify`, utilisé comme
signal de réveil, pas comme bus typé/ordonné/persistant. **CONFIRMÉ** par
grep exhaustif des dépendances (`package.json` de `mcp_gpt_desk` : aucune
dépendance Kafka/RabbitMQ/Redis).

**Quelle infrastructure VPS est disponible ?**
OVH, Windows Server 2025, 8 vCPU AMD EPYC-Milan, 23,4 Go RAM, ~200 Go disque
(80 Go utilisés). Charge observée au moment de l'audit du 07:51 : 4,9 % CPU,
14,7 Go RAM libre. NinjaTrader résident (~1 Go). **CONFIRMÉ** (audit du
07:51, inspection directe VPS) — cohérent avec l'installation Windows Service
+ NinjaTrader Desktop confirmée par cette session.

**Combien de workers doivent tourner initialement ?**
**Décision opérateur — non déductible du code.** Contrainte matérielle réelle :
8 vCPU sur une seule machine. Recommandation de départ raisonnable au vu de la
charge actuelle quasi nulle : 1 live + 1 replay + 2 à 4 backtest en parallèle.

**Quelle charge cible à moyen terme ?**
**Décision opérateur.**

**Quel instrument pour le MVP ?**
MNQ ou MES — les deux seuls instruments avec du M1 réellement exploitable
(~24 jours chacun). Décision finale : **opérateur**.

**Quelle stratégie de référence ?**
**Décision opérateur.** Le catalogue de conditions fournit déjà 8
`setup_patterns` prédéfinis dont `BREAKOUT_RETEST` et `CONTINUATION`, alignés
sur la famille recommandée §28.2 du plan directeur —
`packages/desk-contracts/catalogs/condition-catalog-v1-2.json`.

**Quel broker ou prop provider ?**
NinjaTrader, comptes `Sim*` exclusivement — refus câblé en dur des comptes
non-simulés (`packages/desk-domain/src/broker-execution.js:534,561`).
**CONFIRMÉ**, triangulé.

**Quelle compatibilité exacte avec PickMyTrade ?**
**Aucune information dans le dépôt.** Zéro occurrence de code, zéro
configuration, zéro test. Les 20 points de vérification du §21.4 du plan
directeur relèvent tous d'une vérification externe directement auprès du
fournisseur — rien dans ce dépôt ne peut y répondre. **ABSENT**, confirmé par
grep exhaustif (deux agents indépendants, zéro résultat en dehors de la prose
des documents de conception).

**Le backend-to-backend PickMyTrade est-il officiellement supporté ?**
**Hors périmètre du dépôt** — question à poser directement au fournisseur.

**Comment obtenir un statut broker fiable ?**
Aujourd'hui, seulement en mode push : l'AddOn NinjaTrader envoie ses propres
snapshots (heartbeat 5 s, snapshot 15 s) ; il n'existe **aucun mécanisme de
pull** où le desk interroge activement l'état du broker
(`getOrderStatus`/`getPositionStatus` marqués **ABSENT** en pull par l'audit
du 07:51, confirmé). Le `healthCheck` est en fait inversé : c'est le
fournisseur qui pousse, le desk ne peut pas sonder.

**Comment gérer les sessions Rithmic ?**
**Hors périmètre du dépôt actuel** — NinjaTrader/Sim101 n'implique aucune
gestion de session Rithmic aujourd'hui ; cette question ne se pose que si
PickMyTrade (qui route via Rithmic/Tradovate) est effectivement adopté.

**Comment garantir l'idempotence de bout en bout ?**
**Déjà largement acquis, à préserver.** Cinq couches indépendantes trouvées :
clé de matérialisation de décision (`materializationKey`, hash sha256), intent
d'ordre content-addressed (clé d'idempotence dans `createOrderIntent`),
approbations idempotentes, intents de gestion idempotents, déduplication des
événements broker — plus une concurrence optimiste par
`expected_trade_revision`. **CONFIRMÉ**, triangulé par deux agents.

**Comment éviter le double envoi lors d'un fallback ?**
La mécanique de base (clé d'idempotence + bail d'outbox) existe et fonctionne
pour un fournisseur unique. **Ce qui manque explicitement** : toute la logique
de bascule entre fournisseurs, puisqu'il n'en existe qu'un aujourd'hui
(NinjaTrader) — la question ne devient concrète qu'une fois une deuxième
interface fournisseur introduite.

**Comment réconcilier les positions ?**
Les comparateurs existent et sont corrects et fail-closed en cas de
divergence (verrouillage du compte en lecture seule). **Mais ils ne sont
jamais déclenchés automatiquement** — seulement par un appel manuel, ou par un
flag que l'AddOn actuel code en dur à `false`. C'est un vrai risque
opérationnel présent, indépendant de toute évolution future. **CONFIRMÉ**,
triangulé par deux agents indépendants sur des fichiers différents
(`broker-execution-service.js` et `DeskExecutionAddOn.cs`).

**Quelles limites de risque doivent être codées dès le MVP ?**
Déjà codées et actives : sizing borné (0,01–0,25 % de l'équité nette),
plafonds de quantité, RR minimum 2, fraîcheur de décision (âge maximum de la
décision avant rejet), kill switch, verrous d'exécution, perte journalière.
**Manquantes**, à ajouter avant toute montée en charge multi-stratégies : max
drawdown, trailing drawdown, max trades/jour, exposition agrégée
inter-stratégies, budget de risque portefeuille. **CONFIRMÉ** pour les deux
listes.

## Une question supplémentaire posée par cette session, absente de la liste originale

**Quel est le mécanisme réel d'authentification du CLI Codex, et qu'est-ce qui
a concrètement manqué quand l'opérateur a signalé « plus de token Codex » ?**
**INCERTAIN.** Le code supporte les deux mécanismes (`CODEX_API_KEY` explicite
**ou** session de connexion CLI persistée sous `CODEX_HOME`,
`codex-exec-adapter.js:69,462`) sans qu'on puisse déterminer depuis le dépôt
seul lequel est effectivement configuré sur le VPS. C'est une question
opérationnelle, pas une question de code — mais elle conditionne directement
le chantier « réduction de la consommation de tokens » (§24 du plan
directeur) : si l'authentification est liée à un abonnement à usage plafonné
plutôt qu'à une clé API mesurée à l'usage, l'économie de tokens a un plafond
dur différent d'une économie de coût variable. À clarifier avec l'opérateur
avant de dimensionner le Research Lab.
