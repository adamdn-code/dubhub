# Sets up Windows Task Scheduler to run scheduled_scrape.py at 12am, 6am, 12pm and 6pm every day,
# as you, while you're logged in. A run that's missed (computer asleep or off) starts as soon as the
# computer is back. Run it once from this folder in PowerShell:
#     powershell -ExecutionPolicy Bypass -File setup_schedule.ps1
# Running it again replaces the old schedule. To stop it: schtasks /delete /tn "DubHub scraper" /f
#
# Teammates can run it on their own computers too: Instagram's limit is per internet connection,
# so each home network running it reads more clubs per day, and the runs combine their results.

$ErrorActionPreference = "Stop"
$folder = $PSScriptRoot
$pythonw = (Get-Command pythonw -ErrorAction SilentlyContinue).Source
if (-not $pythonw) { throw "Couldn't find pythonw.exe. Install Python from python.org or the Microsoft Store first." }

$action = New-ScheduledTaskAction -Execute $pythonw -Argument "scheduled_scrape.py" -WorkingDirectory $folder
$triggers = @("12:00AM", "6:00AM", "12:00PM", "6:00PM") | ForEach-Object { New-ScheduledTaskTrigger -Daily -At $_ }
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RunOnlyIfNetworkAvailable -MultipleInstances IgnoreNew `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 3)

Register-ScheduledTask -TaskName "DubHub scraper" -Action $action -Trigger $triggers -Settings $settings -Force `
    -Description "Scrapes UW club events from HuskyLink and Instagram and pushes them to DubHub's main branch (scraper/scheduled_scrape.py)." | Out-Null

Write-Host "Scheduled 'DubHub scraper' at 12am, 6am, 12pm and 6pm daily using $pythonw"
Write-Host "Logs go to $folder\state\logs. Next run:" (Get-ScheduledTaskInfo -TaskName "DubHub scraper").NextRunTime
