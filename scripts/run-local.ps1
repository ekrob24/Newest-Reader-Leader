<#
.SYNOPSIS
  Run Reader Leader on this machine for hands-on testing, microphone included.

.DESCRIPTION
  The Windows equivalent of scripts/run-local.sh. One command, because the sequence has two
  steps that fail quietly when done in the wrong order: VITE_APP_ID has to be set before the
  build (it is baked into the client bundle, and its absence looks exactly like a wrong
  password), and the database has to be migrated and seeded before the app starts.

  Needs Node 22, pnpm, and a MySQL 8 on 127.0.0.1:3306. If MySQL is missing this script says
  so and gives you the one command that starts one.

.EXAMPLE
  .\scripts\run-local.ps1
#>
param(
  # The MySQL root password on this machine. Whatever you chose when you installed MySQL.
  [string]$MysqlPassword = $env:MYSQL_ROOT_PASSWORD
)
$ErrorActionPreference = "Stop"

Set-Location (Join-Path $PSScriptRoot "..")

function Require-Command($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    Write-Host "Missing: $name" -ForegroundColor Red
    Write-Host "  $hint"
    exit 1
  }
}

Require-Command "node" "Install Node 22 from https://nodejs.org"
Require-Command "pnpm" "Run: npm install -g pnpm"

# A TCP probe rather than a mysql client, which you may not have installed.
$mysqlUp = $false
try {
  $probe = New-Object System.Net.Sockets.TcpClient
  $probe.Connect("127.0.0.1", 3306)
  $mysqlUp = $probe.Connected
  $probe.Close()
} catch { $mysqlUp = $false }

if (-not $mysqlUp) {
  Write-Host "No MySQL is listening on 127.0.0.1:3306." -ForegroundColor Red
  Write-Host ""
  Write-Host "With Docker Desktop:"
  Write-Host '  docker run -d --name rl-mysql -e MYSQL_ROOT_PASSWORD=rlroot -p 3306:3306 mysql:8.0'
  Write-Host ""
  Write-Host "Without Docker, install MySQL Server 8 and start it, then re-run this with the"
  Write-Host "root password you chose:"
  Write-Host '  powershell -ExecutionPolicy Bypass -File .\scripts\run-local.ps1 -MysqlPassword "yourpassword"'
  Write-Host ""
  Write-Host "Wait about thirty seconds after starting MySQL before trying again."
  exit 1
}

if (-not $env:DATABASE_URL) {
  # The script creates the database itself, so only the server and a working root login
  # have to exist beforehand.
  $password = if ($MysqlPassword) { [uri]::EscapeDataString($MysqlPassword) } else { "rlroot" }
  $env:DATABASE_URL = "mysql://root:$password@127.0.0.1:3306/rl_local"
}
if (-not $env:JWT_SECRET)   { $env:JWT_SECRET   = "local-development-secret" }
if (-not $env:VITE_APP_ID)  { $env:VITE_APP_ID  = "reader-leader-local" }
if (-not $env:PORT)         { $env:PORT         = "3100" }
if (-not $env:READER_LEADER_CHILD_DEMO_PASSWORD)   { $env:READER_LEADER_CHILD_DEMO_PASSWORD   = "reader-child-2026" }
if (-not $env:READER_LEADER_TEACHER_DEMO_PASSWORD) { $env:READER_LEADER_TEACHER_DEMO_PASSWORD = "reader-teacher-2026" }
if (-not $env:READER_LEADER_PARENT_DEMO_PASSWORD)  { $env:READER_LEADER_PARENT_DEMO_PASSWORD  = "reader-parent-2026" }
$env:NODE_ENV = "production"

Write-Host "Installing dependencies..." -ForegroundColor Cyan
pnpm install --frozen-lockfile

Write-Host "Preparing the database..." -ForegroundColor Cyan
pnpm seed:preview
if ($LASTEXITCODE -ne 0) {
  Write-Host "(database already seeded, or MySQL refused the login - continuing)"
}

Write-Host "Building..." -ForegroundColor Cyan
pnpm build
if ($LASTEXITCODE -ne 0) { exit 1 }

Write-Host ""
Write-Host "Open  http://localhost:$($env:PORT)" -ForegroundColor Green
Write-Host "  Child    child1   / $($env:READER_LEADER_CHILD_DEMO_PASSWORD)"
Write-Host "  Teacher  teacher2 / $($env:READER_LEADER_TEACHER_DEMO_PASSWORD)"
Write-Host "  Parent   parent3  / $($env:READER_LEADER_PARENT_DEMO_PASSWORD)"
Write-Host ""
Write-Host "Use localhost, not 127.0.0.1: browsers only grant microphone access on localhost or HTTPS."
Write-Host ""

node dist/index.js
