param(
  [switch]$Deep
)

function Remove-Path($path) {
  if (Test-Path $path) {
    Write-Host "Removing $path" -ForegroundColor Yellow
    Remove-Item -Recurse -Force -ErrorAction SilentlyContinue $path
  }
}

# Frontend caches and deps
Remove-Path "$PSScriptRoot/../mobile-app/node_modules"
Remove-Path "$PSScriptRoot/../mobile-app/.expo"
Remove-Path "$PSScriptRoot/../mobile-app/.expo-shared"

# RN SDK build artifacts
Remove-Path "$PSScriptRoot/../rn-sdk/dist"
Remove-Path "$PSScriptRoot/../rn-sdk/node_modules"
Get-ChildItem "$PSScriptRoot/../rn-sdk" -Filter "financekit-rn-sdk-*.tgz" -ErrorAction SilentlyContinue | ForEach-Object { Remove-Path $_.FullName }

# Example app deps (if installed)
Remove-Path "$PSScriptRoot/../rn-sdk/example-expo/node_modules"

if ($Deep) {
  # Python caches
  Remove-Path "$PSScriptRoot/../.pytest_cache"
  Remove-Path "$PSScriptRoot/../htmlcov"
  Get-ChildItem "$PSScriptRoot/.." -Recurse -Include "__pycache__" -Directory -ErrorAction SilentlyContinue | ForEach-Object { Remove-Path $_.FullName }
}

Write-Host "Clean complete." -ForegroundColor Green
