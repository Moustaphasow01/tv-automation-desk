# Audit Firestore prod → PostgreSQL local PREPROD — 2026-07-19

## Statut

- Projet Firestore audité en lecture seule : `tv-automation-23d50`
- Rapport brut : `docs/FIRESTORE_PROD_AUDIT_PREPROD_2026-07-19.json`
- Audit lancé depuis le dépôt original, sortie écrite dans PREPROD.
- Aucune écriture, suppression ou migration n’a été exécutée côté Firestore prod.
- La collection legacy `desk_cross_asset_deltas` est décommissionnée côté runtime PREPROD local.

## Arrêt de `desk_cross_asset_deltas`

Le service PREPROD ne lit plus et n’écrit plus de documents `desk_cross_asset_deltas`.

Décision :

- lecture runtime stoppée ; le tool legacy ne renvoie plus qu’un statut `decommissioned` ;
- écriture runtime supprimée, sans flag de réactivation ;
- source active : datasets/snapshots des packs immuables et `get_raw_window` scoped ;
- aucun nettoyage destructif exécuté sur la base locale existante.

Vérification locale après rebuild API :

```text
desk_cross_asset_deltas = 338161
latest_update = 2026-07-19 00:28:10.657148+00
```

Le compteur est resté stable après redémarrage.

## Résumé Firestore prod

| Indicateur | Valeur |
|---|---:|
| Collections top-level | 84 |
| Documents top-level audités | 2 003 304 |
| Documents sous-collections `market_feeds/*` | 1 182 601 |
| Total logique audité | 3 185 905 |
| Erreurs audit | 0 |
| Gros documents > 1 MB | 0 |

Warnings du rapport :

- `residual_market_candles_present`
- `missing_market_candles:30`

## Plus gros volumes prod

| Collection | Documents | Décision migration PREPROD |
|---|---:|---|
| `study_candles` | 777 131 | différer / dédupliquer avec `live_study_values` |
| `live_study_values` | 777 131 | migrer seulement si le front/MCP en dépend encore |
| `market_feeds/*/candles` | 1 182 601 | migrer en priorité pour le replay/live local |
| `tradingview_webhook_events` | 121 673 | migrer partiellement ou archiver |
| `live_data_feed_status` | 121 673 | migrer partiellement, utile health/feed |
| `tradingview_alert_queue` | 96 771 | migrer seulement si reprise ingestion nécessaire |
| `desk_cross_asset_deltas` | 31 579 | exclure, bruit recalculable |
| `market_candles` | 30 635 | legacy résiduel, ne pas intégrer au contrat cible |
| `desk_agent_outputs` | 12 246 | archiver / migrer basse priorité |
| `desk_tool_logs` | 11 207 | archiver / migrer basse priorité |
| `desk_technical_events` | 7 746 | migrer après candles si utilisé front/audit |

## Collections métier à migrer en priorité

### P0 — État actif et contrats

À migrer en premier pour rendre PREPROD fonctionnelle avec le même état métier que la prod.

| Collection | Documents |
|---|---:|
| `desk_contracts` | 2 |
| `desk_contract_registry` | 1 |
| `desk_runtime_control` | 1 |
| `desk_active_theses` | 5 |
| `desk_master_analyses` | 12 |
| `desk_hourly_monitors` | 22 |
| `desk_live_run_cursor` | 7 |
| `desk_positions` | 2 |
| `desk_position_states` | 22 |
| `desk_alerts` | 2 |
| `desk_decisions` | 27 |
| `macro_calendar_events` | 1 069 |

### P1 — Replay, autopilot et work queue GPT

À migrer ensuite pour reprendre les backtests/replays et inspecter les processus GPT.

| Collection | Documents |
|---|---:|
| `desk_replay_runs` | 36 |
| `desk_replay_steps` | 463 |
| `desk_replay_bundles` | 459 |
| `desk_replay_master_analyses` | 109 |
| `desk_replay_monitors` | 325 |
| `desk_replay_setups` | 90 |
| `desk_replay_positions` | 8 |
| `desk_replay_trade_simulations` | 303 |
| `desk_replay_timeline` | 1 905 |
| `desk_replay_idempotency` | 1 896 |
| `desk_replay_autopilot_configs` | 26 |
| `desk_replay_active_theses` | 107 |
| `desk_agent_work_items` | 427 |
| `desk_agent_work_events` | 1 453 |
| `desk_agent_work_dead_letter` | 1 |

### P2 — Packs, bundles et contexte

Ces collections alimentent les lectures MCP et les bundles front/replay.

| Collection | Documents |
|---|---:|
| `desk_packs` | 102 |
| `desk_pack_builds` | 84 |
| `desk_master_cutoff_bundles` | 38 |
| `desk_manual_monitor_bundles` | 106 |
| `desk_manual_monitors` | 6 |
| `desk_master_prep_jobs` | 53 |
| `desk_monitor_prep_jobs` | 108 |
| `desk_context_transmissions` | 14 |
| `desk_monitor_context_transmissions` | 7 |
| `desk_replay_context_transmissions` | 433 |

### P3 — Marché canonique

À migrer avec un importeur optimisé, pas avec une boucle document par document non bornée.

| Source | Documents |
|---|---:|
| `market_feeds/*/candles` | 1 182 601 |
| `live_data_feed_status` | 121 673 |
| `tradingview_webhook_events` | 121 673 |
| `tradingview_alert_queue` | 96 771 |
| `desk_session_snapshots` | 80 |
| `desk_level_maps` | 80 |
| `desk_technical_events` | 7 746 |
| `desk_rolling_snapshots` | 318 |

