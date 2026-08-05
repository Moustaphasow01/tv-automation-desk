param(
    [Parameter(Mandatory = $true)][string]$SourceDatabaseUrl,
    [Parameter(Mandatory = $true)][string]$TargetDatabaseUrl,
    [string]$PostgresBin = ""
)

. (Join-Path $PSScriptRoot "DeskDatabase.Common.ps1")

$psql = Resolve-DeskPostgresTool -Name "psql" -PostgresBin $PostgresBin
$tables = @(
    @{ Name = "desk_documents"; Key = "collection || ':' || document_id" },
    @{ Name = "market_candles"; Key = "feed_id::text || ':' || timestamp_utc::text" },
    @{ Name = "market_feeds"; Key = "feed_id::text" },
    @{ Name = "tradingview_events"; Key = "event_id::text" },
    @{ Name = "desk_pack_objects"; Key = "object_id::text" },
    @{ Name = "trade_decisions"; Key = "trade_decision_id::text" },
    @{ Name = "trade_order_intents"; Key = "order_intent_id::text" },
    @{ Name = "trades"; Key = "trade_id::text" }
)

$results = @()
$failed = $false
foreach ($table in $tables) {
    $existsQuery = "SELECT to_regclass('public.$($table.Name)') IS NOT NULL;"
    $sourceExists = (& $psql -At --dbname $SourceDatabaseUrl --command $existsQuery).Trim()
    $targetExists = (& $psql -At --dbname $TargetDatabaseUrl --command $existsQuery).Trim()
    if ($sourceExists -ne "t" -and $targetExists -ne "t") { continue }
    if ($sourceExists -ne "t" -or $targetExists -ne "t") {
        $results += [pscustomobject]@{ Table = $table.Name; Source = $sourceExists; Target = $targetExists; Match = $false }
        $failed = $true
        continue
    }
    $query = "SELECT count(*)::text || '|' || COALESCE(sum(hashtext(($($table.Key))::text))::text, '0') FROM $($table.Name);"
    $source = (& $psql -At --dbname $SourceDatabaseUrl --command $query).Trim()
    $target = (& $psql -At --dbname $TargetDatabaseUrl --command $query).Trim()
    $match = $source -eq $target
    if (-not $match) { $failed = $true }
    $results += [pscustomobject]@{ Table = $table.Name; Source = $source; Target = $target; Match = $match }
}

$results | Format-Table -AutoSize
if ($failed) { throw "Database parity failed. No cutover is allowed." }
Write-Host "Database parity passed."
