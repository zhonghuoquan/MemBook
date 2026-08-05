$ErrorActionPreference = 'Continue'
$logPath = "$env:TEMP\tauri-build7.log"
"" | Out-File -FilePath $logPath -Encoding utf8

try {
  $sdkRoot = 'C:\Program Files (x86)\Windows Kits\10'
  $sdkVer = '10.0.26100.0'
  $sdkBin = Join-Path $sdkRoot 'bin' | Join-Path -ChildPath $sdkVer | Join-Path -ChildPath 'x64'
  $sdkInc = Join-Path $sdkRoot 'Include' | Join-Path -ChildPath $sdkVer
  $sdkLib = Join-Path $sdkRoot 'Lib' | Join-Path -ChildPath $sdkVer

  $vcRoot = 'C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\VC'
  $msvc = '14.44.35207'
  $msvcBin = Join-Path $vcRoot 'Tools' | Join-Path -ChildPath 'MSVC' | Join-Path -ChildPath $msvc | Join-Path -ChildPath 'bin' | Join-Path -ChildPath 'Hostx64' | Join-Path -ChildPath 'x64'
  $msvcInc = Join-Path $vcRoot 'Tools' | Join-Path -ChildPath 'MSVC' | Join-Path -ChildPath $msvc | Join-Path -ChildPath 'include'
  $msvcLib = Join-Path $vcRoot 'Tools' | Join-Path -ChildPath 'MSVC' | Join-Path -ChildPath $msvc | Join-Path -ChildPath 'lib' | Join-Path -ChildPath 'x64'

  $env:PATH = "$sdkBin;$msvcBin;$env:PATH"
  $env:INCLUDE = "$sdkInc\ucrt;$sdkInc\um;$sdkInc\shared;$sdkInc\winrt;$msvcInc"
  $env:LIB = "$sdkLib\ucrt\x64;$sdkLib\um\x64;$msvcLib"
  $env:LIBPATH = $env:LIB

  "rc.exe: $((Get-Command rc.exe -ErrorAction SilentlyContinue).Source)" | Out-File -Append -FilePath $logPath -Encoding utf8
  "cl.exe: $((Get-Command cl.exe -ErrorAction SilentlyContinue).Source)" | Out-File -Append -FilePath $logPath -Encoding utf8
  "link.exe: $((Get-Command link.exe -ErrorAction SilentlyContinue).Source)" | Out-File -Append -FilePath $logPath -Encoding utf8
  "INCLUDE: $env:INCLUDE" | Out-File -Append -FilePath $logPath -Encoding utf8
  "LIB: $env:LIB" | Out-File -Append -FilePath $logPath -Encoding utf8
  "" | Out-File -Append -FilePath $logPath -Encoding utf8

  Set-Location 'g:\WorkBuddy\MemBook\membook-backup'
  # 普通版本：暂时不启用 native-heic，等待 LLVM/libclang 安装完成后再启用
  & npx tauri build 2>&1 | ForEach-Object { "$_" ; "$_" | Out-File -Append -FilePath $logPath -Encoding utf8 }
  "exit: $LASTEXITCODE" | Out-File -Append -FilePath $logPath -Encoding utf8
} catch {
  "ERROR: $_" | Out-File -Append -FilePath $logPath -Encoding utf8
  $_.ScriptStackTrace | Out-File -Append -FilePath $logPath -Encoding utf8
  exit 2
}
