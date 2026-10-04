param([Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{7,40}$')][string]$Revision)
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
$release="C:\DeskOos\releases\$Revision"
$root='C:\ProgramData\DeskOos'
$serviceRoot=Join-Path $root 'services'
$wrapper=Join-Path $serviceRoot 'DeskOosResearch.exe'
$xmlPath=Join-Path $serviceRoot 'DeskOosResearch.xml'
if (!(Test-Path (Join-Path $release 'mcp_gpt_desk\scripts\run_oos_research_scheduler.mjs'))) {throw 'RESEARCH_SCHEDULER_RELEASE_MISSING'}
& icacls (Join-Path $root 'config\oos.research.env') /inheritance:r /grant:r '*S-1-5-18:F' '*S-1-5-32-544:F'|Out-Null
if($LASTEXITCODE -ne 0){throw 'RESEARCH_ENV_ACL_FAILED'}
$exists=Get-Service DeskOosResearch -ErrorAction SilentlyContinue
if ($exists) {Stop-Service DeskOosResearch}
if (!(Test-Path $wrapper)) {Copy-Item (Join-Path $serviceRoot 'DeskOos.exe') $wrapper}
$xml=@"
<service>
  <id>DeskOosResearch</id><name>Desk OOS Research</name>
  <description>Isolated research queue; no OOS command or live promotion port.</description>
  <executable>C:\Program Files\nodejs\node.exe</executable>
  <arguments>--env-file="C:\ProgramData\DeskOos\config\oos.research.env" "$release\mcp_gpt_desk\scripts\run_oos_research_scheduler.mjs" --enqueue-corpus</arguments>
  <workingdirectory>$release\mcp_gpt_desk</workingdirectory>
  <startmode>Automatic</startmode><stoptimeout>30sec</stoptimeout>
  <logpath>C:\ProgramData\DeskOos\logs\research</logpath>
  <log mode="roll-by-size"><sizeThreshold>10240</sizeThreshold><keepFiles>10</keepFiles></log>
  <onfailure action="restart" delay="10sec"/><onfailure action="restart" delay="30sec"/>
  <onfailure action="restart" delay="60sec"/><resetfailure>1hour</resetfailure>
</service>
"@
[IO.File]::WriteAllText($xmlPath,$xml,[Text.UTF8Encoding]::new($false))
New-Item -ItemType Directory -Force (Join-Path $root 'logs\research')|Out-Null
if (!$exists) {& $wrapper install;if($LASTEXITCODE -ne 0){throw 'RESEARCH_SCHEDULER_INSTALL_FAILED'}}
Start-Service DeskOosResearch
if ((Get-Service DeskOosResearch).Status -ne 'Running') {throw 'RESEARCH_SCHEDULER_START_FAILED'}
Write-Output 'RESEARCH_SCHEDULER=RUNNING'