### P4 — Logs, traces, archives

Ne pas bloquer la migration fonctionnelle avec ces collections.

| Collection | Documents |
|---|---:|
| `desk_agent_outputs` | 12 246 |
| `desk_tool_logs` | 11 207 |
| `desk_cycle_snapshots` | 1 222 |
| `desk_cycles` | 1 530 |
| `desk_cloud_run_slots` | 1 538 |
| `desk_telegram_deliveries` | 338 |
| `desk_data_quality_audits` | 144 |
| `desk_debate_results` | 94 |
| `desk_audit_logs` | 11 |

## Collections à exclure ou quarantainer

| Collection | Raison |
|---|---|
| `desk_cross_asset_deltas` | bruit recalculable, écriture stoppée, nombreux documents vides ou peu utiles |
| `market_candles` | legacy résiduel encore indexé, remplacé par `market_feeds/*/candles` |
| `study_candles` | doublon probable avec `live_study_values`, volume élevé |
| `desk_cloud_run_slots` | spécifique Cloud Run, à ne pas porter tel quel sur PREPROD local |
| `broker_order_intents*` | broker/test, à isoler hors reprise PREPROD sauf besoin explicite |

## État PostgreSQL PREPROD actuel

| Collection locale | Documents |
|---|---:|
| `desk_cross_asset_deltas` | 338 161 |
| `desk_alert_events` | 236 |
| `desk_notification_outbox` | 4 |
| `desk_alerts` | 3 |
| `desk_contracts` | 2 |
| `desk_contract_registry` | 1 |
| `desk_tool_logs` | 1 |

Conclusion : la base locale n’est pas encore une reprise prod. Elle est surtout remplie par les deltas cross-asset locaux maintenant stoppés.

## Modèle PostgreSQL cible

Le modèle documentaire PREPROD actuel est compatible avec une migration simple :

```sql
desk_documents(
  collection text,
  document_id text,
  data jsonb,
  created_at timestamptz,
  updated_at timestamptz,
  primary key(collection, document_id)
)
```

Pour les sous-collections Firestore :

```text
market_feeds/{feed_id}/candles/{doc_id}
```

devient :

```text
collection  = market_feeds/{feed_id}/candles
document_id = {doc_id}
data        = document Firestore complet
```

Ce format correspond déjà à `PostgresDeskPersistence.queryDocuments()`.

## Index PostgreSQL à ajouter avant l’import marché

Le schéma actuel a déjà des indexes génériques, mais pas assez pour `market_feeds/*/candles`.

À ajouter avant P3 :

```sql
CREATE INDEX IF NOT EXISTS desk_documents_collection_timestamp_utc_idx
  ON desk_documents (collection, ((data ->> 'timestamp_utc')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_timestamp_paris_idx
  ON desk_documents (collection, ((data ->> 'timestamp_paris')));

CREATE INDEX IF NOT EXISTS desk_documents_collection_feed_symbol_tf_idx
  ON desk_documents (
    collection,
    ((data ->> 'feed_id')),
    ((data ->> 'symbol')),
    ((data ->> 'timeframe'))
  );
```

Sans ces indexes, les lectures de fenêtres de candles risquent de scanner trop de JSONB.

## Stratégie d’import recommandée

### Étape 1 — Import minimal fonctionnel

Importer uniquement P0 + P1 + P2, sans marché massif.

Objectif :

- front PREPROD lit les états métier ;
- MCP local retrouve les contrats, thèses, monitors, replays ;
- autopilot/replay lab peut inspecter les runs prod migrés ;
- pas de coûts/perfs liés aux millions de candles.

### Étape 2 — Import marché borné

Importer `market_feeds/*/candles` uniquement pour :

- `MNQ1!`, `MES1!`, `NQ1!`, `ES1!`
- timeframes utiles : `1`, `5`, `15`, `1H`, `4H`
- fenêtre temporelle choisie, par exemple 90 jours ou depuis le premier replay requis.

Puis importer les actifs cross-asset sources, pas les deltas :

- `DXY`
- `VIX`
- `US10Y`
- `US02Y`
- `GC1!`
- `CL1!`

### Étape 3 — Recalcul local des features

Recalculer localement :

- `desk_level_maps`
- `desk_session_snapshots`
- `desk_technical_events`
- éventuellement un nouveau cross-asset propre si on le réactive plus tard

### Étape 4 — Archive logs

Importer ou archiver séparément :

- `desk_tool_logs`
- `desk_agent_outputs`
- `desk_cycle_snapshots`
- `tradingview_webhook_events`

## Garde-fous de migration

- Firestore prod reste lecture seule.
- Import PostgreSQL avec upsert idempotent.
- Migration par batches avec checkpoint local.
- Rapport de counts avant/après.
- Validation par hash sur échantillons.
- Ne jamais importer `desk_cross_asset_deltas` dans la base PREPROD cible.
- Ne pas vider la base PREPROD sans sauvegarde explicite.

## Prochaine action proposée

Créer un importeur dry-run :

```text
Firestore prod → NDJSON local → PostgreSQL desk_documents
```

avec options :

- `--collections p0,p1,p2`
- `--exclude desk_cross_asset_deltas,market_candles,study_candles`
- `--dry-run`
- `--limit-per-collection`
- `--since`
- `--truncate-target=false`

Ensuite lancer un premier dry-run P0/P1/P2 et comparer les counts sans toucher aux données existantes.
