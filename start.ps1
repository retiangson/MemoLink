$root = $PSScriptRoot

$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root'; python -m uvicorn memolink_backend.main:app --reload" -PassThru
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$root\memolink_web'; npm run dev" -PassThru

Write-Host "Backend PID: $($backend.Id)  |  Frontend PID: $($frontend.Id)"
Write-Host "Close the two terminal windows to stop the servers."
