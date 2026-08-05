# MemBook EXE Installer Build Script
# Usage (admin PowerShell):
#   Set-ExecutionPolicy Bypass -Scope Process -Force
#   .\build-exe.ps1

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

Write-Step "Check administrator"
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "Administrator rights required to install VS Build Tools"
    Write-Host "`n  Run PowerShell as Administrator, then:" -ForegroundColor Yellow
    Write-Host "  cd `"$ProjectDir`"" -ForegroundColor White
    Write-Host "  Set-ExecutionPolicy Bypass -Scope Process -Force" -ForegroundColor White
    Write-Host "  .\build-exe.ps1" -ForegroundColor White
    exit 1
}
Write-OK "Administrator confirmed"

Write-Step "Step 0: Check UTF-8 Code Page (critical for Rust)"
$acp = (Get-ItemProperty "HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage").ACP
if ($acp -ne "65001") {
    Write-Warn "System ACP=$acp (not UTF-8). Rust binaries with <activeCodePage>UTF-8</activeCodePage> manifest will fail."
    Write-Host "  Enabling UTF-8 Beta (Use Unicode UTF-8 for worldwide language support)..."
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage" -Name "ACP" -Value "65001"
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage" -Name "OEMCP" -Value "65001"
    Set-ItemProperty -Path "HKLM:\SYSTEM\CurrentControlSet\Control\Nls\CodePage" -Name "MACCP" -Value "65001"
    Write-Err "UTF-8 Beta enabled. REBOOT REQUIRED. Please reboot and re-run this script."
    exit 1
}
Write-OK "UTF-8 Beta active (ACP=65001)"

Write-Step "Step 1/7: Check Node.js"
$needNode = $true
try {
    $nodeVer = node -v 2>&1
    if ($LASTEXITCODE -eq 0) {
        $npmVer = npm -v 2>&1
        Write-OK "Node.js $nodeVer (npm $npmVer) already installed"
        $needNode = $false
    }
} catch {}

if ($needNode) {
    Write-Host "  Installing Node.js LTS via winget..."
    winget install OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements
    Refresh-Path
    try {
        $nodeVer = node -v 2>&1
        if ($LASTEXITCODE -eq 0) {
            Write-OK "Node.js $nodeVer installed"
        } else {
            Write-Err "Node.js install failed. Please install manually: https://nodejs.org/"
            exit 1
        }
    } catch {
        Write-Err "Node.js install failed. Please install manually: https://nodejs.org/"
        exit 1
    }
}

Write-Step "Step 2/7: Check Rust toolchain"
$needRust = $true
$rustupBin = "$env:USERPROFILE\.cargo\bin"

# Ensure rustup bin dir is in PATH
if (-not ($env:PATH -like "*$rustupBin*")) {
    $env:PATH = "$rustupBin;$env:PATH"
}

try {
    $rustVer = rustc --version 2>&1
    if ($LASTEXITCODE -eq 0 -and $rustVer) {
        $cargoVer = cargo --version 2>&1
        Write-OK "Rust $rustVer ($cargoVer) already installed"
        $needRust = $false
    }
} catch {}

if ($needRust) {
    # First, check if rustup.exe itself is broken (0 bytes)
    $rustupExe = "$rustupBin\rustup.exe"
    $rustupSize = 0
    if (Test-Path $rustupExe) { $rustupSize = (Get-Item $rustupExe).Length }
    
    if ($rustupSize -lt 1MB) {
        Write-Warn "rustup.exe is $rustupSize bytes (broken). Downloading fresh copy..."
        $tempRustup = "$env:TEMP\rustup-init-fresh.exe"
        Invoke-WebRequest -Uri "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $tempRustup -UseBasicParsing
        $tempSize = (Get-Item $tempRustup).Length
        if ($tempSize -gt 1MB) {
            # Remove old symlinks/proxies first, then copy fresh rustup.exe
            $proxies = @('cargo.exe','rustc.exe','rustdoc.exe','rustfmt.exe',
                          'cargo-fmt.exe','cargo-clippy.exe','clippy-driver.exe',
                          'cargo-miri.exe','rls.exe','rust-analyzer.exe',
                          'rust-gdb.exe','rust-gdbgui.exe','rust-lldb.exe')
            foreach ($p in $proxies) {
                $target = "$rustupBin\$p"
                if (Test-Path $target) {
                    try { Remove-Item $target -Force -EA Stop } catch {}
                }
            }
            Copy-Item $tempRustup $rustupExe -Force
            Write-OK "rustup.exe restored ($tempSize bytes)"
            
            # Recreate proxy symlinks using rustup
            & $rustupExe default stable-x86_64-pc-windows-msvc 2>&1 | Out-Null
        } else {
            Write-Err "Download failed or incomplete ($tempSize bytes)"
        }
    }
    
    # Check if rustup exists and toolchain is installed
    if ((Test-Path $rustupExe) -and (Get-Item $rustupExe).Length -gt 1MB) {
        Write-Warn "rustup.exe found but rustc/cargo proxies are broken (0 bytes)"
        Write-Host "  Fixing proxy binaries by copying rustup.exe..."

        # Check if toolchain is installed
        $toolchainBin = "$env:USERPROFILE\.rustup\toolchains\stable-x86_64-pc-windows-msvc\bin"
        if (Test-Path "$toolchainBin\rustc.exe") {
            Write-OK "Rust toolchain already downloaded, fixing proxies..."
        } else {
            Write-Host "  Installing Rust stable toolchain via rustup..."
            & $rustupExe install stable-x86_64-pc-windows-msvc --profile default
            if ($LASTEXITCODE -ne 0) {
                Write-Err "Rust toolchain install failed"
                exit 1
            }
        }

        # Fix proxy files by copying rustup.exe
        $proxies = @('cargo.exe','rustc.exe','rustdoc.exe','rustfmt.exe',
                      'cargo-fmt.exe','cargo-clippy.exe','clippy-driver.exe',
                      'cargo-miri.exe','rls.exe','rust-analyzer.exe',
                      'rust-gdb.exe','rust-gdbgui.exe','rust-lldb.exe')
        foreach ($p in $proxies) {
            $target = "$rustupBin\$p"
            $currentSize = 0
            if (Test-Path $target) { $currentSize = (Get-Item $target).Length }
            if ($currentSize -lt 1024) {
                try {
                    Copy-Item $rustupExe $target -Force -ErrorAction Stop
                    $newSize = (Get-Item $target).Length
                    if ($newSize -gt 1024) {
                        Write-OK "Fixed $p ($newSize bytes)"
                    } else {
                        Write-Warn "$p still 0 bytes after copy - file may be locked"
                    }
                } catch {
                    Write-Warn "Cannot overwrite $p : $($_.Exception.Message)"
                    Write-Host "  Try: Close all programs, restart PowerShell, re-run this script" -ForegroundColor Yellow
                }
            }
        }

        # Verify fix
        $rustVer = rustc --version 2>&1
        if ($LASTEXITCODE -eq 0 -and $rustVer) {
            Write-OK "Rust fixed: $rustVer"
            $needRust = $false
        }
    }

    if ($needRust) {
        Write-Host "  Downloading rustup-init.exe..."
        $rustupInit = "$env:TEMP\rustup-init.exe"
        Invoke-WebRequest -Uri "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe" -OutFile $rustupInit -UseBasicParsing
        Write-Host "  Installing Rust stable toolchain (may take a few minutes)..."
        & $rustupInit -y --default-toolchain stable --default-host x86_64-pc-windows-msvc
        if ($LASTEXITCODE -ne 0) {
            Write-Err "Rust install failed"
            exit 1
        }
        $env:PATH = "$rustupBin;$env:PATH"
        Write-OK "Rust installed: $(rustc --version)"
    }
}

Write-Step "Step 3/7: Check MSVC build tools"
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
    Write-Host "  Installing VS Build Tools 2022 (C++ workload + Windows SDK)..."
    Write-Host "  This downloads ~2-3GB and may take 10-30 minutes." -ForegroundColor Yellow

    # Try local installer first (more reliable than winget)
    $localInstaller = "$ProjectDir\vs_BuildTools.exe"
    $installerUsed = $false

    if (Test-Path $localInstaller) {
        Write-Host "  Using local installer: $localInstaller"
        Write-Host "  Running VS Build Tools installer (quiet mode)..."
        # Include Windows 11 SDK (10.0.26100.0) explicitly
        & $localInstaller --quiet --wait --norestart `
            --add Microsoft.VisualStudio.Workload.VCTools `
            --includeRecommended `
            --add Microsoft.VisualStudio.Component.Windows11SDK.26100
        $vsExit = $LASTEXITCODE
        Write-Host "  Installer exit code: $vsExit"
        $installerUsed = $true
    } else {
        # Fall back to downloading
        Write-Host "  Local installer not found, downloading..."
        $vsInstaller = "$env:TEMP\vs_BuildTools_$PID.exe"
        Invoke-WebRequest -Uri "https://aka.ms/vs/17/release/vs_BuildTools.exe" -OutFile $vsInstaller -UseBasicParsing
        Write-Host "  Running VS Build Tools installer (quiet mode)..."
        & $vsInstaller --quiet --wait --norestart `
            --add Microsoft.VisualStudio.Workload.VCTools `
            --includeRecommended `
            --add Microsoft.VisualStudio.Component.Windows11SDK.26100
        $vsExit = $LASTEXITCODE
        Write-Host "  Installer exit code: $vsExit"
        Remove-Item $vsInstaller -Force -ErrorAction SilentlyContinue
        $installerUsed = $true
    }

    if (-not $installerUsed -or $vsExit -ne 0) {
        Write-Warn "Local installer did not complete cleanly, trying winget..."
        winget install Microsoft.VisualStudio.2022.BuildTools `
            --override "--quiet --wait --norestart --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended --add Microsoft.VisualStudio.Component.Windows11SDK.26100" `
            --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Write-Host "    $_" }
    }

    Refresh-Path
    Start-Sleep -Seconds 2
    $vcTools = $null
    if (Test-Path $vswhere) {
        $vcTools = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
    }

    if ($vcTools -and $vcTools.ToString().Trim()) {
        Write-OK "MSVC installed: $vcTools"
    } else {
        Write-Err "MSVC install verification failed"
        Write-Host "`n  Please install VS Build Tools manually:" -ForegroundColor Yellow
        Write-Host "  1. Run: vs_BuildTools.exe (in project directory)" -ForegroundColor White
        Write-Host "  2. Select 'Desktop development with C++' workload" -ForegroundColor White
        Write-Host "  3. Also select 'Windows 11 SDK (10.0.26100.0)'" -ForegroundColor White
        Write-Host "  4. Re-run this script" -ForegroundColor White
        exit 1
    }
}

