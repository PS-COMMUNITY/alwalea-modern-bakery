; publisher override (مهمة 4-b): إظهار اسم الناشر العربي في «التطبيقات والميزات» (ARP).
; electron-builder يكتب Publisher = author.name (من package.json) داخل ماكرو registryAddInstallInfo،
; وهذا الماكرو customInstall يُستدعى بعده في installSection.nsh، فتكون كتابته هي الأخيرة (يفوز).
; الملف بترميز UTF-8 مع BOM حتى يقرأه makensis كـUnicode صحيح.
!macro customInstall
  WriteRegStr SHCTX "${UNINSTALL_REGISTRY_KEY}" "Publisher" "مخبز الولاء الحديث"
!macroend
