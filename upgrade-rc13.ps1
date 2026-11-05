# ============================================================================
#  مخبز الولاء الحديث — الترقية المحصّنة إلى v1.0.0-rc.13 (الحملة الشاملة)
#  يزيل أي إصدار قديم مسجلاً (rc.8/rc.12...) + يثبّت rc.13 + يتحقق من الإصدار
#  فعلياً بعد التثبيت، ومع أي فشل يعيد المحاولة ثم يلجأ للنسخة المحمولة.
#  بياناتك في APPDATA لا تُلمس أبداً + نسخة أمان قبل البدء.
#  التشغيل:  powershell -NoProfile -ExecutionPolicy Bypass -File .\upgrade-rc13.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$URL     = 'https://github.com/PS-COMMUNITY/alwalea-modern-bakery/releases/download/v1.0.0-rc.13/Alwalea.Modern.Bakery-1.0.0-rc.13-setup.exe'
$URLP    = 'https://github.com/PS-COMMUNITY/alwalea-modern-bakery/releases/download/v1.0.0-rc.13/Alwalea.Modern.Bakery-1.0.0-rc.13-portable.exe'
$SHA     = '0674c8310f57e0b78b161590326a758f0c7bf75392730321860144cf998c339b'
$SHAP    = '57ae22cd61c62cd1a11e7f9810ba3c7b79af9db836b52a68d199026f8c7b154d'
$TARGET  = '1.0.0-rc.13'
$Tmp     = Join-Path $env:TEMP 'alwalea-rc13'
$AppData = Join-Path $env:APPDATA 'alwalea-modern-bakery'
$bk      = Join-Path $AppData 'backups'
$Dest    = 'C:\almoutmag\deliveries\v1.0.0-rc.13'
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$Report  = New-Object System.Collections.Generic.List[string]
function Log([string]$m) { $t = "[$(Get-Date -Format 'HH:mm:ss')] $m"; Write-Host $t; $Report.Add($t) }

Log '================================================================='
Log " مخبز الولاء الحديث — الترقية المحصّنة إلى $TARGET"
Log '================================================================='

function Get-RegisteredInstalls {
  # كل إصدارات Alwalea المسجلة في Windows (لكل المستخدمين والمقاعد)
  $out = @()
  foreach ($rk in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    Get-ItemProperty $rk -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like '*Alwalea*' } | ForEach-Object {
        $out += [pscustomobject]@{
          Name = $_.DisplayName; Version = $_.DisplayVersion
          Location = $_.InstallLocation; Uninstaller = $_.QuietUninstallString; Raw = $_.UninstallString
        }
      }
  }
  return $out
}
function Get-AppExeVersion([string]$p) {
  if ($p -and (Test-Path $p)) { return (Get-Item $p).VersionInfo.ProductVersion }
  return $null
}
function Find-AnyExe {
  $found = @()
  foreach ($d in @((Join-Path $env:LOCALAPPDATA 'Programs\Alwalea Modern Bakery'),
                   (Join-Path $env:LOCALAPPDATA 'Programs\alwalea-modern-bakery'))) {
    $e = Join-Path $d 'Alwalea Modern Bakery.exe'
    if (Test-Path $e) { $found += $e }
  }
  foreach ($base in @('C:\Program Files', 'C:\Program Files (x86)')) {
    if (Test-Path $base) {
      Get-ChildItem $base -Directory -Filter '*Alwalea*' -ErrorAction SilentlyContinue | ForEach-Object {
        $e = Join-Path $_.FullName 'Alwalea Modern Bakery.exe'
        if (Test-Path $e) { $found += $e }
      }
    }
  }
  return @($found | Select-Object -Unique)
}
function Close-App {
  $procs = Get-Process -Name 'Alwalea*' -ErrorAction SilentlyContinue
  if ($procs) {
    Log ('إغلاق التطبيق (PID ' + (($procs | Select-Object -ExpandProperty Id) -join ', ') + ')')
    $procs | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }
    Start-Sleep 5
    Get-Process -Name 'Alwalea*' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
  }
}
function Download-File([string]$url, [string]$out) {
  & curl.exe -sSL --retry 3 --retry-delay 3 -o $out $url 2>$null
  if (-not (Test-Path $out) -or (Get-Item $out).Length -lt 80MB) {
    Invoke-WebRequest -Uri $url -OutFile $out -UseBasicParsing -TimeoutSec 900
  }
}

