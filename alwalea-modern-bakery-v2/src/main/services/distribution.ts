// =============================================================
// مخبز الولاء الحديث — التوزيع: مندوبون، خطوط، جولات، تسوية ذرية
// تحميل TRIP_OUT− — بيع داخل الجولة (بدون أثر مخزون رئيسي حتى الترحيل)
// مرتجع GOOD → TRIP_RETURN+ — DAMAGED → TRIP_RETURN+ ثم WASTE−
// تسوية: ترحيل فواتير بيع source=DISTRIBUTION + نقد للصندوق + آجل لدفتر العميل
// منع مضاعفة الترحيل: فحص حالة الجولة داخل المعاملة + client_ref فريد.
// =============================================================
import { ApiError, reqStr, optStr, reqInt, reqMilli, reqMinor, reqDate, reqEnum, reqArr, obj } from '../validate'
import { lineTotalMinor, percentOfBp } from '../../shared/money'
import {
  SvcCtx,
  addCustomerLedger,
  addCashMovement,
  addStockMovement,
  assertStock,
  currentShiftId,
  getIntSetting,
  getBoolSetting,
  nextDocNo
} from './helpers'

// ---------- المندوبون والخطوط ----------
export function listReps(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const includeInactive = payload.includeInactive === true
  return ctx.db.query(`SELECT id, name, phone, active FROM distribution_reps ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`)
}

