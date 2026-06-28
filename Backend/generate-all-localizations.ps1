param(
    [string]$ServerUrl = "http://localhost:5080",
    [string]$AdminToken = ""
)

if (-not $AdminToken) {
    Write-Host "Usage: .\generate-all-localizations.ps1 -AdminToken '<admin-token>' [-ServerUrl 'http://localhost:5080']"
    exit 1
}

$headers = @{
    Authorization = "Bearer $AdminToken"
    "Content-Type" = "application/json"
}

try {
    $response = Invoke-RestMethod -Method Post -Uri "$ServerUrl/api/admin/localizations/generate-all" -Headers $headers -Body '{}' -ErrorAction Stop
    Write-Host "Response:";
    $response | ConvertTo-Json -Depth 5
} catch {
    Write-Error "Request failed: $_"
    exit 1
}