try {
  # ------------------------------------------------------------ [1/8] كشف شامل
  Log ''
  Log '== [1/8] كشف شامل — ماذا يوجد على الجهاز؟ =='
  $reg = Get-RegisteredInstalls
  foreach ($r in $reg) { Log ('مسجل: ' + $r.Name + ' | ' + $r.Version + ' | ' + $r.Location) }
  if (-not $reg) { Log 'لا يوجد أي إصدار مسجل في Windows' }
  $exes = Find-AnyExe
  foreach ($e in $exes) { Log ('ملف موجود: ' + $e + ' | إصدار ' + (Get-AppExeVersion $e)) }
  if (-not $exes) { Log 'لا ملفات تطبيق في المواقع القياسية' }
  $db1 = Join-Path $AppData 'data\bakery.db'
  $db2 = Join-Path $AppData 'bakery.db'
  foreach ($db in @($db1,$db2)) {
    if (Test-Path $db) { Log ("قاعدة البيانات: $db | " + [math]::Round((Get-Item $db).Length/1KB,0) + "KB | آخر تعديل " + (Get-Item $db).LastWriteTime) }
  }
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:8452/health' -TimeoutSec 5
    Log ("البوابة :8452 → " + $h.status + " v" + $h.version)
  } catch { Log 'البوابة :8452 غير مستجيبة (غير مؤثر على الترقية)' }
  $sess = 'M:\ps\almoutmag-v8\session.txt'
  if (Test-Path $sess) {
    Log 'session.txt:'
    Get-Content $sess -Encoding UTF8 | ForEach-Object { Log ('  | ' + $_) }
  }

  # ------------------------------------------------------------ [2/8] تنزيل
  Log ''
  Log '== [2/8] تنزيل المثبت rc.13 (88MB) + التحقق من البصمة =='
  New-Item -ItemType Directory -Force -Path $Tmp, $Dest | Out-Null
  $setup = Join-Path $Tmp 'setup-rc13.exe'
  Download-File $URL $setup
  $h1 = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
  Log ('بصمة المثبت: ' + $h1)
  if ($h1 -ne $SHA) { throw "بصمة غير مطابقة — أُلغيت الترقية حمايةً لجهازك. المتوقع: $SHA" }
  Copy-Item $setup (Join-Path $Dest 'Alwalea Modern Bakery-1.0.0-rc.13-setup.exe') -Force
  Log 'البصمة مطابقة 100% ✅'

  # ------------------------------------------------------ [3/8] نسخة أمان
  Log ''
  Log '== [3/8] نسخة أمان احتياطية لقاعدة بياناتك =='
  New-Item -ItemType Directory -Force -Path $bk | Out-Null
  foreach ($db in @($db1,$db2)) {
    if (Test-Path $db) {
      $t = Join-Path $bk ("pre-rc13-$stamp-" + (Split-Path $db -Leaf))
      Copy-Item $db $t -Force
      Log ("نسخة أمان: $t")
    }
  }

  # ------------------------------------------------------- [4/8] إغلاق + إزالة
  Log ''
  Log '== [4/8] إغلاق التطبيق وإزالة أي إصدار قديم مسجل =='
  Close-App
  foreach ($r in (Get-RegisteredInstalls)) {
    $u = $r.Uninstaller
    if (-not $u -and $r.Raw) { $u = $r.Raw }
    if ($u) {
      Log ('إلغاء تثبيت صامت: ' + $r.Name + ' ' + $r.Version)
      try {
        if ($u -match '^"([^"]+)"\s*(.*)$') { $up = Start-Process -FilePath $Matches[1] -ArgumentList ('/S ' + $Matches[2]) -PassThru -Wait }
        else { $parts = $u -split ' (?=/S)', 2; $up = Start-Process -FilePath $parts[0].Trim('"') -ArgumentList '/S' -PassThru -Wait }
        Log ('  انتهى بكود ' + $up.ExitCode)
      } catch { Log ('  تعذر الصامت: ' + $_.Exception.Message + ' — متابعة') }
      Start-Sleep 3
    }
    # تنظيف بقايا مجلد التثبيت فقط (APPDATA بياناتك لا يُمس)
    if ($r.Location -and (Test-Path $r.Location) -and $r.Location -notlike '*Windows*') {
      try { Remove-Item $r.Location -Recurse -Force -ErrorAction SilentlyContinue; Log ('  نُظّف: ' + $r.Location) } catch {}
    }
  }
  foreach ($d in @((Join-Path $env:LOCALAPPDATA 'Programs\Alwalea Modern Bakery'),
                   (Join-Path $env:LOCALAPPDATA 'Programs\alwalea-modern-bakery'))) {
    if (Test-Path $d) {
      try { Remove-Item $d -Recurse -Force -ErrorAction SilentlyContinue; Log ('نُظّف بقايا: ' + $d) } catch {}
    }
  }
  Start-Sleep 2

  # ---------------------------------------------------------- [5/8] تثبيت
  Log ''
  Log '== [5/8] تثبيت صامت لـ rc.13 (في مكان نظيف — بلا تعارض مزيل قديم) =='
  $p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
  Log ('كود خروج المثبت: ' + $p.ExitCode)
  Start-Sleep 3

  # --------------------------------------- [6/8] تحقق إلزامي من الإصدار
  Log ''
  Log '== [6/8] تحقق إلزامي: الإصدار المثبت يجب أن يكون ' + $TARGET + ' =='
  $exes = Find-AnyExe
  $okExe = $null
  foreach ($e in $exes) { if ((Get-AppExeVersion $e) -eq $TARGET) { $okExe = $e; break } }
  if (-not $okExe) {
    Log 'التحقق فشل — إعادة تثبيت ثانية (أحياناً يحتاج NSIS تمريرتين)…'
    Close-App
    $p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
    Log ('كود الخروج: ' + $p.ExitCode)
    Start-Sleep 3
    $exes = Find-AnyExe
    foreach ($e in $exes) { if ((Get-AppExeVersion $e) -eq $TARGET) { $okExe = $e; break } }
  }
  if (-not $okExe) {
    Log 'ما زال فاشلاً — تشغيل المثبّت بواجهة مرئية:'
    Log '  👉 أكمل: Next ← Install ← Finish (اترك المجلد الافتراضي)'
    Close-App
    Start-Process -FilePath $setup -Wait
    $exes = Find-AnyExe
    foreach ($e in $exes) { if ((Get-AppExeVersion $e) -eq $TARGET) { $okExe = $e; break } }
  }
  if (-not $okExe) {
    Log ''
    Log '== [7/8] الخطة البديلة — النسخة المحمولة rc.13 (بدون تثبيت) =='
    $port = Join-Path $Tmp 'portable-rc13.exe'
    Download-File $URLP $port
    $h2 = (Get-FileHash $port -Algorithm SHA256).Hash.ToLower()
    if ($h2 -ne $SHAP) { throw 'بصمة المحمولة غير مطابقة — توقف' }
    New-Item -ItemType Directory -Force -Path 'C:\almoutmag\apps' | Out-Null
    Copy-Item $port 'C:\almoutmag\apps\Alwalea-rc13-portable.exe' -Force
    Log 'المحمولة موثوقة — تشغيلها (نفس بياناتك في APPDATA تماماً)'
    $okExe = 'C:\almoutmag\apps\Alwalea-rc13-portable.exe'
  }

  # ------------------------------------------------ [8/8] تشغيل + تحقق نهائي
  Log ''
  Log '== [8/8] تشغيل التطبيق في الخلفية + التحقق النهائي =='
  Log ('الملف المعتمد: ' + $okExe + ' | إصدار ' + (Get-AppExeVersion $okExe))
  Start-Process -FilePath $okExe -WindowStyle Minimized
  Start-Sleep 8
  $run = Get-Process -Name 'Alwalea*' -ErrorAction SilentlyContinue
  if ($run) { Log ('[نجاح ✅] يعمل في الخلفية — PID: ' + (($run | Select-Object -ExpandProperty Id) -join ', ')) }
  else { Log '[تنبيه] لم يُرصد بعد — انتظر ثوانٍ ثم افتحه يدوياً' }
  $v = Get-AppExeVersion $okExe
  if ($v -eq $TARGET) { Log "[اكتمل ✅] الجهاز الآن على $TARGET — افتح الإعدادات وسترى «الإصدار $TARGET» أسفل الشاشة" }
  else { Log "[تنبيه] الإصدار المقاس $v — الصق التقرير في الشات" }
}
catch {
  Log ''
  Log ('[فشل] ' + $_.Exception.Message)
  Log 'بياناتك آمنة — APPDATA لم يُلمس والنسخة الأمان pre-rc13 موجودة. الصق التقرير في الشات.'
}
finally {
  Log ''
  Log '==================== التقرير النهائي ===================='
  $txt = ($Report -join [Environment]::NewLine)
  try {
    $logDir = Join-Path $AppData 'logs'
    New-Item -ItemType Directory -Force -Path $logDir -ErrorAction SilentlyContinue | Out-Null
    $rf1 = Join-Path $logDir "rc13-report-$stamp.txt"
    [IO.File]::WriteAllText($rf1, $txt, (New-Object Text.UTF8Encoding $true))
    Log ("حُفظ التقرير: $rf1")
  } catch {}
  try {
    $rf2 = 'C:\almoutmag\deliveries\LAST-RC13-REPORT.txt'
    New-Item -ItemType Directory -Force -Path (Split-Path $rf2) -ErrorAction SilentlyContinue | Out-Null
    [IO.File]::WriteAllText($rf2, $txt, (New-Object Text.UTF8Encoding $true))
    Log ("حُفظ التقرير: $rf2")
  } catch {}
  Log ''
  Log '—————————————————————————————————————————————————'
  Log '  انسخ كل مخرجات هذه النافذة والصقها في الشات'
  Log '—————————————————————————————————————————————————'
}
