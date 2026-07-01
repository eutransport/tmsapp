param([string]$Root = "$PSScriptRoot\..\frontend\src\pages")

$Root = (Resolve-Path $Root).Path
Write-Host "Refactoring in: $Root" -ForegroundColor Cyan

$replacements = @(
    # Cards (order matters: specific first)
    @{ From = 'bg-white rounded-lg shadow-sm border border-gray-200 p-6';       To = 'card p-6' },
    @{ From = 'bg-white rounded-lg shadow-sm border border-gray-200 p-4 sm:p-6';To = 'card p-4 sm:p-6' },
    @{ From = 'bg-white rounded-lg shadow-sm border border-gray-200 p-4';       To = 'card p-4' },
    @{ From = 'bg-white rounded-lg shadow-sm border border-gray-200';           To = 'card' },
    @{ From = 'bg-white rounded-lg shadow-sm border p-12 text-center';          To = 'card p-12 text-center' },
    @{ From = 'bg-white rounded-lg shadow-sm border p-4';                       To = 'card p-4' },
    @{ From = 'bg-white rounded-lg shadow-sm border p-3 sm:p-4';                To = 'card p-3 sm:p-4' },
    @{ From = 'bg-white rounded-lg shadow-sm border overflow-hidden';           To = 'card overflow-hidden' },
    @{ From = 'bg-white rounded-lg shadow p-4 sm:p-6';                          To = 'card p-4 sm:p-6' },
    @{ From = 'bg-white rounded-lg shadow p-4 mb-4';                            To = 'card p-4 mb-4' },
    @{ From = 'bg-white rounded-lg shadow p-4';                                 To = 'card p-4' },
    @{ From = 'bg-white rounded-lg shadow overflow-hidden';                     To = 'card overflow-hidden' },
    # Modals -> modal-panel
    @{ From = 'relative bg-white rounded-lg shadow-xl';                         To = 'modal-panel' },
    # h1 title patterns
    @{ From = 'className="text-2xl font-bold text-gray-900"';                   To = 'className="page-title"' },
    @{ From = 'className="text-xl sm:text-2xl font-bold text-gray-900"';        To = 'className="page-title"' }
)

$files = Get-ChildItem -Path $Root -Recurse -Include *.tsx -File
$totalChanges = 0
$totalReplacements = 0
foreach ($file in $files) {
    $content = Get-Content $file.FullName -Raw
    if ($null -eq $content) { continue }
    $original = $content
    foreach ($r in $replacements) {
        $before = $content
        $content = $content.Replace($r.From, $r.To)
        if ($content -ne $before) {
            $count = ([regex]::Matches($before, [regex]::Escape($r.From))).Count
            $totalReplacements += $count
        }
    }
    if ($content -ne $original) {
        Set-Content -Path $file.FullName -Value $content -NoNewline
        Write-Host "  Updated: $($file.FullName.Substring($Root.Length + 1))"
        $totalChanges++
    }
}
Write-Host ""
Write-Host "Files modified: $totalChanges" -ForegroundColor Green
Write-Host "Total string replacements: $totalReplacements" -ForegroundColor Green
