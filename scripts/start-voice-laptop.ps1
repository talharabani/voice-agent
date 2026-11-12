param([switch]$NoTunnel)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runtimeRoot = Join-Path $projectRoot '.claude'
New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$voicePython = Join-Path $runtimeRoot 'tts-venv\Scripts\python.exe'
if (-not (Test-Path -LiteralPath $voicePython)) {
  & python -m venv (Join-Path $runtimeRoot 'tts-venv')
  if ($LASTEXITCODE -ne 0) { throw 'Could not create the local voice environment.' }
}
& $voicePython -c 'import edge_tts, aiohttp' 2>$null
if ($LASTEXITCODE -ne 0) {
  & $voicePython -m pip install -r (Join-Path $PSScriptRoot 'requirements-voice.txt')
  if ($LASTEXITCODE -ne 0) { throw 'Could not install the voice helper dependencies.' }
}
if (-not (Get-NetTCPConnection -State Listen -LocalPort 11434 -ErrorAction SilentlyContinue)) {
  $ollamaBinary = (Get-Command ollama.exe).Source
  Start-Process -FilePath $ollamaBinary -ArgumentList 'serve' -WindowStyle Hidden
}
$bridgeReady = $false
try { $bridgeReady = (Invoke-RestMethod 'http://127.0.0.1:11435/voxa/health' -TimeoutSec 2).service -eq 'voxa-local-voice' } catch {}
if (-not $bridgeReady) {
  if (Get-NetTCPConnection -State Listen -LocalPort 11435 -ErrorAction SilentlyContinue) { throw 'Port 11435 is used by another service.' }
  $bridgeScript = Join-Path $PSScriptRoot 'voice_bridge.py'
  Start-Process -FilePath $voicePython -ArgumentList @('"' + $bridgeScript + '"') -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'voice-bridge.log') -RedirectStandardError (Join-Path $runtimeRoot 'voice-bridge-error.log')
  for ($attempt = 0; $attempt -lt 20; $attempt++) {
    try { $bridgeReady = (Invoke-RestMethod 'http://127.0.0.1:11435/voxa/health' -TimeoutSec 1).service -eq 'voxa-local-voice' } catch {}
    if ($bridgeReady) { break }
    Start-Sleep -Milliseconds 300
  }
  if (-not $bridgeReady) { throw 'Voice helper did not start. Check .claude/voice-bridge-error.log.' }
}
Write-Output 'Urdu voice helper is running on this laptop.'
if ($NoTunnel) { return }

$existingTunnels = @()
try { $existingTunnels = @((Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 2).tunnels) } catch {}
if ($existingTunnels.Count -gt 1) { throw 'Multiple ngrok tunnels are running. Select the intended voice tunnel before restarting.' }
$oldUrl = if ($existingTunnels.Count) { $existingTunnels[0].public_url } else { $null }
if (-not $oldUrl) {
  $savedUrlFile = Join-Path $runtimeRoot 'voice-public-url.txt'
  if (Test-Path -LiteralPath $savedUrlFile) {
    $savedUrl = (Get-Content -LiteralPath $savedUrlFile -Raw).Trim()
    $savedUri = $null
    if ([Uri]::TryCreate($savedUrl, [UriKind]::Absolute, [ref]$savedUri) -and $savedUri.Scheme -eq 'https' -and -not $savedUri.UserInfo -and $savedUri.AbsolutePath -eq '/' -and -not $savedUri.Query) { $oldUrl = $savedUri.AbsoluteUri.TrimEnd('/') }
  }
}
$alreadyBridged = $existingTunnels.Count -eq 1 -and $existingTunnels[0].config.addr -match ':11435/?$'
if ($existingTunnels.Count -eq 1 -and -not $alreadyBridged) {
  if ($existingTunnels[0].config.addr -notmatch '^https?://(?:localhost|127\.0\.0\.1):11434/?$') { throw 'The running tunnel is not the expected local Ollama tunnel; it was left untouched.' }
  $listener = Get-NetTCPConnection -State Listen -LocalPort 4040 | Select-Object -First 1
  $ngrokProcess = Get-Process -Id $listener.OwningProcess
  if ($ngrokProcess.ProcessName -notlike 'ngrok*') { throw 'Port 4040 is not owned by ngrok; no process was stopped.' }
  Stop-Process -Id $ngrokProcess.Id
  Start-Sleep -Milliseconds 500
}
if (-not $alreadyBridged) {
  $ngrokBinary = (Get-Command ngrok.exe).Source
  $tunnelArguments = @('http', 'http://127.0.0.1:11435', '--log=stdout')
  if ($oldUrl) { $tunnelArguments += "--url=$oldUrl" }
  Start-Process -FilePath $ngrokBinary -ArgumentList $tunnelArguments -WindowStyle Hidden -RedirectStandardOutput (Join-Path $runtimeRoot 'voice-tunnel.log') -RedirectStandardError (Join-Path $runtimeRoot 'voice-tunnel-error.log')
}
for ($attempt = 0; $attempt -lt 30; $attempt++) {
  try {
    $current = @((Invoke-RestMethod 'http://127.0.0.1:4040/api/tunnels' -TimeoutSec 1).tunnels)
    if ($current.Count -and $current[0].public_url) {
      $voiceUrl = $current[0].public_url
      if ($oldUrl -and $voiceUrl -ne $oldUrl) { throw 'The public URL changed. Update OLLAMA_BASE_URL in Vercel.' }
      Set-Content -LiteralPath (Join-Path $runtimeRoot 'voice-public-url.txt') -Value $voiceUrl
      Write-Output "Vercel OLLAMA_BASE_URL: $voiceUrl"
      return
    }
  } catch {}
  Start-Sleep -Milliseconds 400
}
throw 'Tunnel did not become ready. Check .claude/voice-tunnel-error.log.'
