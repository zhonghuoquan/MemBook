# MemBook EXE Build - Post-Reboot Script
# Run this script AFTER rebooting (when UTF-8 Beta is active)
# Usage (admin PowerShell):
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\after-reboot-build.ps1

$ErrorActionPreference = "Stop"
$ProjectDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ProjectDir

function Write-Step($msg) { Write-Host "`n========== $msg ==========" -ForegroundColor Cyan }
function Write-OK($msg)   { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "  [!]  $msg" -ForegroundColor Yellow }
function Write-Err($msg)  { Write-Host "  [X]  $msg" -ForegroundColor Red }

function Refresh-Path {
    $env:PATH = [System.Environment]::GetEnvironmentVariable("PATH", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("PATH", "User")
}

Refresh-Path
$rustupBin = "$env:USERPROFILE\.cargo\bin"
if (-not ($env:PATH -like "*$rustupBin*")) {
    $env:PATH = "$rustupBin;$env:PATH"
}

Write-Step "Step 1: Verify UTF-8 Code Page"
$acp = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage").ACP
Write-Host "  System ACP: $acp"
if ($acp -ne "65001") {
    Write-Err "UTF-8 Beta not active! ACP=$acp (expected 65001)"
    Write-Host "  Re-enabling..." -ForegroundColor Yellow
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage" -Name "ACP" -Value "65001"
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage" -Name "OEMCP" -Value "65001"
    Write-Err "Reboot required again. Please reboot and re-run this script."
    exit 1
}
Write-OK "UTF-8 Beta active (ACP=65001)"

Write-Step "Step 2: Fix Rust proxy files (rustup.exe)"
$rustupExe = "$rustupBin\rustup.exe"
$rustupSize = 0
if (Test-Path $rustupExe) { $rustupSize = (Get-Item $rustupExe).Length }

if ($rustupSize -lt 1MB) {
    Write-Warn "rustup.exe is $rustupSize bytes (broken). Downloading fresh copy..."
    $tempExe = "$env:TEMP\rustup-init-fresh.exe"
    Invoke-WebRequest -Uri "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $tempExe -UseBasicParsing
    $tempSize = (Get-Item $tempExe).Length
    if ($tempSize -gt 1MB) {
        Copy-Item $tempExe $rustupExe -Force
        Write-OK "rustup.exe restored ($tempSize bytes)"
    } else {
        Write-Err "Download failed or incomplete ($tempSize bytes)"
        exit 1
    }
} else {
    Write-OK "rustup.exe already OK ($rustupSize bytes)"
}

Write-Step "Step 3: Verify Rust toolchain"
$rustcVer = rustc --version 2>&1
if ($LASTEXITCODE -eq 0 -and $rustcVer) {
    Write-OK "rustc: $rustcVer"
} else {
    Write-Err "rustc still not working (exit=$LASTEXITCODE)"
    Write-Host "  Trying rustup to repair..." -ForegroundColor Yellow
    & $rustupExe install stable-x86_64-pc-windows-msvc --profile default
    Refresh-Path
    $rustcVer = rustc --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-OK "rustc repaired: $rustcVer"
    } else {
        Write-Err "Cannot fix rustc. Manual intervention needed."
        exit 1
    }
}

$cargoVer = cargo --version 2>&1
if ($LASTEXITCODE -eq 0 -and $cargoVer) {
    Write-OK "cargo: $cargoVer"
} else {
    Write-Err "cargo not working (exit=$LASTEXITCODE)"
    exit 1
}

Write-Step "Step 4: Check MSVC Build Tools"
$needMsvc = $true
$vswhere = "${env:ProgramFiles(x86)}\Microsoft Visual Studio\Installer\vswhere.exe"
if (Test-Path $vswhere) {
    $vcTools = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
    if ($vcTools -and $vcTools.ToString().Trim()) {
        Write-OK "MSVC already installed: $vcTools"
        $needMsvc = $false
    }
}

