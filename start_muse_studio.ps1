$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
$dataDir = Join-Path $root "data"
$logDir = Join-Path $dataDir "logs"
$profileDir = Join-Path $dataDir "browser-profiles"
New-Item -ItemType Directory -Force -Path $logDir, (Join-Path $dataDir "agent"), $profileDir | Out-Null

$pidFile = Join-Path $dataDir "pids.json"

function Resolve-BrowserPath {
    $candidates = @(
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
        "$env:LocalAppData\Google\Chrome\Application\chrome.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:LocalAppData\Microsoft\Edge\Application\msedge.exe"
    )
    foreach ($c in $candidates) {
        if ($c -and (Test-Path $c)) { return $c }
    }
    foreach ($regPath in @(
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe",
        "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe",
        "HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\msedge.exe"
    )) {
        try {
            $val = (Get-ItemProperty -Path $regPath -ErrorAction SilentlyContinue).'(default)'
            if ($val -and (Test-Path $val)) { return $val }
        } catch {}
    }
    return ""
}

function Ensure-PythonVenv {
    $venvPython = Join-Path $root ".venv\Scripts\python.exe"
    if (Test-Path $venvPython) { return $venvPython }

    $sysPython = $null
    foreach ($cmd in @("python", "python3")) {
        $found = Get-Command $cmd -ErrorAction SilentlyContinue
        if ($found -and $found.Source -notmatch "WindowsApps\\python") {
            $sysPython = $found.Source
            break
        }
    }
    if (-not $sysPython) {
        $commonPythons = @(
            "$env:MUSE_PYTHON",
            "$env:USERPROFILE\miniconda3\python.exe",
            "$env:USERPROFILE\anaconda3\python.exe",
            "$env:ProgramData\miniconda3\python.exe",
            "$env:ProgramData\anaconda3\python.exe"
        )
        foreach ($p in $commonPythons) {
            if ($p -and (Test-Path $p)) { $sysPython = $p; break }
        }
    }
    if (-not $sysPython) {
        $winget = Get-Command winget -ErrorAction SilentlyContinue
        if ($winget) {
            Write-Host "[1/4] 未检测到 Python，正在通过 winget 自动安装 Python 3.11..."
            & winget install -e --id Python.Python.3.11 --silent --accept-package-agreements --accept-source-agreements | Out-Host
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            $found = Get-Command python -ErrorAction SilentlyContinue
            if ($found) { $sysPython = $found.Source }
        }
    }
    if (-not $sysPython) {
        throw "未找到 Python 3.10+，请先安装 Python (https://www.python.org/downloads/) 并勾选 Add to PATH 后重试。"
    }

    Write-Host "[1/4] 首次启动：正在创建 Python 虚拟环境并安装号池依赖..."
    & $sysPython -m venv (Join-Path $root ".venv") | Out-Host
    & $venvPython -m pip install --upgrade pip -q | Out-Host
    & $venvPython -m pip install -r (Join-Path $root "pool\requirements.txt") | Out-Host
    return $venvPython
}

function Ensure-NodeExe {
    $found = Get-Command node -ErrorAction SilentlyContinue
    if ($found) { return $found.Source }
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        Write-Host "[2/4] 未检测到 Node.js，正在通过 winget 自动安装 Node.js LTS..."
        & winget install -e --id OpenJS.NodeJS.LTS --silent --accept-package-agreements --accept-source-agreements | Out-Host
        $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
        $found = Get-Command node -ErrorAction SilentlyContinue
        if ($found) { return $found.Source }
    }
    throw "未找到 Node.js 18+，请先安装 Node.js LTS (https://nodejs.org/) 后重试。"
}

