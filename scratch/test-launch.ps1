$action = New-ScheduledTaskAction -Execute 'notepad.exe'
$principal = New-ScheduledTaskPrincipal -UserId 'lucky777\varun' -LogonType Interactive
Register-ScheduledTask -TaskName 'OGTestLaunch3' -Action $action -Principal $principal -Force
Start-ScheduledTask -TaskName 'OGTestLaunch3'
