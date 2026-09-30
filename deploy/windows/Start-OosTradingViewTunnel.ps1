param(
  [string]$SshKey = 'C:\Users\CES\.ssh\desk_ovh_ed25519',
  [string]$RemoteHost = 'Administrator@vps-6d6969db.vps.ovh.net'
)
$ErrorActionPreference = 'Stop'
if (!(Test-Path $SshKey -PathType Leaf)) { throw 'OOS_SSH_KEY_MISSING' }
# Loopback-only reverse tunnel. A lost workstation is a technical failure, never fake captures.
while ($true) {
  & "$env:WINDIR\System32\OpenSSH\ssh.exe" -4 -i $SshKey -o BatchMode=yes -o ConnectTimeout=10 -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -N -R '127.0.0.1:9222:127.0.0.1:9222' $RemoteHost
  Start-Sleep -Seconds 10
}
