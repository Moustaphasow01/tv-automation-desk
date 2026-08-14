# Classification legacy et dépendances — 2026-08-08

Ticket source : `TD2-003`
Statut : classification opérable, sans suppression automatique.

## Résumé exécutif

- Scan backend cleanup : 635 fichiers scannés, 345 fichiers éligibles aux findings, 102 marqueurs legacy/backfill/historique, 24 scripts non référencés par scan statique.
- Aucun script n'est supprimé dans ce ticket : plusieurs scripts non référencés sont des outils opérateur, de réparation ou de migration déclenchés manuellement.
- Le backend MCP avait 2 vulnérabilités npm production dont 1 high transitive ; elles sont corrigées par overrides ciblés dans `mcp_gpt_desk/package.json`.
- Le front racine conserve 2 vulnérabilités modérées React Router qui nécessitent une migration majeure v7 ; l'écart est tracé dans Jira `TD2-140` / `TD2-SEC-001`.

## Commandes exécutées

```bash
npm --prefix mcp_gpt_desk run audit:backend-cleanup
npm audit --omit=dev --audit-level=high --json
npm --prefix mcp_gpt_desk audit --omit=dev --audit-level=high --json
npm --prefix mcp_gpt_desk install --package-lock-only
npm --prefix mcp_gpt_desk ls ip-address hono --depth=6
```

Le scanner ignore ce rapport comme consommateur de scripts et comme source de dette, afin que la classification ne masque pas les futurs audits.

## Dépendances vulnérables

| Package | Zone | Sévérité avant | Décision | Statut |
|---|---|---:|---|---|
| `ip-address` via `express-rate-limit` / `@modelcontextprotocol/sdk` | `mcp_gpt_desk` | high | Override transitive vers `^10.4.0` | Corrigé |
| `hono` via `@modelcontextprotocol/sdk` | `mcp_gpt_desk` | moderate | Override transitive vers `^4.13.1` | Corrigé |
| `react-router-dom` / `react-router` | front racine | moderate | Migration majeure v7 isolée | Jira `TD2-140` |

Validation backend MCP après correction :

```text
npm --prefix mcp_gpt_desk audit --omit=dev --audit-level=high --json
→ 0 info, 0 low, 0 moderate, 0 high, 0 critical

npm --prefix mcp_gpt_desk ls ip-address hono --depth=6
→ hono@4.13.1
→ ip-address@10.4.0
```

## Scripts non référencés par scan statique

Le scan ne prouve pas qu'un script est mort. Il prouve seulement qu'il n'est pas appelé par une référence texte évidente depuis les racines scannées. Les scripts suivants sont donc classés avant suppression éventuelle.

### Outils opérateur actifs à conserver

| Script | Raison |
|---|---|
| `mcp_gpt_desk/scripts/close_historical_live_cursors.mjs` | Maintenance live/cursors historiques opérée manuellement. |
| `mcp_gpt_desk/scripts/inspect_deployment_drain.mjs` | Diagnostic release/drain VPS. |
| `mcp_gpt_desk/scripts/inspect_service_heartbeat.mjs` | Diagnostic de services et workers. |
| `mcp_gpt_desk/scripts/pause_claim_lanes.mjs` | Gel live/replay demandé par opérateur. |
| `mcp_gpt_desk/scripts/pause_replay_queue.mjs` | Gel ciblé de replay demandé par opérateur. |
| `scripts/mcp/validate_public_gpt_connector.py` | Validation du connecteur MCP public GPT. |
| `scripts/deploy/transfer_telegram_secrets_to_vps.mjs` | Migration contrôlée des secrets Telegram vers VPS. |
| `scripts/tradingview/Start-TradingViewDesktopCdp.ps1` | Démarrage/outillage CDP TradingView local. |
| `scripts/tradingview/audit_local_alert_webhooks.py` | Audit des alertes TradingView locales. |
| `scripts/tradingview/inspect_local_alert_editor.py` | Inspection assistée de l'éditeur d'alerte TradingView. |
| `scripts/tradingview/migrate_local_alert_webhooks.py` | Migration locale des webhooks TradingView. |

### Outils replay/réparation à conserver mais à documenter par runbook

| Script | Raison |
|---|---|
| `mcp_gpt_desk/scripts/archive_terminal_replay_config.mjs` | Archivage de config replay terminale. |
| `mcp_gpt_desk/scripts/audit_pack_local_objects.mjs` | Audit des objets de pack local. |
| `mcp_gpt_desk/scripts/audit_v5_replay_data_coverage.mjs` | Audit de couverture data replay V5/V4. |
| `mcp_gpt_desk/scripts/cancel_replay_for_engine_audit.mjs` | Interruption contrôlée de replay pour audit moteur. |
| `mcp_gpt_desk/scripts/inspect_replay_analysis_documents.mjs` | Inspection des documents analytiques replay. |
| `mcp_gpt_desk/scripts/materialize_replay_position_outcomes.mjs` | Matérialisation/correction de résultats position replay. |
| `mcp_gpt_desk/scripts/migrate_replay_queue_to_m5.mjs` | Migration ponctuelle de file replay vers cadence M5. |
| `mcp_gpt_desk/scripts/repair_replay_position_from_immutable_prices.mjs` | Réparation à partir des prix immuables. |
| `mcp_gpt_desk/scripts/replace_queued_replay_comparison.mjs` | Remplacement contrôlé de comparatif replay en file. |

### Backfill/import manuel à conserver en quarantaine

| Script | Raison |
|---|---|
| `scripts/db/export_tradingview_mcp_backfill.py` | Export/backfill TradingView MCP. |
| `scripts/db/export_tradingview_replay_m1_backfill.py` | Export/backfill M1 pour replay. |
| `scripts/db/restore_v4_replay_certification.py` | Restauration de certification replay V4. |

### Diagnostic IA à conserver

| Script | Raison |
|---|---|
| `mcp_gpt_desk/scripts/test_codex_inference_canary.mjs` | Canary d'inférence Codex, utile pour worker/runtime IA. |

## Politique de suppression à partir de cette classification

Un script ne peut être supprimé que si les trois preuves suivantes sont réunies dans le ticket de suppression :

1. `rg` ne montre aucun consommateur code, package, runbook, service Windows, documentation opérateur récente ou commande Jira associée.
2. Une alternative canonique existe ou le workflow opérateur est explicitement abandonné.
3. Les tests ciblés plus la certification de résilience passent après suppression.

Les lots recommandés sont :

- lot A : scripts TradingView locaux, seulement après bascule webhooks confirmée côté VPS ;
- lot B : backfills DB, seulement après inventaire final des imports historiques ;
- lot C : réparations replay, seulement après stabilisation du nouveau Run Registry ;
- lot D : diagnostics IA, seulement après remplacement par observabilité agent durable.

## Décisions

- Ne pas supprimer automatiquement les 24 scripts.
- Fermer immédiatement la vulnérabilité high backend MCP via overrides.
- Créer un ticket séparé pour React Router v7 : `TD2-140`.
- Conserver la baseline legacy comme dette mesurée, à réduire par règle `touch-and-improve`.
