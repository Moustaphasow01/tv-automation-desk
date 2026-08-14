# Prompt Runtime Inventory

> Ticket : `TD2-PRM-001`
> Statut : livré en préproduction locale
> Date : 2026-08-09

## Rôle

Cet inventaire fige les prompts runtime actifs avant migration vers le Prompt & Instruction Registry.

Source machine-readable :

- `config/prompt-registry/runtime-prompt-inventory.v1.json`.

## Prompts actifs inventoriés

| Prompt | Lane | Version cible | Source | SHA-256 |
|---|---|---:|---|---|
| `CHATGPT_LIVE_WORKER_FALLBACK` | live | 2.4.0 | `docs/CHATGPT_LIVE_WORKER_PROMPT.md` | `sha256:58805173a2a0f7db96cfc4c8ed0ad213b4a2d74045990f9ee151255730fa4ffd` |
| `CHATGPT_REPLAY_WORKER_FALLBACK` | replay | 2.4.0 | `docs/CHATGPT_REPLAY_WORKER_PROMPT.md` | `sha256:79b9648bd9b2388e55e759aa60e15b7ecd492907f98856a066cde52cfd1558f2` |
| `MCP_WORK_ITEM_EXECUTION_PROMPT` | live/replay | généré | `mcp_gpt_desk/src/store.js` + `mcp_gpt_desk/src/tools.js` | à remplacer par snapshot registry |

## Contrats liés à la pile V5.4/V2.4

| Contrat | Version | SHA-256 |
|---|---:|---|
| `DeskMasterAnalysisContract` | 5.4.0 | `sha256:000f5bf0ac0602f5c1fb298350b6a0ce2447abba8112202fef198d37f7e6da7d` |
| `DeskHourlyThesisMonitorContract` | 2.4.0 | `sha256:f3a57d05711d96bc1de73f84fc00e098c07468b7f3aaab279e9dc878d3961f17` |
| `DeskExecutionPlanContract` | 1.4.0 | `sha256:a1e40d10c891b9f2df47f30b35dd7be7e0f4e59aaecf75d9dbc1f685e207c828` |
| `DeskMonitorCommandContract` | 1.4.0 | `sha256:aae4dde166a9702fae80a49172afcb950833ab938b2eeaca79f2554275bc5ebb` |
| `DeskDeterministicExecutionPolicy` | 4.3.0 | `sha256:f8861200515007771e9f79dc4bce5e6d908fa8b2444932fa917ab0bd9d3bdc22` |
| `DeskConditionCatalogContract` | 1.2.0 | `sha256:2af8d5325a0a14a533944a3763b4a288346512c2886441b24a50f1ca2919eb61` |

## Consommateurs

- `config/chatgpt-workers/live-v4.json`.
- `config/chatgpt-workers/replay-v4.json`.
- `mcp_gpt_desk/src/tools.js`.
- `mcp_gpt_desk/src/store.js`.

## Garde sécurité

Les prompts inventoriés sont soumis à la règle `NO_SECRET_ALLOWED`.

Les textes dynamiques `execution_prompt` produits par le backend doivent être remplacés par un `prompt_render_snapshot` épinglé avant claim. Après claim, le worker ne doit jamais résoudre `latest`.
