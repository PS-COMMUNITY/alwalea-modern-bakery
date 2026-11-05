# ============================================================================
#  مخبز الولاء الحديث — أمر التحديث الشامل إلى v1.0.0-rc.12
#  اكتشاف النسخ + رفع التطبيق للجهاز + تحديث في المكان (D-048)
#  + فحص البوابة والأنفاق وملف الجلسة + تقرير كامل للمزامنة مع المساعد
#  التشغيل:  powershell -NoProfile -ExecutionPolicy Bypass -File .\upgrade-rc12.ps1
# ============================================================================
$ErrorActionPreference = 'Stop'
$ProgressPreference    = 'SilentlyContinue'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}

$URL     = 'https://github.com/PS-COMMUNITY/alwalea-modern-bakery/releases/download/v1.0.0-rc.12/Alwalea.Modern.Bakery-1.0.0-rc.12-setup.exe'
$SHA     = '6240d8ceb86a13a3860b853b12a936bcfb298556ea6b4834e1a15b74a3beca57'
$Tmp     = Join-Path $env:TEMP 'alwalea-upgrade'
$AppDir  = Join-Path $env:LOCALAPPDATA 'Programs\alwalea-modern-bakery'
$AppData = Join-Path $env:APPDATA 'alwalea-modern-bakery'
$bk      = Join-Path $AppData 'backups'
$Dest    = 'C:\almoutmag\deliveries\v1.0.0-rc.12'
$stamp   = Get-Date -Format 'yyyyMMdd-HHmmss'
$Report  = New-Object System.Collections.Generic.List[string]
function Log([string]$m) { $t = "[$(Get-Date -Format 'HH:mm:ss')] $m"; Write-Host $t; $Report.Add($t) }

