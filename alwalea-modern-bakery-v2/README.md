# مخبز الولاء الحديث — Al Wale'a Modern Bakery
## نظام إدارة مخبز احترافي — إصدار Desktop محلي يعمل دون إنترنت

نظام متكامل لإدارة مخبز: **مبيعات (POS)، مخزون، مشتريات، عملاء وديون، مورّدون، إنتاج ووصفات، توزيع ومندوبون، مصروفات، خزينة وورديات، تقارير، سجل تدقيق، نسخ احتياطي** — بواجهة عربية RTL كاملة وقاعدة بيانات محلية.

> **حالة الإصدار 1.0.0**: جميع الوحدات مُنفّذة ومختبرة على بيئة التطوير. نسخة Linux (AppImage) مبنية ومختبرة التشغيل والاستمرارية فعليًا. حزمة Windows محمولة (ZIP) جاهزة **غير مختبرة على Windows**، والمثبّت NSIS يتطلب بناءه من جهاز Windows (انظر `docs/build-from-source.md`).

---

## البنية التقنية

| الطبقة | التقنية |
|---|---|
| الواجهة | React 18 + TypeScript strict + Vite، خط Cairo مضمّن محليًا |
| سطح المكتب | Electron (سياق معزول، `nodeIntegration: false`، preload بقنوات IPC محدودة) |
| قاعدة البيانات | SQLite عبر `sql.js` (WASM — بدون وحدات native) بملف ذري الحفظ |
| التغليف | electron-builder (AppImage / NSIS) |
| الأرقام المالية | أعداد صحيحة بوحدة أصغر للعملة (أغورة) — ممنوع الفواصل العائمة |
| الكميات | أعداد صحيحة بوحدة ألفية (×1000) |
| كلمات المرور | scrypt مع ملح مستقل لكل مستخدم + قفل مؤقت بعد محاولات فاشلة |

### مكان قاعدة البيانات (دائم خارج مجلد التثبيت)
- **Windows**: `%APPDATA%\alwalea-modern-bakery\data\bakery.db`
- **Linux**: `~/.config/alwalea-modern-bakery/data/bakery.db`

البيانات تبقى بعد إغلاق التطبيق وإعادة تشغيل الجهاز، ولا يمسها التثبيت أو التحديث.

## التشغيل السريع للمطورين

```bash
bun install        # أو npm install
bun run dev        # تطوير: vite + electron معًا
bun run build      # بناء الإنتاج (renderer + main)
bunx electron .    # تشغيل النسخة المبنية
bun run smoke      # اختبار دوخان: فتح + حفظ + إعادة فتح + تحقق
bun run dist:linux # AppImage
bun run dist:win   # مثبت NSIS — يتطلب Windows أو wine
```

## الملفات الرئيسية

```
src/main/          عملية Electron الرئيسية الآمنة (نافذة، IPC، قاعدة، خدمات)
src/main/services/ خدمات الأعمال: sales, purchases, inventory, production,
                   distribution, finance (مصروفات/ورديات), reports, backup...
src/main/migrations/ ترحيلات مرقمة (001_initial.sql)
src/preload/       جسر contextBridge بقائمة قنوات مسموحة فقط
src/shared/        أنواع مشتركة (IPC والنطاق)
src/renderer/      واجهة React العربية RTL (setup, login, POS, مخزون، تقارير...)
electron-builder.yml إعدادات التغليف
docs/              الأدلة: التثبيت، الاستخدام، النسخ الاحتياطي، البناء، القرارات
```

## الأدلة
- [دليل التثبيت وأول تشغيل](docs/install-guide.md)
- [دليل الاستخدام الأساسي](docs/user-guide.md)
- [دليل النسخ الاحتياطي والاستعادة](docs/backup-guide.md)
- [البناء من المصدر وإنتاج مثبت Windows](docs/build-from-source.md)
- [القرارات التقنية والافتراضات التجارية](docs/decisions.md)

## الأمان — الحدود الحقيقية
- كلمات المرور وPIN مُلبَّدة (scrypt) ولا تُخزَّن نصًا.
- الصلاحيات مفروضة في طبقة الخدمات (عملية Electron الرئيسية) لا في الواجهة فقط.
- سجل تدقيق للعمليات الحساسة لا يمكن تعديله من الواجهة.
- **حد معلوم**: قاعدة البيانات المحلية ليست حماية ضد من يملك وصولًا كاملًا لحساب Windows على الجهاز — احمِ الجهاز نفسه واستخدم النسخ الاحتياطي الدوري.

## الترخيص
UNLICENSED — برمجيات مخصصة لصاحب النشاط. الخط Cairo رخصة OFL (ملف الترخيص مع الأصول).
