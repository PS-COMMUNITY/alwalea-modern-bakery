// =============================================================
// مخبز الولاء الحديث — تصدير CSV موحد (rc.8 — P0-1)
// تحقيق وعد موثق (RELEASE-NOTES + UAT 2.12 + دليل الاستخدام):
// UTF-8 + BOM (\uFEFF) + أسطر CRLF + اقتباس RFC-4180 للحقول التي
// تحوي فاصلة أو اقتباسًا أو سطرًا جديدًا — يفتح في Excel عربي بأعمدة سليمة.
// =============================================================

function csvField(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value)
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

/** بناء محتوى CSV من صفوف (صفوف من أعمدة نصية/رقمية) — بلا BOM هنا */
export function csvRows(rows: readonly (readonly (string | number | null | undefined)[])[]): string {
  return rows.map((r) => r.map(csvField).join(',')).join('\r\n')
}

/** تنزيل ملف CSV: BOM أول الملف ثم المحتوى — يفتح حوار حفظ Windows الافتراضي */
export function downloadCsv(filename: string, rows: readonly (readonly (string | number | null | undefined)[])[]): void {
  const content = '\uFEFF' + csvRows(rows)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.csv') ? filename : `${filename}.csv`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** مبلغ بالأغورة → رقم عشري بمنزلتين لملفات Excel (1250 → "12.50") — بلا رمز عملة */
export function csvMoney(minor: number): string {
  return (Number(minor) / 100).toFixed(2)
}
