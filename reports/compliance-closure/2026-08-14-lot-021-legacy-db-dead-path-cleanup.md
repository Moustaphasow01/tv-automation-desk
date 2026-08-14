# Lot 021 — Legacy DB / Dead Path Cleanup

Date: 2026-08-14

## Verdict

Statut final: PARTIEL.

Le repository dispose maintenant d'un audit non destructif, d'une politique SQL anti-suppression non autorisée, et d'un cleanup legacy research testable. En revanche, aucune purge massive ne doit être faite sans preuve runtime PostgreSQL, export/rétention et validation opérateur.

## Ce qui a été corrigé dans ce lot

Le script `cleanup_legacy_research_queue.mjs` est désormais importable et testable sans déclencher le CLI ni ouvrir automatiquement la stack.

Preuves:

- Entrypoint CLI isolé: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/scripts/cleanup_legacy_research_queue.mjs:10`
- Fonction CLI explicite: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/scripts/cleanup_legacy_research_queue.mjs:14`
- Fonction métier exportée: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/scripts/cleanup_legacy_research_queue.mjs:43`
- Refus `apply` sans horloge maintenance: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/scripts/cleanup_legacy_research_queue.mjs:46`
- Query bornée des tâches legacy research: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/scripts/cleanup_legacy_research_queue.mjs:71`
- Annulation idempotente en mode apply: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/scripts/cleanup_legacy_research_queue.mjs:59`

Tests ajoutés:

- Dry-run sans mutation: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/test/cleanup_legacy_research_queue.test.js:5`
- Fail-safe apply sans horloge: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/mcp_gpt_desk/test/cleanup_legacy_research_queue.test.js:35`

## Audit cleanup non destructif

Commande:

```text
node mcp_gpt_desk/scripts/audit_backend_cleanup_candidates.mjs
```

Résumé:

```text
scannedFiles=990
findingFiles=582
findings=143
unreferencedScripts=27
topRules:
- historical_marker: 101
- backfill_or_publish_script: 32
- firebase_or_firestore: 10
policy.deleteAutomatically=false
```

Premiers scripts non référencés signalés par l'audit:

- `mcp_gpt_desk/scripts/archive_terminal_replay_config.mjs`
- `mcp_gpt_desk/scripts/audit_pack_local_objects.mjs`
- `mcp_gpt_desk/scripts/audit_v5_replay_data_coverage.mjs`
- `mcp_gpt_desk/scripts/backfill_missing_research_robustness_tasks.mjs`
- `mcp_gpt_desk/scripts/cancel_replay_for_engine_audit.mjs`
- `mcp_gpt_desk/scripts/cleanup_legacy_research_queue.mjs`
- `mcp_gpt_desk/scripts/close_historical_live_cursors.mjs`
- `mcp_gpt_desk/scripts/inspect_deployment_drain.mjs`
- `mcp_gpt_desk/scripts/materialize_replay_position_outcomes.mjs`
- `mcp_gpt_desk/scripts/migrate_replay_queue_to_m5.mjs`

Ces scripts ne sont pas automatiquement supprimables: plusieurs sont des outils opérateur ponctuels, des runbooks exécutable ou des scripts de réparation historique.

## Politique SQL anti-destruction

Le guard SQL inspecte les migrations et bloque les opérations destructives non allowlistées.

Preuves:

- Guard: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/scripts/quality/check_sql_migrations.mjs:32`
- Liste des opérations destructives: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/engineering/sql-migration-policy.json:111`
- Allowlist unique actuelle `desk_cross_asset_deltas`: `/mnt/c/Users/CES/Desktop/TV_Automation_PREPROD/docs/engineering/sql-migration-policy.json:104`

Commande:

```text
npm run guard:sql-migrations
```

Résultat:

```text
ok=true
migration_files=54
tables=124
indexed_tables=113
```

Warnings non bloquants:

```text
market_instruments, market_timeframes, desk_import_checkpoints, broker_providers,
desk_runtime_migrations, trade_policy_profiles, trade_management_approvals,
desk_schema_migrations, news_sources, telegram_runtime_config, telegram_runtime_state
```

## Tests exécutés

```text
node --test mcp_gpt_desk/test/cleanup_legacy_research_queue.test.js
2 pass / 0 fail
```

```text
npm run guard:sql-migrations
ok=true
```

```text
node --test mcp_gpt_desk/test/agent_runtime_sql_schema.test.js mcp_gpt_desk/test/research_experiment_sql_schema.test.js mcp_gpt_desk/test/portfolio_order_intent_execution_sql_schema.test.js
21 pass / 0 fail
```

```text
npm run guard:static-quality
ok=true, checked_files=393, baseline=docs/engineering/static-quality-baseline.json
```

## Requirement matrix

| Requirement | Current status | Gap | Implementation | Tests | Runtime proof | Final status |
|---|---:|---|---|---|---|---:|
| Legacy cleanup sans perte de données | PARTIEL | Besoin export/rétention DB réelle | Audit non destructif + policy SQL | cleanup test + sql guard | Snapshot PostgreSQL réel requis | PARTIEL |
| Tâches research legacy nettoyables | PARTIEL | Apply non exécuté sur DB réelle | `cleanupLegacyResearchQueue` | 2 tests ciblés | Dry-run réel DB requis | PARTIEL |
| Suppressions SQL non autorisées bloquées | FAIT | Aucun gap local | `check_sql_migrations` + policy allowlist | `guard:sql-migrations` | N/A guard | FAIT |
| Scripts dead-path identifiés | PARTIEL | 27 scripts à classifier humainement | audit backend cleanup | audit command | N/A | PARTIEL |
| Dette static non aggravée | FAIT sous baseline | Dette structurelle encore présente | static-quality baseline | `guard:static-quality` | N/A | PARTIEL architectural |

## Décision de nettoyage

Ne pas supprimer automatiquement les 27 scripts non référencés.

Ordre recommandé:

1. Classifier chaque script: `runtime`, `runbook`, `repair`, `one-shot historique`, `dead`.
2. Pour chaque `dead`: `rg` preuve zéro usage + test impact.
3. Pour chaque table/collection legacy: export + hash + rétention + migration archive.
4. Suppression uniquement par lot dédié avec rollback/documentation.

## Blockers

- BLOQUÉ EXTERNE: dry-run/apply sur vraie DB PostgreSQL préprod/VPS avec snapshot préalable.
- PARTIEL local: classification détaillée des 27 scripts non référencés.
- PARTIEL local: burn-down réel de dette legacy/god files reste Lot017 accepté, pas clôture totale.

## Résultat de lot

- FAIT gagnés: politique SQL destructive prouvée ; cleanup research importable/testé.
- PARTIEL restant: suppression physique dead paths et nettoyage DB réel.
- NON FAIT: aucun nouveau.
- NON PROUVÉ: état de la base runtime réelle au moment du cleanup.
- BLOQUÉ EXTERNE: accès/snapshot PostgreSQL runtime.

## Prochain lot

LOT 022 — AUTO/LIVE readiness sans activation.

Objectif: vérifier la capacité technique Demo/PAPER et produire le gate de réactivation automatique, sans activer AUTO ni LIVE.
