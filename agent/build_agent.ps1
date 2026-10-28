$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
& py -3 -m pip install -q -r requirements-dev.txt
& py -3 run_tests.py
if ($LASTEXITCODE -ne 0) { throw 'Tests failed' }
& py -3 -m PyInstaller --noconfirm iqos_agent.spec
if ($LASTEXITCODE -ne 0) { throw 'PyInstaller failed' }
Write-Host "Built: $PSScriptRoot\dist\IQOS-Agent.exe" -ForegroundColor Green
