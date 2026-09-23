#Requires -Version 5.1
<#
  ProBruno - builds this Bruno checkout and installs it per-user on Windows,
  leaving an official Bruno install and its data alone.

  Run it from inside a Bruno checkout, on the branch you want to build:
    .\scripts\probruno.ps1

  No administrator rights needed: the installer is built one-click/per-user with
  elevation disabled, so it lands in %LOCALAPPDATA%\Programs\ProBruno.

  Needs Node 22.x (.nvmrc pins v22.12.0), git and npm on PATH.

  Examples:
    .\scripts\probruno.ps1
    .\scripts\probruno.ps1 -ProductName 'Bruno Dev' -SkipInstall
#>
[CmdletBinding()]
param(
  [string] $ProductName = 'ProBruno',
  [string] $AppId       = 'com.usebruno.app.probruno',
  [string] $DataName    = 'probruno',
  [switch] $SkipInstall
)

$ErrorActionPreference = 'Stop'

function Say  { param([string] $Message) Write-Host "`n=== $Message" -ForegroundColor Cyan }
function Die  { param([string] $Message) Write-Host "error: $Message" -ForegroundColor Red; exit 1 }

function Run {
  param([string] $Exe, [string[]] $Arguments)
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) { Die "$Exe $($Arguments -join ' ') exited with $LASTEXITCODE" }
}

function Require-Command {
  param([string] $Name, [string] $Hint)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) { Die "$Name not found on PATH - $Hint" }
}

# ---------- preflight ----------
Say 'Preflight'
Require-Command 'git'  'install Git for Windows'
Require-Command 'node' 'install Node 22 (nvm install 22.12.0, or winget install OpenJS.NodeJS.LTS)'
Require-Command 'npm'  'ships with Node'
Require-Command 'npx'  'ships with npm'

$nodeVersion = (& node --version).Trim()
if ($nodeVersion -notmatch '^v22\.') { Die "Node $nodeVersion found, need v22.x (.nvmrc pins v22.12.0)" }

switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { $archFlag = '--x64' }
  'ARM64' { $archFlag = '--arm64' }
  default { Die "unsupported processor architecture: $env:PROCESSOR_ARCHITECTURE" }
}
Write-Host "node $nodeVersion, npm $((& npm --version).Trim()), building $archFlag"

# ---------- source ----------
# Build whatever checkout this script sits in, on whatever branch is current.
# Nothing is fetched, checked out or reset: switching branches stays your call.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RepoDir = (& git -C $scriptDir rev-parse --show-toplevel 2>$null)
if ($LASTEXITCODE -ne 0 -or -not $RepoDir) { Die 'run this from inside a Bruno checkout' }
$RepoDir = $RepoDir.Trim()
Set-Location $RepoDir

Say 'Source'
Write-Host "repo    $RepoDir"
Write-Host "branch  $((& git rev-parse --abbrev-ref HEAD).Trim())"
Write-Host "commit  $((& git log -1 --format='%h %ad %s' --date=short).Trim())"
if ((& git status --porcelain --untracked-files=no)) {
  Write-Host 'note    working tree has uncommitted changes; they will be built too'
}

# ---------- dependencies ----------
Say 'Installing dependencies (a few minutes)'
& npm ci
if ($LASTEXITCODE -ne 0) {
  Write-Host 'npm ci failed, retrying as documented in contributing.md' -ForegroundColor Yellow
  Run 'npm' @('i', '--legacy-peer-deps')
}

# ---------- packages ----------
Say 'Building workspace packages'
$targets = @(
  'build:graphql-docs', 'build:bruno-query', 'build:bruno-common',
  'build:bruno-converters', 'build:bruno-requests', 'build:schema-types',
  'build:bruno-filestore'
)
foreach ($target in $targets) {
  Write-Host "  $target"
  Run 'npm' @('run', $target)
}
Write-Host '  sandbox:bundle-libraries'
Run 'npm' @('run', 'sandbox:bundle-libraries', '--workspace=packages/bruno-js')

Say 'Building the web bundle'
Run 'npm' @('run', 'build:web')

