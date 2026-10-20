# فهرس الأدلة — تدقيق 2026-10-20
مرجع سريع: كل استنتاج في التقرير ← موقعه الفعلي (ملف:سطر أو أمر + مخرجاته).

## أ. هوية المشروع
- مستودع واحد، فرع main، آخر commit 6a64b79: `git -C /home/z/my-project log --oneline -4` (مخرجات حقيقية في جلسة التدقيق).
- 257 مسارًا معدلًا غير مرحّل: `git status --porcelain | wc -l`.
- سكربتات v2: `alwalea-modern-bakery-v2/package.json:10-22` (build/lint/smoke/dist:linux/dist:win).
- v2 ليس مستودعًا مستقلًا: `git rev-parse` داخله يعيد تاريخ الجذر نفسه.
- ملفات القفل: `/home/z/my-project/bun.lock` و`alwalea-modern-bakery-v2/bun.lock`.

## ب. المصادقة وكلمة المرور
| الاستنتاج | الدليل |
|---|---|
| حقل كلمة مرور واحد (ويب) | `src/components/bakery/screens/login-screen.tsx:16-96` + تصيير متصفح فعلي (snapshot: textbox «كلمة المرور» + زر EyeOff) |
| حقل كلمة مرور واحد (Electron) | `alwalea-modern-bakery-v2/src/renderer/src/screens/LoginScreen.tsx:59-93` + CDP wrong/correct PASS |
| scrypt + ملح مستقل (ويب) | `src/lib/bakery/auth.ts:13-27` (scryptSync 64, N=16384, r=8, p=1, timingSafeEqual) |
| scrypt + ملح مستقل (Electron) | `alwalea-modern-bakery-v2/src/main/services/auth.ts:16-28` |
| 1234 تعمل في قاعدة التطوير فقط | curl حي: POST /api/auth/login 9999→401، 1234→200 role=OWNER (قاعدة db/custom.db) |
| لا نص مكشوف في القاعدة | فحص python3 sqlite3 قراءة فقط: length(passwordHash)=128, length(passwordSalt)=32, صفوف تحوي «1234» = 0 |
| 1234 ليست بابًا خلفيًا | auth-flow-test PASS: بعد التغيير login(1234)=401 وحتى مع username=401؛ لا ثوابت كلمة في الشيفرة — 1234 فقط كقيمة prefill تهيئة: `setup-wizard.tsx:15`, `api/setup/route.ts:9`, `SetupScreen.tsx:12` وسكربت تطوير وسيطي `scripts/set-dev-owner-password.mjs:9` |
| تغيير كلمة يرفض الحالية الخاطئة | `src/app/api/users/[id]/password/route.ts:24-27`؛ `v2 settings-users.ts:129-144`؛ auth-flow PASS×2؛ cdp-settings PASS |
| إبطال الجلسات | ويب: `auth.ts:6` (12h)، `users/[id]/password/route.ts:31` (حذف كل جلسات المستخدم)، `auth.ts:56-59` (تنظيف منتهية)؛ Electron: `auth.ts:55-58,117` (انتهاء 24h + تنظيف)، `settings-users.ts:122,159` (تعطيل/إعادة ضبط)، `api.ts:11` (token بالذاكرة فقط) |
| قفل المحاولات | `api/auth/login/route.ts:8-9,42-54`؛ `v2 auth.ts:12-14,134-153` (5 محاولات → 5 دقائق) |
| التهيئة مرة واحدة | `v2 setup.ts:11` (409)، `api/setup/route.ts:18` (409) |
| التدقيق بحساب الجلسة | `v2 registry.ts:211-229` (user.id من الجلسة)؛ auth-flow أثبت auth.login/login_failed/users.password_change |
| انحراف Argon2id→scrypt | لا ذكر لـargon في أي شيفرة (rg -i argon = فارغ)؛ التوثيق الداخلي يصرح scrypt: `v2 docs/decisions.md:22` |

## ج. قاعدة البيانات والاستمرارية
- sql.js في الذاكرة + تحميل ملف: `v2 src/main/db.ts:35-51`.
- حفظ ذري بعد كل معاملة (tmp+rename): `db.ts:129-162,170-177`.
- rollback وSAVEPOINT متداخل: `db.ts:131-161`.
- تصفير dirty بعد migrations (إصلاح مسح البيانات): `db.ts:48-50`.
- migrations idempotent مرقمة: `db.ts:66-90` + `src/main/migrations/001_initial.sql` (33 جدولًا — قائمة CREATE TABLE سطر 7-397).
- مسار القاعدة userData موحد قبل القفل: `v2 main.ts:18-19,35-37`.
- قفل نسخة واحدة: `main.ts:29-31`.
- إثبات استمرارية داخل Electron: `/tmp/bakery-smoke-result.json` (ok:true) + سجل `/tmp/smoke-audit.log` («migrations: 1 [001_initial.sql]»).
- 24 مسار ويب بمعاملات: `rg -l '\$transaction' src/app/api` → قائمة في جلسة التدقيق؛ نموذج كامل: `src/app/api/sales/route.ts:170-292` (Serializable + clientRef + فحص مخزون داخلي).
- فشل الحفظ يبقى dirty ويُعاد بثه لاحقًا: `db.ts:149-161` (persistFn بعد COMMIT) و`close()` `db.ts:183-195`.

