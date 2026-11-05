# مخبز الولاء الحديث — تحديث v1.0.0-rc.12 (النهائي)
# مسار يدوي احتياطي إن لم يعمل التحديث داخل التطبيق — PowerShell عادي (لا يحتاج مسؤول)
# الاستخدام: powershell -ExecutionPolicy Bypass -File .\install-rc12.ps1
$ErrorActionPreference='Stop'
$URL="https://github.com/PS-COMMUNITY/alwalea-modern-bakery/releases/download/v1.0.0-rc.12/Alwalea.Modern.Bakery-1.0.0-rc.12-setup.exe"
$SHA="6240d8ceb86a13a3860b853b12a936bcfb298556ea6b4834e1a15b74a3beca57"
$Tmp="$env:TEMP\alwalea-rc12"
New-Item -ItemType Directory -Force -Path $Tmp | Out-Null

Write-Host "[1/6] تنزيل المثبت (88MB)..."
curl.exe -sSL --retry 3 -L -o "$Tmp\setup.exe" $URL
if(-not(Test-Path "$Tmp\setup.exe") -or (Get-Item "$Tmp\setup.exe").Length -lt 80MB){throw "التنزيل ناقص"}

Write-Host "[2/6] التحقق من البصمة SHA256..."
$h=(Get-FileHash "$Tmp\setup.exe" -Algorithm SHA256).Hash.ToLower()
if($h -ne $SHA){throw "بصمة غير مطابقة: $h"}
Write-Host "   OK: $h"

Write-Host "[3/6] نسخة أمان احتياطية للقاعدة..."
$bkDir="$env:APPDATA\alwalea-modern-bakery\backups"
New-Item -ItemType Directory -Force -Path $bkDir | Out-Null
foreach($db in @("$env:APPDATA\alwalea-modern-bakery\bakery.db","$env:APPDATA\alwalea-modern-bakery\data\bakery.db")){
  if(Test-Path $db){ Copy-Item $db "$bkDir\manual-pre-rc12-$(Get-Date -Format yyyyMMdd-HHmmss).db" -Force; Write-Host "   OK: $db" }
}

Write-Host "[4/6] إغلاق التطبيق إن كان شغالًا..."
Get-Process | Where-Object{$_.Name -like 'Alwalea*'} | ForEach-Object { $_.CloseMainWindow() | Out-Null } 2>$null
Start-Sleep 4
Get-Process | Where-Object{$_.Name -like 'Alwalea*'} | Stop-Process -Force -ErrorAction SilentlyContinue
Start-Sleep 2

Write-Host "[5/6] تثبيت صامت (تحديث في المكان)..."
$p = Start-Process -FilePath "$Tmp\setup.exe" -ArgumentList "/S" -PassThru -Wait
Write-Host "   المثبت انتهى بكود $($p.ExitCode)"

Write-Host "[6/6] إطلاق التطبيق..."
$exe = "$env:LOCALAPPDATA\Programs\alwalea-modern-bakery\Alwalea Modern Bakery.exe"
if(-not(Test-Path $exe)){ $exe = (Get-ChildItem "$env:LOCALAPPDATA\Programs" -Recurse -Filter "Alwalea Modern Bakery.exe" | Select-Object -First 1).FullName }
if(Test-Path $exe){
  Write-Host "   إصدار EXE: $((Get-Item $exe).VersionInfo.ProductVersion)"
  Start-Process -FilePath $exe
  Write-Host "تم — v1.0.0-rc.12 مثبت ويعمل"
} else { throw "لم يُعثر على EXE بعد التثبيت" }
