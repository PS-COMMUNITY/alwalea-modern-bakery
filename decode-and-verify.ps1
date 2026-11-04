# decode-and-verify.ps1 — مخبز الولاء الحديث v1.0.0-rc.5
# يجمع أجزاء Base64 من bin64 ويفكها إلى EXE ويحسب SHA-256 والحجم ويقارن مع MANIFEST-BINARIES.json
# الاستخدام: powershell -ExecutionPolicy Bypass -File .\decode-and-verify.ps1
# النتيجة: OK أو MISMATCH لكل ملف — MISMATCH يعني أن الملف غير سليم ولا يجوز تشغيله.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$bin64 = Join-Path $root 'bin64'
$manifestPath = Join-Path $root 'MANIFEST-BINARIES.json'

if (-not (Test-Path $manifestPath)) { Write-Output "MISMATCH | MANIFEST missing: $manifestPath"; exit 1 }
$manifest = Get-Content $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Output ("MANIFEST | release={0} build={1}" -f $manifest.release, $manifest.build_date_utc)

$sha256 = [System.Security.Cryptography.SHA256]::Create()
$allOk = $true

foreach ($b in $manifest.binaries) {
  $name = $b.filename
  $expectedHash = ($b.sha256).ToLower()
  $expectedSize = [long]$b.size_bytes
  $base = $name -replace '\.exe$', ''
  $kind = if ($base -match 'portable$') { 'portable' } else { 'setup' }

  # اجمع أجزاء base64 بالترتيب: <base>.part000.b64 ...
  $parts = Get-ChildItem -Path $bin64 -Filter "$kind.exe.part*.b64" | Sort-Object { [int]($_.Name -replace '.*\.part(\d+)\.b64$', '$1') }
  if ($parts.Count -eq 0) { Write-Output "MISMATCH | $name | no parts found in bin64"; $allOk = $false; continue }

  $sb = New-Object System.Text.StringBuilder
  foreach ($p in $parts) {
    $txt = [System.IO.File]::ReadAllText($p.FullName)
    $txt = ($txt -replace '\s', '')   # تحمّل أي CRLF أو مسافات عرضية
    [void]$sb.Append($txt)
  }
  $b64 = $sb.ToString()
  $bytes = [System.Convert]::FromBase64String($b64)

  # الحجم
  $size = [long]$bytes.Length
  # الهاش
  $hashBytes = $sha256.ComputeHash($bytes)
  $hash = ([System.BitConverter]::ToString($hashBytes)) -replace '-', ''
  $hash = $hash.ToLower()

  # اكتب EXE بجانب المانيفست
  $outPath = Join-Path $root $name
  [System.IO.File]::WriteAllBytes($outPath, $bytes)

  $sizeOk = ($size -eq $expectedSize)
  $hashOk = ($hash -eq $expectedHash)
  if ($sizeOk -and $hashOk) {
    Write-Output ("OK       | {0} | size={1} | sha256={2} | parts={3}" -f $name, $size, $hash, $parts.Count)
  } else {
    Write-Output ("MISMATCH | {0} | size={1} (expected {2}) | sha256={3} (expected {4}) | parts={5}" -f $name, $size, $expectedSize, $hash, $expectedHash, $parts.Count)
    $allOk = $false
  }
}

$sha256.Dispose()
if ($allOk) { Write-Output 'RESULT: ALL OK — الملفان سليمان ويمكن تشغيلهما' ; exit 0 }
else { Write-Output 'RESULT: MISMATCH — يوجد ملف تالف، لا تشغّله وأبلغ الوكيل' ; exit 2 }