export function createRep(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, number | string | null> {
  const name = reqStr(payload.name, 'اسم المندوب', 120)
  const phone = optStr(payload.phone, 'الهاتف', 30)
  return ctx.db.tx(() => {
    ctx.db.run('INSERT INTO distribution_reps (name, phone, active, created_at) VALUES (?, ?, 1, ?)', [name, phone, ctx.db.now()])
    const id = ctx.db.lastId()
    ctx.audit('distribution.rep_create', 'rep', id, { name })
    return { id, name, phone, active: 1 }
  })
}

export function updateRep(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const name = reqStr(payload.name, 'اسم المندوب', 120)
  const phone = optStr(payload.phone, 'الهاتف', 30)
  const active = payload.active === undefined ? 1 : payload.active === false ? 0 : 1
  return ctx.db.tx(() => {
    if (!ctx.db.get('SELECT id FROM distribution_reps WHERE id = ?', [id])) throw new ApiError('المندوب غير موجود', 404)
    ctx.db.run('UPDATE distribution_reps SET name = ?, phone = ?, active = ? WHERE id = ?', [name, phone, active, id])
    ctx.audit('distribution.rep_update', 'rep', id, null)
    return { done: true }
  })
}

export function listRoutes(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const includeInactive = payload.includeInactive === true
  return ctx.db.query(`SELECT id, name, note, active FROM distribution_routes ${includeInactive ? '' : 'WHERE active = 1'} ORDER BY name`)
}

export function createRoute(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, number | string | null> {
  const name = reqStr(payload.name, 'اسم الخط', 120)
  const note = optStr(payload.note, 'ملاحظة', 300)
  return ctx.db.tx(() => {
    ctx.db.run('INSERT INTO distribution_routes (name, note, active, created_at) VALUES (?, ?, 1, ?)', [name, note, ctx.db.now()])
    const id = ctx.db.lastId()
    ctx.audit('distribution.route_create', 'route', id, { name })
    return { id, name, note, active: 1 }
  })
}

export function updateRoute(ctx: SvcCtx, payload: Record<string, unknown>): { done: boolean } {
  const id = reqInt(payload.id, 'المعرف', 1)
  const name = reqStr(payload.name, 'اسم الخط', 120)
  const note = optStr(payload.note, 'ملاحظة', 300)
  const active = payload.active === undefined ? 1 : payload.active === false ? 0 : 1
  return ctx.db.tx(() => {
    if (!ctx.db.get('SELECT id FROM distribution_routes WHERE id = ?', [id])) throw new ApiError('الخط غير موجود', 404)
    ctx.db.run('UPDATE distribution_routes SET name = ?, note = ?, active = ? WHERE id = ?', [name, note, active, id])
    ctx.audit('distribution.route_update', 'route', id, null)
    return { done: true }
  })
}

// ---------- الجولات ----------
interface TripRow {
  id: number
  trip_no: string
  rep_id: number
  route_id: number | null
  date: string
  status: string
  notes: string | null
  settle_notes: string | null
  created_at: string
  settled_at: string | null
}

function requireTrip(ctx: SvcCtx, id: number): TripRow {
  const t = ctx.db.get<TripRow>('SELECT * FROM distribution_trips WHERE id = ?', [id])
  if (!t) throw new ApiError('الجولة غير موجودة', 404)
  return t
}

export function createTrip(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const db = ctx.db
  const repId = reqInt(payload.repId, 'المندوب', 1)
  const routeId = payload.routeId === undefined || payload.routeId === null ? null : reqInt(payload.routeId, 'الخط', 1)
  const date = payload.date === undefined || payload.date === null ? db.today() : reqDate(payload.date, 'التاريخ')
  const notes = optStr(payload.notes, 'ملاحظات', 500)
  const loads = payload.loads === undefined || payload.loads === null ? [] : reqArr(payload.loads, 'التحميل').map((r, i) => {
    const l = obj(r, `تحميل ${i + 1}`)
    return { productId: reqInt(l.productId, 'المنتج', 1), qtyMilli: reqMilli(l.qtyMilli, 'الكمية') }
  })

  return db.tx(() => {
    const rep = db.get('SELECT id FROM distribution_reps WHERE id = ?', [repId])
    if (!rep) throw new ApiError('المندوب غير موجود', 404)
    if (routeId !== null && !db.get('SELECT id FROM distribution_routes WHERE id = ?', [routeId])) {
      throw new ApiError('الخط غير موجود', 404)
    }
    const tripNo = nextDocNo(db, 'TRP', date)
    db.run(
      `INSERT INTO distribution_trips (trip_no, rep_id, route_id, date, status, notes, user_id, created_at)
       VALUES (?, ?, ?, ?, 'OPEN', ?, ?, ?)`,
      [tripNo, repId, routeId, date, notes, ctx.user?.id ?? null, db.now()]
    )
    const tripId = db.lastId()
    for (const l of loads) {
      addTripLoad(ctx, tripId, tripNo, l.productId, l.qtyMilli, date)
    }
    ctx.audit('distribution.trip_create', 'trip', tripId, { tripNo })
    return getTrip(ctx, { id: tripId })
  })
}

function addTripLoad(ctx: SvcCtx, tripId: number, tripNo: string, productId: number, qtyMilli: number, date: string): void {
  const p = ctx.db.get<{ id: number; name: string; track_stock: number }>('SELECT id, name, track_stock FROM products WHERE id = ?', [productId])
  if (!p) throw new ApiError('المنتج غير موجود', 404)
  if (Number(p.track_stock) !== 1) throw new ApiError(`المنتج «${p.name}» لا يتتبع المخزون`)
  assertStock(ctx.db, productId, -qtyMilli, p.name)
  ctx.db.run('INSERT INTO trip_loads (trip_id, product_id, qty_milli, created_at) VALUES (?, ?, ?, ?)', [tripId, productId, qtyMilli, ctx.db.now()])
  addStockMovement(ctx.db, {
    productId,
    qtyMilli: -qtyMilli,
    type: 'TRIP_OUT',
    refType: 'trip',
    refId: tripId,
    note: `تحميل جولة ${tripNo}`,
    date,
    userId: ctx.user?.id ?? null
  })
}

/** إضافة تحميل لجولة مفتوحة */
export function addLoad(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const tripId = reqInt(payload.tripId, 'الجولة', 1)
  const item = obj(payload, 'payload')
  const productId = reqInt(item.productId, 'المنتج', 1)
  const qtyMilli = reqMilli(item.qtyMilli, 'الكمية')
  return ctx.db.tx(() => {
    const trip = requireTrip(ctx, tripId)
    if (trip.status !== 'OPEN') throw new ApiError('لا يمكن التحميل إلا لجولة مفتوحة', 409)
    addTripLoad(ctx, tripId, trip.trip_no, productId, qtyMilli, trip.date)
    ctx.audit('distribution.trip_load', 'trip', tripId, { productId, qtyMilli })
    return getTrip(ctx, { id: tripId })
  })
}

/** تسجيل بيع داخل الجولة (يُرحّل لاحقًا في التسوية) */
export function addTripSale(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const tripId = reqInt(payload.tripId, 'الجولة', 1)
  const items = reqArr(payload.items, 'بنود البيع').map((r, i) => {
    const it = obj(r, `بند ${i + 1}`)
    return {
      productId: reqInt(it.productId, 'المنتج', 1),
      qtyMilli: reqMilli(it.qtyMilli, 'الكمية'),
      unitPriceMinor: reqMinor(it.unitPriceMinor, 'سعر الوحدة'),
      paymentType: reqEnum(it.paymentType, 'نوع الدفع', ['CASH', 'CREDIT'] as const),
      customerId: it.customerId === undefined || it.customerId === null ? null : reqInt(it.customerId, 'العميل', 1)
    }
  })
  return ctx.db.tx(() => {
    const trip = requireTrip(ctx, tripId)
    if (trip.status !== 'OPEN') throw new ApiError('الجولة مسواة/ملغاة — لا يمكن تسجيل بيع', 409)
    for (const it of items) {
      if (it.paymentType === 'CREDIT' && it.customerId === null) {
        throw new ApiError('البيع الآجل داخل الجولة يتطلب تحديد العميل')
      }
      if (it.customerId !== null && !ctx.db.get('SELECT id FROM customers WHERE id = ?', [it.customerId])) {
        throw new ApiError('العميل غير موجود', 404)
      }
      const p = ctx.db.get('SELECT id FROM products WHERE id = ?', [it.productId])
      if (!p) throw new ApiError('المنتج غير موجود', 404)
      ctx.db.run(
        `INSERT INTO trip_sales (trip_id, product_id, qty_milli, unit_price_minor, payment_type, customer_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [tripId, it.productId, it.qtyMilli, it.unitPriceMinor, it.paymentType, it.customerId, ctx.db.now()]
      )
    }
    ctx.audit('distribution.trip_sale', 'trip', tripId, { count: items.length })
    return getTrip(ctx, { id: tripId })
  })
}

/** مرتجع جولة: GOOD يعود للمخزون — DAMAGED يعود ثم يوثق كهالك */
export function addTripReturn(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const tripId = reqInt(payload.tripId, 'الجولة', 1)
  const items = reqArr(payload.items, 'بنود المرتجع').map((r, i) => {
    const it = obj(r, `مرتجع ${i + 1}`)
    return {
      productId: reqInt(it.productId, 'المنتج', 1),
      qtyMilli: reqMilli(it.qtyMilli, 'الكمية'),
      condition: reqEnum(it.condition, 'حالة المرتجع', ['GOOD', 'DAMAGED'] as const),
      note: optStr(it.note, 'ملاحظة', 300)
    }
  })
  return ctx.db.tx(() => {
    const trip = requireTrip(ctx, tripId)
    if (trip.status !== 'OPEN') throw new ApiError('الجولة مسواة/ملغاة — لا يمكن تسجيل مرتجع', 409)

    // تحقق رصيد العربة: تحميل − بيع − مرتجعات سابقة ≥ المرتجع الحالي
    for (const it of items) {
      const loaded = Number(ctx.db.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM trip_loads WHERE trip_id = ? AND product_id = ?', [tripId, it.productId])?.s ?? 0)
      const sold = Number(ctx.db.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM trip_sales WHERE trip_id = ? AND product_id = ?', [tripId, it.productId])?.s ?? 0)
      const returned = Number(ctx.db.get<{ s: number }>('SELECT COALESCE(SUM(qty_milli),0) AS s FROM trip_returns WHERE trip_id = ? AND product_id = ?', [tripId, it.productId])?.s ?? 0)
      const onVan = loaded - sold - returned
      if (it.qtyMilli > onVan) {
        throw new ApiError(`كمية المرتجع أكبر من المتبقي في عربة الجولة للمنتج رقم ${it.productId} (المتبقي ${onVan / 1000})`)
      }
    }

    for (const it of items) {
      ctx.db.run('INSERT INTO trip_returns (trip_id, product_id, qty_milli, condition, note, created_at) VALUES (?, ?, ?, ?, ?, ?)', [
        tripId,
        it.productId,
        it.qtyMilli,
        it.condition,
        it.note,
        ctx.db.now()
      ])
      const noteBase = `مرتجع جولة ${trip.trip_no}`
      if (it.condition === 'GOOD') {
        addStockMovement(ctx.db, {
          productId: it.productId,
          qtyMilli: it.qtyMilli,
          type: 'TRIP_RETURN',
          refType: 'trip',
          refId: tripId,
          note: it.note ? `${noteBase} — ${it.note}` : noteBase,
          date: trip.date,
          userId: ctx.user?.id ?? null
        })
      } else {
        // تالف: يعود فعليًا إلى المخزن (TRIP_RETURN+) ثم يوثق كهالك (WASTE−)
        addStockMovement(ctx.db, {
          productId: it.productId,
          qtyMilli: it.qtyMilli,
          type: 'TRIP_RETURN',
          refType: 'trip',
          refId: tripId,
          note: `${noteBase} (تالف)`,
          date: trip.date,
          userId: ctx.user?.id ?? null
        })
        addStockMovement(ctx.db, {
          productId: it.productId,
          qtyMilli: -it.qtyMilli,
          type: 'WASTE',
          refType: 'trip',
          refId: tripId,
          note: `${noteBase} تالف${it.note ? ' — ' + it.note : ''}`,
          date: trip.date,
          userId: ctx.user?.id ?? null
        })
      }
    }
    ctx.audit('distribution.trip_return', 'trip', tripId, { count: items.length })
    return getTrip(ctx, { id: tripId })
  })
}

/** تفاصيل جولة: تحميل/بيع/مرتجعات + المتبقي في العربة */
export function getTrip(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const id = reqInt(payload.id, 'المعرف', 1)
  const trip = requireTrip(ctx, id)
  const rep = ctx.db.get<{ name: string }>('SELECT name FROM distribution_reps WHERE id = ?', [trip.rep_id])
  const route = trip.route_id ? ctx.db.get<{ name: string }>('SELECT name FROM distribution_routes WHERE id = ?', [trip.route_id]) : undefined
  const loads = ctx.db.query<{ product_id: number; product_name: string; qty_milli: number }>(
    `SELECT tl.product_id, p.name AS product_name, tl.qty_milli FROM trip_loads tl JOIN products p ON p.id = tl.product_id WHERE tl.trip_id = ? ORDER BY tl.id`,
    [id]
  )
  const sales = ctx.db.query<{ id: number; product_id: number; product_name: string; qty_milli: number; unit_price_minor: number; payment_type: string; customer_id: number | null; customer_name: string | null; sale_id: number | null; created_at: string }>(
    `SELECT ts.id, ts.product_id, p.name AS product_name, ts.qty_milli, ts.unit_price_minor, ts.payment_type,
            ts.customer_id, c.name AS customer_name, ts.sale_id, ts.created_at
     FROM trip_sales ts JOIN products p ON p.id = ts.product_id LEFT JOIN customers c ON c.id = ts.customer_id
     WHERE ts.trip_id = ? ORDER BY ts.id`,
    [id]
  )
  const returns = ctx.db.query<{ id: number; product_id: number; product_name: string; qty_milli: number; condition: string; note: string | null }>(
    `SELECT tr.id, tr.product_id, p.name AS product_name, tr.qty_milli, tr.condition, tr.note
     FROM trip_returns tr JOIN products p ON p.id = tr.product_id WHERE tr.trip_id = ? ORDER BY tr.id`,
    [id]
  )
  // المتبقي في العربة لكل منتج
  const van = new Map<number, { productId: number; loaded: number; sold: number; returned: number; onVan: number }>()
  for (const l of loads) {
    const cur = van.get(l.product_id) ?? { productId: l.product_id, loaded: 0, sold: 0, returned: 0, onVan: 0 }
    cur.loaded += Number(l.qty_milli)
    van.set(l.product_id, cur)
  }
  for (const s of sales) {
    const cur = van.get(s.product_id) ?? { productId: s.product_id, loaded: 0, sold: 0, returned: 0, onVan: 0 }
    cur.sold += Number(s.qty_milli)
    van.set(s.product_id, cur)
  }
  for (const r of returns) {
    const cur = van.get(r.product_id) ?? { productId: r.product_id, loaded: 0, sold: 0, returned: 0, onVan: 0 }
    cur.returned += Number(r.qty_milli)
    van.set(r.product_id, cur)
  }
  const vanStock = [...van.values()].map((v) => ({ ...v, onVan: v.loaded - v.sold - v.returned }))
  const cashTotal = sales.filter((s) => s.payment_type === 'CASH').reduce((s, r) => s + Math.round((Number(r.qty_milli) * Number(r.unit_price_minor)) / 1000), 0)
  const creditTotal = sales.filter((s) => s.payment_type === 'CREDIT').reduce((s, r) => s + Math.round((Number(r.qty_milli) * Number(r.unit_price_minor)) / 1000), 0)
  return {
    ...trip,
    rep_name: rep?.name ?? null,
    route_name: route?.name ?? null,
    loads: loads.map((l) => ({ ...l, qty_milli: Number(l.qty_milli) })),
    sales: sales.map((s) => ({ ...s, qty_milli: Number(s.qty_milli), unit_price_minor: Number(s.unit_price_minor) })),
    returns: returns.map((r) => ({ ...r, qty_milli: Number(r.qty_milli) })),
    vanStock,
    cashTotalMinor: cashTotal,
    creditTotalMinor: creditTotal
  }
}

export function listTrips(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const status = optStr(payload.status, 'الحالة', 20)
  const from = optStr(payload.from, 'من', 10)
  const to = optStr(payload.to, 'إلى', 10)
  const conditions: string[] = []
  const params: unknown[] = []
  if (status) {
    conditions.push('t.status = ?')
    params.push(status)
  }
  if (from) {
    conditions.push('t.date >= ?')
    params.push(from)
  }
  if (to) {
    conditions.push('t.date <= ?')
    params.push(to)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return ctx.db.query(
    `SELECT t.id, t.trip_no, t.date, t.status, t.rep_id, r.name AS rep_name, t.route_id, rt.name AS route_name,
            (SELECT COALESCE(SUM(qty_milli),0) FROM trip_loads WHERE trip_id = t.id) AS loaded_milli,
            t.settled_at, t.created_at
     FROM distribution_trips t
     JOIN distribution_reps r ON r.id = t.rep_id
     LEFT JOIN distribution_routes rt ON rt.id = t.route_id
     ${where} ORDER BY t.id DESC LIMIT 300`,
    params
  )
}

/** إلغاء جولة مفتوحة بلا حركات — يعيد التحميل للمخزون */
export function cancelTrip(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const id = reqInt(payload.id, 'المعرف', 1)
  const reason = reqStr(payload.reason, 'سبب الإلغاء', 300)
  return ctx.db.tx(() => {
    const trip = requireTrip(ctx, id)
    if (trip.status !== 'OPEN') throw new ApiError('لا يمكن إلغاء جولة مسواة', 409)
    const salesCount = Number(ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM trip_sales WHERE trip_id = ?', [id])?.c ?? 0)
    const returnsCount = Number(ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM trip_returns WHERE trip_id = ?', [id])?.c ?? 0)
    if (salesCount > 0 || returnsCount > 0) {
      throw new ApiError('لا يمكن إلغاء جولة بها بيع أو مرتجعات — سوِّ الجولة أولًا')
    }
    const loads = ctx.db.query<{ product_id: number; qty_milli: number }>('SELECT product_id, qty_milli FROM trip_loads WHERE trip_id = ?', [id])
    for (const l of loads) {
      addStockMovement(ctx.db, {
        productId: Number(l.product_id),
        qtyMilli: Number(l.qty_milli),
        type: 'TRIP_RETURN',
        refType: 'trip_cancel',
        refId: id,
        note: `إلغاء جولة ${trip.trip_no}: ${reason}`,
        date: trip.date,
        userId: ctx.user?.id ?? null
      })
    }
    ctx.db.run('UPDATE distribution_trips SET status = ?, settle_notes = ? WHERE id = ?', ['CANCELLED', `إلغاء: ${reason}`, id])
    ctx.audit('distribution.trip_cancel', 'trip', id, { tripNo: trip.trip_no, reason })
    return getTrip(ctx, { id })
  })
}

/**
 * التسوية الذرية:
 * 1) تجميع مبيعات الجولة: نقدية (دفعة واحدة) + آجل لكل عميل (فاتورة لكل عميل)
 * 2) إنشاء فواتير بيع source=DISTRIBUTION مع client_ref فريد (منع مضاعفة الترحيل)
 * 3) النقد → حركة صندوق TRIP_CASH (مع فرق موثق إن حُصّل مبلغ مختلف)
 * 4) الآجل → قيود دفتر العملاء
 */
export function settleTrip(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const db = ctx.db
  const tripId = reqInt(payload.tripId, 'الجولة', 1)
  const countedCash = payload.countedCashMinor === undefined || payload.countedCashMinor === null ? null : reqMinor(payload.countedCashMinor, 'النقد المجرود')
  const notes = optStr(payload.notes, 'ملاحظات', 500)

  return db.tx(() => {
    const trip = requireTrip(ctx, tripId)
    if (trip.status === 'SETTLED') throw new ApiError('الجولة مسواة مسبقًا — لا يمكن مضاعفة الترحيل', 409)
    if (trip.status !== 'OPEN') throw new ApiError('الجولة غير مفتوحة', 409)

    const sales = db.query<{ id: number; product_id: number; qty_milli: number; unit_price_minor: number; payment_type: string; customer_id: number | null }>(
      'SELECT id, product_id, qty_milli, unit_price_minor, payment_type, customer_id FROM trip_sales WHERE trip_id = ? ORDER BY id',
      [tripId]
    )

    const shiftId = currentShiftId(db)
    let cashTotal = 0
    let creditTotal = 0

    // تجميع: نقدية بدون عميل → مجموعة "cash"؛ آجل → مجموعة لكل عميل
    interface Group {
      key: string
      customerId: number | null
      paymentType: 'CASH' | 'CREDIT'
      rows: Array<{ id: number; product_id: number; qty_milli: number; unit_price_minor: number }>
    }
    const groups = new Map<string, Group>()
    for (const s of sales) {
      const key = s.payment_type === 'CASH' ? 'cash' : `credit:${s.customer_id}`
      const g = groups.get(key) ?? { key, customerId: s.customer_id, paymentType: s.payment_type as 'CASH' | 'CREDIT', rows: [] }
      g.rows.push({ id: Number(s.id), product_id: Number(s.product_id), qty_milli: Number(s.qty_milli), unit_price_minor: Number(s.unit_price_minor) })
      groups.set(key, g)
    }

    for (const g of groups.values()) {
      let subtotal = 0
      for (const r of g.rows) subtotal += lineTotalMinor(r.qty_milli, r.unit_price_minor)
      if (g.paymentType === 'CASH') cashTotal += subtotal
      else creditTotal += subtotal

      const taxBp = getBoolSetting(db, 'tax_enabled', false) ? getIntSetting(db, 'tax_bp', 0) : 0
      const tax = taxBp > 0 ? percentOfBp(subtotal, taxBp) : 0
      const total = subtotal + tax
      const date = trip.date
      const invoiceNo = nextDocNo(db, 'S', date)
      const clientRef = `trip:${tripId}:${g.paymentType === 'CASH' ? 'cash' : `cust:${g.customerId}`}`

      // أمان إضافي: client_ref فريد — لو موجود نستخدم الفاتورة القائمة
      const existing = db.get<{ id: number }>('SELECT id FROM sales WHERE client_ref = ?', [clientRef])
      const saleId = existing ? Number(existing.id) : (() => {
        db.run(
          `INSERT INTO sales (invoice_no, date, customer_id, subtotal_minor, discount_minor, tax_minor, total_minor, paid_minor, credit_minor, status, source, client_ref, note, shift_id, user_id, created_at)
           VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?, ?, 'DISTRIBUTION', ?, ?, ?, ?, ?)`,
          [invoiceNo, date, g.paymentType === 'CASH' ? null : g.customerId, subtotal, tax, total, g.paymentType === 'CASH' ? total : 0, g.paymentType === 'CASH' ? 0 : total, g.paymentType === 'CASH' ? 'PAID' : 'CREDIT', clientRef, `ترحيل جولة ${trip.trip_no}`, shiftId, ctx.user?.id ?? null, db.now()]
        )
        const sid = db.lastId()
        for (const r of g.rows) {
          db.run(
            `INSERT INTO sale_items (sale_id, product_id, qty_milli, unit_price_minor, discount_minor, line_total_minor) VALUES (?, ?, ?, ?, 0, ?)`,
            [sid, r.product_id, r.qty_milli, r.unit_price_minor, lineTotalMinor(r.qty_milli, r.unit_price_minor)]
          )
        }
        db.run('INSERT INTO sale_payments (sale_id, method, amount_minor, shift_id, created_at) VALUES (?, ?, ?, ?, ?)', [
          sid,
          g.paymentType,
          total,
          shiftId,
          db.now()
        ])
        return sid
      })()

      // ربط بنود الجولة بالفاتورة
      for (const r of g.rows) {
        db.run('UPDATE trip_sales SET sale_id = ? WHERE id = ?', [saleId, r.id])
      }

      if (g.paymentType === 'CASH') {
        addCashMovement(db, { type: 'TRIP_CASH', amountMinor: total, refType: 'trip', refId: tripId, note: `نقد جولة ${trip.trip_no}`, date: trip.date, userId: ctx.user?.id ?? null })
      } else if (g.customerId !== null) {
        addCustomerLedger(db, { customerId: g.customerId, refType: 'TRIP_SALE', refId: saleId, amountMinor: total, note: `آجل جولة ${trip.trip_no}` })
      }
    }

    // فرق النقد: إن حُصّل مبلغ مغاير، توثيق الفرق بحركة ADJUSTMENT
    let differenceMinor: number | null = null
    if (countedCash !== null && countedCash !== cashTotal) {
      differenceMinor = countedCash - cashTotal
      addCashMovement(db, {
        type: 'ADJUSTMENT',
        amountMinor: differenceMinor,
        refType: 'trip_settle',
        refId: tripId,
        note: `فرق جرد نقد جولة ${trip.trip_no} (متوقع ${cashTotal})`,
        date: trip.date,
        userId: ctx.user?.id ?? null
      })
    }

    db.run('UPDATE distribution_trips SET status = ?, settled_at = ?, settle_notes = ? WHERE id = ?', [
      'SETTLED',
      db.now(),
      notes ?? (differenceMinor !== null ? `فرق النقد: ${differenceMinor}` : null),
      tripId
    ])
    ctx.audit('distribution.trip_settle', 'trip', tripId, {
      tripNo: trip.trip_no,
      cashTotal,
      creditTotal,
      countedCash,
      differenceMinor
    })
    return getTrip(ctx, { id: tripId })
  })
}
