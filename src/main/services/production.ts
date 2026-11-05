// =============================================================
// مخبز الولاء الحديث — الوصفات والإنتاج (ذرية) + إلغاء عكسي
// خصم مواد PRODUCTION_OUT− + إضافة ناتج PRODUCTION_IN+ + تكلفة مواد
// clientRef يمنع الترحيل المزدوج (توحيد مع البيع والشراء — إصلاح BUG-4)
// =============================================================
import { ApiError, reqStr, optStr, reqInt, reqMilli, reqDate, reqArr, obj } from '../validate'
import { SvcCtx, addStockMovement, assertStock, stockBalance, nextDocNo, assertNoActiveStockCount } from './helpers'
import { assertMonthOpen } from './period'

interface RecipeItemInput {
  productId: number
  qtyMilli: number
}

function readRecipeItems(payload: Record<string, unknown>): RecipeItemInput[] {
  return reqArr(payload.items, 'مكونات الوصفة').map((r, i) => {
    const item = obj(r, `المكون ${i + 1}`)
    return { productId: reqInt(item.productId, 'المنتج', 1), qtyMilli: reqMilli(item.qtyMilli, 'الكمية') }
  })
}

// ---------- الوصفات ----------
export function listRecipes(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const includeInactive = payload.includeInactive === true
  return ctx.db.query(
    `SELECT r.id, r.name, r.product_id, p.name AS product_name, r.output_qty_milli, r.note, r.active,
            (SELECT COUNT(*) FROM recipe_items ri WHERE ri.recipe_id = r.id) AS items_count
     FROM recipes r JOIN products p ON p.id = r.product_id
     ${includeInactive ? '' : 'WHERE r.active = 1'} ORDER BY r.name`
  )
}

export function getRecipe(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const id = reqInt(payload.id, 'المعرف', 1)
  const r = ctx.db.get<Record<string, number | string | null>>(
    `SELECT r.id, r.name, r.product_id, p.name AS product_name, r.output_qty_milli, r.note, r.active
     FROM recipes r JOIN products p ON p.id = r.product_id WHERE r.id = ?`,
    [id]
  )
  if (!r) throw new ApiError('الوصفة غير موجودة', 404)
  const items = ctx.db.query(
    `SELECT ri.id, ri.product_id, p.name AS product_name, ri.qty_milli, p.cost_minor
     FROM recipe_items ri JOIN products p ON p.id = ri.product_id WHERE ri.recipe_id = ? ORDER BY ri.id`,
    [id]
  )
  return { ...r, items }
}

export function createRecipe(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const name = reqStr(payload.name, 'اسم الوصفة', 200)
  const productId = reqInt(payload.productId, 'المنتج الناتج', 1)
  const outputQtyMilli = reqMilli(payload.outputQtyMilli, 'كمية الناتج')
  const note = optStr(payload.note, 'ملاحظة', 500)
  const items = readRecipeItems(payload)
  return ctx.db.tx(() => {
    const out = ctx.db.get('SELECT id, name FROM products WHERE id = ?', [productId])
    if (!out) throw new ApiError('المنتج الناتج غير موجود', 404)
    if (items.some((i) => i.productId === productId)) {
      throw new ApiError('لا يمكن أن يكون المنتج الناتج مكونًا في نفس الوصفة')
    }
    for (const it of items) {
      if (!ctx.db.get('SELECT id FROM products WHERE id = ?', [it.productId])) throw new ApiError('أحد المكونات غير موجود', 404)
    }
    ctx.db.run(
      'INSERT INTO recipes (name, product_id, output_qty_milli, note, active, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
      [name, productId, outputQtyMilli, note, ctx.db.now(), ctx.db.now()]
    )
    const id = ctx.db.lastId()
    for (const it of items) {
      ctx.db.run('INSERT INTO recipe_items (recipe_id, product_id, qty_milli) VALUES (?, ?, ?)', [id, it.productId, it.qtyMilli])
    }
    ctx.audit('recipe.create', 'recipe', id, { name })
    return getRecipe(ctx, { id })
  })
}

