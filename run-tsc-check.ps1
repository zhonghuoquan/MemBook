$ErrorActionPreference = 'Continue'
Set-Location 'f:\N-编程\MenBook开发项目\MemBook'
$output = & node 'node_modules\typescript\bin\tsc' --noEmit -p tsconfig.app.json 2>&1
$output | Out-File -FilePath 'tsc_output2.txt' -Encoding utf8
Write-Host "TSC_EXIT_CODE=$LASTEXITCODE"
Write-Host "Output lines: $($output.Count)"
if ($output.Count -gt 0) {
  $output | Select-Object -First 30 | ForEach-Object { Write-Host $_ }
}
