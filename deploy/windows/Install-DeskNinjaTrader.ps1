param(
    [string]$InstallRoot = "C:\DeskFutures",
    [string]$DataRoot = "C:\ProgramData\DeskFutures",
    [switch]$EnableAutoRestart
)

. (Join-Path $PSScriptRoot "DeskDeployment.Common.ps1")

$InstallRoot = Assert-DeskDeploymentPath -Path $InstallRoot -Label "InstallRoot"
$DataRoot = Assert-DeskDeploymentPath -Path $DataRoot -Label "DataRoot"
$projectRoot = Join-Path $InstallRoot "current"
$controlRoot = Join-Path $DataRoot "ninjatrader-control"
$stagingRoot = Join-Path $DataRoot "ninjatrader\addon-source"
$addonSource = Join-Path $projectRoot "integrations\ninjatrader\DeskExecutionAddOn\DeskExecutionAddOn.cs"
$installer = Join-Path $projectRoot "integrations\ninjatrader\windows\Install-DeskNinjaTraderSupervisor.ps1"
$ninjaProject = Join-Path $env:USERPROFILE "Documents\NinjaTrader 8\bin\Custom\NinjaTrader.Custom.csproj"

function Add-NinjaProjectReference {
    param(
        [Parameter(Mandatory = $true)][string]$ProjectPath,
        [Parameter(Mandatory = $true)][string]$ReferenceName
    )

    [xml]$projectXml = Get-Content -LiteralPath $ProjectPath -Raw -Encoding UTF8
    $existing = @($projectXml.SelectNodes("//*[local-name()='Reference']") |
        Where-Object { [string]$_.Include -eq $ReferenceName })
    if ($existing.Count -gt 0) { return $false }

    $projectNode = $projectXml.DocumentElement
    $namespaceUri = $projectNode.NamespaceURI
    $referenceNodes = @($projectXml.SelectNodes("//*[local-name()='Reference']"))
    if ($referenceNodes.Count -gt 0) {
        $itemGroup = $referenceNodes[0].ParentNode
    } else {
        $itemGroup = $projectXml.CreateElement("ItemGroup", $namespaceUri)
        [void]$projectNode.AppendChild($itemGroup)
    }
    $reference = $projectXml.CreateElement("Reference", $namespaceUri)
    $reference.SetAttribute("Include", $ReferenceName)
    [void]$itemGroup.AppendChild($reference)

    $backupPath = "$ProjectPath.desk-reference.bak"
    if (-not (Test-Path -LiteralPath $backupPath)) {
        Copy-Item -LiteralPath $ProjectPath -Destination $backupPath -Force
    }
    $settings = [System.Xml.XmlWriterSettings]::new()
    $settings.Encoding = [System.Text.UTF8Encoding]::new($false)
    $settings.Indent = $true
    $settings.OmitXmlDeclaration = $false
    $writer = [System.Xml.XmlWriter]::Create($ProjectPath, $settings)
    try { $projectXml.Save($writer) } finally { $writer.Dispose() }
    return $true
}

if (-not (Test-Path -LiteralPath $addonSource)) { throw "DeskExecutionAddOn source is missing: $addonSource" }
if (-not (Test-Path -LiteralPath $installer)) { throw "NinjaTrader supervisor installer is missing: $installer" }
New-Item -ItemType Directory -Path $stagingRoot, $controlRoot -Force | Out-Null
Copy-Item -LiteralPath $addonSource -Destination (Join-Path $stagingRoot "DeskExecutionAddOn.cs") -Force
$checksum = (Get-FileHash -LiteralPath $addonSource -Algorithm SHA256).Hash.ToLowerInvariant()
[System.IO.File]::WriteAllText((Join-Path $stagingRoot "DeskExecutionAddOn.cs.sha256"), "$checksum  DeskExecutionAddOn.cs`n", [System.Text.UTF8Encoding]::new($false))

if (Test-Path -LiteralPath $ninjaProject -PathType Leaf) {
    $addedReferences = @()
    foreach ($referenceName in @("System.Net.Http", "System.Web.Extensions")) {
        if (Add-NinjaProjectReference -ProjectPath $ninjaProject -ReferenceName $referenceName) {
            $addedReferences += $referenceName
        }
    }
    if ($addedReferences.Count -gt 0) {
        Write-Host "NinjaScript references added: $($addedReferences -join ', ')."
    } else {
        Write-Host "NinjaScript references already present."
    }
} else {
    Write-Warning "NinjaTrader.Custom.csproj is not available yet. Start NinjaTrader once, then rerun this installer before compiling the AddOn."
}

& $installer -ProjectRoot $projectRoot -ControlRoot $controlRoot -Enable:$EnableAutoRestart
Write-Host "NinjaTrader supervisor installed for the current interactive Windows user."
Write-Host "AddOn source staged at $stagingRoot (SHA256 $checksum). Import/compile it from NinjaTrader, then keep commands disabled until Sim acceptance."
