$root = $PSScriptRoot

# Kill any existing uvicorn (backend) and npm/vite (frontend) processes
Write-Host "Stopping existing servers..." -ForegroundColor Yellow

Get-Process -Name "python" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "uvicorn" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

# Kill by window title written by the previous start.ps1
Get-Process -Name "powershell" -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowTitle -match "MemoLink (Backend|Frontend)" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

# Kill npm / node / vite on the dev port
Get-Process -Name "node" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match "vite|npm" } |
    Stop-Process -Force -ErrorAction SilentlyContinue

# Brief pause to let ports release
Start-Sleep -Milliseconds 800

Write-Host "Starting MemoLink..." -ForegroundColor Cyan

$backend = Start-Process powershell -ArgumentList `
    "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle = 'MemoLink Backend'; cd '$root'; python -m uvicorn memolink_backend.main:app --reload" `
    -PassThru

$frontend = Start-Process powershell -ArgumentList `
    "-NoExit", "-Command",
    "`$host.UI.RawUI.WindowTitle = 'MemoLink Frontend'; cd '$root\memolink_web'; npm run dev" `
    -PassThru

Write-Host "Backend  PID: $($backend.Id)" -ForegroundColor Green
Write-Host "Frontend PID: $($frontend.Id)" -ForegroundColor Green
Write-Host "Run .\start.ps1 again to restart both servers." -ForegroundColor DarkGray
