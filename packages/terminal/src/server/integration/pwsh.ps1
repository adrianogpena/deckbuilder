# DeckBuilder shell integration for PowerShell and pwsh, run after the user's profile.
# Wraps the existing prompt with OSC 133 marks and OSC 7; PSReadLine's ReadLine gets the C mark.
if (-not $global:__dbSi) {
  $global:__dbSi = $true
  $global:__dbFirst = $true
  $global:__dbUserPrompt = $function:prompt
  function global:prompt {
    $ok = $?
    $code = $global:LASTEXITCODE
    $e = [char]27
    $a = [char]7
    $out = ''
    if (-not $global:__dbFirst) {
      $ec = if ($ok) { 0 } elseif ($code -is [int] -and $code -ne 0) { $code } else { 1 }
      $out += "$e]133;D;$ec$a"
    }
    $global:__dbFirst = $false
    $loc = $executionContext.SessionState.Path.CurrentLocation
    if ($loc.Provider.Name -eq 'FileSystem') {
      $p = $loc.ProviderPath -replace '\', '/'
      if ($p -match '^[A-Za-z]:') { $p = '/' + $p }
      if ($p -match '^/[^/]') {
        $hostName = if ($env:COMPUTERNAME) { $env:COMPUTERNAME } else { 'localhost' }
        $out += "$e]7;file://$hostName$($p.Replace('%', '%25'))$a"
      }
    }
    $out += "$e]133;A$a"
    $inner = if ($global:__dbUserPrompt) { & $global:__dbUserPrompt } else { "PS $loc$('>' * ($nestedPromptLevel + 1)) " }
    $global:LASTEXITCODE = $code
    "$out$inner$e]133;B$a"
  }
  if (Get-Command PSConsoleHostReadLine -ErrorAction SilentlyContinue) {
    $global:__dbUserReadLine = $function:PSConsoleHostReadLine
    function global:PSConsoleHostReadLine {
      $line = & $global:__dbUserReadLine
      [Console]::Write("$([char]27)]133;C$([char]7)")
      $line
    }
  }
}
