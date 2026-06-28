param(
    [int]$Port = 5080
)

$backendPath = Join-Path $PSScriptRoot "Backend"
$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1

if ($null -ne $listener) {
    Stop-Process -Id $listener.OwningProcess -Force
    Write-Host "Stopped process $($listener.OwningProcess) on port $Port"
}

Set-Location $backendPath

dotnet run --urls "http://0.0.0.0:$Port"
