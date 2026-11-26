# benchmark/scripts/run_phase3.ps1 — Master Phase 3 Benchmark Runner (PowerShell)
# Executes E1 Baseline, E4 Durability, E3 Fault Isolation, E8 Burst, and Aggregation.

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = Resolve-Path "$scriptDir\..\.."
$resultsDir = "$repoRoot\benchmark\results"
$runLog = "$resultsDir\RUN_LOG.md"

if (-not (Test-Path "$resultsDir\logs")) {
    New-Item -ItemType Directory -Path "$resultsDir\logs" -Force | Out-Null
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host " Starting Phase 3 Benchmark Suite (PulseFlow ECS351) " -ForegroundColor Cyan
Write-Host "==========================================================" -ForegroundColor Cyan

# 1. Environment check
Write-Host "`n[Step 1/5] Checking Docker Environment..." -ForegroundColor Yellow
try {
    $dockerInfo = docker version --format '{{.Server.Version}}'
    Write-Host "Docker is running (Server version: $dockerInfo)" -ForegroundColor Green
} catch {
    Write-Host "ERROR: Docker is not reachable. Please start Docker Desktop before running Phase 3." -ForegroundColor Red
    exit 1
}

function Reset-Databases($variant) {
    Write-Host "Resetting datastores for $variant..." -ForegroundColor Gray
    if ($variant -eq "micro") {
        docker exec mongo-micro mongosh fitness_telemetry --quiet --eval "db.dropDatabase()" 2>$null
        docker exec mongo-micro mongosh fitness_goals --quiet --eval "db.dropDatabase()" 2>$null
        docker exec mongo-micro mongosh fitness_notifications --quiet --eval "db.dropDatabase()" 2>$null
        docker exec mongo-micro mongosh fitness_workouts --quiet --eval "db.dropDatabase()" 2>$null
        docker exec redis-micro redis-cli FLUSHALL 2>$null
    } else {
        docker exec "mongo-$variant" mongosh "fitness_$variant" --quiet --eval "db.dropDatabase()" 2>$null
        docker exec "redis-$variant" redis-cli FLUSHALL 2>$null
    }
}

function Wait-Healthy($port) {
    $url = "http://localhost:$port/health"
    Write-Host "Awaiting healthy status from $url..." -ForegroundColor Gray
    for ($i = 0; $i -lt 30; $i++) {
        try {
            $resp = Invoke-RestMethod -Uri $url -Method Get -TimeoutSec 2 -ErrorAction SilentlyContinue
            if ($resp.status -eq "ok") {
                Write-Host "Service on port $port is healthy." -ForegroundColor Green
                return $true
            }
        } catch {}
        Start-Sleep -Seconds 2
    }
    Write-Host "WARNING: Service on port $port did not respond healthy." -ForegroundColor Yellow
    return $false
}

# 2. Experiment E1: Baseline Multi-Variant Load
Write-Host "`n[Step 2/5] Running Experiment E1: Baseline Step Loads (10, 50, 100, 200)" -ForegroundColor Yellow
$variants = @("event", "modular", "micro")
$ports = @{ "event" = 5001; "modular" = 5011; "micro" = 5021 }

foreach ($var in $variants) {
    $port = $ports[$var]
    foreach ($run in @("run1", "run2", "run3")) {
        $startIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        Write-Host ">>> E1 | Variant: $var | Run: $run | Start: $startIso <<<" -ForegroundColor Cyan
        Reset-Databases $var
        Wait-Healthy $port

        $logFile = "$resultsDir\logs\e1_${var}_${run}.log"
        $env:EXP = "e1"
        $env:RUN_LABEL = "${var}_${run}"
        $env:VARIANT = $var
        $env:STEPS = "10,50,100,200"
        $env:HOLD_S = "120"
        $env:WARMUP_S = "20"
        $env:GOAL_CPU_MS = "10"

        node "$repoRoot\benchmark\loadgen.js" *>&1 | Tee-Object -FilePath $logFile

        $endIso = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
        Add-Content -Path $runLog -Value "`n### E1 Baseline — $var / $run ($startIso to $endIso)`n- Stages: 10,50,100,200`n- Log: benchmark/results/logs/e1_${var}_${run}.log`n- CSV: benchmark/results/e1-${var}_${run}-levels.csv"
        Start-Sleep -Seconds 3
    }
}

# 3. Experiment E4: Durability (20 crash trials)
Write-Host "`n[Step 3/5] Running Experiment E4: Crash Durability (20 trials per variant)" -ForegroundColor Yellow
& "$repoRoot\benchmark\scripts\e4_durability.sh"

# 4. Experiment E3: Fault Isolation
Write-Host "`n[Step 4/5] Running Experiment E3: Fault Isolation" -ForegroundColor Yellow
& "$repoRoot\benchmark\scripts\e3_fault.sh"

# 5. Experiment E8: Burst Load (0 -> 200 in 5s)
Write-Host "`n[Step 5/5] Running Experiment E8: Burst Surge Load" -ForegroundColor Yellow
& "$repoRoot\benchmark\scripts\e8_burst.sh"

# 6. Aggregate Results
Write-Host "`n[Aggregation] Aggregating results into summary.csv and summary.md..." -ForegroundColor Cyan
node "$repoRoot\benchmark\analysis\aggregate.js" "$resultsDir"

Write-Host "`n==========================================================" -ForegroundColor Green
Write-Host " Phase 3 Benchmarks Completed Successfully! " -ForegroundColor Green
Write-Host " Results generated in benchmark/results/summary.csv and summary.md" -ForegroundColor Green
Write-Host "==========================================================" -ForegroundColor Green
