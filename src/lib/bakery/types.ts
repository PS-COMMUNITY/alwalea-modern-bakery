// =============================================================
// أنواع مشتركة بين الواجهة والـ API — مخبز الولاء الحديث
// الأموال بالأغورة (Int) والكميات بالألفية (Int)
// =============================================================

export type Role = 'OWNER' | 'MANAGER' | 'CASHIER' | 'STOCK' | 'PRODUCTION' | 'DISTRIBUTION' | 'ACCOUNTANT'

export type AuthUser = { id: string; username: string; displayName: string; role: Role }

export type StatusInfo = {
  setupCompleted: boolean
  businessName: string
  currencyCode: string
  currencySymbol: string
  schemaVersion: string
  appVersion: string
}

export type Settings = {
  id: number
  businessName: string
  ownerName: string | null
  phone: string | null
  address: string | null
  currencyCode: string
  currencySymbol: string
  currencyDecimals: number
  taxEnabled: boolean
  taxRateBp: number
  negativeStockAllowed: boolean
  receiptWidth: number
  idleLockMinutes: number
  requireCustomerForCredit: boolean
  setupCompleted: boolean
  demoDataLoaded: boolean
  schemaVersion: string
}

export type UserInfo = {
  id: string
  username: string
  displayName: string
  role: Role
  active: boolean
  lastLoginAt: string | null
  createdAt: string
}

export type Category = { id: string; name: string; active: boolean; _count?: { products: number } }

export type Product = {
  id: string
  code: string | null
  barcode: string | null
  name: string
  categoryId: string | null
  category?: { id: string; name: string } | null
  type: 'RAW' | 'FINISHED' | 'TRADE'
  baseUnit: string
  trackStock: boolean
  priceMinor: number
  wholesalePriceMinor: number | null
  costMinor: number
  minStockMilli: number
  active: boolean
  stockMilli?: number
}

export type Customer = {
  id: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  creditLimitMinor: number | null
  defaultPriceType: 'RETAIL' | 'WHOLESALE'
  active: boolean
  debtMinor?: number
}

export type Supplier = {
  id: string
  name: string
  phone: string | null
  address: string | null
  notes: string | null
  active: boolean
  dueMinor?: number
}

export type SaleItem = {
  id?: string
  productId: string
  productName: string
  qtyMilli: number
  priceMinor: number
  discountMinor: number
  costMinor: number
  lineTotalMinor: number
}

export type Sale = {
  id: string
  invoiceNo: string
  date: string
  customerId: string | null
  customerName: string
  source: 'POS' | 'DISTRIBUTION'
  subtotalMinor: number
  discountMinor: number
  taxMinor: number
  totalMinor: number
  paidMinor: number
  creditMinor: number
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID'
  status: 'COMPLETED' | 'CANCELLED'
  userId: string
  note: string | null
  items?: SaleItem[]
}

export type Purchase = {
  id: string
  invoiceNo: string
  date: string
  supplierId: string
  supplierName: string
  subtotalMinor: number
  discountMinor: number
  totalMinor: number
  paidMinor: number
  paymentStatus: 'PAID' | 'PARTIAL' | 'UNPAID'
  status: 'COMPLETED' | 'CANCELLED'
}

export type Paged<T> = { items: T[]; total: number }

export type StatementEntry = {
  id: string
  date: string
  type: string
  refType: string | null
  amountMinor: number
  note: string | null
  balanceMinor: number
}

export type DashboardData = {
  today: { salesTotalMinor: number; invoicesCount: number; creditMinor: number; collectedMinor: number; expensesMinor: number }
  yesterday: { salesTotalMinor: number; invoicesCount: number; creditMinor: number; collectedMinor: number; expensesMinor: number }
  stockAlerts: { count: number; items: { productId: string; name: string; baseUnit: string; balanceMilli: number; minStockMilli: number }[] }
  latestSales: Sale[]
  customerDebts: { totalMinor: number; debtorsCount: number }
  openOperations: { openTripsCount: number; openShift: { id: string; openedAt: string; openingCashMinor?: number } | null }
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'المالك',
  MANAGER: 'المدير',
  CASHIER: 'كاشير',
  STOCK: 'مسؤول المخزون',
  PRODUCTION: 'مسؤول الإنتاج',
  DISTRIBUTION: 'مسؤول التوزيع',
  ACCOUNTANT: 'المحاسب',
}

export const PRODUCT_TYPE_LABELS: Record<string, string> = {
  RAW: 'مادة خام',
  FINISHED: 'منتج مصنّع',
  TRADE: 'بضاعة تجارية',
}

export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  CASH: 'نقدي',
  CARD: 'بطاقة',
  TRANSFER: 'حوالة',
  CHEQUE: 'شيك',
}

export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  OPENING: 'رصيد افتتاحي',
  PURCHASE: 'مشتريات',
  SALE: 'بيع',
  SALE_RETURN: 'مرتجع بيع',
  PURCHASE_RETURN: 'مرتجع شراء',
  PRODUCTION_IN: 'ناتج إنتاج',
  PRODUCTION_OUT: 'استهلاك إنتاج',
  WASTE: 'تلف وهدر',
  ADJUSTMENT: 'تسوية/تصحيح',
  TRIP_OUT: 'تحميل جولة',
  TRIP_RETURN: 'مرتجع جولة',
}

/** أدوار يمكنها الوصول للصفحة — للتحكم في إظهار القائمة */
export const NAV_PERMS: Record<string, string> = {
  dashboard: '',
  pos: 'pos.use',
  products: 'products.view',
  customers: 'customers.view',
  suppliers: 'suppliers.view',
  purchases: 'purchases.view',
  inventory: 'inventory.view',
  production: 'production.view',
  distribution: 'distribution.view',
  expenses: 'expenses.view',
  shifts: 'shifts.view',
  reports: 'reports.operations',
  audit: 'audit.view',
  settings: 'settings.manage',
}
