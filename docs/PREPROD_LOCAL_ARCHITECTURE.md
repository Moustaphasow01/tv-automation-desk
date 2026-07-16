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
     -> DeskContractService
        -> contrats embarqués ou persistance documentaire
     -> DeskPackService
        -> packs, datasets, intégrité, macro et news
     -> DeskReplayService
        -> file Replay, claims, leases, récupération et autopilot
        -> création des runs, transitions Master/Monitor et horloge Replay
        -> mutations révisionnées, idempotence et matérialisation des sorties GPT
     -> DeskLiveService
        -> curseurs Live, claims, heartbeat, clôture et réconciliation
     -> DeskFrontService
        -> projections, commandes opérateur, macro et snapshot marché
     -> PostgresDeskPersistence
        -> desk_documents (JSONB)
```

## Services Docker

- `postgres` : PostgreSQL 16, volume `postgres_data` ;
- `api` : BFF, MCP, OAuth MCP et webhook TradingView ;
- `frontend` : build React servi par Nginx ;
- `desk_objects` : volume réservé aux objets locaux des packs.

## Persistance

La table `desk_documents` conserve le modèle documentaire du Desk pendant la transition : clé primaire `(collection, document_id)` et contenu JSONB indexé. Cette forme évite de réécrire simultanément toute la logique métier, tout en supprimant la dépendance à Firestore.

Les opérations sensibles — claims, leases, révisions, idempotence et mutations de projection — utilisent des transactions PostgreSQL avec verrou consultatif par ressource.

Le runtime et les tests exercent désormais la même classe `PersistentDeskStore`. En test, un port `InMemoryDeskPersistence` remplace PostgreSQL sans modifier la logique métier : il charge au besoin les fixtures historiques en lecture, mais toutes les écritures restent en mémoire. L'ancien `LocalDeskStore` et son chemin d'exécution fichier ont été supprimés.

La modularisation du store est progressive. `DeskContractService` possède le chargement des contrats embarqués, leur versionnement, leur activation, leur archivage et leur audit. `DeskPackService` possède la résolution des packs logiques et immuables, la lecture des datasets, les contrôles d'intégrité, les niveaux de marché ainsi que les datasets macro et news. `DeskReplayService` possède la file de travail Replay, les leases, l'autopilot et toute la séquence d'orchestration Master/Monitor, y compris les mutations révisionnées et idempotentes. Les algorithmes purs de construction des bundles lui sont fournis par un port explicite pendant la modularisation. `DeskLiveService` possède le cycle de vie transactionnel des curseurs Live. `DeskFrontService` possède les projections courantes, les mutations opérateur et les lectures marché destinées au frontend. `PersistentDeskStore` reste la façade compatible avec les outils MCP et coordonne les workflows qui traversent plusieurs domaines.

## Sécurité locale

- l'API écoute uniquement sur `127.0.0.1` ;
- PostgreSQL écoute uniquement sur `127.0.0.1` ;
- la clé opérateur et le secret TradingView sont distincts ;
- aucun fichier `.env` ou credential du projet source n'a été copié ;
- les secrets fournis dans les payloads TradingView sont retirés avant persistance.

Pour une future préproduction accessible sur le réseau, il faudra remplacer la clé compilée dans le frontend par une authentification serveur et ajouter TLS.
