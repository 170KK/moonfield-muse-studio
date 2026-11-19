$pidFile = Join-Path $PSScriptRoot "data\pids.json"
if (Test-Path $pidFile) {
    $pids = Get-Content $pidFile -Raw | ConvertFrom-Json
    foreach ($p in @($pids.pool, $pids.agent, $pids.web)) {
        if ($p) { & taskkill.exe /PID $p /T /F 2>$null | Out-Null }
    }
    Remove-Item $pidFile -Force -ErrorAction SilentlyContinue
}
foreach ($port in @(18620, 17381, 3010)) {
    $conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    foreach ($c in $conns) {
        if ($c.OwningProcess) { & taskkill.exe /PID $c.OwningProcess /T /F 2>$null | Out-Null }
    }
}
Write-Output "Muse Studio stopped."
