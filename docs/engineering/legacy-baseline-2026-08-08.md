# Baseline de dette architecturale — 2026-08-08

Cette baseline autorise une migration progressive ; elle n'autorise ni aggravation ni maintien permanent de la dette.

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

La baseline exhaustive et exécutable des budgets de lignes, fonctions longues, complexité, duplication et fichiers potentiellement morts est `docs/engineering/static-quality-baseline.json`.
Elle est contrôlée par `npm run guard:static-quality` et empêche l'aggravation des compteurs suivants au 2026-08-08 :

- 39 fichiers de production au-dessus de 600 lignes ;
- 228 fonctions au-dessus de 60 lignes ;
- 565 fonctions au-dessus du seuil de complexité cyclomatique 15 ;
- 49 blocs dupliqués détectés ;
- 11 fichiers potentiellement morts.

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

## Classification TD2-003

Le rapport `docs/engineering/legacy-and-dependency-classification-2026-08-08.md` classe les 24 scripts non référencés par scan statique et les dépendances vulnérables détectées.

- 24 scripts non référencés ne sont pas supprimés : ils sont classés comme outils opérateur, réparation replay, backfill/import manuel ou diagnostic IA.
- `mcp_gpt_desk` est corrigé de 1 vulnérabilité high transitive `ip-address` et 1 vulnérabilité moderate `hono` via overrides ciblés.
- Les vulnérabilités modérées React Router du front sont suivies par le ticket Jira `TD2-140` / `TD2-SEC-001`, car la correction impose une migration majeure v7.

## Politique de convergence

1. Aucun nouveau god file.
2. Toute nouvelle capacité cible va dans son bounded context.
3. Un fichier legacy touché ne gagne pas une nouvelle responsabilité.
4. Tout fichier ou flux legacy touché réduit une dette mesurable, sauf correctif urgent formellement justifié.
5. Extraction par vertical slice avec tests de parité, pas par déplacement massif.
6. Chaque réduction de dette met à jour cette baseline et ferme ou réduit la dérogation correspondante.
7. Chaque phase publie son delta de conformité avant/après.
8. Le ticket final de clôture exige une baseline vide et zéro dérogation active.
