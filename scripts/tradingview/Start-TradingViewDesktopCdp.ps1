[CmdletBinding()]
param(
  [int]$Port = 9222
)

$ErrorActionPreference = "Stop"

if (-not ("Desk.TradingView.ApplicationActivationManager" -as [type])) {
  Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Desk.TradingView
{
    [Flags]
    public enum ActivateOptions
    {
        None = 0,
        DesignMode = 1,
        NoErrorUi = 2,
        NoSplashScreen = 4
    }

    [ComImport]
    [Guid("45BA127D-10A8-46EA-8AB7-56EA9078943C")]
    public class ApplicationActivationManager
    {
    }

    [ComImport]
    [Guid("2e941141-7f97-4756-ba1d-9decde894a3d")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    public interface IApplicationActivationManager
    {
        [PreserveSig]
        int ActivateApplication(
            [MarshalAs(UnmanagedType.LPWStr)] string appUserModelId,
            [MarshalAs(UnmanagedType.LPWStr)] string arguments,
            ActivateOptions options,
            out uint processId);

        [PreserveSig]
        int ActivateForFile(IntPtr appUserModelId, IntPtr itemArray, IntPtr verb, out uint processId);

        [PreserveSig]
        int ActivateForProtocol(IntPtr appUserModelId, IntPtr itemArray, out uint processId);
    }

    public static class Launcher
    {
        public static uint Activate(string appUserModelId, string arguments)
        {
            var manager = (IApplicationActivationManager)new ApplicationActivationManager();
            uint processId;
            int result = manager.ActivateApplication(
                appUserModelId,
                arguments,
                ActivateOptions.None,
                out processId);
            Marshal.ThrowExceptionForHR(result);
            return processId;
        }
    }
}
"@
}

$package = Get-AppxPackage "*TradingView*" | Select-Object -First 1
if (-not $package) {
  throw "TRADINGVIEW_DESKTOP_PACKAGE_NOT_FOUND"
}

$appUserModelId = "$($package.PackageFamilyName)!TradingView.Desktop"
$processId = [Desk.TradingView.Launcher]::Activate(
  $appUserModelId,
  "--remote-debugging-port=$Port"
)

$deadline = [DateTime]::UtcNow.AddSeconds(30)
do {
  Start-Sleep -Milliseconds 500
  $listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue |
    Select-Object -First 1
} while (-not $listener -and [DateTime]::UtcNow -lt $deadline)

if (-not $listener) {
  throw "TRADINGVIEW_CDP_LISTENER_NOT_READY:$Port"
}

[pscustomobject]@{
  status = "ready"
  app_user_model_id = $appUserModelId
  process_id = $processId
  cdp_port = $Port
  listening = $true
} | ConvertTo-Json
