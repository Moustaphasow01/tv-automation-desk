# Desk Front V3 — Cahier de refonte

Ticket : TD2-1004.

## Intentions produit

Le Front V3 doit devenir une interface d'opérateur de desk, pas un explorateur d'objets techniques.

Objectifs :

- comprendre l'état du desk en moins de 10 secondes ;
- passer d'une vue globale à un zoom puis à un détail sans perdre le contexte ;
- piloter Live, Replay, Performance, Strategy, Research, Data Foundation, Risk et Execution avec un langage métier ;
- cacher les identifiants techniques dans des panneaux détails, jamais comme libellé principal ;
- exploiter le catalogue `/api/v2/catalog.json` comme source de vérité pour routes, domaines et permissions.

## Principes UX

1. **Global d'abord** : chaque espace commence par une synthèse opérateur.
2. **Zoom dédié** : cliquer sur un élément ouvre une page zoom dédiée, pas un panneau perpétuel à droite.
3. **Détail technique replié** : IDs, payloads, hashes, leases et raw JSON restent dans un inspecteur technique replié.
4. **Fil d'Ariane obligatoire** : chaque zoom expose `Espace > Objet métier > Détail`.
5. **État réel visible** : no data, degraded, loading, stale et disconnected ont des états visuels distincts.
6. **Actions permissionnées** : le front lit `operatorScopes` et désactive/masque selon les scopes.
7. **Temps réel sobre** : SSE `/api/v1/events` met à jour les vues opérations sans recharger tout le desk.

## Architecture d'information

| Espace V3 | Rôle | Vue globale | Zoom | Détail |
|---|---|---|---|---|
| Aujourd'hui | Situation live | Command Center, session, marché, thèse, setup, risques | Session Live | Master, Monitor, setup, événement timeline |
| Replay | Backtests orchestrés | Runs, journées, avancement, R live | Replay Run, Replay Day | Process IA, décision, trade, bundle |
| Performance | Résultats | Equity, calendrier R, drawdown, trade tape | Journée, stratégie, période | Trade, attribution, erreur analyse/moteur |
| Opérations | Santé système | Workflows, incidents, queue, runbooks | Workflow, incident, runbook | Step, event, dead-letter |
| Stratégies | Moteurs déterministes | Definitions, versions, instances, signals | Strategy Version, Instance | DSL, compilation, signal, audit |
| Research | Recherche IA/quant | Expériences, candidates, knowledge graph | Experiment, Candidate | Rapport, preuve, promotion/rejet |
| Fondation données | Sources et datasets | Sources, batches, datasets, features, storage | Dataset, Feature, Source | Lineage, freshness, coverage |
| Exécution | Broker/provider | Risk, intents, approvals, bridge/addon | Intent, account, reconciliation | Order event, fill, snapshot |
| Gouvernance | Paramètres | Prompts, AI Context, scopes, policies | Prompt version, policy | Hash, diff, historique |

## Navigation cible

La navigation principale doit être courte :

- Aujourd'hui ;
- Replay ;
- Performance ;
- Opérations ;
- Stratégies ;
- Research ;
- Données ;
- Exécution ;
- Gouvernance.

Chaque espace possède une sous-navigation locale, pas un menu latéral global interminable.

## Règle Global → Zoom → Détail

### Global

Affiche :

- KPI métier ;
- état santé ;
- dernières transitions ;
- éléments à traiter ;
- liens de zoom.

Ne doit pas afficher :

- IDs longs ;
- payloads ;
- raw JSON ;
- listes techniques exhaustives.

### Zoom

Affiche un objet métier en pleine page :

- une synthèse ;
- une timeline horizontale ou verticale selon le domaine ;
- les sous-objets liés ;
- les actions permises.

### Détail

Affiche :

- inspecteur technique ;
- IDs, hashes, leases, payloads ;
- provenance ;
- raw data.

Toujours replié par défaut.

## Mapping API

