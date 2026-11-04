// =============================================================
// مخبز الولاء الحديث — توليد CSV محليًا (بلا مكتبات خارجية)
// BOM + فاصلة + اقتباس للقيم الخاصة + أسطر CRLF
// مشترك بين شاشة التقارير (renderer) واختبارات الجرد الآلية
// =============================================================

/** اقتباس الخلية إن احتوت فاصلة/اقتباس/سطر جديد */
export function csvCell(v: string): string {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

/** بناء ملف CSV كامل: ترويسة + صفوف (كل صف مصفوفة نصوص) */
export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((line) => line.map(csvCell).join(','))
  return `\uFEFF${lines.join('\r\n')}\r\n`
}
