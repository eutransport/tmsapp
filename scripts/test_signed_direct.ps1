$ErrorActionPreference = 'Stop'
$path = "reports/pdf/rapport_Urenregistratie_samenvatting_2026_20260331_113016.pdf"

$pyCode = @"
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE','tms.settings.production')
django.setup()
from apps.core.file_signing import sign_media_path
print(sign_media_path('$path'))
"@

$signed = (docker exec tms_local_backend python -c $pyCode) -join ''
Write-Host "Signed URL: $signed"

$base = "http://localhost:8080"
Write-Host "`n--- Valid signed URL ---"
curl.exe -s -o NUL -w "Status: %{http_code}  Size: %{size_download}`n" "$base$signed"

Write-Host "`n--- Tampered signature ---"
$tampered = $signed -replace 'sig=[a-f0-9]+', 'sig=deadbeef'
curl.exe -s -o NUL -w "Status: %{http_code}`n" "$base$tampered"

Write-Host "`n--- /files/<path> without sig ---"
curl.exe -s -o NUL -w "Status: %{http_code}`n" "$base/files/$path"

Write-Host "`n--- Direct /media/<path> ---"
curl.exe -s -o NUL -w "Status: %{http_code}`n" "$base/media/$path"

Write-Host "`n--- Path traversal attempt ---"
$bad = "/files/../etc/passwd?sig=x&exp=99999999999"
curl.exe -s -o NUL -w "Status: %{http_code}`n" "$base$bad"
