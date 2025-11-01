Param(
  [string]$Username,
  [string]$Month,
  [string]$Category,
  [switch]$All,
  [switch]$Force,
  [switch]$DryRun,
  [string]$DbContainer = "capstone-db",
  [string]$DbName = "capstone",
  [string]$DbUser = "capstone",
  [string]$DbPassword = "capstone"
)

# Delete receipts directly in Postgres running in Docker.
# Requires Docker and the Postgres container running (docker-compose up -d db).
# Examples:
#   ./scripts/clear-receipts-docker.ps1 -All
#   ./scripts/clear-receipts-docker.ps1 -Username tester
#   ./scripts/clear-receipts-docker.ps1 -Username tester -Month 2025-10
#   ./scripts/clear-receipts-docker.ps1 -Category Groceries -Force

$ErrorActionPreference = 'Stop'

# If no filters provided, default to ALL (with confirmation) to reduce friction
if (-not $All -and -not $Username -and -not $Month -and -not $Category) {
  Write-Warning "No filters provided; will target ALL receipts unless you cancel."
  $All = $true
}

function EscapeSql([string]$s) {
  if ([string]::IsNullOrEmpty($s)) { return "" }
  return $s.Replace("'", "''")
}

# Build SQL conditions
$conditions = @()
$useJoin = $false

if (-not $All) {
  if ($Username) {
    $uname = EscapeSql $Username
    $conditions += "r.user_id = u.id"
    $conditions += "u.username = '$uname'"
    $useJoin = $true
  }
  if ($Month) {
    try {
      $parts = $Month.Replace('/', '-').Split('-')
      if ($parts.Count -ge 2) {
        $y = [int]$parts[0]
        $m = [int]$parts[1]
        $conditions += "r.year = $y"
        $conditions += "r.month = $m"
      }
    } catch {}
  }
  if ($Category) {
    $cat = EscapeSql $Category
    $conditions += "LOWER(r.category) = LOWER('$cat')"
  }
}

$whereClause = ""
if ($conditions.Count -gt 0) { $whereClause = "WHERE " + ($conditions -join " AND ") }

# SELECT with optional JOIN
if ($useJoin) {
  $selectSql = "SELECT COUNT(*) FROM financekit_receipt r JOIN auth_user u ON r.user_id = u.id $whereClause;"
} else {
  $selectSql = "SELECT COUNT(*) FROM financekit_receipt r $whereClause;"
}

# DELETEs (Postgres: DELETE ... USING). Delete child items first, then receipts.
# Build WHERE for items: ensure link i.receipt_id = r.id
$conditionsItems = @()
$conditionsItems += $conditions
$conditionsItems += "i.receipt_id = r.id"
$whereClauseItems = "WHERE " + ($conditionsItems -join " AND ")

if ($useJoin) {
  $deleteItemsSql = "DELETE FROM financekit_receiptitem i USING financekit_receipt r, auth_user u $whereClauseItems;"
  $deleteReceiptsSql = "DELETE FROM financekit_receipt r USING auth_user u $whereClause;"
} else {
  $deleteItemsSql = "DELETE FROM financekit_receiptitem i USING financekit_receipt r $whereClauseItems;"
  $deleteReceiptsSql = "DELETE FROM financekit_receipt r $whereClause;"
}

# Confirmation prompt unless forced
if (-not $Force) {
  $scope = ""
  if ($All) { $scope = "ALL receipts" } else {
    $parts = @()
    if ($Username) { $parts += "user=$Username" }
    if ($Month) { $parts += "month=$Month" }
    if ($Category) { $parts += "category=$Category" }
    $scope = ($parts -join ", ")
  }
  $ans = Read-Host "This will delete receipts ($scope) in Postgres container '$DbContainer'. Continue? (y/N)"
  if ($ans -ne 'y' -and $ans -ne 'Y') { Write-Host "Aborted"; exit 0 }
}

Write-Host ("[clear-receipts-docker] Container: {0}  DB: {1}  User: {2}" -f $DbContainer, $DbName, $DbUser)
Write-Host ("[clear-receipts-docker] SELECT SQL: {0}" -f $selectSql)
Write-Host ("[clear-receipts-docker] DELETE items SQL: {0}" -f $deleteItemsSql)
Write-Host ("[clear-receipts-docker] DELETE receipts SQL: {0}" -f $deleteReceiptsSql)

if ($DryRun) {
  Write-Host "[clear-receipts-docker] Dry run: not executing."
  exit 0
}

$env:PGPASSWORD = $DbPassword

function Invoke-DbSql([string]$sql) {
  $argsDocker = @(
    'exec','-i','-e',"PGPASSWORD=$DbPassword",
    $DbContainer,
    'psql','-v','ON_ERROR_STOP=1','-U',$DbUser,'-d',$DbName,'-t','-A','-c',$sql
  )
  $dockerCmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($dockerCmd) {
    return (& docker @argsDocker) 2>$null
  }
  $wslCmd = Get-Command wsl -ErrorAction SilentlyContinue
  if ($wslCmd) {
    $argsWsl = @('-e','docker') + $argsDocker
    return (& wsl @argsWsl) 2>$null
  }
  throw "docker CLI not found in PowerShell or WSL. Install Docker Desktop or ensure docker is on PATH."
}

# Get count
Write-Host "[clear-receipts-docker] Counting rows..."
$dCountRaw = Invoke-DbSql $selectSql
$dCount = ($dCountRaw | Out-String).Trim()
Write-Host "[clear-receipts-docker] About to delete $dCount receipts"

# Perform deletes
Write-Host "[clear-receipts-docker] Deleting items..."
Invoke-DbSql $deleteItemsSql | Out-Null
Write-Host "[clear-receipts-docker] Deleting receipts..."
Invoke-DbSql $deleteReceiptsSql | Out-Null

Write-Host "[clear-receipts-docker] Done."