## د. النسخ الاحتياطي
- قائمة الجداول 33/33 تغطي كل المخطط: `v2 services/backup.ts:13-47` مقابل 001_initial.sql.
- تصدير + سجل backup_records: `backup.ts:61-89`.
- معاينة: `backup.ts:119-133`. استعادة بمعاملة واحدة + نسخة أمان pre-restore: `backup.ts:144-188` (safety copy سطر 162-168).
- رفض نسخة بلا مستخدمين: `backup.ts:155-159`.
- عيب هاش فارغ في ويب: تصدير يعقّم `passwordHash:''` (`src/app/api/backup/export/route.ts` — safeUsers) والاستعادة تدخل المستخدمين كما هم `restore/route.ts:91-93` + إعادة بناء الجلسة الحالية `restore/route.ts:241-255`.
- عدم توافق حقول عابر للمنصتين: electron snake_case (001_initial.sql) مقابل prisma camelCase في restore/route.ts (dates() يتوقع camelCase).
- لا جدولة تلقائية: لا setInterval/scheduler في الشيفرة (rg).
- 16 فحصًا وظيفيًا معزولًا: مخرجات `/tmp/backup-audit-test2.ts` في جلسة التدقيق (15 PASS + خلل تأكيد سكربت الشرح موثق في TEST_RESULTS.md §4).

## هـ. الأمن
- webPreferences آمنة: `v2 main.ts:59-66` (contextIsolation، nodeIntegration:false، sandbox، webSecurity).
- جسر محدود بقائمة قنوات: `v2 preload/preload.ts:9-26` + فحص مزدوج `registry.ts:194-209` و`main.ts:86-94`.
- CSP صارم: `v2 src/renderer/index.html:5-9` (connect-src 'none').
- منع تنقل/نوافذ: `main.ts:70-78`.
- الصلاحيات لكل قناة: `registry.ts:50-190` + `permissions.ts:26-40` (OWNER=ALL).
- .env يحوي DATABASE_URL فقط: `cut -d= -f1 .env` → سطر واحد؛ وكلا `.env` و`db/custom.db` مُتتبَّعان في Git: `git ls-files | rg '\.env|custom.db'` → سطران.
- demo محمي: `src/app/api/backup/demo/route.ts:12-17` (settings.manage + رفض فوق بيانات فعلية).

## و. الإصدار
- SHASUMS يتيم: `alwalea-modern-bakery-v2/SHASUMS.txt:1-2` مقابل `ls release` غير موجود و`find *.AppImage/*.zip/*.exe` = صفر.
- لا ملفات إصدار في تاريخ Git: `git log --all --name-only -- 'alwalea-modern-bakery-v2/release'` فارغ.
- تكوين builder سليم: `electron-builder.yml:1-30`.
- أحجام ملفات worklog المزعومة (رواية): `worklog.md` قسم Task 7 (112,532,090 و115,846,502 بايت).

## ز. الاختبارات الموجودة كلها (جرد)
- `alwalea-modern-bakery-v2/scripts/auth-flow-test.ts` (108 سطرًا — تكامل dispatch حقيقي).
- `alwalea-modern-bakery-v2/scripts/e2e/cdp-login-test.ts`، `cdp-settings-test.ts` (واجهة CDP حقيقية).
- لا شيء آخر: `rg --files -g '*test*'` (بعد استبعاد node_modules) = الملفات الثلاثة أعلاه فقط. لا مشغّل اختبارات في package.json لأي حزمة.

## ح. لقطات وملفات خام أُنتجت أثناء التدقيق
- `evidence/web-dashboard-after-login.png` — لوحة التحكم بعد دخول متصفح حي.
- `evidence/web-settings.png` — شاشة الإعدادات بتبويباتها.
- `/tmp/bakery-smoke-result.json`، `/tmp/smoke-audit.log`، `/tmp/electron-audit.log`، `/tmp/web-tsc-full.txt` (تفصيل أخطاء tsc الـ31 خارج src/).