Write-Step "Step 4/7: Check WebView2"
$wv2Keys = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}",
    "HKLM:\SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
)
$wv2Found = $false
foreach ($key in $wv2Keys) {
    if (Test-Path $key) {
        $wv2Ver = (Get-ItemProperty $key -ErrorAction SilentlyContinue).pv
        if (-not $wv2Ver) { $wv2Ver = (Get-ItemProperty $key -ErrorAction SilentlyContinue).version }
        if ($wv2Ver) {
            Write-OK "WebView2 installed (v$wv2Ver)"
            $wv2Found = $true
            break
        }
    }
}
if (-not $wv2Found) {
    Write-Warn "WebView2 not detected, installing..."
    winget install Microsoft.EdgeWebView2Runtime --accept-package-agreements --accept-source-agreements 2>&1 | ForEach-Object { Write-Host "    $_" }
    Refresh-Path
}

Write-Step "Step 5/7: Check project dependencies"
if (-not (Test-Path "node_modules")) {
    Write-Host "  Running npm install..."
    npm install
    if ($LASTEXITCODE -ne 0) {
        Write-Err "npm install failed"
        exit 1
    }
    Write-OK "Dependencies installed"
} else {
    Write-OK "node_modules exists, skipping install"
}

Write-Step "Step 6/7: Build Tauri EXE installer"