| Besoin V3 | Endpoint actuel |
|---|---|
| Carte API et permissions | `GET /api/v2/catalog.json` |
| Realtime opérations | `GET /api/v1/events` |
| Session actuelle | `GET /api/v1/live-desk/current` |
| Opérations globales | `GET /api/v1/operations/summary` |
| Workflows | `GET /api/v1/workflows`, `GET /api/v1/workflows/{workflowId}` |
| Replays | `GET/POST /api/v1/replays`, `GET /api/v1/replays/{runId}` |
| Simulation runs | `GET /api/v1/simulation-runs` |
| Performance | `GET /api/v1/performance/overview` |
| Strategy V2 | `GET /api/v1/strategy-v2/overview` |
| Research | `GET /api/v1/research/overview` |
| Fondation données | `GET /api/v1/data-foundation/overview` |
| Execution | `GET /api/v1/execution/overview`, `POST /api/v1/execution/actions` |
| AI Context | `GET /api/v1/ai-context/overview` |
| Portfolio Risk | `GET /api/v1/portfolio-risk/overview` |

## Nomenclature

À utiliser en premier niveau :

- Session ;
- Run ;
- Journée ;
- Process IA ;
- Thèse ;
- Setup ;
- Trade ;
- Incident ;
- Workflow ;
- Dataset ;
- Stratégie ;
- Provider ;
- Intention d'ordre ;
- Réconciliation.

À éviter en libellé principal :

- `workflow_id` ;
- `run_id` ;
- `cursor_id` ;
- `lease_token` ;
- `pack_build_id` ;
- `payload_hash`.

Ces valeurs restent visibles dans l'inspecteur technique.

## États visuels obligatoires

| État | Sens | UX |
|---|---|---|
| Loading | requête en cours | skeleton compact |
| Empty | aucune donnée réelle | état vide explicite |
| Degraded | donnée partielle mais exploitable | badge orange + explication |
| Stale | donnée trop ancienne | badge ambre + dernier timestamp |
| Disconnected | API/SSE indisponible | bandeau rouge + retry |
| Permission denied | scope absent | action désactivée + scope requis |
| Dangerous action | execution/provider/risk | confirmation forte |

## Permissions

Le front doit consommer `operatorScopes` depuis le catalogue API v2.

Règles :

- lecture globale : `desk.read` ;
- automation : `desk.automation.read/write` ;
- execution : `desk.execution.read/write` ;
- admin : `desk.admin` ;
- compatibilité : `desk.read` et `desk.write` restent supportés.

Une action disabled doit afficher :

- scope requis ;
- raison métier ;
- chemin pour demander/activer le droit.

## Design system cible

Direction : desk dense, net, premium, lisible.

- densité compacte par défaut ;
- mode clair et sombre ;
- cartes KPI petites et comparables ;
- tables lisibles avec lignes hautes seulement dans les zooms ;
- timeline horizontale pour Live/Replay ;
- couleurs fonctionnelles, pas décoratives :
  - vert : OK / profit / exécuté ;
  - orange : degraded / attention ;
  - rouge : blocage / risque ;
  - bleu : information / attente ;
  - violet : IA / Research.

## Migration

Le Front V3 est un chantier séparé.

Pré-requis déjà livrés :

- `Front API v2 catalog` ;
- `front_events_v1` ;
- `operator_access_policy_v1` ;
- surfaces MCP strictes ;
- guard `api-compatibility`.

Plan de coexistence détaillé : `docs/engineering/front-v3-coexistence-migration-plan.md`.

Étapes de lancement :

1. créer le shell V3 avec navigation courte ;
2. brancher `/api/v2/catalog.json` ;
3. migrer un espace pilote : `Replay` ou `Opérations` ;
4. ajouter zoom pages dédiées ;
5. intégrer SSE ;
6. activer permissions UI ;
7. comparer en parallèle avec le front actuel ;
8. couper écran par écran après validation opérateur.

## Critères de réussite

- aucun écran principal n'affiche d'ID technique comme titre ;
- chaque liste importante possède une page zoom ;
- chaque action sensible lit `operatorScopes` ;
- chaque écran critique a un état loading/empty/degraded/disconnected ;
- le front actuel continue de fonctionner pendant la coexistence ;
- le futur chantier V3 peut être découpé par espace sans redéfinir les API.
