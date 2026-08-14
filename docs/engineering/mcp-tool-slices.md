# MCP Tool Slices

`TD2-ARCH-006` découpe la surface MCP legacy par vertical slices sans casser les
workers live/replay existants.

La source de vérité est `mcp_gpt_desk/src/mcp-tool-slices.js`.

## Règles

- Tout outil MCP déclaré dans `createDeskToolRegistry` doit avoir une slice et un
  owner explicites.
- Le profil public `autopilot_v4` est dérivé des slices, pas d'une liste plate
  maintenue séparément.
- Les profils stricts `live_worker`, `replay_worker`, `research_worker` et
  `execution_gateway` filtrent ensuite cette surface par rôle.
- Les outils historiques restent classés `internal_legacy` tant qu'ils existent,
  mais ils ne sont pas automatiquement exposés au profil GPT.
- Un nouvel outil sans slice, un outil supprimé mais encore classé, ou un outil
  déclaré dans deux slices fait échouer `npm run guard:mcp-slices`.

## Slices initiales

- `platform.contracts` : santé MCP et contrats immuables.
- `market-data.context` : packs, datasets, niveaux, macro/news.
- `live.analysis-bundles` : bundles Master/Monitor live.
- `front.projections` : read models opérateur transitoires.
- `gpt-work.lifecycle` : claim/heartbeat/complete/fail.
- `replay.autopilot` : replay V4 et simulation intervalle.
- `backtest.legacy` : backtest historique et Feature Engine.
- `analysis.legacy-documents` : writes historiques de documents analytiques.
- `desk-jobs.legacy` : CRUD jobs opérateur historique.

## Migration progressive

Cette étape ne déplace pas encore tous les handlers. Elle pose la frontière
exécutable : le prochain déplacement d'un handler devra partir de sa slice
déclarée, réduire une dette mesurable, et garder le profil Autopilot V4 stable.

Voir aussi `docs/engineering/mcp-strict-role-surfaces.md`.
