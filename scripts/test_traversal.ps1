Write-Host "--- traversal via --path-as-is ---"
curl.exe --path-as-is -s -o NUL -w "Status: %{http_code}`n" "http://localhost:8080/files/../etc/passwd?sig=x&exp=99999999999"
Write-Host "--- URL-encoded traversal (../) ---"
curl.exe -s -o NUL -w "Status: %{http_code}`n" "http://localhost:8080/files/%2E%2E/etc/passwd?sig=x&exp=99999999999"
Write-Host "--- Crafted valid sig for ../etc/passwd ---"
$pyCode = @"
import os, django, time, hmac, hashlib
os.environ.setdefault('DJANGO_SETTINGS_MODULE','tms.settings.production')
django.setup()
from django.conf import settings
path = '../etc/passwd'
exp = int(time.time()) + 60
msg = f'{path}|{exp}'.encode()
sig = hmac.new(settings.SECRET_KEY.encode(), msg, hashlib.sha256).hexdigest()
print(f'{path}|{sig}|{exp}')
"@
$out = (docker exec tms_local_backend python -c $pyCode) -join ''
$parts = $out.Trim().Split('|')
$url = "http://localhost:8080/files/$($parts[0])?sig=$($parts[1])&exp=$($parts[2])"
Write-Host "URL: $url"
curl.exe --path-as-is -s -o NUL -w "Status: %{http_code}`n" $url