# Final verification
Write-Host "  Pre-build verification:" -ForegroundColor Yellow
$allOk = $true

# Check rustc
$rustCheck = rustc --version 2>&1
if ($LASTEXITCODE -eq 0 -and $rustCheck) {
    Write-OK "rustc: $rustCheck"
} else {
    Write-Err "rustc not working! Try: Close all programs, restart PowerShell, re-run this script"
    $allOk = $false
}

# Check cargo
$cargoCheck = cargo --version 2>&1
if ($LASTEXITCODE -eq 0 -and $cargoCheck) {
    Write-OK "cargo: $cargoCheck"
} else {
    Write-Err "cargo not working!"
    $allOk = $false
}

# Check MSVC link.exe
$linkCheck = Get-Command link.exe -ErrorAction SilentlyContinue
if ($linkCheck) {
    Write-OK "link.exe: $($linkCheck.Source)"
} else {
    # Try to find via vswhere
    $vsInstall = & $vswhere -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>&1
    if ($vsInstall -and $vsInstall.ToString().Trim()) {
        Write-OK "VS Build Tools: $vsInstall"
        Write-Host "  (link.exe will be found automatically by Rust)" -ForegroundColor Gray
    } else {
        Write-Err "MSVC link.exe not found in PATH"
        $allOk = $false
    }
}

