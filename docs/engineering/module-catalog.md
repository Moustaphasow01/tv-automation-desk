# Catalogue canonique des bounded contexts du Trading Desk

| Module | Responsabilité propriétaire | Données principales |
|---|---|---|
| `platform` | temps, identités techniques, idempotence, feature flags et primitives d'exécution | runtime settings, flags, receipts |
| `market-data` | sources, ingestion, normalisation, datasets, qualité et provenance | candles, feeds, datasets, ingestion batches |
| `features` | définitions/version/calcul point-in-time des features | feature definitions, feature values |
| `strategy` | Strategy Definition, Version, Instance, DSL et compilation | definitions, versions, instances, artifacts |
| `simulation` | runs déterministes, order simulator, métriques et robustesse | runs, simulated orders/trades, metrics |
| `research` | hypothèses, expériences, candidates, connaissance positive/négative | missions research, experiments, knowledge edges |
| `agents` | agents, missions, conversations, tasks, leases, prompts et model policies | agent tasks, prompt registry, inference telemetry |
| `live-runtime` | scheduling live, état des instances et production de signaux | runtime checkpoints, signals |
| `portfolio-risk` | allocations, arbitrage, budgets, corrélations, netting et target positions | allocations, risk decisions, target positions |
| `execution` | OrderIntent, providers, broker states, fills, protections et réconciliation | accounts, orders, fills, trades, reconciliation |
| `operations` | incidents, alertes, runbooks, déploiements, santé et commandes opérateur | incidents, alerts, deployments, health snapshots |
| `audit` | journal immuable et traçabilité causale | audit entries, event lineage |
| `reporting` | projections BFF et read models front, sans propriété transactionnelle | materialized views, front projections |

## Règles

- Un module possède ses invariants et tables ; `reporting` ne devient jamais propriétaire des transactions.
- `features` consomme les datasets publics de `market-data`, sans accéder à son adapter d'ingestion.
- `simulation` et `live-runtime` consomment le même API public `strategy` et les mêmes features.
- `research` demande des runs à `simulation`; il ne simule pas lui-même.
- `agents` orchestre les réflexions mais ne produit jamais directement un OrderIntent.
- `portfolio-risk` est le seul propriétaire de l'autorisation globale et du netting.
- `execution` ne décide pas l'opportunité ; il exécute un OrderIntent autorisé et réconcilie le broker.
- `reporting` construit les vues front depuis les API/événements approuvés.
- Les adapters NinjaTrader, PickMyTrade, Codex, TradingView, Telegram et stockage restent hors domaine.

## Extraction progressive depuis l'existant

`mcp_gpt_desk/src` est un host legacy. Toute nouvelle capacité cible doit être placée dans le module propriétaire ou extraite avec test de parité. Le host peut temporairement appeler les API publiques des nouveaux modules ; l'inverse est interdit.
