# Live Trading VNext — mapping Backend → Front

**Endpoint primaire :** `GET /front-api/v1/views/live-trading`
**Principe :** DTO validé → mapper domaine → `LiveTradingModel` → panneaux. Aucun composant ne consomme directement un provider, PostgreSQL ou une donnée de maquette.

| Zone Live | Projection autoritaire | État local observé | Comportement Front |
| --- | --- | --- | --- |
| Policy strip | `canonicalRuntime.mode`, `freshness`, `meta` | `PAPER`, `SEMI_MANUAL`, AUTO/physical OFF, stale | affiche les valeurs backend et ferme les actions si stale |
| Market Context | `canonicalRuntime.authoritativeSources` | compteurs disponibles, séries marché absentes | tableau de provenance ; aucun prix/sparkline fictif |
| Strategy Instances | `canonicalRuntime.activeStrategyInstances` | liste vide | empty state `UNAVAILABLE` |
| Macro / Session | `session`, `canonicalRuntime.freshness` | session Asia, données stale | source/asOf visible, notes non inventées |
| Chart | `timeSeriesContracts[market.ohlcv|market.vwap]` | contrat publié, points/route absents | grille et raison `UNAVAILABLE`, aucun niveau à zéro |
| Latest Signal | `canonicalRuntime.latestSignals`, puis `signals` | aucun signal courant | proposition Strategy explicitement absente |
| AI/Portfolio/Risk | `canonicalRuntime.aiContextGate`, `riskCenter` | contexte absent, Risk `BLOCKED/UNAVAILABLE` | Requested/Authorized non synthétisés |
| TargetPosition/OrderIntent | `pendingOrderIntents`, `portfolioOrderIntents` | aucun intent | termes post-Risk absents et toujours non éditables |
| Human Gate | intersection `resource.allowedActions` × `humanGate.allowedActions`, plus fraîcheur | aucune action exploitable ; snapshot stale | Confirm/Reject désactivés avec cause ; aucun fallback local |
| Provider Runtime | `providers`, timeline/provider events | aucun état provider exploitable | lifecycle neutre ; `ACKNOWLEDGEMENT IS NOT A FILL` |
| Reconciliation | projection attendue `LT-EXE-001` | absente du snapshot Live | expected/broker/result tous `UNAVAILABLE`, jamais faux PASS |
| Timeline | `timeline` | vide | empty state opérateur sûr |
| Performance | `timeSeriesContracts[performance.r_equity]` | contrat sans série, availability unavailable | aucun R calculé dans le navigateur |
| Jarvis | `aiAdvisory` | `ADVISORY / NO_CONTEXT_DECISIONS` | explication uniquement, aucune autorité |

## Actions et sûreté

- Les actions du Human Gate passent exclusivement par le runtime de commandes BFF déjà audité.
- Le Front ne déduit jamais une capability d'un statut.
- `HTTP ACCEPTED`, confirmation humaine, ACK, partial fill et fill restent des états distincts.
- Une projection `PARTIAL`, `STALE`, `DISCONNECTED` ou invalide rend les actions sensibles indisponibles.
- Les champs post-Risk `instrument`, `side`, `account`, `quantity`, `entry`, `stop`, `targets` n'ont aucun input, select, cellule éditable ou mutation locale.

## Écarts de contrat suivis

- `LT-DATA-001` — route paginée OHLCV/VWAP.
- `LT-EXE-001` — expected vs broker reconciliation dans le dossier Live.
- `LT-PERF-001` — série officielle de performance en R et nature de source.
- `LT-RT-001` — séquence/gap/resume SSE certifiables.

Ils sont détaillés dans `FRONTEND_V2_BACKEND_CONTRACT_NEEDS.md`. Aucun de ces écarts n'est remplacé par une fixture runtime.
