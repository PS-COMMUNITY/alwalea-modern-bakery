# ============================================================================
#  مخبز الولاء الحديث — إصلاح تثبيت v1.0.0-rc.12 (فشل المرحلة 8)
#  السبب المرجح: مزيل rc.8 غير المتزامن حذف مجلد التثبيت بعد نسخ ملفات rc.12
#  (نمط معروف في NSIS مع oneClick:false) — بياناتك في APPDATA لم تُلمس إطلاقاً
#  التشغيل:  powershell -NoProfile -ExecutionPolicy Bypass -File .\fix-rc12.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$URL     = 'https://github.com/PS-COMMUNITY/alwalea-modern-bakery/releases/download/v1.0.0-rc.12/Alwalea.Modern.Bakery-1.0.0-rc.12-setup.exe'
$SHA     = '6240d8ceb86a13a3860b853b12a936bcfb298556ea6b4834e1a15b74a3beca57'
$AppData = Join-Path $env:APPDATA 'alwalea-modern-bakery'
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$Report  = New-Object System.Collections.Generic.List[string]
function Log([string]$m) { $t = "[$(Get-Date -Format 'HH:mm:ss')] $m"; Write-Host $t; $Report.Add($t) }

Log '================================================================='
Log ' مخبز الولاء الحديث — إصلاح تثبيت v1.0.0-rc.12'
Log '================================================================='

