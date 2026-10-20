# البناء من المصدر وإنتاج مثبت Windows

## المتطلبات
- Node.js 20+ (أو Bun 1.1+) وnpm/bun.
- لا حاجة لأدوات بناء native — القاعدة `sql.js` (WASM) بلا وحدات مجمعة.

## خطوات البناء العامة
```bash
npm install        # أو bun install
npm run build      # يبني renderer (vite) و main/preload
npm run smoke      # اختبار دوخان: يحفظ سجلًا ويعيد قراءته (يتطلب شاشة: xvfb-run -a على Linux)
```

## بناء مثبت Windows NSIS (الأهم للنشر)
**نفّذه على جهاز Windows فعلي** (أو بيئة Windows موثوقة) لأن NSIS يحتاج wine على Linux:

```powershell
npm install
npm run build
npx electron-builder --win nsis --x64
```

الناتج في `release/`:
- `AlWaleaModernBakery-Setup-1.0.0.exe` — مثبت واحد clicks مع اختيار مجلد التثبيت، واختصارات قائمة ابدأ وسطح المكتب.

### إعدادات مثبت NSIS المفعلة (electron-builder.yml)
- تثبيت لكل مستخدم (لا يحتاج صلاحيات مدير).
- **إلغاء التثبيت لا يحذف** `%APPDATA%\alwalea-modern-bakery` (بيانات النشاط).
- اسم المنتج والإصدار وأيقونة التطبيق مضبوطة.

### بعد البناء — قائمة تحقق قبل التسليم
1. [ ] ثبّت على جهاز Windows نظيف.
2. [ ] أكمل معالج الإعداد وأنشئ المالك.
3. [ ] أضف منتجًا وسجّل بيعًا واطبع إيصالًا (معاينة الطباعة).
4. [ ] أغلق التطبيق وافتحه — تحقق أن البيانات باقية.
5. [ ] خذ نسخة احتياطية واستعدها (بعد تعديل شيء ما) وتحقق.
6. [ ] أنشئ `sha256sum` لملف EXE وسجّله مع ملف التسليم.
7. [ ] حدّث `SHASUMS.txt` والتقرير النهائي بحالة الاختبار الفعلي على Windows.

## بناء Linux (للتشغيل على Linux)
```bash
npx electron-builder --linux AppImage
# اختبار سريع بلا تثبيت:
./dist/*.AppImage --appimage-extract-and-run --smoke
```

## تحديث إصدار مستقبلًا
1. عدّل `version` في `package.json`.
2. أعد البناء — القاعدة في `userData` لا يمسها التحديث، وترحيلات القاعدة مرقمة وتتطبق تلقائيًا عند أول تشغيل للإصدار الجديد.

## التوقيع الرقمي
التطبيق حاليًا **غير موقّع**. للتوقيع ستحتاج شهادة توقيع كود مدفوعة (OV/EV) من جهة موثوقة ثم ضبط `win.certificateFile`/`certificateSubjectName` في electron-builder.yml. لا تدّعِ توقيعًا غير موجود — وثّق تحذير SmartScreen المتوقع للمستخدم.
