param(
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [Parameter(Mandatory = $true)][string]$SchemaDirectory,
    [string]$PostgresBin = ""
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

$schemaRoot = Assert-DeskExplicitPath -Path $SchemaDirectory -Label "SchemaDirectory"
$migrationId = "058_theoretical_execution_portfolio_lineage"
$migrationPath = Join-Path $schemaRoot "$migrationId.sql"
if (-not (Test-Path -LiteralPath $migrationPath -PathType Leaf)) {
    throw "Required migration file not found: $migrationPath"
}

$psql = Resolve-DeskPostgresTool -Name "psql" -PostgresBin $PostgresBin
$expectedChecksum = Get-DeskFileSha256 $migrationPath
$contractSql = @'
DO $desk_migration_contract$
DECLARE
  contract_row record;
  relation_id regclass;
  match_count integer;
BEGIN
  IF to_regclass('public.desk_schema_migrations') IS NULL THEN
    RAISE EXCEPTION 'MIGRATION_058_LEDGER_MISSING';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM desk_schema_migrations
    WHERE migration_id = '058_theoretical_execution_portfolio_lineage'
      AND content_sha256 = '__EXPECTED_CHECKSUM__'
  ) THEN
    RAISE EXCEPTION 'MIGRATION_058_NOT_CATALOGUED_OR_CHECKSUM_MISMATCH';
  END IF;

  FOR contract_row IN
    SELECT *
    FROM (VALUES
      ('trades', 'trades_portfolio_order_intent_idx', 'updated_at'),
      ('trade_theoretical_execution_events', 'theoretical_execution_events_portfolio_intent_idx', 'event_at_utc'),
      ('trade_manual_execution_events', 'manual_execution_events_portfolio_intent_idx', 'occurred_at_utc')
    ) AS expected(table_name, index_name, ordering_column)
  LOOP
    relation_id := to_regclass(format('public.%I', contract_row.table_name));
    IF relation_id IS NULL THEN
      RAISE EXCEPTION 'MIGRATION_058_TABLE_MISSING: %', contract_row.table_name;
    END IF;

    SELECT count(*) INTO match_count
    FROM pg_attribute
    WHERE attrelid = relation_id
      AND attname = 'portfolio_order_intent_id'
      AND atttypid = 'text'::regtype
      AND NOT attnotnull
      AND NOT attisdropped;
    IF match_count <> 1 THEN
      RAISE EXCEPTION 'MIGRATION_058_COLUMN_CONTRACT_INVALID: %', contract_row.table_name;
    END IF;

    SELECT count(*) INTO match_count
    FROM pg_constraint AS constraint_catalog
    WHERE constraint_catalog.contype = 'f'
      AND constraint_catalog.conrelid = relation_id
      AND constraint_catalog.confrelid = 'public.portfolio_order_intent_lineage'::regclass
      AND constraint_catalog.confdeltype = 'n'
      AND ARRAY(
        SELECT source_attribute.attname::text
        FROM unnest(constraint_catalog.conkey) WITH ORDINALITY AS source_key(attnum, ordinal)
        JOIN pg_attribute AS source_attribute
          ON source_attribute.attrelid = constraint_catalog.conrelid
         AND source_attribute.attnum = source_key.attnum
        ORDER BY source_key.ordinal
      ) = ARRAY['portfolio_order_intent_id']
      AND ARRAY(
        SELECT target_attribute.attname::text
        FROM unnest(constraint_catalog.confkey) WITH ORDINALITY AS target_key(attnum, ordinal)
        JOIN pg_attribute AS target_attribute
          ON target_attribute.attrelid = constraint_catalog.confrelid
         AND target_attribute.attnum = target_key.attnum
        ORDER BY target_key.ordinal
      ) = ARRAY['portfolio_order_intent_id'];
    IF match_count <> 1 THEN
      RAISE EXCEPTION 'MIGRATION_058_FOREIGN_KEY_CONTRACT_INVALID: %', contract_row.table_name;
    END IF;

    SELECT count(*) INTO match_count
    FROM pg_class AS index_relation
    JOIN pg_index AS index_catalog ON index_catalog.indexrelid = index_relation.oid
    WHERE index_relation.relname = contract_row.index_name
      AND index_catalog.indrelid = relation_id
      AND index_catalog.indisvalid
      AND index_catalog.indisready
      AND pg_get_indexdef(index_relation.oid) LIKE format(
        '%%(portfolio_order_intent_id, %I DESC)%%',
        contract_row.ordering_column
      )
      AND coalesce(pg_get_expr(index_catalog.indpred, index_catalog.indrelid), '')
        LIKE '%portfolio_order_intent_id IS NOT NULL%';
    IF match_count <> 1 THEN
      RAISE EXCEPTION 'MIGRATION_058_INDEX_CONTRACT_INVALID: %', contract_row.index_name;
    END IF;
  END LOOP;
END
$desk_migration_contract$;
'@
$contractSql = $contractSql.Replace("__EXPECTED_CHECKSUM__", $expectedChecksum)

Invoke-DeskExternal -FilePath $psql -Arguments @(
    "--set", "ON_ERROR_STOP=1", "--dbname", $DatabaseUrl, "--command", $contractSql
)

$evidenceSql = @'
SELECT json_build_object(
  'ok', true,
  'migration_id', migration_id,
  'content_sha256', content_sha256,
  'applied_at_utc', applied_at_utc,
  'columns_verified', 3,
  'foreign_keys_verified', 3,
  'indexes_verified', 3
)
FROM desk_schema_migrations
WHERE migration_id = '058_theoretical_execution_portfolio_lineage';
'@
$evidence = Invoke-DeskExternal -FilePath $psql -Arguments @(
    "--set", "ON_ERROR_STOP=1", "--tuples-only", "--no-align",
    "--dbname", $DatabaseUrl, "--command", $evidenceSql
) -PassThru
Write-Host ([string]$evidence).Trim()
Write-Host "PostgreSQL migration 058 contract verified."
