$url = "https://fonts.gstatic.com/l/font?kit=kJEhBvYX7gnkSrUwT8OhrdQw4oELdPIeeII9v6oFsL7CbI5em_ipcEpX78gns8LOsrfwe6pE4o42Q&skey=b8dc2088854b122f&v=v326"
$headers = @{
    "Referer" = "https://fonts.googleapis.com/"
    "Origin" = "https://fonts.googleapis.com"
    "User-Agent" = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}
try {
    if (-not (Test-Path "fonts")) { New-Item -ItemType Directory "fonts" }
    Invoke-WebRequest -Uri $url -OutFile "fonts/material-symbols-outlined.woff2" -Headers $headers -UseBasicParsing
    $size = (Get-Item "fonts/material-symbols-outlined.woff2").Length
    Write-Host "Success: $size bytes"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
}
