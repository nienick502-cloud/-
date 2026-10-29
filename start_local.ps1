param([ValidateSet('auto', 'cpu', 'cuda')][string]$Device = 'cpu')
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$projectPython = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $projectPython)) {
    throw '缺少项目虚拟环境，请先按 README 安装依赖并生成语义索引。'
}
$env:IMMERSION_DEVICE = $Device
Write-Host '本地页面：http://127.0.0.1:8765'
Write-Host '对照试听：http://127.0.0.1:8765/outputs/semantic-comparison/index.html'
& $projectPython -X utf8 -m server.app
exit $LASTEXITCODE
