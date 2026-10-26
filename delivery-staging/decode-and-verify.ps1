# =============================================================
# decode-and-verify.ps1 — تحقق تسليم مخبز الولاء الحديث v1.0.0-rc.5
# الاستخدام من مجلد التسليم C:\almoutmag\deliveries\v1.0.0-rc.5 :
#   powershell -ExecutionPolicy Bypass -File decode-and-verify.ps1
# ما يفعله:
#   1) يقرأ MANIFEST-BINARIES.json
#   2) لكل ملف: إن وُجدت أجزاء <filename>.part000.b64 ... يجمعها ويفك Base64
#      (وإلا يستخدم الملف الجاهز كما هو)
#   3) يحسب SHA-256 والحجم ويقارنهما بالمانيفست
#   4) يطبع OK أو MISMATCH لكل ملف — أي MISMATCH يعني الملف غير سليم
# مخرجات الملفات الثنائية في مجلد bin64 بجانب المانيفست
# =============================================================
param(
  [string]$Manifest = ".\MANIFEST-BINARIES.json",
  [string]$OutDir = ".\bin64"
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path $Manifest)) {
  Write-Host "FAIL: المانيفست غير موجود: $Manifest" -ForegroundColor Red
  exit 1
}

$manifest = Get-Content $Manifest -Raw -Encoding UTF8 | ConvertFrom-Json
Write-Host "=================================================="
Write-Host "  تحقق التسليم - الإصدار $($manifest.version)"
Write-Host "  تاريخ البناء: $($manifest.buildDate)"
Write-Host "=================================================="

if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Path $OutDir | Out-Null }

$manifestDir = Split-Path (Resolve-Path $Manifest) -Parent
$binDir = Join-Path $manifestDir "bin64"
$allOk = $true
$results = @()

foreach ($f in $manifest.files) {
  $name = $f.filename
  $expectedHash = ($f.sha256).ToLower()
  $expectedSize = [int64]$f.sizeBytes

  # 1) ابحث عن أجزاء Base64 في bin64 ثم بجانب المانيفست - وإلا فالملف جاهز
  $parts = @(Get-ChildItem -Path (Join-Path $binDir "$name.part*.b64") -ErrorAction SilentlyContinue)
  if ($parts.Count -eq 0) { $parts = @(Get-ChildItem -Path (Join-Path $manifestDir "$name.part*.b64") -ErrorAction SilentlyContinue) }
  $parts = @($parts | Sort-Object Name)
  $target = Join-Path $OutDir $name

  if ($parts.Count -gt 0) {
    Write-Host "[$name] جمع $($parts.Count) جزءًا من Base64..."
    $sb = New-Object System.Text.StringBuilder
    foreach ($p in $parts) {
      $raw = [IO.File]::ReadAllText($p.FullName)
      # إزالة كل المسافات وأسطر الجديدة (تحصين ضد CRLF من أدوات الكتابة)
      [void]$sb.Append(($raw -replace '\s', ''))
    }
    $b64 = $sb.ToString()
    $bytes = [Convert]::FromBase64String($b64)
    [IO.File]::WriteAllBytes($target, $bytes)
    Write-Host "[$name] فُك الترميز: $($bytes.Length) بايت"
  }
  elseif ((Test-Path (Join-Path $binDir $name)) -or (Test-Path (Join-Path $manifestDir $name))) {
    if (Test-Path (Join-Path $binDir $name)) { Copy-Item (Join-Path $binDir $name) $target -Force }
    else { Copy-Item (Join-Path $manifestDir $name) $target -Force }
  }
  elseif (Test-Path $target) {
    # الملف موجود مسبقًا في bin64
  }
  else {
    Write-Host "[$name] FAIL: الملف غير موجود (ولا أجزاء .partNNN.b64)" -ForegroundColor Red
    $allOk = $false
    $results += [pscustomobject]@{ File = $name; Status = 'MISSING'; Size = 0; Hash = '' }
    continue
  }

  # 2) الحجم
  $actualSize = (Get-Item $target).Length

  # 3) الهاش
  $actualHash = (Get-FileHash -Path $target -Algorithm SHA256).Hash.ToLower()

  $ok = ($actualHash -eq $expectedHash) -and ($actualSize -eq $expectedSize)
  if ($ok) {
    Write-Host ("[$name] OK  size={0}  sha256={1}..." -f $actualSize, $actualHash.Substring(0,16)) -ForegroundColor Green
  } else {
    Write-Host ("[$name] MISMATCH  size={0} (متوقع {1})  sha256={2} (متوقع {3})" -f $actualSize, $expectedSize, $actualHash, $expectedHash) -ForegroundColor Red
    $allOk = $false
  }
  $results += [pscustomobject]@{ File = $name; Status = $(if ($ok) {'OK'} else {'MISMATCH'}); Size = $actualSize; Hash = $actualHash }
}

Write-Host "=================================================="
$results | Format-Table -AutoSize
if ($allOk) {
  Write-Host "النتيجة: كل الملفات سليمة (OK) - الإصدار $($manifest.version)" -ForegroundColor Green
  exit 0
} else {
  Write-Host "النتيجة: يوجد ملفات غير سليمة (MISMATCH/MISSING) - لا تستخدمها" -ForegroundColor Red
  exit 1
}
