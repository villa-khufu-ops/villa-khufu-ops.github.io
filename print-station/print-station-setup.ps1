$vbs = Join-Path $PSScriptRoot 'print-station-hidden.vbs'
$stop = Join-Path $PSScriptRoot 'STOP-PRINT.txt'
if (Test-Path $stop) { Remove-Item $stop }
$action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument "`"$vbs`"" -WorkingDirectory $PSScriptRoot
try {
  $t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5)
} catch {
  $t2 = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)
}
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Seconds 0)
Register-ScheduledTask -TaskName 'VillaKhufu Print Station' -Action $action -Trigger $t2 -Settings $settings -Force | Out-Null
Start-Process wscript.exe -ArgumentList "`"$vbs`"" -WorkingDirectory $PSScriptRoot
Write-Host 'Print station is on. Windows checks every 5 minutes and starts it again if it stopped.'
