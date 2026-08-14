# MCP strict role surfaces

Ticket : TD2-1006.

## Objectif

Éviter les confusions entre Live, Replay, Research et Execution en exposant des profils MCP stricts par rôle.

Le profil historique `autopilot_v4` reste disponible comme surface de compatibilité. Les nouveaux workers doivent viser les profils stricts.

## Profils

| Profil | Rôle | Règle principale |
|---|---|---|
| `autopilot_v4` | compatibilité | Surface large existante, conservée pour ne pas casser les prompts/workers actuels. |
| `live_worker` | analyste live | Outils live, bundles live, lifecycle live et sauvegardes live ; pas de replay ni claim générique. |
| `replay_worker` | analyste replay | Préparation, lecture, sauvegarde et lifecycle replay ; pas de live ni bundle live. |
| `research_worker` | recherche | Lecture contrats, datasets, snapshots/replay/backtest ; aucune sauvegarde, claim, completion ou fail. |
| `execution_gateway` | passerelle execution | Santé et contrats uniquement pour l'instant ; aucun outil d'ordre GPT direct. |

## Aliases supportés

- `live`, `live_worker`, `live-worker` ;
- `replay`, `replay_worker`, `replay-worker` ;
- `research`, `research_worker`, `research-worker` ;
- `execution`, `execution_gateway`, `execution-gateway`.

## Garde-fou

Le test `mcp_gpt_desk/test/mcp_tool_profile.test.js` vérifie :

- `autopilot_v4` inchangé ;
- impossibilité de relancer les profils legacy `all` / `compatibility` ;
- live sans outils replay ;
- replay sans outils live ;
- research sans outils mutateurs ;
- execution sans outils live/replay/save/claim/complete/fail.

## Règle prompt/policy

Chaque worker doit référencer explicitement son profil MCP dans son prompt ou sa policy runtime.

Exemples :

- worker live : `MCP_TOOL_PROFILE=live_worker` ;
- worker replay : `MCP_TOOL_PROFILE=replay_worker` ;
- worker research : `MCP_TOOL_PROFILE=research_worker` ;
- passerelle execution : `MCP_TOOL_PROFILE=execution_gateway`.
