# Baseline de dette architecturale — 2026-08-08

Cette baseline autorise une migration progressive ; elle n'autorise aucune aggravation.

## Taille actuelle

- 101 fichiers JavaScript dans `mcp_gpt_desk/src`.
- 87 fichiers TypeScript/TSX dans le front.
- 41 fichiers source JavaScript dans les packages métier.
- Backend principalement plat dans `mcp_gpt_desk/src`.

## Principaux fichiers backend au-dessus de 600 lignes

| Fichier | Lignes au baseline |
|---|---:|
| `front-operations-service.js` | 4869 |
| `desk-replay-orchestration-algorithms.js` | 3025 |
| `desk-ai-worker-service.js` | 2595 |
| `tools.js` | 2547 |
| `store.js` | 2224 |
| `desk-strategy-audit-algorithms.js` | 2164 |
| `desk-replay-service.js` | 2084 |
| `replay-continuity.js` | 1922 |
| `desk-ai-worker-envelope.js` | 1873 |
| `front-session-projection.js` | 1663 |
| `schemas.js` | 1363 |
| `desk-market-feature-algorithms.js` | 1322 |
| `codex-exec-adapter.js` | 1221 |
| `legacy-compatibility-adapter.js` | 1210 |
| `broker-execution-repository.js` | 1209 |
| `desk-live-bundle-algorithms.js` | 1170 |
| `server.js` | 1164 |
| `live-cursor.js` | 1041 |
| `desk-state-algorithms.js` | 1022 |
| `live-paper-execution.js` | 977 |
| `position-continuity-engine.js` | 962 |
| `macro-calendar-service.js` | 955 |
| `broker-execution-service.js` | 948 |
| `telegram-alert-service.js` | 895 |

## Frontend au-dessus de 600 lignes

- `src/operationsTypes.ts` : 1071 lignes.
- `src/styles/v2.css` : 1003 lignes.
- `src/test/fixtures/deskSessionFixture.ts` : 1085 lignes, autorisé comme fixture de test mais à découper si sa responsabilité diverge.

## Constats

- Les packages `desk-domain`, `desk-audit`, `desk-time` et `desk-replay-engine` montrent déjà une direction modulaire réutilisable.
- Le host MCP concentre encore orchestration, projection, persistance et adapters.
- Les prompts Live/Replay sont versionnés/hashés mais construits en dur dans plusieurs fichiers.
- Les fixtures front trouvées sont confinées aux tests ; aucun mock métier de production n'a été détecté par le scan initial.
- Les tests sont nombreux, mais les frontières, tailles, imports, dépendances et TODO ne sont pas encore tous contrôlés automatiquement.

## Politique de convergence

1. Aucun nouveau god file.
2. Toute nouvelle capacité cible va dans son bounded context.
3. Un fichier legacy touché ne gagne pas une nouvelle responsabilité.
4. Extraction par vertical slice avec tests de parité, pas par déplacement massif.
5. Chaque réduction de dette met à jour cette baseline et ferme la dérogation correspondante.
