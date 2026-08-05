# Architecture de la préproduction locale

## Périmètre

Cette préproduction est indépendante du projet source et n'utilise aucun service Google. Elle contient uniquement le frontend actuel, l'API/MCP Node.js, les contrats métier atteints et l'infrastructure Docker locale.

Le frontend n'a plus de chemin mock de production : toutes les vues utilisent l'API locale. Le runtime API sélectionne uniquement PostgreSQL et exige une `DATABASE_URL` explicite.

```text
Navigateur :8080
  -> Nginx
     -> fichiers React statiques
     -> /api et /mcp vers api:8787

TradingView
  -> POST /api/v1/webhooks/tradingview
     -> validation du secret et des bougies
     -> écritures transactionnelles PostgreSQL

API/MCP
  -> PersistentDeskStore
     -> façade MCP, coordination de persistance et transactions transverses
     -> desk-state-algorithms.js : états Live/Front, sélections et façade de travail unifiée
     -> desk-live-bundle-algorithms.js : bundles Master/Monitor et jobs de préparation
     -> desk-document-algorithms.js : timestamps, normalisations et filtres documentaires
     -> DeskContractService
        -> contrats embarqués ou persistance documentaire
     -> DeskPackService
        -> packs, datasets, intégrité, macro et news
     -> LocalPackBuilder
        -> requêtes sur market_candles PostgreSQL
        -> objets immuables locaux et manifestes scellés
     -> DeskMarketFeatureService
        -> fenêtres brutes, snapshots de session, niveaux et événements techniques
        -> statuts de conditions et préparation marché V4
        -> lecture des bougies et préparation marché des setups Replay
        -> algorithmes purs dans desk-market-feature-algorithms.js
     -> DeskStrategyAuditService
        -> calendrier, détail journalier et timeline Live
        -> performance et événements opérateur audités
        -> état d'audit des contrats, données, features et erreurs backend
        -> algorithmes purs dans desk-strategy-audit-algorithms.js
     -> DeskReplayService
        -> file Replay, claims, leases, récupération et autopilot
        -> création des runs, transitions Master/Monitor et horloge Replay
        -> mutations révisionnées, idempotence et matérialisation des sorties GPT
        -> constructeurs, transitions et projections dans desk-replay-orchestration-algorithms.js
     -> DeskLiveService
        -> curseurs Live, claims, heartbeat, clôture et réconciliation
     -> DeskFrontService
        -> projections, commandes opérateur, macro et snapshot marché
     -> PostgresDeskPersistence
        -> desk_documents (JSONB)
        -> tables marché normalisées
        -> desk_pack_objects (catalogue immuable)
```

## Services Docker

- `postgres` : PostgreSQL 16, volume `postgres_data` ;
- `api` : BFF, MCP, OAuth MCP et webhook TradingView ;
- `frontend` : build React servi par Nginx ;
- `broker-management` : worker déterministe de gestion/réconciliation, désarmé par défaut ;
- `.local/desk_objects` : bind mount local réservé aux objets immuables des packs.

## Frontend React

Le frontend est une application React unique. Ses routes Desk, Replay Lab et
Operations sont rattachées à `src/App.tsx` et utilisent toutes l'API locale.

La session affichée est choisie automatiquement selon l'heure de Paris : Asia avant 08:00, London de 08:00 à 15:30, puis New York. Le bandeau latéral montre les trois phases mais n'est plus un sélecteur manuel. Les pages métier lisent l'agrégat de session puis rafraîchissent séparément les ressources marché, position, macro, news, activité, alertes et audit.

Le runtime de production ne contient aucune donnée factice. Les scénarios Playwright interceptent `/api/v1` avec une fixture isolée dans `e2e/mockDeskApi.ts`, bloquent le service worker pendant le test et utilisent une clé opérateur dédiée au seul build E2E. Cette mécanique ne fait partie ni du bundle de production ni de l'image Docker PREPROD et n'écrit jamais dans PostgreSQL.

## Persistance

La table `desk_documents` conserve les agrégats métier V4 : clé primaire
`(collection, document_id)` et contenu JSONB indexé. Les flux de marché sont
normalisés dans `market_feeds`, `market_candles`, `market_feed_status` et
`tradingview_events`. Les objets de packs restent des fichiers immuables et
leur identité physique est enregistrée dans `desk_pack_objects`.

Les opérations sensibles — claims, leases, révisions, idempotence et mutations de projection — utilisent des transactions PostgreSQL avec verrou consultatif par ressource.

Le runtime et les tests exercent désormais la même classe `PersistentDeskStore`. En test, un port `InMemoryDeskPersistence` remplace PostgreSQL sans modifier la logique métier : il charge au besoin les fixtures historiques en lecture, mais toutes les écritures restent en mémoire. `LocalDeskStore` et son chemin d'exécution fichier ont été supprimés.

`DeskContractService` possède les contrats. `DeskPackService` résout et valide
les packs. `LocalPackBuilder` fabrique les packs LIVE/replay depuis PostgreSQL.
`DeskReplayService` possède la file, les leases et la séquence Master/Monitor.
`DeskLiveService` utilise la même préparation V4 avec un curseur temps réel.
Le LIVE suit la cadence M15 de Replay V4. Les triggers de marché sont soumis à
une fraîcheur SQL stricte et le moteur shadow suit les setups/positions paper
sur les bougies closes M5 entre deux Monitors. Le chemin broker déterministe
est présent derrière des risk gates, approvals, outbox, réconciliation et kill
switch. Il reste fail-closed, limité à Sim101 et désarmé par défaut. Le runbook détaillé est dans
`docs/AUTOPILOT_V4_LIVE_PREPROD_READINESS_2026-07-20.md`.
Le profil MCP `autopilot_v4` n'expose que ces capacités. Les agrégats importés
de PROD portent `operational_visibility=history` : ils restent consultables,
mais ne participent ni aux claims ni aux alertes PREPROD.

Le champ historique `gcs_generation` reste présent dans le contrat des
manifestes pour compatibilité. Pour un objet local, sa valeur désigne la
génération immuable cataloguée ; aucune requête Google n'est faite au runtime.

## Sécurité locale

- l'API écoute uniquement sur `127.0.0.1` ;
- PostgreSQL écoute uniquement sur `127.0.0.1` ;
- la clé opérateur et le secret TradingView sont distincts ;
- aucun fichier `.env` ou credential du projet source n'a été copié ;
- les secrets fournis dans les payloads TradingView sont retirés avant persistance.

Le frontend de production n'embarque plus de clé opérateur. Il utilise une
session serveur signée obtenue avec le PIN opérateur. Le mode public et TLS ne
sont pas activés dans Docker local, mais leur configuration fail-closed est
prête sous `deploy/` pour le VPS Windows.

## Cible VPS Windows

Le runtime distant n'utilisera pas Docker : Caddy, Node.js, PostgreSQL 16 et les
workers tourneront comme services natifs Windows. NinjaTrader et son AddOn
tourneront sur la même machine dans une session interactive persistante. Voir
`docs/VPS_WINDOWS_READINESS_2026-07-23.md`.
