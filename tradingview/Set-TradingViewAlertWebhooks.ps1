<#
Normalizes the five Desk batch alerts in an already connected local TradingView
session. The authenticated endpoint is read from the Windows clipboard and is
never persisted by this script.
#>
param(
    [string[]]$AlertPrefixes = @(
        "TVAutomation Market Feed Batch M1:",
        "TVAutomation Market Feed Batch M5:",
        "TVAutomation Market Feed Batch M15:",
        "TVAutomation Market Feed Batch H1:",
        "TVAutomation Market Feed Batch H4:"
    )
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type @"
using System;
using System.Runtime.InteropServices;

public static class TradingViewNativeInput
{
    [DllImport("user32.dll")]
    public static extern bool SetProcessDPIAware();

    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    public static extern bool SetCursorPos(int x, int y);

    [DllImport("user32.dll")]
    public static extern void mouse_event(
        uint flags,
        uint dx,
        uint dy,
        uint data,
        UIntPtr extraInfo
    );
}
"@

[TradingViewNativeInput]::SetProcessDPIAware() | Out-Null

function Get-ChromeRoot {
    $process = Get-Process chrome |
        Where-Object { $_.MainWindowHandle -ne 0 } |
        Sort-Object StartTime |
        Select-Object -First 1
    if (-not $process) {
        throw "A visible Chrome window is required."
    }

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
    if (-not $root) {
        throw "Chrome accessibility root is unavailable."
    }
    [TradingViewNativeInput]::SetForegroundWindow($process.MainWindowHandle) | Out-Null
    return $root
}

function Get-AllElements {
    param([System.Windows.Automation.AutomationElement]$Root)

    return $Root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
}

function Find-Element {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [System.Windows.Automation.ControlType]$ControlType,
        [string]$Name,
        [string]$AutomationId = ""
    )

    $elements = Get-AllElements -Root $Root
    for ($index = 0; $index -lt $elements.Count; $index++) {
        $element = $elements.Item($index)
        if ($ControlType -and $element.Current.ControlType -ne $ControlType) {
            continue
        }
        if ($Name -and $element.Current.Name -ne $Name) {
            continue
        }
        if ($AutomationId -and $element.Current.AutomationId -ne $AutomationId) {
            continue
        }
        return $element
    }
    return $null
}

function Wait-Element {
    param(
        [System.Windows.Automation.ControlType]$ControlType,
        [string]$Name,
        [string]$AutomationId = "",
        [int]$TimeoutSeconds = 10
    )

    $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
    do {
        $root = Get-ChromeRoot
        $element = Find-Element `
            -Root $root `
            -ControlType $ControlType `
            -Name $Name `
            -AutomationId $AutomationId
        if ($element) {
            return $element
        }
        Start-Sleep -Milliseconds 150
    } while ([DateTime]::UtcNow -lt $deadline)

    throw "Timed out waiting for UI element '$Name' '$AutomationId'."
}

function Invoke-Element {
    param([System.Windows.Automation.AutomationElement]$Element)

    $pattern = $Element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $pattern.Invoke()
}

function Invoke-DoubleClick {
    param([System.Windows.Automation.AutomationElement]$Element)

    $rectangle = $Element.Current.BoundingRectangle
    if ($rectangle.IsEmpty) {
        throw "The TradingView alert row is not visible."
    }
    $scrollPattern = $null
    if (
        $Element.TryGetCurrentPattern(
            [System.Windows.Automation.ScrollItemPattern]::Pattern,
            [ref]$scrollPattern
        )
    ) {
        $scrollPattern.ScrollIntoView()
        Start-Sleep -Milliseconds 100
        $rectangle = $Element.Current.BoundingRectangle
    }

    $x = [int]($rectangle.X + ($rectangle.Width / 2))
    $y = [int]($rectangle.Y + ($rectangle.Height / 2))
    [TradingViewNativeInput]::SetCursorPos($x, $y) | Out-Null
    Start-Sleep -Milliseconds 100
    1..2 | ForEach-Object {
        [TradingViewNativeInput]::mouse_event(0x0002, 0, 0, 0, [UIntPtr]::Zero)
        [TradingViewNativeInput]::mouse_event(0x0004, 0, 0, 0, [UIntPtr]::Zero)
        Start-Sleep -Milliseconds 120
    }
}