if (-not $allOk) {
    Write-Err "`nPre-build verification failed. Fix the issues above and re-run."
    Write-Host "  Tip: If Rust proxy files are 0 bytes, restart the computer and re-run this script." -ForegroundColor Yellow
    exit 1
}

Write-Host ""
Write-Host "  Starting build. This compiles Rust and bundles the frontend." -ForegroundColor Yellow
Write-Host "  First build may take 10-30 minutes depending on network and CPU." -ForegroundColor Yellow
Write-Host "  Output: src-tauri/target/release/bundle/" -ForegroundColor White
Write-Host ""

# Set GitHub mirror for Tauri bundler tools (prevents NSIS download timeout in China)
if (-not $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR) {
    $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR = "https://gh-proxy.com/https://github.com"
    Write-OK "Set TAURI_BUNDLER_TOOLS_GITHUB_MIRROR (NSIS download mirror)"
} else {
    Write-OK "TAURI_BUNDLER_TOOLS_GITHUB_MIRROR already set: $env:TAURI_BUNDLER_TOOLS_GITHUB_MIRROR"
}

# Verify NSIS cache (avoids re-download if already cached)
$nsisDir = "$env:LOCALAPPDATA\tauri\NSIS"
if (Test-Path "$nsisDir\makensis.exe") {
    $nsisVer = & "$nsisDir\makensis.exe" /VERSION 2>&1
    Write-OK "NSIS cache: v$nsisVer at $nsisDir"
} else {
    Write-Warn "NSIS not cached yet - Tauri will download it (using mirror)"
}

Refresh-Path

npm run desktop:build
if ($LASTEXITCODE -ne 0) {
    Write-Err "Build failed! Check errors above"
    Write-Host "`n  Troubleshooting:" -ForegroundColor Yellow
    Write-Host "  - Rust not in PATH: restart PowerShell and re-run" -ForegroundColor White
    Write-Host "  - MSVC link errors: ensure C++ workload is fully installed" -ForegroundColor White
    Write-Host "  - NSIS timeout: ensure TAURI_BUNDLER_TOOLS_GITHUB_MIRROR is set" -ForegroundColor White
    Write-Host "  - .cargo-build-lock error: run in normal PowerShell (not through TRAE IDE)" -ForegroundColor White
    Write-Host "  - Out of memory: close other programs and retry" -ForegroundColor White
    exit 1
}

Write-Step "Build complete!"
$bundleDir = "$ProjectDir\src-tauri\target\release\bundle"
Write-Host ""
Write-Host "  Installer location:" -ForegroundColor Green

$foundInstaller = $false
if (Test-Path "$bundleDir\nsis") {
    $nsisFiles = Get-ChildItem "$bundleDir\nsis\*.exe" -ErrorAction SilentlyContinue
    foreach ($f in $nsisFiles) {
        Write-Host "    NSIS installer: $($f.FullName)" -ForegroundColor White
        Write-Host "    Size: $([math]::Round($f.Length / 1MB, 2)) MB" -ForegroundColor Gray
        $foundInstaller = $true
    }
}
if (Test-Path "$bundleDir\msi") {
    $msiFiles = Get-ChildItem "$bundleDir\msi\*.msi" -ErrorAction SilentlyContinue
    foreach ($f in $msiFiles) {
        Write-Host "    MSI installer:  $($f.FullName)" -ForegroundColor White
        Write-Host "    Size: $([math]::Round($f.Length / 1MB, 2)) MB" -ForegroundColor Gray
        $foundInstaller = $true
    }
}

if (-not $foundInstaller) {
    Write-Warn "No installer files found, checking output directory..."
    Write-Host "  Output: $bundleDir" -ForegroundColor White
    if (Test-Path $bundleDir) {
        Get-ChildItem $bundleDir -Recurse -Filter "*.exe" | ForEach-Object {
            Write-Host "    $($_.FullName)" -ForegroundColor White
        }
        Get-ChildItem $bundleDir -Recurse -Filter "*.msi" | ForEach-Object {
            Write-Host "    $($_.FullName)" -ForegroundColor White
        }
    }
}

Write-Host ""
Write-Host "  Open output directory:" -ForegroundColor Green
Write-Host "    explorer `"$bundleDir`"" -ForegroundColor White
Write-Host ""