function Ensure-PoolEnv {
    $poolEnvPath = Join-Path $root "pool\.env"
    if (Test-Path $poolEnvPath) {
        $raw = Get-Content $poolEnvPath -Raw -Encoding UTF8
        $m = [regex]::Match($raw, '(?m)^\s*MUSE2API_KEY\s*=\s*(.+?)\s*$')
        if ($m.Success) { return $m.Groups[1].Value.Trim("'`"") }
    }
    $bytes = New-Object byte[] 16
    [System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    $apiKey = "m2a_studio_" + ([System.BitConverter]::ToString($bytes) -replace "-", "").ToLowerInvariant()
    $browserPath = Resolve-BrowserPath
    $lines = @(
        "MUSE2API_KEY=$apiKey",
        "MUSE2API_HOST=127.0.0.1",
        "MUSE2API_PORT=18620",
        "MUSE2API_PUBLIC_BASE=http://127.0.0.1:18620",
        "MUSE2API_CHROMIUM=$browserPath",
        "MUSE2API_CDP_PORT=19220",
        "MUSE2API_PROFILE_ROOT=$profileDir",
        "MUSE2API_IMAGE_TIMEOUT=240",
        "MUSE2API_VIDEO_TIMEOUT=1800",
        "MUSE2API_CHAT_TIMEOUT=300",
        "MUSE2API_CONCURRENCY=2",
        "MUSE2API_KEEPALIVE_DISABLED_ACCOUNTS=0",
        "MUSE2API_REF_IMAGE_LOCAL_FILES=0",
        "MUSE2API_REF_IMAGE_PRIVATE_FETCH=0"
    )
    Set-Content -Path $poolEnvPath -Value ($lines -join "`n") -Encoding UTF8
    Write-Host "[3/4] 已自动生成本机号池配置 pool\.env"
    return $apiKey
}

$pythonExe = [string](Ensure-PythonVenv | Select-Object -Last 1)
$nodeExe = [string](Ensure-NodeExe | Select-Object -Last 1)
$npmCmd = (Get-Command npm.cmd -ErrorAction SilentlyContinue).Source
if (-not $npmCmd) { $npmCmd = "npm" }

$agentDir = Join-Path $root "canvas\canvas-agent"
if (-not (Test-Path (Join-Path $agentDir "node_modules"))) {
    Write-Output "[2/4] 首次启动：正在安装 Agent 服务依赖..."
    Push-Location $agentDir
    try { & $npmCmd install --omit=dev } finally { Pop-Location }
}
if (-not (Test-Path (Join-Path $agentDir "dist\index.js"))) {
    Push-Location $agentDir
    try { & $npmCmd run build } finally { Pop-Location }
}

$webDir = Join-Path $root "canvas\web"
if (-not (Test-Path (Join-Path $webDir "dist\index.html"))) {
    Write-Output "[2/4] 首次启动：正在安装并构建前端页面..."
    Push-Location $webDir
    try {
        if (-not (Test-Path (Join-Path $webDir "node_modules"))) { & $npmCmd install }
        & $npmCmd run build
    } finally { Pop-Location }
}

$poolKey = Ensure-PoolEnv

Write-Output "[4/4] 正在启动 Muse Studio 服务..."

# 1. Start Muse Studio Pool (18620)
$env:MUSE2API_HOME = Join-Path $root "pool"
$poolProc = Start-Process -FilePath $pythonExe -ArgumentList "-m", "uvicorn", "app:app", "--host", "127.0.0.1", "--port", "18620" -WorkingDirectory (Join-Path $root "pool") -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "pool.out.log") -RedirectStandardError (Join-Path $logDir "pool.err.log")

# 2. Start Muse Studio Agent (17381)
$env:PORT = "17381"
$env:CANVAS_AGENT_CONFIG_DIR = Join-Path $dataDir "agent"
$agentProc = Start-Process -FilePath $nodeExe -ArgumentList (Join-Path $agentDir "dist\index.js") -WorkingDirectory $agentDir -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "agent.out.log") -RedirectStandardError (Join-Path $logDir "agent.err.log")

# 3. Start Muse Studio Web (3010)
$env:MUSE_STUDIO_WEB_PORT = "3010"
$webProc = Start-Process -FilePath $nodeExe -ArgumentList (Join-Path $root "services\web_server.mjs") -WorkingDirectory $root -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $logDir "web.out.log") -RedirectStandardError (Join-Path $logDir "web.err.log")

@{
    pool = $poolProc.Id
    agent = $agentProc.Id
    web = $webProc.Id
} | ConvertTo-Json | Set-Content $pidFile -Encoding UTF8

foreach ($check in @(
    @{ name = "pool"; url = "http://127.0.0.1:18620/healthz" },
    @{ name = "agent"; url = "http://127.0.0.1:17381/health" },
    @{ name = "web"; url = "http://127.0.0.1:3010/health" }
)) {
    $ok = $false
    for ($i = 0; $i -lt 50; $i++) {
        try {
            $r = Invoke-WebRequest -UseBasicParsing -Uri $check.url -TimeoutSec 2
            if ($r.StatusCode -eq 200) { $ok = $true; break }
        } catch { }
        Start-Sleep -Milliseconds 300
    }
    if (-not $ok) { throw "$($check.name) 启动失败，请查看日志目录: $logDir" }
}

Write-Output ""
Write-Output "=========================================="
Write-Output "  Muse Studio 已就绪！"
Write-Output "  画布主页 : http://127.0.0.1:3010"
Write-Output "  月域号池 : http://127.0.0.1:18620/admin?key=$poolKey"
Write-Output "  Agent    : http://127.0.0.1:17381"
Write-Output "=========================================="

Start-Process "http://127.0.0.1:3010" | Out-Null