function Select-TradingViewTab {
    $root = Get-ChromeRoot
    $elements = Get-AllElements -Root $root
    for ($index = 0; $index -lt $elements.Count; $index++) {
        $element = $elements.Item($index)
        if (
            $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::TabItem -and
            $element.Current.Name -match "MES1!|MNQ1!|MCL1!" -and
            $element.Current.Name -notmatch "Nakili|LinkedIn"
        ) {
            $pattern = $element.GetCurrentPattern(
                [System.Windows.Automation.SelectionItemPattern]::Pattern
            )
            $pattern.Select()
            Start-Sleep -Milliseconds 500
            return
        }
    }
    throw "The connected TradingView tab was not found."
}

function Close-OpenAlertEditor {
    $root = Get-ChromeRoot
    $apply = Find-Element `
        -Root $root `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name "Apply"
    if ($apply) {
        Invoke-Element -Element $apply
        Start-Sleep -Milliseconds 250
    }

    $root = Get-ChromeRoot
    $save = Find-Element `
        -Root $root `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name "Save"
    if ($save) {
        Invoke-Element -Element $save
        Start-Sleep -Milliseconds 500
    }
}

function Open-AlertEditor {
    param([string]$AlertPrefix)

    $root = Get-ChromeRoot
    $elements = Get-AllElements -Root $root
    $title = $null
    for ($index = 0; $index -lt $elements.Count; $index++) {
        $element = $elements.Item($index)
        if (
            $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
            $element.Current.Name.StartsWith($AlertPrefix, [StringComparison]::Ordinal)
        ) {
            $title = $element
            break
        }
    }
    if (-not $title) {
        throw "TradingView alert '$AlertPrefix' was not found."
    }

    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $row = $walker.GetParent($walker.GetParent($title))
    if (-not $row) {
        throw "TradingView alert row '$AlertPrefix' is unavailable."
    }
    Invoke-Element -Element $row
    Start-Sleep -Milliseconds 250

    $root = Get-ChromeRoot
    $elements = Get-AllElements -Root $root
    $title = $null
    for ($index = 0; $index -lt $elements.Count; $index++) {
        $element = $elements.Item($index)
        if (
            $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Text -and
            $element.Current.Name.StartsWith($AlertPrefix, [StringComparison]::Ordinal)
        ) {
            $title = $element
            break
        }
    }
    if (-not $title) {
        throw "TradingView alert '$AlertPrefix' disappeared after selection."
    }

    $walker = [System.Windows.Automation.TreeWalker]::RawViewWalker
    $row = $walker.GetParent($walker.GetParent($title))
    $rowRectangle = $row.Current.BoundingRectangle
    [TradingViewNativeInput]::SetCursorPos(
        [int]($rowRectangle.X + $rowRectangle.Width - 50),
        [int]($rowRectangle.Y + 20)
    ) | Out-Null
    Start-Sleep -Milliseconds 250
    $rowElements = $row.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    $edit = $null
    for ($index = 0; $index -lt $rowElements.Count; $index++) {
        $element = $rowElements.Item($index)
        if (
            $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
            [string]::IsNullOrEmpty($element.Current.Name)
        ) {
            $edit = $element
            break
        }
    }
    if (-not $edit) {
        throw "TradingView edit action '$AlertPrefix' is unavailable."
    }
    $editRectangle = $edit.Current.BoundingRectangle
    [TradingViewNativeInput]::SetCursorPos(
        [int]($editRectangle.X + ($editRectangle.Width / 2)),
        [int]($editRectangle.Y + ($editRectangle.Height / 2))
    ) | Out-Null
    Start-Sleep -Milliseconds 200
    Invoke-Element -Element $edit
    Start-Sleep -Milliseconds 400

    $root = Get-ChromeRoot
    $webhook = Find-Element `
        -Root $root `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name "Webhook"
    if (-not $webhook) {
        $elements = Get-AllElements -Root $root
        for ($index = 0; $index -lt $elements.Count; $index++) {
            $element = $elements.Item($index)
            $rectangle = $element.Current.BoundingRectangle
            if (
                $element.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and
                [string]::IsNullOrEmpty($element.Current.Name) -and
                $rectangle.Y -ge $rowRectangle.Y -and
                $rectangle.Y -lt ($rowRectangle.Y + $rowRectangle.Height)
            ) {
                Invoke-Element -Element $element
                Start-Sleep -Milliseconds 300
                $root = Get-ChromeRoot
                $webhook = Find-Element `
                    -Root $root `
                    -ControlType ([System.Windows.Automation.ControlType]::Button) `
                    -Name "Webhook"
                if (-not $webhook) {
                    [TradingViewNativeInput]::SetCursorPos(
                        [int]($rectangle.X + ($rectangle.Width / 2)),
                        [int]($rectangle.Y + ($rectangle.Height / 2))
                    ) | Out-Null
                    [TradingViewNativeInput]::mouse_event(
                        0x0002,
                        0,
                        0,
                        0,
                        [UIntPtr]::Zero
                    )
                    [TradingViewNativeInput]::mouse_event(
                        0x0004,
                        0,
                        0,
                        0,
                        [UIntPtr]::Zero
                    )
                }
                break
            }
        }
    }
    Wait-Element `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name "Webhook" | Out-Null
}

function Open-WebhookSettings {
    $button = Wait-Element `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name "Webhook"
    Invoke-Element -Element $button
    Wait-Element `
        -ControlType ([System.Windows.Automation.ControlType]::Edit) `
        -Name "https://example.com/alert-hook" `
        -AutomationId "webhook-url" | Out-Null
}

function Set-WebhookSettings {
    param([string]$ExpectedUrl)

    $root = Get-ChromeRoot
    $edit = Find-Element `
        -Root $root `
        -ControlType ([System.Windows.Automation.ControlType]::Edit) `
        -Name "https://example.com/alert-hook" `
        -AutomationId "webhook-url"
    $checkbox = Find-Element `
        -Root $root `
        -ControlType ([System.Windows.Automation.ControlType]::CheckBox) `
        -Name "Webhook URL"
    if (-not $edit -or -not $checkbox) {
        throw "TradingView webhook controls are unavailable."
    }

    $toggle = $checkbox.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    if ($toggle.Current.ToggleState -ne [System.Windows.Automation.ToggleState]::On) {
        $toggle.Toggle()
    }

    $value = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    if ($value.Current.Value -cne $ExpectedUrl) {
        $value.SetValue($ExpectedUrl)
    }

    $apply = Wait-Element `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name "Apply"
    Invoke-Element -Element $apply

    $save = Wait-Element `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name "Save"
    Invoke-Element -Element $save
    Start-Sleep -Milliseconds 600
}

function Read-WebhookSettings {
    param([string]$ExpectedUrl)

    $root = Get-ChromeRoot
    $edit = Find-Element `
        -Root $root `
        -ControlType ([System.Windows.Automation.ControlType]::Edit) `
        -Name "https://example.com/alert-hook" `
        -AutomationId "webhook-url"
    $checkbox = Find-Element `
        -Root $root `
        -ControlType ([System.Windows.Automation.ControlType]::CheckBox) `
        -Name "Webhook URL"
    if (-not $edit -or -not $checkbox) {
        throw "TradingView webhook controls are unavailable during verification."
    }

    $value = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $toggle = $checkbox.GetCurrentPattern([System.Windows.Automation.TogglePattern]::Pattern)
    return [pscustomobject]@{
        endpoint_match = $value.Current.Value -ceq $ExpectedUrl
        webhook_enabled = $toggle.Current.ToggleState -eq [System.Windows.Automation.ToggleState]::On
    }
}

$expectedUrl = Get-Clipboard -Raw
if (
    $expectedUrl -notmatch
    "^https://vps-6d6969db\.vps\.ovh\.net/api/v1/webhooks/tradingview\?token=.{24,}$"
) {
    throw "The clipboard does not contain the authenticated Desk webhook URL."
}

Select-TradingViewTab
Close-OpenAlertEditor

$results = @()
foreach ($prefix in $AlertPrefixes) {
    Open-AlertEditor -AlertPrefix $prefix
    Open-WebhookSettings
    Set-WebhookSettings -ExpectedUrl $expectedUrl

    Open-AlertEditor -AlertPrefix $prefix
    Open-WebhookSettings
    $verification = Read-WebhookSettings -ExpectedUrl $expectedUrl

    $apply = Wait-Element `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name "Apply"
    Invoke-Element -Element $apply
    $save = Wait-Element `
        -ControlType ([System.Windows.Automation.ControlType]::Button) `
        -Name "Save"
    Invoke-Element -Element $save
    Start-Sleep -Milliseconds 500

    $results += [pscustomobject]@{
        alert = $prefix.TrimEnd(":")
        endpoint_match = $verification.endpoint_match
        webhook_enabled = $verification.webhook_enabled
    }
}

Set-Clipboard -Value "Desk TradingView webhook configured"

if ($results.endpoint_match -contains $false -or $results.webhook_enabled -contains $false) {
    throw "At least one TradingView webhook alert failed verification."
}

[pscustomobject]@{
    ok = $true
    endpoint_host = "vps-6d6969db.vps.ovh.net"
    endpoint_path = "/api/v1/webhooks/tradingview"
    alerts = $results
} | ConvertTo-Json -Depth 4 -Compress
