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

# one icon "Villa Khufu" on the Desktop and Start menu: opens the app window of the same program
$ws = New-Object -ComObject WScript.Shell
$open = Join-Path $PSScriptRoot 'open-villa-khufu.vbs'
$ico = Join-Path $PSScriptRoot 'VillaKhufu.ico'
foreach ($d in @([Environment]::GetFolderPath('Desktop'), (Join-Path ([Environment]::GetFolderPath('StartMenu')) 'Programs'))) {
  $lnk = $ws.CreateShortcut((Join-Path $d 'Villa Khufu.lnk'))
  $lnk.TargetPath = 'wscript.exe'
  $lnk.Arguments = "`"$open`""
  $lnk.WorkingDirectory = $PSScriptRoot
  $lnk.IconLocation = $ico
  $lnk.Description = 'Villa Khufu Operations + kitchen printing'
  $lnk.Save()
}
Write-Host 'Villa Khufu icon is on the Desktop.'

# Windows notifications from the program carry the name "Villa Khufu" and its icon
$k = 'HKCU:\Software\Classes\AppUserModelId\VillaKhufu.App'
New-Item -Path $k -Force | Out-Null
Set-ItemProperty -Path $k -Name DisplayName -Value 'Villa Khufu'
Set-ItemProperty -Path $k -Name IconUri -Value (Join-Path $PSScriptRoot 'icon-192.png')
Set-ItemProperty -Path $k -Name ShowInSettings -Value 0 -Type DWord
