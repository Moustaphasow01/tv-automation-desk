# Import SQL des données de juin et des replays Autopilot V4

Date d'exécution : 2026-07-20  
Environnement cible : PREPROD local PostgreSQL  
Projet source : `tv-automation-23d50`

## Périmètre

L'import des résultats replay est volontairement limité aux deux runs V4 terminés :

- `replay_2026_06_01_asia_open_15m_autopilot_v2`
- `replay_2026_06_02_asia_open_15m_autopilot_v2`

Le run `replay_2026_06_03_asia_open_15m_autopilot_v2` n'est pas importé comme résultat de recherche : sa source est incomplète et reste en attente de Master. Une ancienne copie partielle déjà présente dans PREPROD est conservée en lecture seule, classée `excluded_incomplete`, avec configuration désactivée et work item annulé.

## Sauvegardes préalables

- PostgreSQL : `/tmp/tv_automation_preprod_before_v4_june_import_20260720T170033Z.dump`
  - SHA-256 : `498a8bdefa1c6e0e65e4759731dadae9ca9ad5ba1a6652657452432b4051578e`
- Objets locaux : `/tmp/tv_automation_preprod_objects_before_v4_june_import_20260720T170033Z.tar.gz`
  - SHA-256 : `5f9122c345492f119f98b68695a03f8df9269c46a6647e8ffbd7cd2bffd9cc6e`

## Données de marché injectées dans le schéma SQL spécialisé

Le backfill Firestore a alimenté les tables relationnelles existantes, sans DDL ni collection générique pour les bougies :

- `market_feeds`
- `market_feed_status`
- `market_candles`
- référentiels `market_symbols`, `market_instruments` et `market_timeframes`

Résultat :

- 77 412 bougies sur la fenêtre `2026-05-31T22:00:00Z` à `2026-06-30T21:55:00Z`
- 50 documents de feed
- 48 feeds contenant des bougies de juin
- 20 symboles
- 4 temporalités : M5, M15, H1 et H4
- 0 erreur
- 0 document en quarantaine

Les séries cœur V4 MNQ, MES, NQ et ES sont présentes en M5, M15, H1 et H4. Le calendrier macro local contient 802 documents de juin.

Rapport machine : `docs/FIRESTORE_TO_POSTGRES_IMPORT_MARKET_JUNE_2026-07-20.json`

## Résultats V4 importés

L'import transactionnel utilise `scripts/db/archive/import_v4_replay_history_20260720.py`. Il valide avant écriture :

- statut terminal `COMPLETED`
- cadence `15m`
- schéma replay `2.0.0`
- Master `DeskMasterAnalysisContract_v4_0_0`, schéma `4.0.0`
- anti-lookahead de chaque simulation
- absence de prix futur
- borne maximale des prix inférieure ou égale au cutoff

Chaque document importé est marqué :

- `strategy_version = autopilot_v4`
- `autopilot_version = 4.0.0`
- `data_origin = prod_v4_import`
- `operational_visibility = history`
- `research_visibility = replay_lab`
- `read_only = true`
- `v4_history_eligible = true`

### 1er juin

- 104 steps
- 104 bundles
- 16 Masters ou replans
- 88 Monitors
- 16 snapshots de thèse
- 33 setups
- 12 positions, toutes fermées
- 88 simulations
- 104 transmissions de contexte
- 473 événements de timeline
- 104 work items
- 332 work events

### 2 juin

- 123 steps
- 123 bundles
- 35 Masters ou replans
- 88 Monitors
- 35 snapshots de thèse
- 107 setups
- 14 positions, toutes fermées
- 88 simulations
- 122 transmissions de contexte
- 511 événements de timeline
- 123 work items
- 427 work events

Audit anti-lookahead : 176 simulations conformes sur 176.

Rapports machine :

- `docs/AUTOPILOT_V4_REPLAY_HISTORY_DRY_RUN_2026-07-20.json`
- `docs/AUTOPILOT_V4_REPLAY_HISTORY_IMPORT_2026-07-20.json`

## Packs immuables

Les deux builds sources ont été copiés dans le stockage objet local et enregistrés comme `GCS_MIRROR` :

- 1er juin : `packbuild__2026-06-01_asia_open_replay_source__665d45ec-d8d6-428e-ae05-b615f5c19759`
  - 20 objets sur 20 `READY`
  - 20 objets sur 20 vérifiés
- 2 juin : `packbuild__2026-06-02_asia_open_replay_source__25935d24-0226-4563-8947-75c0e51c8c29`
  - 20 objets sur 20 `READY`
  - 20 objets sur 20 vérifiés

Les packs contiennent notamment les fenêtres de prix, le calendrier macro, les mégacaps et le `news_digest` exacts utilisés par les replays.

## Projection front

Replay Lab, Historique, Performance et Stratégies exposent désormais uniquement :

- les runs opérationnels Autopilot V4 ;
- les imports de recherche explicitement marqués V4 et `research_visibility = replay_lab`.

Les analyses, statistiques et backtests legacy restent conservés en base, mais ne sont plus agrégés ni affichés par ces vues.

Réponse réelle de l'API après reconstruction :

- 2 replays terminés
- 2 jours actifs
- 227 processus GPT
- 26 positions fermées
- 16 positions avec géométrie de sortie exploitable
- 10 positions fermées sans prix de sortie exploitable, exclues du calcul R
- résultat net : `+9.901 R`
  - 1er juin : `+5.7225 R`
  - 2 juin : `+4.1785 R`
- 5 gains, 3 pertes, 8 flats parmi les 16 positions valorisables
- profit factor : `4.3003`
- drawdown maximal : `-2 R`

Aucun résultat n'a été inventé pour les 10 positions sans `exit_price`.

## Limites de la source

- Firestore ne fournit pas de M1 de juin pour MNQ et MES dans les deux feeds M1 attendus.
- Il n'existe pas encore de provider/table locale autonome de news ; le front conserve son fallback calendrier macro, tandis que les packs replay immuables contiennent leur `news_digest`.
- Certains symboles optionnels ne sont pas présents dans la source Firestore et n'ont pas été fabriqués.
- GC M5 commence le 3 juin et VIX M5 le 2 juin selon la couverture source disponible.

## Validation

- MCP : 265 tests sur 265
- projection Front Operations ciblée : 16 tests sur 16
- React : 16 tests sur 16
- domaine : 66 tests sur 66
- moteur replay : 9 tests sur 9
- Playwright sur pile PostgreSQL/API/front réelle : 4 scénarios sur 4
- typecheck : réussi
- build production : réussi