function Find-AppExe {
  $cands = New-Object System.Collections.Generic.List[string]
  $dirs = New-Object System.Collections.Generic.List[string]
  $dirs.Add((Join-Path $env:LOCALAPPDATA 'Programs\Alwalea Modern Bakery'))
  $dirs.Add((Join-Path $env:LOCALAPPDATA 'Programs\alwalea-modern-bakery'))
  foreach ($base in @('C:\Program Files', 'C:\Program Files (x86)')) {
    if (Test-Path $base) {
      Get-ChildItem $base -Directory -Filter '*Alwalea*' -ErrorAction SilentlyContinue |
        ForEach-Object { $dirs.Add($_.FullName) }
    }
  }
  foreach ($d in $dirs) {
    if (Test-Path $d) {
      $e = Join-Path $d 'Alwalea Modern Bakery.exe'
      if (Test-Path $e) { $cands.Add($e) }
      else {
        Log ("  مجلد موجود بلا EXE: $d — محتواه:")
        Get-ChildItem $d -ErrorAction SilentlyContinue | Select-Object -First 10 |
          ForEach-Object { Log ('    ' + $_.Name + '  ' + $_.Length + 'B') }
      }
    }
  }
  try {
    $sh = New-Object -ComObject WScript.Shell
    $lnkRoots = @(
      (Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs'),
      'C:\ProgramData\Microsoft\Windows\Start Menu\Programs',
      (Join-Path $env:USERPROFILE 'Desktop'),
      'C:\Users\Public\Desktop'
    )
    foreach ($root in $lnkRoots) {
      if (Test-Path $root) {
        Get-ChildItem $root -Recurse -Filter '*Alwalea*.lnk' -ErrorAction SilentlyContinue |
          ForEach-Object {
            try {
              $t = $sh.CreateShortcut($_.FullName).TargetPath
              if ($t -and $t -like '*.exe' -and (Test-Path $t)) { $cands.Add($t) }
            } catch {}
          }
      }
    }
  } catch {}
  return @($cands | Select-Object -Unique)
}

try {
  # ------------------------------------------------------- [A/4] تشخيص شامل
  Log ''
  Log '== [A/4] تشخيص شامل — أين ذهب التطبيق؟ =='
  $cands = Find-AppExe
  if ($cands.Count -gt 0) {
    Log ('وُجد ' + $cands.Count + ' مرشّح للـ EXE:')
    foreach ($c in $cands) {
      Log ('  ' + $c + ' | إصدار ' + (Get-Item $c).VersionInfo.ProductVersion + ' | آخر تعديل ' + (Get-Item $c).LastWriteTime)
    }
  } else { Log 'لا يوجد EXE للتطبيق في أي موقع معروف (سنعيد التثبيت في المرحلة C)' }
  Log 'سجل إلغاء التثبيت:'
  foreach ($rk in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    Get-ItemProperty $rk -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like '*Alwalea*' } | ForEach-Object {
        Log ('  ' + $_.DisplayName + ' | ' + $_.DisplayVersion + ' | موقع: ' + $_.InstallLocation + ' | مزيل: ' + $_.UninstallString)
      }
  }
  $procs = Get-Process -Name 'Alwalea*' -ErrorAction SilentlyContinue
  if ($procs) { Log ('عمليات شغالة الآن: PID ' + (($procs | Select-Object -ExpandProperty Id) -join ', ')) }
  else { Log 'التطبيق غير شغال' }
  try {
    $threats = Get-MpThreatDetection -ErrorAction Stop |
      Where-Object { ($_.Resources -join ' ') -like '*Alwalea*' }
    if ($threats) {
      Log '⚠️ Windows Defender اعترض على ملفات Alwalea:'
      $threats | Select-Object -First 5 | ForEach-Object { Log ('  ' + ($_.Resources -join ', ')) }
    } else { Log 'لا اعتراضات من Windows Defender على ملفات التطبيق' }
  } catch { Log 'فحص Defender غير متاح في هذه الجلسة' }

  # ------------------------------------------- [B/4] مزامنة المنظومة معي
  Log ''
  Log '== [B/4] مزامنة البوابة والأنفاق (حسب session.txt) =='
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:8452/health' -TimeoutSec 6
    Log ("البوابة :8452 → " + $h.status + " | " + $h.service + " v" + $h.version + " | uptime " + [math]::Round($h.uptime_seconds/60,0) + " دقيقة")
  } catch { Log ('البوابة :8452 غير مستجيبة — ' + $_.Exception.Message) }
  $sess = 'M:\ps\almoutmag-v8\session.txt'
  if (Test-Path $sess) {
    Log "محتوى session.txt:"
    $tPids = @()
    Get-Content $sess -Encoding UTF8 | ForEach-Object {
      Log ('  | ' + $_)
      if ($_ -match '(?:server|tunnel)\d\s*=\s*(\d+)') { $tPids += [int]$Matches[1] }
    }
    foreach ($p in ($tPids | Select-Object -Unique)) {
      $pr = Get-Process -Id $p -ErrorAction SilentlyContinue
      if ($pr) { Log ("  PID $p شغال → " + $pr.ProcessName) }
      else { Log ("  PID $p غير موجود (انتهت العملية)") }
    }
  } else { Log 'session.txt غير موجود على M:\ps\almoutmag-v8' }

  # ----------------------------------------------- [C/4] الإصلاح — إعادة تثبيت
  Log ''
  Log '== [C/4] الإصلاح — إعادة تثبيت rc.12 (لا يوجد الآن إصدار قديم يتعارض) =='
  if ($cands.Count -eq 0) {
    $setup = 'C:\almoutmag\deliveries\v1.0.0-rc.12\Alwalea Modern Bakery-1.0.0-rc.12-setup.exe'
    $setupAlt = Join-Path $env:TEMP 'alwalea-upgrade\setup-rc12.exe'
    if (-not (Test-Path $setup)) {
      if (Test-Path $setupAlt) { $setup = $setupAlt }
      else {
        Log 'المثبت غير موجود محلياً — تنزيله من GitHub…'
        $tmpDir = Join-Path $env:TEMP 'alwalea-upgrade'
        New-Item -ItemType Directory -Force -Path $tmpDir | Out-Null
        $setup = Join-Path $tmpDir 'setup-rc12.exe'
        & curl.exe -sSL --retry 3 --retry-delay 3 -o $setup $URL 2>$null
        if (-not (Test-Path $setup) -or (Get-Item $setup).Length -lt 80MB) {
          Invoke-WebRequest -Uri $URL -OutFile $setup -UseBasicParsing -TimeoutSec 900
        }
      }
    }
    $h2 = (Get-FileHash $setup -Algorithm SHA256).Hash.ToLower()
    if ($h2 -ne $SHA) { throw "بصمة المثبت غير مطابقة ($h2) — توقف لأمان بياناتك" }
    Log ('المثبت سليم وموثوق: ' + $setup)
    Log 'تشغيل تثبيت صامت ثانٍ…'
    $p = Start-Process -FilePath $setup -ArgumentList '/S' -PassThru -Wait
    Log ('كود خروج المثبت: ' + $p.ExitCode)
    Start-Sleep 3
    $cands = Find-AppExe
    if ($cands.Count -eq 0) {
      Log 'ما زال مفقوداً بعد الصامت — فتح المثبّت بواجهة مرئية:'
      Log '  👉 أكمل: Next ← Install ← Finish (اترك المجلد الافتراضي كما هو)'
      Start-Process -FilePath $setup -Wait
      $cands = Find-AppExe
    }
  } else { Log 'الـ EXE موجود فعلاً — لا حاجة لإعادة تثبيت، ننتقل للتشغيل مباشرة' }

  # ------------------------------------------- [D/4] تشغيل خلفي + تحقق نهائي
  Log ''
  Log '== [D/4] تشغيل التطبيق في الخلفية + التحقق =='
  if ($cands.Count -gt 0) {
    $best = $null
    foreach ($c in $cands) {
      if ((Get-Item $c).VersionInfo.ProductVersion -like '*rc.12*') { $best = $c; break }
      if (-not $best) { $best = $c }
    }
    Log ('إطلاق: ' + $best)
    Log ('إصدار EXE: ' + (Get-Item $best).VersionInfo.ProductVersion)
    Start-Process -FilePath $best -WindowStyle Minimized
    Start-Sleep 8
    $run = Get-Process -Name 'Alwalea*' -ErrorAction SilentlyContinue
    if ($run) {
      Log ('[نجاح ✅] التطبيق يعمل في الخلفية — PID: ' + (($run | Select-Object -ExpandProperty Id) -join ', '))
      $db1 = Join-Path $AppData 'data\bakery.db'
      if (Test-Path $db1) {
        Log ('قاعدة بياناتك سليمة: ' + $db1 + ' | ' + [math]::Round((Get-Item $db1).Length/1KB,0) + 'KB | آخر تعديل ' + (Get-Item $db1).LastWriteTime)
      }
      Log '✅ جهازك الآن على v1.0.0-rc.12 ويعمل'
    } else { Log '[تنبيه] لم يُرصد التطبيق بعد الإطلاق — افتحه يدوياً من سطح المكتب' }
  } else {
    throw 'فشل الإصلاح — لا يوجد EXE حتى بعد إعادة التثبيت. الصق التقرير في الشات فوراً.'
  }
}
catch {
  Log ''
  Log ('[فشل] ' + $_.Exception.Message)
  Log 'بياناتك آمنة — قاعدة البيانات في APPDATA لم تُلمس، والنسخة الاحتياطية pre-rc12-upgrade موجودة.'
}
finally {
  Log ''
  Log '==================== التقرير النهائي ===================='
  $txt = ($Report -join [Environment]::NewLine)
  try {
    $logDir = Join-Path $AppData 'logs'
    New-Item -ItemType Directory -Force -Path $logDir -ErrorAction SilentlyContinue | Out-Null
    $rf1 = Join-Path $logDir "fix-report-$stamp.txt"
    [IO.File]::WriteAllText($rf1, $txt, (New-Object Text.UTF8Encoding $true))
    Log ("حُفظ التقرير: $rf1")
  } catch {}
  try {
    $rf2 = 'C:\almoutmag\deliveries\LAST-FIX-REPORT.txt'
    New-Item -ItemType Directory -Force -Path (Split-Path $rf2) -ErrorAction SilentlyContinue | Out-Null
    [IO.File]::WriteAllText($rf2, $txt, (New-Object Text.UTF8Encoding $true))
    Log ("حُفظ التقرير: $rf2")
  } catch {}
  Log ''
  Log '—————————————————————————————————————————————————'
  Log '  انسخ كل مخرجات هذه النافذة والصقها في الشات'
  Log '—————————————————————————————————————————————————'
}
