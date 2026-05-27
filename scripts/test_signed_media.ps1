$ErrorActionPreference = 'Stop'
$body = @{ email='admin@moveo-bv.nl'; password='admin' } | ConvertTo-Json
try {
    $resp = Invoke-RestMethod -Uri 'http://localhost:8080/api/auth/login/' -Method Post -Body $body -ContentType 'application/json'
} catch {
    Write-Host "login failed: $($_.Exception.Message)"
    exit 1
}
$tok = $resp.access
Write-Host "Got token (len=$($tok.Length))"
$headers = @{ Authorization = "Bearer $tok" }

# Fetch one invoice
$inv = Invoke-RestMethod -Uri 'http://localhost:8080/api/invoicing/invoices/?page_size=1' -Headers $headers
$first = $inv.results[0]
Write-Host "Invoice: $($first.factuurnummer)"
Write-Host "pdf_file: $($first.pdf_file)"
Write-Host "bijlage:  $($first.bijlage)"

if ($first.pdf_file) {
    $url = $first.pdf_file
    Write-Host "`n--- GET signed URL (no auth header) ---"
    $r1 = Invoke-WebRequest -Uri $url -UseBasicParsing -SkipHttpErrorCheck -MaximumRedirection 0
    Write-Host "Status: $($r1.StatusCode)  Length: $($r1.RawContentLength)  CT: $($r1.Headers['Content-Type'])"

    Write-Host "`n--- GET with tampered signature ---"
    $bad = $url -replace 'sig=[a-f0-9]+', 'sig=deadbeef'
    $r2 = Invoke-WebRequest -Uri $bad -UseBasicParsing -SkipHttpErrorCheck -MaximumRedirection 0
    Write-Host "Status: $($r2.StatusCode)"

    Write-Host "`n--- GET with expired signature (exp=0) ---"
    $expired = $url -replace 'exp=\d+', 'exp=0'
    $r3 = Invoke-WebRequest -Uri $expired -UseBasicParsing -SkipHttpErrorCheck -MaximumRedirection 0
    Write-Host "Status: $($r3.StatusCode)"
} else {
    Write-Host "(no pdf_file on this invoice)"
}

# Settings logo (public path) — should NOT be signed
$settings = Invoke-RestMethod -Uri 'http://localhost:8080/api/core/settings/' -Headers $headers
Write-Host "`n--- Settings logo_url ---"
Write-Host "logo_url: $($settings.logo_url)"
Write-Host "favicon_url: $($settings.favicon_url)"
