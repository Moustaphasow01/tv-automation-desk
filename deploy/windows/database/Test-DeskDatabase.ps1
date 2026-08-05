param(
    [Parameter(Mandatory = $true)][string]$DatabaseUrl,
    [string]$PostgresBin = "",
    [switch]$RequireBrokerSchema
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

$psql = Resolve-DeskPostgresTool -Name "psql" -PostgresBin $PostgresBin
$requiredTables = @(
    "desk_documents",
    "market_instruments",
    "market_feeds",
    "market_candles",
    "tradingview_events",
    "desk_pack_objects",
    "desk_schema_migrations",
    "news_sources",
    "news_articles",
    "news_ingestion_runs"
)
if ($RequireBrokerSchema) {
    $requiredTables += @(
        "trade_decisions",
        "trade_order_intents",
        "broker_orders",
        "trade_fills",
        "trades",
        "broker_bridge_heartbeats",
        "broker_addon_snapshots"
    )
}

$failures = @()
foreach ($table in $requiredTables) {
    $query = "SELECT CASE WHEN to_regclass('public.$table') IS NULL THEN 'missing' ELSE 'ok' END;"
    $status = (& $psql --tuples-only --no-align --dbname $DatabaseUrl --command $query).Trim()
    if ($LASTEXITCODE -ne 0 -or $status -ne "ok") { $failures += $table }
}
if ($failures.Count -gt 0) { throw "Missing required PostgreSQL tables: $($failures -join ', ')" }

$health = (& $psql --tuples-only --no-align --dbname $DatabaseUrl --command "SELECT json_build_object('database', current_database(), 'server_version', current_setting('server_version'), 'desk_documents', (SELECT count(*) FROM desk_documents), 'market_candles', (SELECT count(*) FROM market_candles), 'news_articles', (SELECT count(*) FROM news_articles), 'news_ingestion_runs', (SELECT count(*) FROM news_ingestion_runs), 'schema_migrations', (SELECT count(*) FROM desk_schema_migrations));").Trim()
if ($LASTEXITCODE -ne 0) { throw "PostgreSQL health query failed." }
Write-Host $health
Write-Host "Desk PostgreSQL validation passed."
