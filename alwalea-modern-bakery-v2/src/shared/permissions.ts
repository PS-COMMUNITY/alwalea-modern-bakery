// =============================================================
// مخبز الولاء الحديث — الأدوار والصلاحيات
// تُفرض في طبقة الخدمات (main) وليس في الواجهة فقط.
// =============================================================

export const ROLES = ['OWNER', 'MANAGER', 'CASHIER', 'STOCK', 'PRODUCTION', 'DISTRIBUTION', 'ACCOUNTANT'] as const
export type Role = (typeof ROLES)[number]

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'المالك',
  MANAGER: 'المدير',
  CASHIER: 'كاشير',
  STOCK: 'مسؤول المخزون',
  PRODUCTION: 'مسؤول الإنتاج',
  DISTRIBUTION: 'مسؤول التوزيع',
  ACCOUNTANT: 'المحاسب'
}

export const PERMS = [
  'settings.manage', 'users.manage', 'backup.manage',
  'products.view', 'products.manage', 'categories.manage',
  'customers.view', 'customers.manage', 'customers.collect',
  'suppliers.view', 'suppliers.manage', 'suppliers.pay',
  'pos.use', 'sales.view', 'sales.cancel', 'sales.discount',
  'purchases.view', 'purchases.manage', 'purchases.cancel',
  'inventory.view', 'inventory.adjust', 'inventory.opening', 'inventory.waste',
  'production.view', 'production.manage',
  'distribution.view', 'distribution.manage',
  'expenses.view', 'expenses.manage',
  'shifts.use', 'shifts.view', 'shifts.close',
  'reports.financial', 'reports.operations', 'audit.view'
] as const
export type Perm = (typeof PERMS)[number]

const ALL: Perm[] = [...PERMS]

// مصفوفة الدور → الصلاحيات (المالك يملك الكل؛ لا يستطيع أي مستخدم منح نفسه صلاحيات)
export const ROLE_PERMS: Record<Role, Perm[]> = {
  OWNER: ALL,
  MANAGER: ALL.filter((p) => p !== 'users.manage' && p !== 'backup.manage'),
  CASHIER: ['products.view', 'customers.view', 'pos.use', 'sales.view', 'shifts.use', 'customers.collect'],
  STOCK: ['products.view', 'products.manage', 'categories.manage', 'inventory.view', 'inventory.adjust', 'inventory.opening', 'inventory.waste', 'purchases.view', 'reports.operations'],
  PRODUCTION: ['products.view', 'inventory.view', 'production.view', 'production.manage', 'reports.operations'],
  DISTRIBUTION: ['products.view', 'customers.view', 'distribution.view', 'distribution.manage', 'inventory.view', 'reports.operations'],
  ACCOUNTANT: ['sales.view', 'purchases.view', 'expenses.view', 'expenses.manage', 'customers.view', 'customers.collect', 'suppliers.view', 'suppliers.pay', 'inventory.view', 'reports.financial', 'reports.operations', 'shifts.view', 'audit.view']
}

export function permsForRole(role: string): Perm[] {
  return ROLE_PERMS[role as Role] ?? []
}

export function hasPerm(role: string, perm: Perm): boolean {
  return permsForRole(role).includes(perm)
}
