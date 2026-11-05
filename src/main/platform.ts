// =============================================================
// مخبز الولاء الحديث — جسر قدرات النظام (rc.12)
// فتح المجلدات في مدير ملفات النظام عبر حقن دالة من main.ts (التي تستورد electron)
// — بلا استيراد electron هنا حتى تعمل الاختبارات في Node الخام (qa-suite).
// =============================================================

type ShellOpener = (p: string) => Promise<string>

let shellOpener: ShellOpener | null = null

/** يُستدعى من main.ts بعد تهيئة Electron */
export function setShellOpener(fn: ShellOpener | null): void {
  shellOpener = fn
}

/**
 * فتح مسار في مدير الملفات (fire-and-forget مع تسجيل الخطأ):
 * النتيجة تُعاد فورًا للواجهة، والوعد يُتابع في الخلفية.
 */
export function openFolder(p: string): { ok: boolean; error?: string } {
  if (!shellOpener) {
    return { ok: false, error: 'فتح المجلد غير مدعوم في هذه البيئة (يعمل داخل التطبيق المثبت فقط)' }
  }
  try {
    void shellOpener(p)
      .then((err) => {
        if (err) console.error('[platform] openPath:', err)
      })
      .catch((e) => {
        console.error('[platform] openPath failed:', e)
      })
    return { ok: true }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}
