#!/usr/bin/env node
// بناء حزم Windows (NSIS + Portable) على Linux دون wine.
//
// الخلفية: مسار NSIS الافتراضي في electron-builder يشغّل مثبّت الحذف المؤقت مرة واحدة
// تحت wine لاستخراج برنامج إلغاء التثبيت. electron-builder 26 يتضمن مسارًا بديلًا نقيًا
// (UninstallerReader — محلّل PE بـJS يستخرج برنامج إلغاء التثبيت دون تشغيله) يُستخدم
// أصلًا على macOS Catalina حيث لا يوجد wine. هذا السكربت يوجّه البناء إلى المسار البديل
// ثم يستدعي واجهة electron-builder البرمجية مباشرة.
// التوقيع (signtool) يُتخطى عبر win.signExecutable: false في electron-builder.yml
// (لا شهادة توقيع في هذا المشروع)، مع الإبقاء على تحرير موارد EXE (الأيقونة/الإصدار)
// وهي تنفيذ JS نقي في electron-builder 26 عبر حزمة resedit.
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const projectDir = new URL("..", import.meta.url).pathname;

const macosVersion = require(
  require.resolve("app-builder-lib/out/util/macosVersion", { paths: [projectDir] }),
);
const original = macosVersion.isMacOsCatalina;
if (process.platform !== "win32") {
  // فقط خارج Windows الحقيقي: استخراج برنامج إلغاء التثبيت بـUninstallerReader بدل wine
  macosVersion.isMacOsCatalina = () => true;
}

const { build } = require(require.resolve("electron-builder", { paths: [projectDir] }));

try {
  const artifacts = await build({
    projectDir,
    publish: "never",
    win: ["nsis", "portable"],
    x64: true,
  });
  console.log("=== WINDOWS ARTIFACTS ===");
  for (const a of artifacts) console.log(`${a.file} (${Math.round(a.fileSize / 1024 / 1024)} MB)`);
} finally {
  macosVersion.isMacOsCatalina = original;
}
