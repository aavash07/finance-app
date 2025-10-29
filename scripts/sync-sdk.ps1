# Packs rn-sdk and installs the tarball into mobile-app
$ErrorActionPreference = "Stop"

Push-Location "$PSScriptRoot/../rn-sdk"
try {
  Write-Host "Packing rn-sdk..." -ForegroundColor Cyan
  $packOutput = npm pack | Out-String
  $tarball = ($packOutput.Trim().Split([Environment]::NewLine) | Select-Object -Last 1).Trim()
  if (-not (Test-Path $tarball)) { throw "Pack did not produce a tarball" }
  Write-Host "Packed: $tarball" -ForegroundColor Green

  Push-Location "$PSScriptRoot/../mobile-app"
  try {
    Write-Host "Installing $tarball into mobile-app..." -ForegroundColor Cyan
    npm i "../rn-sdk/$tarball"
    Write-Host "Install complete. You may want to run: npx expo start -c" -ForegroundColor Green
  }
  finally { Pop-Location }
}
finally { Pop-Location }
