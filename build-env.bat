@echo off
set WORK_DIR=c:\Users\Administrator\.trae-cn\work\6a67017d19d7d425bd907033
set TOOLCHAIN_BIN=%WORK_DIR%\rustup\toolchains\stable-x86_64-pc-windows-msvc\bin
set RUSTUP_HOME=%WORK_DIR%\rustup
set CARGO_HOME=%WORK_DIR%\cargo
set PATH=%TOOLCHAIN_BIN%;%WORK_DIR%;%PATH%
set TRAE_NODE=C:\Users\Administrator\AppData\Roaming\TRAE SOLO CN\ModularData\ai-agent\vm\tools\node
set PATH=%TRAE_NODE%;%PATH%
set PROJECT_DIR=f:\N-??\MenBook????\MemBook
cd /d %PROJECT_DIR%
echo === Build environment ready ===
echo RUSTUP_HOME=%RUSTUP_HOME%
echo CARGO_HOME=%CARGO_HOME%
echo.
echo === Verify tools ===
node --version
call npm --version
cargo.exe --version
rustc.exe --version
echo.
echo === Start build ===
call npm run desktop:build
if errorlevel 1 (echo BUILD FAILED & exit /b 1)
echo BUILD SUCCESS