Log '================================================================='
Log ' مخبز الولاء الحديث — التحديث الشامل إلى v1.0.0-rc.12'
Log '================================================================='
try {
  try {
    $os = Get-CimInstance Win32_OperatingSystem -ErrorAction Stop
    Log ("الجهاز: $env:COMPUTERNAME | المستخدم: $env:USERNAME | النظام: " + $os.Caption + ' ' + $os.OSArchitecture)
  } catch { Log ("الجهاز: $env:COMPUTERNAME | المستخدم: $env:USERNAME") }

  # ---------------------------------------------------------- [1/8] اكتشاف
  Log ''
  Log '== [1/8] اكتشاف النسخ المثبتة =='
  $exe = Join-Path $AppDir 'Alwalea Modern Bakery.exe'
  $oldVer = 'غير مثبت'
  if (Test-Path $exe) {
    $oldVer = (Get-Item $exe).VersionInfo.ProductVersion
    Log ("التثبيت الحالي: $exe")
    Log ("الإصدار الحالي: $oldVer | الحجم: " + [math]::Round((Get-Item $exe).Length/1MB,1) + 'MB | آخر تشغيل: ' + (Get-Item $exe).LastWriteTime)
  } else {
    Log 'المسار الافتراضي غير موجود — بحث شامل في Programs…'
    $found = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Filter 'Alwalea Modern Bakery.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $exe = $found.FullName; $oldVer = $found.VersionInfo.ProductVersion; Log ("وُجد تثبيت في: $exe — إصدار $oldVer") }
    else { Log 'لا يوجد تثبيت سابق — سيتم تثبيت جديد كامل' }
  }
  foreach ($rk in @('HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*',
                    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*')) {
    Get-ItemProperty $rk -ErrorAction SilentlyContinue |
      Where-Object { $_.DisplayName -like '*Alwalea*' } | ForEach-Object {
        Log ("سجل البرامج: " + $_.DisplayName + ' | إصدار ' + $_.DisplayVersion + ' | موقع: ' + $_.InstallLocation)
      }
  }
  $procs = Get-Process -Name 'Alwalea*' -ErrorAction SilentlyContinue
  if ($procs) { Log ("عمليات التطبيق الشغالة الآن: PID " + (($procs | Select-Object -ExpandProperty Id) -join ', ')) }
  else { Log 'التطبيق غير شغال حالياً' }
  if (Test-Path 'C:\almoutmag\deliveries') {
    Log 'تسليمات سابقة في C:\almoutmag\deliveries:'
    Get-ChildItem 'C:\almoutmag\deliveries' -Recurse -File -ErrorAction SilentlyContinue |
      Select-Object -First 15 | ForEach-Object { Log ('  ' + $_.FullName + '  ' + [math]::Round($_.Length/1MB,1) + 'MB') }
  } else { Log 'لا يوجد مجلد C:\almoutmag\deliveries بعد' }
  $db1 = Join-Path $AppData 'bakery.db'
  $db2 = Join-Path $AppData 'data\bakery.db'
  foreach ($db in @($db1,$db2)) {
    if (Test-Path $db) {
      Log ("قاعدة البيانات: $db | " + [math]::Round((Get-Item $db).Length/1KB,0) + 'KB | آخر تعديل: ' + (Get-Item $db).LastWriteTime)
    }
  }
  $nBk = 0
  if (Test-Path $bk) { $nBk = (Get-ChildItem $bk -File -ErrorAction SilentlyContinue).Count }
  Log ("نسخ احتياطية موجودة: $nBk في $bk")

  # ------------------------------------------- [2/8] البوابة والأنفاق والجلسة
  Log ''
  Log '== [2/8] فحص المنظومة المتصلة بالمساعد (البوابة/الأنفاق/الجلسة) =='
  try {
    $h = Invoke-RestMethod 'http://127.0.0.1:8452/health' -TimeoutSec 6
    Log ("البوابة المحلية :8452 → " + $h.status + " | " + $h.service + " v" + $h.version + " | uptime " + [math]::Round($h.uptime_seconds/60,0) + " دقيقة")
  } catch { Log ('البوابة المحلية :8452 غير مستجيبة — ' + $_.Exception.Message) }
  $ns = netstat -ano 2>$null | Select-String ':8452'
  if ($ns) { $ns | ForEach-Object { Log ('  منفذ 8452: ' + $_.ToString().Trim()) } }
  $cf = Get-CimInstance Win32_Process -Filter "Name='cloudflared.exe'" -ErrorAction SilentlyContinue
  if ($cf) {
    Log ("أنفاق cloudflared شغالة: " + @($cf).Count)
    $cf | ForEach-Object { Log ('  PID ' + $_.ProcessId + ' → ' + $_.CommandLine) }
  } else { Log 'لا توجد عمليات cloudflared — الأنفاق مطفأة حالياً' }
  $sess = @('M:\ps\almoutmag-v8\session.txt','C:\almoutmag\session.txt', (Join-Path $env:USERPROFILE 'session.txt')) |
          Where-Object { Test-Path $_ } | Select-Object -First 1
  if ($sess) {
    Log "ملف الجلسة الموجود: $sess — محتواه الكامل (لمزامنة المساعد):"
    Get-Content $sess -Encoding UTF8 -ErrorAction SilentlyContinue | ForEach-Object { Log ('  | ' + $_) }
  } else { Log 'لم يُعثر على session.txt في المسارات المعتادة (M:\ps\almoutmag-v8\session.txt وغيرها)' }

  # --------------------------------------------------------- [3/8] التنزيل
  Log ''
  Log '== [3/8] رفع التطبيق إلى الجهاز — تنزيل المثبت (88MB) من GitHub =='
  New-Item -ItemType Directory -Force -Path $Tmp | Out-Null
  $exeDl = Join-Path $Tmp 'setup-rc12.exe'
  & curl.exe -sSL --retry 3 --retry-delay 3 -o $exeDl $URL 2>$null
  if (-not (Test-Path $exeDl) -or (Get-Item $exeDl).Length -lt 80MB) {
    Log 'curl فشل — محاولة عبر Invoke-WebRequest…'
    Invoke-WebRequest -Uri $URL -OutFile $exeDl -UseBasicParsing -TimeoutSec 900
  }
  if (-not (Test-Path $exeDl) -or (Get-Item $exeDl).Length -lt 80MB) { throw 'فشل التنزيل — الحجم ناقص' }
  Log ('تم التنزيل: ' + [math]::Round((Get-Item $exeDl).Length/1MB,1) + 'MB → ' + $exeDl)

  # --------------------------------------------------------- [4/8] البصمة
  Log ''
  Log '== [4/8] التحقق من البصمة SHA256 =='
  $h2 = (Get-FileHash $exeDl -Algorithm SHA256).Hash.ToLower()
  Log ('البصمة الفعلية: ' + $h2)
  if ($h2 -ne $SHA) { throw "بصمة غير مطابقة! أُلغي التثبيت لأمان بياناتك — المتوقع: $SHA" }
  Log 'البصمة مطابقة 100% للإصدار rc.12 المختوم ✅'

  # ----------------------------------------------------- [5/8] إغلاق التطبيق
  Log ''
  Log '== [5/8] إغلاق التطبيق إن كان يعمل =='
  $procs = Get-Process -Name 'Alwalea*' -ErrorAction SilentlyContinue
  if ($procs) {
    $procs | ForEach-Object { try { $_.CloseMainWindow() | Out-Null } catch {} }
    Start-Sleep 6
    Get-Process -Name 'Alwalea*' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep 2
    Log 'تم إغلاق التطبيق بأمان'
  } else { Log 'كان غير شغال — لا شيء للإغلاق' }

  # ---------------------------------------------------------- [6/8] نسخ أمان
  Log ''
  Log '== [6/8] نسخة أمان احتياطية لقاعدة البيانات =='
  New-Item -ItemType Directory -Force -Path $bk | Out-Null
  foreach ($db in @($db1,$db2)) {
    if (Test-Path $db) {
      $target = Join-Path $bk ("pre-rc12-upgrade-$stamp-" + (Split-Path $db -Leaf))
      Copy-Item $db $target -Force
      Log ("نسخة أمان: $target")
    }
  }

  # ---------------------------------------------------------- [7/8] التثبيت
  Log ''
  Log '== [7/8] تثبيت صامت — تحديث في المكان (قاعدة D-048) =='
  New-Item -ItemType Directory -Force -Path $Dest | Out-Null
  Copy-Item $exeDl (Join-Path $Dest 'Alwalea Modern Bakery-1.0.0-rc.12-setup.exe') -Force
  Log ("المثبت محفوظ أيضاً في: $Dest")
  $p = Start-Process -FilePath $exeDl -ArgumentList '/S' -PassThru -Wait
  Log ('انتهى المثبت بكود خروج: ' + $p.ExitCode)
  Start-Sleep 2

  # ------------------------------------------- [8/8] التشغيل الخلفي والتحقق
  Log ''
  Log '== [8/8] تشغيل التطبيق في الخلفية + التحقق النهائي =='
  $exe = Join-Path $AppDir 'Alwalea Modern Bakery.exe'
  if (-not (Test-Path $exe)) {
    $found = Get-ChildItem (Join-Path $env:LOCALAPPDATA 'Programs') -Recurse -Filter 'Alwalea Modern Bakery.exe' -ErrorAction SilentlyContinue | Select-Object -First 1
    if ($found) { $exe = $found.FullName }
  }
  if (-not (Test-Path $exe)) { throw 'لم يُعثر على EXE بعد التثبيت!' }
  $newVer = (Get-Item $exe).VersionInfo.ProductVersion
  Start-Process -FilePath $exe -WindowStyle Minimized
  Start-Sleep 8
  $run = Get-Process -Name 'Alwalea*' -ErrorAction SilentlyContinue
  if ($run) { Log ('[نجاح] التطبيق يعمل في الخلفية — PID: ' + (($run | Select-Object -ExpandProperty Id) -join ', ')) }
  else { Log '[تنبيه] لم يُرصد التطبيق بعد الإطلاق — انتظر ثوانٍ ثم افتحه يدوياً' }
  Log ("الإصدار المثبت الآن: $newVer  (السابق: $oldVer)")
  if ($newVer -like '*rc.12*') { Log '[اكتمل ✅] جهازك الآن على v1.0.0-rc.12' }
  else { Log "[تنبيه] الإصدار المقاس ليس rc.12 — راجع مخرجات المثبت أعلاه" }
}
catch {
  Log ''
  Log ('[فشل] ' + $_.Exception.Message)
  Log 'لم يكتمل التحديث — بياناتك ونسخك الاحتياطية آمنة. الصق التقرير في الشات وسنعالجه فوراً.'
}
finally {
  Log ''
  Log '==================== التقرير النهائي ===================='
  $txt = ($Report -join [Environment]::NewLine)
  $rf1 = Join-Path $bk ("..\logs\upgrade-report-$stamp.txt")
  $rf2 = 'C:\almoutmag\deliveries\LAST-UPGRADE-REPORT.txt'
  try {
    $logDir = Join-Path $AppData 'logs'
    New-Item -ItemType Directory -Force -Path $logDir -ErrorAction SilentlyContinue | Out-Null
    $rf1 = Join-Path $logDir "upgrade-report-$stamp.txt"
    [IO.File]::WriteAllText($rf1, $txt, (New-Object Text.UTF8Encoding $true))
    Log ("حُفظ التقرير: $rf1")
  } catch { Log 'تعذر حفظ التقرير في AppData' }
  try {
    New-Item -ItemType Directory -Force -Path (Split-Path $rf2) -ErrorAction SilentlyContinue | Out-Null
    [IO.File]::WriteAllText($rf2, $txt, (New-Object Text.UTF8Encoding $true))
    Log ("حُفظ التقرير: $rf2")
  } catch {}
  Log ''
  Log '—————————————————————————————————————————————————'
  Log '  انسخ كل مخرجات هذه النافذة (من أولها لآخرها)'
  Log '  والصقها في الشات — حتى تكتمل المزامنة مع المساعد'
  Log '—————————————————————————————————————————————————'
}
