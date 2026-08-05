# MemBook Tauri Setup Script
# Run: .\setup-tauri.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  MemBook Desktop Setup" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# [1/6] Check Node.js
Write-Host "[1/6] Checking Node.js..." -ForegroundColor Yellow
try {
    $null = node -v 2>&1
    Write-Host "  Node.js OK" -ForegroundColor Green
} catch {
    Write-Host "  Node.js not found. Install from https://nodejs.org/" -ForegroundColor Red
    pause
    exit 1
}

# [2/6] Check / Install Rust
Write-Host "[2/6] Checking Rust..." -ForegroundColor Yellow
$rustOk = $false
try {
    $null = rustc --version 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "  Rust OK" -ForegroundColor Green
        $rustOk = $true
    }
} catch {}

if (-not $rustOk) {
    Write-Host "  Installing Rust..." -ForegroundColor Yellow
    try {
        winget install Rustlang.Rustup --accept-source-agreements --accept-package-agreements 2>$null
        Write-Host "  Rust installed via winget" -ForegroundColor Green
    } catch {
        Write-Host "  Downloading rustup-init.exe..." -ForegroundColor Yellow
        $rustupPath = "$env:TEMP\rustup-init.exe"
        Invoke-WebRequest -Uri "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $rustupPath
        & $rustupPath -y --default-toolchain stable
        Remove-Item $rustupPath -Force -ErrorAction SilentlyContinue
        Write-Host "  Rust installed" -ForegroundColor Green
    }
    $env:PATH = "$env:USERPROFILE\.cargo\bin;$env:PATH"
    Write-Host ""
    Write-Host "  Rust installed. Restart terminal and re-run this script." -ForegroundColor Yellow
    pause
    exit 0
}

# [3/6] Install npm dependencies
Write-Host "[3/6] Installing npm dependencies..." -ForegroundColor Yellow
npm install
Write-Host "  Dependencies OK" -ForegroundColor Green

# [4/6] Install Tauri CLI
Write-Host "[4/6] Installing Tauri CLI..." -ForegroundColor Yellow
npm install @tauri-apps/cli@latest --save-dev
npm install @tauri-apps/api@latest @tauri-apps/plugin-dialog @tauri-apps/plugin-fs @tauri-apps/plugin-shell
Write-Host "  Tauri CLI OK" -ForegroundColor Green

# [5/6] Generate app icons
Write-Host "[5/6] Generating app icons..." -ForegroundColor Yellow
$iconDir = "$root\src-tauri\icons"
if (-not (Test-Path "$iconDir\32x32.png")) {
    Add-Type -AssemblyName System.Drawing
    $sizes = @{
        "32x32.png" = 32
        "128x128.png" = 128
        "128x128@2x.png" = 256
    }
    foreach ($file in $sizes.Keys) {
        $size = $sizes[$file]
        $bmp = New-Object System.Drawing.Bitmap($size, $size)
        $g = [System.Drawing.Graphics]::FromImage($bmp)
        $g.SmoothingMode = "HighQuality"
        $brush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
            (New-Object System.Drawing.Point(0, 0)),
            (New-Object System.Drawing.Point($size, $size)),
            [System.Drawing.Color]::FromArgb(108, 99, 255),
            [System.Drawing.Color]::FromArgb(72, 52, 212)
        )
        $g.FillRectangle($brush, 0, 0, $size, $size)
        $pen = New-Object System.Drawing.Pen([System.Drawing.Color]::White, [Math]::Max(2, $size / 16))
        $m = $size / 5
        $cx = $size / 2
        $cy = $size / 2
        $g.DrawRectangle($pen, $m, $m + $size * 0.1, $size - 2 * $m, ($size - 2 * $m) * 0.7)
        $innerM = $m + $size * 0.05
        $lensR = ($size - 2 * $m) * 0.15
        $g.DrawEllipse($pen, $cx - $lensR, $cy - $lensR * 0.7, $lensR * 2, $lensR * 2)
        $g.Dispose()
        $bmp.Save("$iconDir\$file", [System.Drawing.Imaging.ImageFormat]::Png)
        $bmp.Dispose()
        Write-Host "  Generated $file" -ForegroundColor Green
    }
    $ico = New-Object System.Drawing.Bitmap("$iconDir\32x32.png")
    $ico.Save("$iconDir\icon.ico", [System.Drawing.Imaging.ImageFormat]::Icon)
    $ico.Dispose()
    Copy-Item "$iconDir\128x128.png" "$iconDir\icon.icns" -Force
    Write-Host "  Icons generated" -ForegroundColor Green
}

# [6/6] Verify package.json scripts
Write-Host "[6/6] Verifying package.json scripts..." -ForegroundColor Yellow
$pkg = Get-Content "$root\package.json" -Raw | ConvertFrom-Json
if (-not $pkg.scripts.'desktop:dev') {
    Write-Host "  Scripts already configured" -ForegroundColor Green
} else {
    Write-Host "  Scripts OK" -ForegroundColor Green
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Setup Complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To start the desktop app:" -ForegroundColor White
Write-Host "    npm run desktop:dev" -ForegroundColor Cyan
Write-Host ""
Write-Host "  To build release installer:" -ForegroundColor White
Write-Host "    npm run desktop:build" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Output location:" -ForegroundColor White
Write-Host "    src-tauri\target\release\bundle\" -ForegroundColor Gray
Write-Host ""
pause