export function updateRecipe(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const id = reqInt(payload.id, 'المعرف', 1)
  const name = reqStr(payload.name, 'اسم الوصفة', 200)
  const outputQtyMilli = reqMilli(payload.outputQtyMilli, 'كمية الناتج')
  const note = optStr(payload.note, 'ملاحظة', 500)
  const active = payload.active === undefined ? 1 : payload.active === false ? 0 : 1
  const items = readRecipeItems(payload)
  return ctx.db.tx(() => {
    const recipe = ctx.db.get<{ product_id: number }>('SELECT product_id FROM recipes WHERE id = ?', [id])
    if (!recipe) throw new ApiError('الوصفة غير موجودة', 404)
    if (items.some((i) => i.productId === Number(recipe.product_id))) {
      throw new ApiError('لا يمكن أن يكون المنتج الناتج مكونًا في نفس الوصفة')
    }
    ctx.db.run('UPDATE recipes SET name = ?, output_qty_milli = ?, note = ?, active = ?, updated_at = ? WHERE id = ?', [
      name,
      outputQtyMilli,
      note,
      active,
      ctx.db.now(),
      id
    ])
    ctx.db.run('DELETE FROM recipe_items WHERE recipe_id = ?', [id])
    for (const it of items) {
      ctx.db.run('INSERT INTO recipe_items (recipe_id, product_id, qty_milli) VALUES (?, ?, ?)', [id, it.productId, it.qtyMilli])
    }
    ctx.audit('recipe.update', 'recipe', id, { name })
    return getRecipe(ctx, { id })
  })
}

// ---------- الإنتاج ----------
export function createBatch(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const db = ctx.db
  const recipeId = reqInt(payload.recipeId, 'الوصفة', 1)
  const actualQtyMilli = reqMilli(payload.actualQtyMilli, 'كمية الناتج الفعلية')
  const wasteQtyMilli = payload.wasteQtyMilli === undefined || payload.wasteQtyMilli === null ? 0 : reqMilli(payload.wasteQtyMilli, 'كمية الهالك')
  const date = payload.date === undefined || payload.date === null ? db.today() : reqDate(payload.date, 'التاريخ')
  const notes = optStr(payload.notes, 'ملاحظات', 500)
  const clientRef = optStr(payload.clientRef, 'مرجع العميل', 120)

  return db.tx(() => {
    // منع الترحيل المزدوج عبر clientRef (نقر مزدوج/إعادة إرسال) — كما في البيع والشراء
    if (clientRef) {
      const existing = db.get<{ id: number }>('SELECT id FROM production_batches WHERE client_ref = ?', [clientRef])
      if (existing) return getBatch(ctx, { id: Number(existing.id) })
    }

    // حاجز الجرد النشط (rc.12 P0-1 — صريح عند المدخل): إنتاج بلا حركات أثناء جرد
    assertNoActiveStockCount(db)
    // حاجز الشهر المقفل: دفعة إنتاج بتاريخها (الافتراضي الآن) — بعد فحص clientRef وقبل المعالجة
    assertMonthOpen(db, date)

    const recipe = db.get<{ id: number; name: string; product_id: number }>('SELECT id, name, product_id FROM recipes WHERE id = ?', [recipeId])
    if (!recipe) throw new ApiError('الوصفة غير موجودة', 404)
    const items = db.query<{ product_id: number; name: string; qty_milli: number; cost_minor: number }>(
      `SELECT ri.product_id, p.name, ri.qty_milli, p.cost_minor
       FROM recipe_items ri JOIN products p ON p.id = ri.product_id WHERE ri.recipe_id = ?`,
      [recipeId]
    )

    // كمية المواد اللازمة تناسب الناتج الفعلي + الهالك نسبةً إلى الناتج المعياري
    const totalOut = actualQtyMilli + wasteQtyMilli
    const recipeRow = db.get<{ output_qty_milli: number }>('SELECT output_qty_milli FROM recipes WHERE id = ?', [recipeId])
    const planned = Number(recipeRow?.output_qty_milli ?? 0)
    if (planned <= 0) throw new ApiError('كمية الناتج المعيارية في الوصفة غير صالحة')
    const factor = totalOut / planned

    // تحقق توفر المواد
    for (const it of items) {
      const needed = Math.round(it.qty_milli * factor)
      assertStock(db, it.product_id, -needed, it.name)
    }

    // تكلفة المواد (أغورة) بناءً على تكلفة كل مادة الحالية
    let materialCost = 0
    for (const it of items) {
      const needed = Math.round(it.qty_milli * factor)
      materialCost += Math.round((needed * Number(it.cost_minor)) / 1000)
    }
    const unitCost = Math.round((materialCost * 1000) / Math.max(1, totalOut))

    const batchNo = nextDocNo(db, 'PRD', date)
    db.run(
      `INSERT INTO production_batches (batch_no, recipe_id, date, actual_qty_milli, waste_qty_milli, material_cost_minor, unit_cost_minor, status, notes, client_ref, user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', ?, ?, ?, ?)`,
      [batchNo, recipeId, date, actualQtyMilli, wasteQtyMilli, materialCost, unitCost, notes, clientRef, ctx.user?.id ?? null, db.now()]
    )
    const batchId = db.lastId()

    // خصم المواد
    for (const it of items) {
      const needed = Math.round(it.qty_milli * factor)
      addStockMovement(db, {
        productId: it.product_id,
        qtyMilli: -needed,
        type: 'PRODUCTION_OUT',
        refType: 'batch',
        refId: batchId,
        unitCostMinor: Number(it.cost_minor),
        note: `${batchNo} — ${recipe.name}`,
        date,
        userId: ctx.user?.id ?? null
      })
    }

    // إضافة الناتج الكلي (الصالح + الهالك) ثم توثيق الهالك بحركة WASTE
    const producedTotal = actualQtyMilli + wasteQtyMilli
    if (producedTotal > 0) {
      addStockMovement(db, {
        productId: Number(recipe.product_id),
        qtyMilli: producedTotal,
        type: 'PRODUCTION_IN',
        refType: 'batch',
        refId: batchId,
        unitCostMinor: unitCost,
        note: `${batchNo} — ${recipe.name}`,
        date,
        userId: ctx.user?.id ?? null
      })
      if (wasteQtyMilli > 0) {
        addStockMovement(db, {
          productId: Number(recipe.product_id),
          qtyMilli: -wasteQtyMilli,
          type: 'WASTE',
          refType: 'batch',
          refId: batchId,
          unitCostMinor: unitCost,
          note: `هالك إنتاج ${batchNo}`,
          date,
          userId: ctx.user?.id ?? null
        })
      }
    }

    // تحديث تكلفة المنتج الناتج بآخر تكلفة إنتاج
    db.run('UPDATE products SET cost_minor = ?, updated_at = ? WHERE id = ?', [unitCost, db.now(), Number(recipe.product_id)])

    ctx.audit('production.create', 'batch', batchId, { batchNo, materialCost, unitCost })
    return getBatch(ctx, { id: batchId })
  })
}

