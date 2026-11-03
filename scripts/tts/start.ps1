#Requires -Version 5.1
# 启动本地 TTS（edge-tts），供 bridge 语音 [[voice:短句]] 使用
$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root

Write-Host "检查 edge-tts…"
python -c "import edge_tts" 2>$null
if ($LASTEXITCODE -ne 0) {
  Write-Host "正在安装 edge-tts…"
  python -m pip install -r .\scripts\tts\requirements.txt
}

$env:TTS_PORT = if ($env:TTS_PORT) { $env:TTS_PORT } else { "8787" }
$env:TTS_VOICE = if ($env:TTS_VOICE) { $env:TTS_VOICE } else { "zh-CN-XiaoxiaoNeural" }

Write-Host "启动 TTS → http://127.0.0.1:$($env:TTS_PORT)/tts  voice=$($env:TTS_VOICE)"
Write-Host "保持此窗口开着；另开终端跑 pnpm bridge"
node .\scripts\tts\server.mjs
