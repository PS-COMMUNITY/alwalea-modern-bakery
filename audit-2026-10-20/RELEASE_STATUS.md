# حالة الإصدار والحزم — تدقيق 2026-10-20

## 1. جرد مجلد الإصدار (release/)
- **المجلد غير موجود إطلاقًا** في `alwalea-modern-bakery-v2/` (فحص: `ls dist dist-electron release out` → «No such file or directory» لكلٍّ؛ و`find` شامل عن `*.exe`/`*.AppImage`/`*.zip`/`*.blockmap` → **صفر نتائج**).
- ما وُجد فعليًا أثناء التدقيق من مخلفات بناء dev (أنشأها هذا التدقيق لغرض التشغيل فقط، وكلها داخل .gitignore): `dist/` (renderer عبر vite) و`dist-electron/` (main+preload عبر esbuild) — **ليست حزم توزيع**.

## 2. SHASUMS.txt — ملف يتيم (أهم استنتاج)
المحتوى الفعلي (`alwalea-modern-bakery-v2/SHASUMS.txt`):
```
674814f3784d3bd46ae9f72e6f9cb1d12ca01890258442398cf00c2ace5560d7  Alwalea Modern Bakery-1.0.0.AppImage
b25b1d160eee3912810ca5f811e2ccfa5f882918afb9cb3e088a75c4ae8d8177  Alwalea Modern Bakery-1.0.0-win.zip
```
- الملفان **غير موجودين على القرص** ولا يمكن التحقق من الهواش («sha256sum -c» سيفشل: لا ملفات).
- `git log --all --oneline --name-only -- 'alwalea-modern-bakery-v2/release' ...` → **فارغ**: لم يُرحَّل أي ملف إصدار إلى Git قطّ.
- الاستنتاج: حزمًا بُنيت سابقًا (بحسب worklog بأحجام ~107.3MB و~110.5MB) ثم **حُذفت من القرص**؛ الشاهد الوحيد المتبقي هو هذا الملف. لا يمكن اعتبار أي حزمة «موجودة» أو «قابلة للتسليم» اليوم.

## 3. ما الذي يمكن إثباته عن ما بُني سابقًا؟ (رواية غير قابلة لإعادة التحقق)
بحسب worklog فقط (لا يُعد دليلًا):
- AppImage بُني واختُبر بـ`--appimage-extract-and-run --smoke` (PASS) — البيئة بلا libfuse لذا الإقلاع المباشر لم يُختبر.
- `--win zip` بُني (بديل NSIS) و**لم يُختبر على ويندوز إطلاقًا** — موثق بصدق في worklog نفسه.
- **NSIS EXE فشل بناؤه** (wine مطلوب من app-builder وغير مثبت؛ لا sudo) — لا شك في ذلك: wine غير موجود فعليًا في هذه البيئة الآن.

## 4. تكوين البناء الحالي (سليم وجاهز لإعادة البناء)
`alwalea-modern-bakery-v2/electron-builder.yml`:
- `win: target nsis x64` + `nsis: oneClick:false, allowToChangeInstallationDirectory:true` → سيُنتج `Alwalea Modern Bakery-1.0.0-setup.exe`.
- `linux: target AppImage`.
- `asar:true` مع `files: dist/**, dist-electron/**, package.json` — وsql.js (wasm) يُقرأ من داخل asar عبر مسارات `wasmCandidatesFor` (src/main/db.ts:223-234) — التصميم متسق مع التغليف.
- electron-builder 25.1.8 مثبت في devDependencies؛ ثنائي electron نُزّل أثناء هذا التدقيق (`node install.js` → exit 0).

## 5. ما اختُبر فعليًا وعلى أي نظام (حتى تاريخ هذا التدقيق)
| ماذا | على أي نظام | بواسطة/دليل |
|---|---|---|
| بناء dev (vite + esbuild) | Linux (هذه الحاوية) | أُعيد بناؤه أثناء التدقيق: exit 0 |
| إقلاع التطبيق كاملًا + دخول + استمرارية قاعدة | Linux تحت Xvfb (شاشة افتراضية) | CDP tests + smoke أثناء هذا التدقيق (PASS) |
| سلوك التطبيق داخل حزمة معبأة | **غير قابل للتحقق الآن** (لا حزمة موجودة) | — |
| أي شيء على Windows | **أبدًا — لا بيئة** | — |
| الطباعة الحرارية | لا طابعة في البيئة | — |

## 6. سياسة موقع قاعدة المستخدم ونسخه الاحتياطية
- القاعدة: `userData/data/bakery.db` (main.ts:19,35-37) — **خارج مجلد التثبيت** كما تقرر السياسة. النسخ الاحتياطية: `userData/backups/` (backup.ts:56-59).
- من حيث التصميم: تحديث/إزالة تثبيت NSIS (per-user) لا يمس userData. **لكن هذا لم يُختبر على ويندوز مطلقًا** — يظل ادعاءً نظريًا حتى اختبار فعلي.

## 7. الخلاصة
| السؤال | الجواب الصادق |
|---|---|
| هل يوجد مثبت NSIS EXE؟ | **لا — لم يُبنَ بنجاح يومًا (wine)، ولا يوجد ملف.** |
| هل يوجد ZIP/AppImage جاهز للتسليم؟ | **لا — بُنيا سابقًا ثم حُذفا؛ لا وجود لهما الآن.** |
| هل فُحصت SHA-256؟ | لا يمكن — الملفات مفقودة (SHASUMS يتيم). |
| هل اختُبرت حزمة ويندوز على ويندوز؟ | **لا، أبدًا.** |
| هل التكوين جاهز لإعادة البناء؟ | نعم (`electron-builder.yml` سليم) — NSIS يحتاج wine أو جهاز ويندوز. |
| هل القاعدة خارج مجلد التثبيت؟ | نعم بالتصميم (userData) — غير مختبر على ويندوز. |
