// =============================================================
// مخبز الولاء الحديث — تصدير Excel احترافي (rc.9 — المرحلة 3)
// exceljs: ورقة RTL + رأس ملون ثابت (freeze) + عروض أعمدة تلقائية
// + تنسيق أرقام #,##0.00 + صف مجاميع + فلاتر — يفتح في Excel مباشرة.
// =============================================================
import ExcelJS from 'exceljs'

export interface XlsxColumn {
  key: string
  label: string
  /** عرض العمود (أحرف) — الافتراضي 16 */
  width?: number
  /** تنسيق رقمي Excel — مثال '#,##0.00' للمبالغ */
  numFmt?: string
  /** توسيط عمود نصي */
  center?: boolean
}

const HEADER_BROWN = 'FF6B4226' // بني داكن — هوية المخبز
const TOTALS_FILL = 'FFF3E9DC' // بيج فاتح لصف المجاميع

/** تصدير ورقة واحدة إلى ملف xlsx وتنزيله */
export async function downloadXlsx(
  filename: string,
  sheetName: string,
  columns: readonly XlsxColumn[],
  rows: readonly Record<string, unknown>[],
  totalsRow?: Record<string, unknown> | undefined
): Promise<void> {
  const wb = new ExcelJS.Workbook()
  wb.creator = 'مخبز الولاء الحديث'
  wb.created = new Date()

  const ws = wb.addWorksheet(sheetName, {
    views: [{ rightToLeft: true, state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  })

  ws.columns = columns.map((c) => ({ header: c.label, key: c.key, width: c.width ?? Math.max(14, c.label.length + 4) }))

  // رأس ملون ثابت
  const header = ws.getRow(1)
  header.font = { bold: true, size: 12, color: { argb: 'FFFFFFFF' }, name: 'Calibri' }
  header.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_BROWN } }
  header.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true }
  header.height = 24

  // الصفوف
  for (const r of rows) {
    const row = ws.addRow(r)
    row.alignment = { vertical: 'middle' }
  }

  // صف المجاميع
  if (totalsRow) {
    const tr = ws.addRow(totalsRow)
    tr.font = { bold: true, color: { argb: 'FF3E2A18' } }
    tr.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: TOTALS_FILL } }
    tr.alignment = { vertical: 'middle' }
    for (let i = 1; i <= columns.length; i++) {
      tr.getCell(i).border = { top: { style: 'thin', color: { argb: HEADER_BROWN } } }
    }
  }

  // تنسيق الأرقام والتوسيط لكل عمود
  columns.forEach((c, idx) => {
    const col = ws.getColumn(idx + 1)
    if (c.numFmt) col.numFmt = c.numFmt
    if (c.center) col.alignment = { horizontal: 'center', vertical: 'middle' }
  })

  // فلاتر على الرأس
  ws.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: columns.length }
  }

  const buf = await wb.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 5000)
}

/** مبلغ بالأغورة → رقم لخلية Excel (1250 → 12.5) */
export function xlsxMoney(minor: number): number {
  return Number(minor) / 100
}
