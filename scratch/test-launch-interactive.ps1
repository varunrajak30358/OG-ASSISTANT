$action = New-ScheduledTaskAction -Execute 'C:\Windows\System32\notepad.exe'
$principal = New-ScheduledTaskPrincipal -UserId 'lucky777\varun' -LogonType Interactive
Register-ScheduledTask -TaskName 'OGTestInteractive' -Action $action -Principal $principal -Force
Start-ScheduledTask -TaskName 'OGTestInteractive'