export function listBatches(ctx: SvcCtx, payload: Record<string, unknown>): unknown[] {
  const from = optStr(payload.from, 'من', 10)
  const to = optStr(payload.to, 'إلى', 10)
  const conditions: string[] = []
  const params: unknown[] = []
  if (from) {
    conditions.push('b.date >= ?')
    params.push(from)
  }
  if (to) {
    conditions.push('b.date <= ?')
    params.push(to)
  }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
  return ctx.db.query(
    `SELECT b.id, b.batch_no, b.date, b.recipe_id, r.name AS recipe_name, b.actual_qty_milli, b.waste_qty_milli,
            b.material_cost_minor, b.unit_cost_minor, b.status, b.notes
     FROM production_batches b JOIN recipes r ON r.id = b.recipe_id ${where} ORDER BY b.id DESC LIMIT 300`,
    params
  )
}

export function getBatch(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const id = reqInt(payload.id, 'المعرف', 1)
  const b = ctx.db.get<Record<string, number | string | null>>(
    `SELECT b.*, r.name AS recipe_name, r.product_id
     FROM production_batches b JOIN recipes r ON r.id = b.recipe_id WHERE b.id = ?`,
    [id]
  )
  if (!b) throw new ApiError('دفعة الإنتاج غير موجودة', 404)
  const materials = ctx.db.query(
    `SELECT m.product_id, p.name AS product_name, m.qty_milli, m.type
     FROM stock_movements m JOIN products p ON p.id = m.product_id
     WHERE m.ref_type = 'batch' AND m.ref_id = ? AND m.type IN ('PRODUCTION_OUT','PRODUCTION_IN','WASTE') ORDER BY m.id`,
    [id]
  )
  return { ...b, materials }
}

/**
 * rc.12 — حذف وصفة نهائيًا: مسموح فقط إن لم تُستخدم في أي دفعة إنتاج.
 * الوصفة المستخدمة بياناتها التكلفية موثقة — تُعطّل (active=0) بدل الحذف.
 */
export function deleteRecipe(ctx: SvcCtx, payload: Record<string, unknown>): { id: number; deleted: true } {
  const id = reqInt(payload.id, 'المعرف', 1)
  return ctx.db.tx(() => {
    const r = ctx.db.get<{ id: number; name: string }>('SELECT id, name FROM recipes WHERE id = ?', [id])
    if (!r) throw new ApiError('الوصفة غير موجودة', 404)
    const used = ctx.db.get<{ c: number }>('SELECT COUNT(*) AS c FROM production_batches WHERE recipe_id = ?', [id])
    if (Number(used?.c ?? 0) > 0) {
      throw new ApiError(
        `لا يمكن حذف الوصفة: استُخدمت في ${used?.c} دفعة إنتاج (بياناتها موثقة) — يمكنك تعطيلها من التعديل (نشط = لا)`,
        409
      )
    }
    ctx.db.run('DELETE FROM recipe_items WHERE recipe_id = ?', [id])
    ctx.db.run('DELETE FROM recipes WHERE id = ?', [id])
    ctx.audit('recipe.delete', 'recipe', id, { name: r.name })
    return { id, deleted: true as const }
  })
}

