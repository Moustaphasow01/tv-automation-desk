# Catalogue canonique des bounded contexts du Trading Desk

| Module | Responsabilité propriétaire | Données principales |
|---|---|---|
| `platform` | temps, identités techniques, idempotence, feature flags et primitives d'exécution | runtime settings, flags, receipts |
| `market-data` | sources, ingestion, normalisation, datasets, qualité et provenance | candles, feeds, datasets, ingestion batches |
| `features` | définitions/version/calcul point-in-time des features | feature definitions, feature values |
| `strategy` | Strategy Definition, Version, Instance, DSL et compilation | definitions, versions, instances, artifacts |
| `simulation` | runs déterministes, order simulator, métriques et robustesse | runs, simulated orders/trades, metrics |
| `research` | hypothèses, expériences, candidates, connaissance positive/négative | missions research, experiments, knowledge edges |
| `agents` | agents, missions, conversations, tasks, leases, prompts, model policies et AI Context Advisory consultatifs | agent tasks, prompt registry, inference telemetry, ai context advisories |
| `live-runtime` | scheduling live, état des instances et production de signaux | runtime checkpoints, signals |
| `portfolio-risk` | allocations, arbitrage, budgets, corrélations, netting et target positions | allocations, risk decisions, target positions |
| `execution` | OrderIntent, port provider-neutral, providers, broker states, fills, protections et réconciliation | accounts, provider commands/events, orders, fills, trades, reconciliation |
| `operations` | incidents, alertes, runbooks, déploiements, santé et commandes opérateur | incidents, alerts, deployments, health snapshots |
| `audit` | journal immuable et traçabilité causale | audit entries, event lineage |
| `reporting` | projections BFF et read models front, sans propriété transactionnelle | materialized views, front projections |
| `front-control-plane` | application VNext opérateur, composition UI, routing, état client et commandes idempotentes vers le BFF | UI state, query cache, view envelopes, command UI receipts |

## Règles

- Un module possède ses invariants et tables ; `reporting` ne devient jamais propriétaire des transactions.
- `features` consomme les datasets publics de `market-data`, sans accéder à son adapter d'ingestion.
- `simulation` et `live-runtime` consomment le même API public `strategy` et les mêmes features.
- `research` demande des runs à `simulation`; il ne simule pas lui-même.
- `agents` orchestre les réflexions mais ne produit jamais directement un OrderIntent ; ses AI Context Advisory restent des effets `READ_ONLY_ADVISORY`.
- `portfolio-risk` est le seul propriétaire de l'autorisation globale et du netting.
- `execution` ne décide pas l'opportunité ; il transforme un OrderIntent autorisé en commande provider-neutral, délègue aux adapters et réconcilie le broker.
- `reporting` construit les vues front depuis les API/événements approuvés.
- `reporting` expose aussi le cockpit `AI Context` : lecture opérateur des advisories, fallbacks et métriques agent-runtime, sans écriture métier.
- `reporting` publie le catalogue `Front API v2` : classification métier des routes OpenAPI, politique de compatibilité et point d'appui du futur front V3.
- `reporting` porte le manifeste de coexistence Front V3 : flags par espace, chemins de rollback et mapping global/zoom/détail, sans règle de trading.
- `front-control-plane` consomme exclusivement `/front-api/v1`, ne lit aucune base/MCP/broker directement et ne recalcule jamais risque, exposition, sizing ou PnL officiel.
- `front-control-plane` reste isolé du frontend legacy jusqu'au cutover ; tout import croisé est interdit par guard.
- Les adapters NinjaTrader, PickMyTrade, Codex, TradingView, Telegram et stockage restent hors domaine.
- `market-data` possède `desk-market-data`, projection éphémère des observations crypto publiques (ADR-0039). `reporting` la publie en lecture seule ; aucun consommateur de risque, stratégie ou exécution n'est raccordé à ce flux externe.
- `market-data` porte la continuité grains `M1_M5_STRICT` / `M5_FALLBACK` via l'API publique `desk-domain` (ADR-0035). `live-runtime` consomme cette politique pour les seules familles M5 SHADOW compatibles ; `agents` conserve un contexte consultatif et `operations` livre le flag audité, OFF par défaut.

## Extraction progressive depuis l'existant

`mcp_gpt_desk/src` est un host legacy. Toute nouvelle capacité cible doit être placée dans le module propriétaire ou extraite avec test de parité. Le host peut temporairement appeler les API publiques des nouveaux modules ; l'inverse est interdit.
