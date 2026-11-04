// =============================================================
// مخبز الولاء الحديث — أيقونات SVG محلية (بلا إنترنت، بلا خطوط خارجية)
// stroke-based بمقاس 24×24، ترث currentColor
// =============================================================
import type { ReactNode } from 'react'

type P = { size?: number; className?: string }

function svg(paths: ReactNode, props: P & { viewBox?: string } = {}): ReactNode {
  const s = props.size ?? 24
  return (
    <svg
      width={s}
      height={s}
      viewBox={props.viewBox ?? '0 0 24 24'}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={props.className}
      aria-hidden="true"
      focusable="false"
    >
      {paths}
    </svg>
  )
}

export const IconDashboard = (p: P = {}): ReactNode => svg(<><rect x="3" y="3" width="7.5" height="9" rx="1.5" /><rect x="13.5" y="3" width="7.5" height="5.5" rx="1.5" /><rect x="13.5" y="12" width="7.5" height="9" rx="1.5" /><rect x="3" y="15.5" width="7.5" height="5.5" rx="1.5" /></>, p)

export const IconPos = (p: P = {}): ReactNode => svg(<><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M7 9h6M7 12.5h4" /><path d="M8 21l4-4 4 4" /></>, p)

export const IconProducts = (p: P = {}): ReactNode => svg(<><path d="M5 8c0-3 2-5 4.5-5S14 5 14 8c0 1.5-1 2.5-2.5 2.5S9 9.5 9 8c0-2 1.5-4 4.5-4 3.5 0 5.5 2.5 5.5 6 0 4.5-3 9-7 9s-7-4-7-11z" /></>, p)

export const IconInventory = (p: P = {}): ReactNode => svg(<><path d="M21 8.5L12 3 3 8.5v7L12 21l9-5.5v-7z" /><path d="M3 8.5l9 5 9-5M12 13.5V21" /></>, p)

export const IconCustomers = (p: P = {}): ReactNode => svg(<><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20c0-3 2.5-5 5.5-5s5.5 2 5.5 5" /><circle cx="17" cy="9.5" r="2.4" /><path d="M15.5 15.2c2.8 0 5 1.8 5 4.3" /></>, p)

export const IconSuppliers = (p: P = {}): ReactNode => svg(<><path d="M3 6h11v10H3zM14 9h4l3 3v4h-7z" /><circle cx="7" cy="18.5" r="1.8" /><circle cx="17" cy="18.5" r="1.8" /></>, p)

export const IconPurchases = (p: P = {}): ReactNode => svg(<><circle cx="9" cy="20" r="1.6" /><circle cx="17.5" cy="20" r="1.6" /><path d="M3 3.5h2.2l2.3 11.4h10.4L20.5 7H6" /></>, p)

export const IconSales = (p: P = {}): ReactNode => svg(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 7.5h6M9 11h6M9 14.5h3.5" /></>, p)

export const IconProduction = (p: P = {}): ReactNode => svg(<><path d="M12 4c3.5 0 6.5 2.6 6.5 6.4 0 3-2 4.6-2 7.1v1.5a1.5 1.5 0 0 1-1.5 1.5h-6a1.5 1.5 0 0 1-1.5-1.5v-1.5c0-2.5-2-4.1-2-7.1C5.5 6.6 8.5 4 12 4z" /><path d="M9.5 20.5h5" /></>, p)

export const IconDistribution = (p: P = {}): ReactNode => svg(<><circle cx="6" cy="17" r="2.5" /><circle cx="18" cy="17" r="2.5" /><path d="M6 17l4-8h4l2.5 5M10 9l2 5M14 6h2v3" /><path d="M14.5 6L16 3.5h2.5" /></>, p)

export const IconCash = (p: P = {}): ReactNode => svg(<><rect x="3" y="6.5" width="18" height="11" rx="2" /><circle cx="12" cy="12" r="2.6" /><path d="M6.5 9.8v.01M17.5 14.2v.01" /></>, p)

export const IconCount = (p: P = {}): ReactNode => svg(<><path d="M21 8.5L12 3 3 8.5v7L12 21l9-5.5v-7z" /><path d="M9 12l2 2 4-4.5" /></>, p)

export const IconExpenses = (p: P = {}): ReactNode => svg(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h4" /></>, p)

export const IconAudit = (p: P = {}): ReactNode => svg(<><path d="M12 3l8 3v5.5c0 4.8-3.2 8.3-8 9.5-4.8-1.2-8-4.7-8-9.5V6z" /><path d="M9 12l2 2 4-4" /></>, p)

export const IconReports = (p: P = {}): ReactNode => svg(<><path d="M4 20V10M10 20V4M16 20v-7M21 20H3" /></>, p)

export const IconSettings = (p: P = {}): ReactNode => svg(<><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.15-1.4l2-1.55-2-3.45-2.35.95a7 7 0 0 0-2.4-1.4L13.7 2.7h-3.4l-.4 2.45a7 7 0 0 0-2.4 1.4L5.15 5.6l-2 3.45 2 1.55A7 7 0 0 0 5 12c0 .48.05.94.15 1.4l-2 1.55 2 3.45 2.35-.95a7 7 0 0 0 2.4 1.4l.4 2.45h3.4l.4-2.45a7 7 0 0 0 2.4-1.4l2.35.95 2-3.45-2-1.55c.1-.46.15-.92.15-1.4z" /></>, p)

export const IconLock = (p: P = {}): ReactNode => svg(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 8 0v3.5" /></>, p)

export const IconUnlock = (p: P = {}): ReactNode => svg(<><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V7a4 4 0 0 1 7.7-1.5" /></>, p)

export const IconSearch = (p: P = {}): ReactNode => svg(<><circle cx="11" cy="11" r="6.5" /><path d="M20.5 20.5L16 16" /></>, p)

export const IconPlus = (p: P = {}): ReactNode => svg(<><path d="M12 5v14M5 12h14" /></>, p)

export const IconClose = (p: P = {}): ReactNode => svg(<><path d="M6 6l12 12M18 6L6 18" /></>, p)

export const IconCheck = (p: P = {}): ReactNode => svg(<><path d="M4.5 12.5l5 5L19.5 7" /></>, p)

export const IconAlert = (p: P = {}): ReactNode => svg(<><path d="M12 3L2.5 20h19z" /><path d="M12 9.5v4.5M12 17.2v.01" /></>, p)

export const IconInfo = (p: P = {}): ReactNode => svg(<><circle cx="12" cy="12" r="9" /><path d="M12 11v5.5M12 7.6v.01" /></>, p)

export const IconTrash = (p: P = {}): ReactNode => svg(<><path d="M4 6.5h16M9.5 6.5V4.8A1.3 1.3 0 0 1 10.8 3.5h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7M6.5 6.5l1 13.2a1.5 1.5 0 0 0 1.5 1.3h6a1.5 1.5 0 0 0 1.5-1.3l1-13.2" /></>, p)

export const IconExport = (p: P = {}): ReactNode => svg(<><path d="M12 15V4M8 8l4-4 4 4" /><path d="M4 15v3.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V15" /></>, p)

export const IconCalendar = (p: P = {}): ReactNode => svg(<><rect x="3.5" y="5" width="17" height="16" rx="2" /><path d="M8 3v4M16 3v4M3.5 10h17" /></>, p)

export const IconFlour = (p: P = {}): ReactNode => svg(<><path d="M8 21c-2.5-1-4.5-3.2-4.5-6.2C3.5 10.6 7 7 12 7s8.5 3.6 8.5 7.8c0 3-2 5.2-4.5 6.2z" /><path d="M12 7V3.5M12 3.5c-1.5 0-2.5-.7-2.5-1.5h5c0 .8-1 1.5-2.5 1.5z" /></>, p)

export const IconBread = (p: P = {}): ReactNode => svg(<><path d="M4 12.5C4 8.9 7.6 6.5 12 6.5s8 2.4 8 6c0 2-.9 3-2 3.4V18a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 6 18v-2.1c-1.1-.4-2-1.4-2-3.4z" /><path d="M8.5 11v3M12 10.5v4M15.5 11v3" /></>, p)

export const IconSalt = (p: P = {}): ReactNode => svg(<><path d="M7 9h10l1.5 10.5a1.5 1.5 0 0 1-1.5 1.5H7a1.5 1.5 0 0 1-1.5-1.5z" /><path d="M9.5 9V6.5A1.5 1.5 0 0 1 11 5h2a1.5 1.5 0 0 1 1.5 1.5V9" /><path d="M9.5 13.5h.01M12 16h.01M14.5 13h.01" /></>, p)

export const IconBags = (p: P = {}): ReactNode => svg(<><path d="M6 8h12l-1 12.5a1.5 1.5 0 0 1-1.5 1.3h-7A1.5 1.5 0 0 1 7 20.5z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></>, p)

export const IconBox = IconInventory

// =============================================================
// rc.7 parity additions — أيقونات توازٍ مع الويب (نفس النمط: 24×24، currentColor، 1.9)
// =============================================================

export const IconEye = (p: P = {}): ReactNode => svg(<><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>, p)

export const IconEyeOff = (p: P = {}): ReactNode => svg(<><path d="M4 4l16 16" /><path d="M10.7 5.7c.4-.1.9-.2 1.3-.2 6 0 9.5 6.5 9.5 6.5a17.6 17.6 0 0 1-2.9 3.6M6.6 6.6C4 8.5 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.4 3.9-.9" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></>, p)

export const IconPlusCircle = (p: P = {}): ReactNode => svg(<><circle cx="12" cy="12" r="9" /><path d="M12 8v8M8 12h8" /></>, p)

export const IconMinusCircle = (p: P = {}): ReactNode => svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12h8" /></>, p)

export const IconDownload = (p: P = {}): ReactNode => svg(<><path d="M12 4v10.5M7.5 10.5l4.5 4.5 4.5-4.5" /><path d="M4.5 16.5V18a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-1.5" /></>, p)

export const IconCart = (p: P = {}): ReactNode => svg(<><circle cx="9" cy="20.3" r="1.4" /><circle cx="17" cy="20.3" r="1.4" /><path d="M2.8 3.8h2.3l2.5 11.2h10l2.3-8H6" /><path d="M9.5 10.8h7" /></>, p)

export const IconReceipt = (p: P = {}): ReactNode => svg(<><path d="M6 21.5V4.5A1.5 1.5 0 0 1 7.5 3h9A1.5 1.5 0 0 1 18 4.5v17l-3-2-3 2-3-2z" /><path d="M9.5 8h5M9.5 11.5h5M9.5 15h3" /></>, p)

export const IconCamera = (p: P = {}): ReactNode => svg(<><path d="M4 8.5A1.5 1.5 0 0 1 5.5 7h2L9 4.5h6L16.5 7h2A1.5 1.5 0 0 1 20 8.5V18a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 18z" /><circle cx="12" cy="13" r="3.2" /></>, p)

export const IconArrowUp = (p: P = {}): ReactNode => svg(<path d="M12 19.5v-14M6.5 11L12 5.5 17.5 11" />, p)

export const IconArrowDown = (p: P = {}): ReactNode => svg(<path d="M12 4.5v14M6.5 13l5.5 5.5L17.5 13" />, p)

export const IconAdjust = (p: P = {}): ReactNode => svg(<><path d="M4 7h8.5M17.5 7H20M4 12h2.5M11 12h9M4 17h8.5M17.5 17H20" /><circle cx="15" cy="7" r="2.1" /><circle cx="8.5" cy="12" r="2.1" /><circle cx="15" cy="17" r="2.1" /></>, p)

export const IconFactory = (p: P = {}): ReactNode => svg(<><path d="M4 20.5V9.5l5.5 3.2V9.5L15 12.7V4.5h4.5v16" /><path d="M3.5 20.5h17" /><path d="M8 20.5v-3M12.5 20.5v-3M17 20.5v-3" /></>, p)

export const IconBook = (p: P = {}): ReactNode => svg(<><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" /><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" /></>, p)

export const IconMap = (p: P = {}): ReactNode => svg(<><path d="M9 4.5L3.5 6.5v13L9 17.5l6 2 5.5-2v-13L15 6.5z" /><path d="M9 4.5v13M15 6.5v13" /></>, p)

export const IconBike = (p: P = {}): ReactNode => svg(<><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M6 17l3.5-6.5h5.4L18 17" /><path d="M9.5 10.5H7.4M14.9 10.5l1-2.3h1.7" /></>, p)

export const IconCalc = (p: P = {}): ReactNode => svg(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M8.5 7h7" /><path d="M8.5 11.5h.01M12 11.5h.01M15.5 11.5h.01M8.5 15h.01M12 15h.01M15.5 15h.01M8.5 18.5h.01M12 18.5h.01M15.5 18.5h.01" /></>, p)

export const IconCheckCircle = (p: P = {}): ReactNode => svg(<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l2.7 2.7L16.5 9" /></>, p)

export const IconXCircle = (p: P = {}): ReactNode => svg(<><circle cx="12" cy="12" r="9" /><path d="M9.2 9.2l5.6 5.6M14.8 9.2l-5.6 5.6" /></>, p)

export const IconPower = (p: P = {}): ReactNode => svg(<><path d="M12 3v8.5" /><path d="M7 6.5a7.5 7.5 0 1 0 10 0" /></>, p)

export const IconUser = (p: P = {}): ReactNode => svg(<><circle cx="12" cy="8" r="3.6" /><path d="M5 20c0-3.6 3.1-5.8 7-5.8s7 2.2 7 5.8" /></>, p)

export const IconScale = (p: P = {}): ReactNode => svg(<><path d="M12 5v14.5" /><path d="M8.5 19.5h7" /><path d="M5 7h14" /><path d="M5 7l-2.2 5M5 7l2.2 5" /><path d="M2.8 12a3 3 0 0 0 4.4 0" /><path d="M19 7l-2.2 5M19 7l2.2 5" /><path d="M16.8 12a3 3 0 0 0 4.4 0" /></>, p)

export const IconWrench = (p: P = {}): ReactNode => svg(<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />, p)

/** اختيار أيقونة منتج حسب الاسم — محلي بالكامل */
export function productIcon(name: string): ReactNode {
  const n = name ?? ''
  if (n.includes('خبز') || n.includes('كعك') || n.includes('معجن') || n.includes('كرواسان')) return <IconBread />
  if (n.includes('طحين') || n.includes('دقيق')) return <IconFlour />
  if (n.includes('سكر')) return <IconFlour />
  if (n.includes('ملح')) return <IconSalt />
  if (n.includes('خميرة')) return <IconProducts />
  if (n.includes('محسن')) return <IconProducts />
  if (n.includes('كيس') || n.includes('تغليف') || n.includes('أكياس')) return <IconBags />
  return <IconBread />
}