# ---------- stage the renderer ----------
# What scripts/build-electron.sh does, without sed. Files are rewritten as UTF-8
# without BOM via .NET, because Set-Content on PowerShell 5.1 defaults to ANSI
# and would mangle non-ASCII content.
Say 'Staging the renderer into bruno-electron\web'
$electronDir = Join-Path $RepoDir 'packages\bruno-electron'
$webDir      = Join-Path $electronDir 'web'
$appDist     = Join-Path $RepoDir 'packages\bruno-app\dist'

if (-not (Test-Path $appDist)) { Die "web bundle missing at $appDist" }
Remove-Item (Join-Path $electronDir 'out') -Recurse -Force -ErrorAction SilentlyContinue
Remove-Item $webDir -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $webDir -Force | Out-Null
Copy-Item (Join-Path $appDist '*') $webDir -Recurse -Force

$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
foreach ($html in Get-ChildItem $webDir -Filter '*.html' -File) {
  $text = [System.IO.File]::ReadAllText($html.FullName)
  [System.IO.File]::WriteAllText($html.FullName, $text.Replace('/static/', 'static/'), $utf8NoBom)
}
$cssDir = Join-Path $webDir 'static\css'
if (Test-Path $cssDir) {
  foreach ($css in Get-ChildItem $cssDir -Filter '*.css' -File) {
    $text = [System.IO.File]::ReadAllText($css.FullName)
    [System.IO.File]::WriteAllText($css.FullName, $text.Replace('/static/font', '../../static/font'), $utf8NoBom)
  }
}
Get-ChildItem $webDir -Filter '*.map' -Recurse -File | Remove-Item -Force

# ---------- package ----------
# appId / productName / extraMetadata.name keep this build separate from an
# official Bruno install and from its %APPDATA% data directory.
# oneClick + perMachine=false + allowElevation=false is what makes the installer
# runnable without administrator rights: it installs under %LOCALAPPDATA%.
# The config already sets win.sign = null, so nothing needs signing.
Say "Packaging $ProductName (nsis, per-user, unsigned)"
Set-Location $electronDir
Run 'npx' @(
  'electron-builder', '--win', 'nsis', $archFlag,
  '--config', 'electron-builder-config.js',
  "-c.appId=$AppId",
  "-c.productName=$ProductName",
  "-c.extraMetadata.name=$DataName",
  '-c.nsis.oneClick=true',
  '-c.nsis.perMachine=false',
  '-c.nsis.allowElevation=false',
  # The config sets allowToChangeInstallationDirectory, which electron-builder
  # rejects for a one-click installer. Turn it off for this build.
  '-c.nsis.allowToChangeInstallationDirectory=false'
)

$installer = Get-ChildItem (Join-Path $electronDir 'out') -Filter '*.exe' -File |
             Sort-Object LastWriteTime -Descending | Select-Object -First 1
if (-not $installer) { Die 'no installer produced' }
Write-Host ("built {0} ({1:N0} MB)" -f $installer.Name, ($installer.Length / 1MB))

# ---------- install ----------
if ($SkipInstall) {
  Say 'Skipping install'
  Write-Host "Installer: $($installer.FullName)"
  exit 0
}

Say "Installing $ProductName for the current user"
# A one-click installer installs immediately and launches the app when done.
# SmartScreen may warn first, since the build is unsigned: More info -> Run anyway.
Start-Process -FilePath $installer.FullName -Wait

$installDir = Join-Path $env:LOCALAPPDATA "Programs\$ProductName"
$dataDir    = Join-Path $env:APPDATA $DataName

Say 'Done'
if (Test-Path $installDir) {
  Write-Host "Installed  $installDir"
} else {
  Write-Host "Installer finished, but $installDir is not there." -ForegroundColor Yellow
  Write-Host "Check Start Menu for $ProductName, or run the installer yourself: $($installer.FullName)"
}
Write-Host "Data dir   $dataDir  (an official Bruno keeps its own)"
Write-Host "Uninstall  Settings > Apps > Installed apps > $ProductName"
