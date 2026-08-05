# MemBook EXE Installer Build Script
# Run in SYSTEM PowerShell (Win+X -> Terminal/PowerShell, NOT in TRAE)
#
# Usage:
#   cd "f:\N-编程\MenBook开发项目\MemBook"
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\build-exe-now.ps1

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

function Write-Step($msg) { Write-Host "`n========== $msg ==========" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Err($msg)  { Write-Host "  [X]  $msg" -ForegroundColor Red }

# Setup PATH
$rustupBin = "$env:USERPROFILE\.cargo\bin"
if (-not ($env:PATH -like "*$rustupBin*")) { $env:PATH = "$rustupBin;$env:PATH" }

Write-Step "Step 1: Environment Check"
Write-OK "rustc: $(rustc --version)"
Write-OK "cargo: $(cargo --version)"
Write-OK "node: $(node -v)"

$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
$vc = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
if ($vc -and $vc.ToString().Trim()) { Write-OK "MSVC: $vc" }
else { Write-Err "MSVC not found!"; exit 1 }

Write-Step "Step 2: Clean old bundle"
$bundleDir = "$ProjectDir\src-tauri\target\release\bundle"
if (Test-Path $bundleDir) {
    Remove-Item $bundleDir -Recurse -Force -EA SilentlyContinue
    Write-OK "Old bundle cleaned"
} else {
    Write-OK "No old bundle to clean"
}

Write-Step "Step 3: Pre-download NSIS tools"
# Tauri downloads NSIS to LOCALAPPDATA. Pre-create the directory.
$tauriCache = "$env:LOCALAPPDATA\tauri"
if (-not (Test-Path $tauriCache)) {
    New-Item -ItemType Directory -Path $tauriCache -Force | Out-Null
}
Write-OK "Tauri cache dir: $tauriCache"

# Check if NSIS is already cached
$nsisCache = "$tauriCache\Nsis"
if (Test-Path "$nsisCache\nsis.exe") {
    Write-OK "NSIS already cached"
} else {
    Write-Host "  NSIS will be downloaded during build (may take a few minutes)..."
}

Write-Step "Step 4: Build Tauri (NSIS only)"
Write-Host "  Targets: nsis only (skipped MSI/WiX to avoid timeout)"
Write-Host "  First build may take 10-30 minutes." -ForegroundColor Yellow
Write-Host "  Output: src-tauri/target/release/bundle/nsis/" -ForegroundColor White
Write-Host ""

# Set longer timeout for bundler (6 minutes = 360 seconds)
$env:TAURI_BUNDLER_TIMEOUT = "360"

# Use GitHub mirror to prevent NSIS download timeout (硬约束：project_memory)
$env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR = "https://gh-proxy.com/https://github.com"

npm run desktop:build
$buildExit = $LASTEXITCODE

if ($buildExit -ne 0) {
    Write-Err "Build failed (exit: $buildExit)!"
    Write-Host "`n  If 'timeout: global' error:" -ForegroundColor Yellow
    Write-Host "  1. Check network connection" -ForegroundColor White
    Write-Host "  2. Try: cargo tauri build --bundles nsis" -ForegroundColor White
    Write-Host "  3. Or manually download NSIS from https://nsis.sourceforge.io" -ForegroundColor White
    exit 1
}

Write-Step "Step 5: Verify Output"
$nsisDir = "$bundleDir\nsis"
$foundInstaller = $false

if (Test-Path $nsisDir) {
    Get-ChildItem "$nsisDir\*.exe" -EA SilentlyContinue | ForEach-Object {
        $sizeMB = [math]::Round($_.Length / 1MB, 2)
        Write-Host "  NSIS Installer: $($_.FullName)" -ForegroundColor White
        Write-Host "  Size: $sizeMB MB" -ForegroundColor Gray
        Write-Host "  Modified: $($_.LastWriteTime)" -ForegroundColor Gray
        $foundInstaller = $true
    }
}

if ($foundInstaller) {
    Write-Host "`n  ========================================" -ForegroundColor Green
    Write-Host "  SUCCESS! EXE installer built." -ForegroundColor Green
    Write-Host "  ========================================" -ForegroundColor Green
} else {
    Write-Host "`n  Build completed but no installer found." -ForegroundColor Yellow
    Write-Host "  Check: $nsisDir"
}