/** إلغاء دفعة: حركات عكسية موثقة — rc.12 (إصلاح P0-2 من مراجعة المحترفين):
 * يُبنى الإلغاء من عكس **كل** حركات الدفعة الأصلية (PRODUCTION_OUT + PRODUCTION_IN + WASTE)
 * بصفوفها الفعلية، وفحص التوفر يُحسب **صافي** أثر الدفعة على كل منتج (لا الإجمالي الخام)،
 * فلا يُرفض إلغاء سليم ولا يُخرّب الرصيد عندما وُجد هالك.
 * مثال مرجعي: ناتج 100، هالك 10 → داخل المخزون +100 وWASTE −10 (صافي 90)؛
 * الإلغاء يعكس الثلاثة: −100 +10 = صافي −90 = إزالة الصافي الصحيح.
 */
export function cancelBatch(ctx: SvcCtx, payload: Record<string, unknown>): Record<string, unknown> {
  const id = reqInt(payload.id, 'المعرف', 1)
  const reason = reqStr(payload.reason, 'سبب الإلغاء', 300)
  return ctx.db.tx(() => {
    const b = ctx.db.get<{ id: number; batch_no: string; status: string; recipe_id: number; date: string }>(
      'SELECT id, batch_no, status, recipe_id, date FROM production_batches WHERE id = ?',
      [id]
    )
    if (!b) throw new ApiError('دفعة الإنتاج غير موجودة', 404)
    if (b.status === 'CANCELLED') throw new ApiError('الدفعة ملغاة مسبقًا', 409)
    // حاجز الشهر المقفل: بتاريخ الدفعة الأصلية — بعد جلب السجل وقبل أي كتابة
    assertMonthOpen(ctx.db, b.date)
    // rc.12 (P0-1): الإلغاء حركة مخزنية — خاضع لحاجز الجرد النشط أيضًا
    assertNoActiveStockCount(ctx.db)

    // كل حركات الدفعة الأصلية بلا استثناء (كان يستثني WASTE فيخلّ الرصيد)
    const moves = ctx.db.query<{ product_id: number; qty_milli: number; type: string }>(
      `SELECT product_id, qty_milli, type FROM stock_movements
       WHERE ref_type = 'batch' AND ref_id = ? AND type IN ('PRODUCTION_OUT','PRODUCTION_IN','WASTE') ORDER BY id`,
      [id]
    )

    // الصافي لكل منتج: سالب = مواد خُصمت (عكسها يُرجع — لا فحص)،
    // موجب = ناتج صافٍ داخل المخزون (عكسه يخصم — نتحقق من توفره)
    const netByProduct = new Map<number, number>()
    for (const m of moves) {
      const pid = Number(m.product_id)
      netByProduct.set(pid, (netByProduct.get(pid) ?? 0) + Number(m.qty_milli))
    }
    for (const [pid, net] of netByProduct) {
      if (net <= 0) continue
      const balance = stockBalance(ctx.db, pid)
      if (balance < net) {
        throw new ApiError(
          `لا يمكن الإلغاء: صافي ناتج الدفعة (${net / 1000} كغ) تم استهلاكه/بيعه — الرصيد الحالي ${balance / 1000}. أعد الكميات أولًا`
        )
      }
    }

    // عكس كل حركة بحركتها المعاكسة (بما فيها WASTE — منع التمييز)
    for (const m of moves) {
      addStockMovement(ctx.db, {
        productId: Number(m.product_id),
        qtyMilli: -Number(m.qty_milli), // عكس الإشارة
        type: m.type,
        refType: 'batch_cancel',
        refId: id,
        note: `إلغاء دفعة ${b.batch_no}: ${reason}`,
        userId: ctx.user?.id ?? null
      })
    }

    ctx.db.run('UPDATE production_batches SET status = ?, cancelled_at = ?, cancel_reason = ? WHERE id = ?', [
      'CANCELLED',
      ctx.db.now(),
      reason,
      id
    ])
    ctx.audit('production.cancel', 'batch', id, { batchNo: b.batch_no, reason })
    return getBatch(ctx, { id })
  })
}