if ($needMsvc) {
    Write-Host "  Installing VS Build Tools 2022 (C++ workload + Windows SDK)..." -ForegroundColor Yellow
    Write-Host "  This downloads ~2-3GB and may take 10-30 minutes."

    $localInstaller = "$ProjectDir\vs_BuildTools.exe"
    if (Test-Path $localInstaller) {
        Write-Host "  Using local installer..."
        & $localInstaller --quiet --wait --norestart `
            --add Microsoft.VisualStudio.Workload.VCTools `
            --includeRecommended `
            --add Microsoft.VisualStudio.Component.Windows11SDK.26100
    } else {
        Write-Host "  Downloading VS Build Tools installer..."
        $vsInstaller = "$env:TEMP\vs_BuildTools_$PID.exe"
        Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_BuildTools.exe" -OutFile $vsInstaller -UseBasicParsing
        & $vsInstaller --quiet --wait --norestart `
            --add Microsoft.VisualStudio.Workload.VCTools `
            --includeRecommended `
            --add Microsoft.VisualStudio.Component.Windows11SDK.26100
        Remove-Item $vsInstaller -Force -EA SilentlyContinue
    }

    Refresh-Path
    Start-Sleep -Seconds 2

    # Verify
    if (Test-Path $vswhere) {
        $vcTools = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
        if ($vcTools -and $vcTools.ToString().Trim()) {
            Write-OK "MSVC installed: $vcTools"
        } else {
            Write-Err "MSVC install verification failed"
            Write-Host "  Please install VS Build Tools manually (select C++ workload + Windows 11 SDK)" -ForegroundColor Yellow
            exit 1
        }
    }
}

Write-Step "Step 5: Check WebView2"
$wv2Keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
$wv2Found = $false
foreach ($key in $wv2Keys) {
    if (Test-Path $key) {
        $wv2Ver = (Get-ItemProperty $key -EA SilentlyContinue).pv
        if ($wv2Ver) {
            Write-OK "WebView2 installed (v$wv2Ver)"
            $wv2Found = $true
            break
        }
    }
}
if (-not $wv2Found) {
    Write-Warn "WebView2 not detected, installing..."
    winget install Microsoft.EdgeWebView2Runtime --accept-package-agreements --accept-source-agreements
    Refresh-Path
}

Write-Step "Step 6: Install npm dependencies"
if (-not (Test-Path "node_modules")) {
    Write-Host "  Running npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install failed"
        exit 1
    }
    Write-OK "Dependencies installed"
} else {
    Write-OK "node_modules exists"
}

Write-Step "Step 7: Build Tauri EXE installer"
Write-Host "  Starting build. First build may take 10-30 minutes." -ForegroundColor Yellow
Write-Host "  Output: src-tauri/target/release/bundle/" -ForegroundColor White
Write-Host ""

# Set GitHub mirror for Tauri bundler tools (prevents NSIS download timeout)
if (-not $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR) {
    $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR = "https://gh-proxy.com/https://github.com"
    Write-OK "Set TAURI_BUNDLER_TOOLS_GITHUB_MIRROR (NSIS download mirror)"
}

# Verify NSIS cache
$nsisDir = "$env:LOCALAPPDATA\tauri\NSIS"
if (Test-Path "$nsisDir\makensis.exe") {
    $nsisVer = & "$nsisDir\makensis.exe" /VERSION 2>&1
    Write-OK "NSIS cache: v$nsisVer"
} else {
    Write-Warn "NSIS not cached - Tauri will download via mirror"
}

Refresh-Path
npm run desktop:build
if ($LASTEXITCODE -ne 0) {
    Write-Err "Build failed! Check errors above"
    Write-Host "`n  Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  - Rust not in PATH: restart PowerShell and re-run" -ForegroundColor White
    Write-Host "  - MSVC link errors: ensure C++ workload is fully installed" -ForegroundColor White
    Write-Host "  - NSIS timeout: ensure TAURI_BUNDLER_TOOLS_GITHUB_MIRROR is set" -ForegroundColor White
    Write-Host "  - .cargo-build-lock error: run in normal PowerShell (not TRAE IDE)" -ForegroundColor White
    exit 1
}

Write-Step "Build Complete!"
$bundleDir = "$ProjectDir\src-tauri\target\release\bundle"
Write-Host ""
Write-Host "  Installer location:" -ForegroundColor Green

$foundInstaller = $false
if (Test-Path "$bundleDir\nsis") {
    Get-ChildItem "$bundleDir\nsis\*.exe" -EA SilentlyContinue | ForEach-Object {
        Write-Host "    NSIS: $($_.FullName)" -ForegroundColor White
        Write-Host "    Size: $([math]::Round($_.Length / 1MB, 2)) MB" -ForegroundColor Gray
        $foundInstaller = $true
    }
}
if (Test-Path "$bundleDir\msi") {
    Get-ChildItem "$bundleDir\msi\*.msi" -EA SilentlyContinue | ForEach-Object {
        Write-Host "    MSI:  $($_.FullName)" -ForegroundColor White
        Write-Host "    Size: $([math]::Round($_.Length / 1MB, 2)) MB" -ForegroundColor Gray
        $foundInstaller = $true
    }
}

if ($foundInstaller) {
    Write-Host "`n  SUCCESS! EXE installer built successfully." -ForegroundColor Green
} else {
    Write-Warn "Build completed but no installer found in bundle directory"
    Write-Host "  Check: $bundleDir"
}
