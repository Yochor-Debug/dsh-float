# Atomic restart of the web profile on 127.0.0.1:3080.
#
# Run by an agent session that lives inside the process being replaced, so the
# new instance is spawned detached: the whole sequence completes even if this
# session's transport drops the moment the old listener goes away.
$ErrorActionPreference = 'Continue'
$bin = "C:\Users\17548\AppData\Local\pnpm\global\v11\3888-18d6b87ff7543e1c-0\node_modules\@deepseek-ai\dsh\lib\bin.js"
$log = Join-Path $env:TEMP "dsh-web-3080.log"
$err = Join-Path $env:TEMP "dsh-web-3080.err"
$old = (netstat -ano | Select-String ':3080\s+.*LISTENING' | ForEach-Object { ($_ -split '\s+')[-1] } | Select-Object -Unique)

foreach ($pid_ in $old) {
  Write-Output "stopping old 3080 listener pid $pid_"
  Stop-Process -Id $pid_ -Force -ErrorAction SilentlyContinue
}

# Wait for the socket to actually be released before rebinding.
$released = $false
for ($i = 0; $i -lt 60; $i++) {
  Start-Sleep -Milliseconds 500
  if (-not (netstat -ano | Select-String ':3080\s+.*LISTENING')) { $released = $true; break }
}
Write-Output "port released: $released after $([math]::Round($i * 0.5, 1))s"
if (-not $released) { Write-Output 'refusing to start while 3080 is still bound'; exit 1 }

Remove-Item $log, $err -Force -ErrorAction SilentlyContinue
$proc = Start-Process -FilePath 'node' `
  -ArgumentList @($bin, '--profile', 'web', '--host', '127.0.0.1', '--port', '3080', '--no-open') `
  -RedirectStandardOutput $log -RedirectStandardError $err `
  -WindowStyle Hidden -PassThru
Write-Output "new instance started: pid $($proc.Id)"

# Wait for the plugin route to answer: a fresh boot mounts it, so this proves
# the new process is up AND the balance plugin is mounted.
$ok = $false
for ($i = 0; $i -lt 90; $i++) {
  Start-Sleep -Seconds 1
  try {
    $body = (Invoke-WebRequest -Uri 'http://127.0.0.1:3080/x-balance-float' -TimeoutSec 5 -UseBasicParsing).Content
    Write-Output "route responded after ${i}s: $body"
    $ok = $true
    break
  } catch {
    if ($proc.HasExited) { Write-Output "new instance exited early (code $($proc.ExitCode))"; break }
  }
}

Write-Output "listener: $((netstat -ano | Select-String ':3080\s+.*LISTENING' | Select-Object -First 1))"
Write-Output "startup line: $((Get-Content $log -ErrorAction SilentlyContinue | Select-Object -First 1))"
if (-not $ok) {
  Write-Output 'startup stderr tail:'
  Get-Content $err -ErrorAction SilentlyContinue | Select-Object -Last 25
}
Write-Output "RESULT: $(if ($ok) { 'web restarted on 3080 with the balance plugin mounted' } else { 'restart FAILED - see stderr above' })"
