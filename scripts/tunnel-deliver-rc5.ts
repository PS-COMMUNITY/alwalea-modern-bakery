// =============================================================
// تسليم v1.0.0-rc.5 عبر جسر MCP/النفق — مخبز الولاء الحديث
// يشغَّل: bun scripts/tunnel-deliver-rc5.mjs <tunnel-base-url> <bearer-token> [budget-seconds=470]
// - يكتشف الأدوات عبر tools/list ويعرف ديناميكيًا: file_upload / code_write_file|file_write / file_hash / file_list
// - المسار 1: file_upload (ثنائي مباشر) إن وُجدت
// - المسار 2: أجزاء base64 خام ≤2,800,000 محرف عبر code_write_file/file_write (يتحمل تطبيع LF→CRLF لأن كل جزء سطر واحد)
// - تحقق بعد كل كتابة عبر file_hash، حالة قابلة للاستئناف في /tmp/rc5-deliver-state.json
// النتيجة: جدول ملفات مع OK/HASH-MISMATCH + خروج 0 عند اكتمال كل الملفات
// =============================================================
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as crypto from 'node:crypto'

const [, , baseUrlArg, tokenArg, budgetArg] = process.argv
if (!baseUrlArg || !tokenArg) {
  console.error('الاستخدام: bun scripts/tunnel-deliver-rc5.mjs <tunnel-url> <token> [budget-seconds]')
  process.exit(2)
}
const BASE = baseUrlArg.replace(/\/+$/, '')
const TOKEN = tokenArg
const BUDGET_MS = Number(budgetArg ?? 470) * 1000
const START = Date.now()

const SRC_DIR = path.resolve(import.meta.dir, '../..', 'delivery', 'v1.0.0-rc.5')
const REMOTE_ROOT = 'C:/almoutmag/deliveries/v1.0.0-rc.5'
const STATE_FILE = '/tmp/rc5-deliver-state.json'

// ملفات نصية تُكتب كما هي + أجزاء bin64
function buildFileList(): Array<{ remote: string; local: string; kind: 'text' | 'parts'; partBase?: string }> {
  const out: Array<{ remote: string; local: string; kind: 'text' | 'parts'; partBase?: string }> = []
  const textFiles = [
    'MANIFEST-BINARIES.json', 'SHASUMS256.txt', 'RELEASE-NOTES-AR.md', 'UAT-CHECKLIST-AR.md',
    'README-DELIVERY-AR.md', 'decode-and-verify.ps1', 'docs/install-guide.md', 'docs/user-guide.md'
  ]
  for (const f of textFiles) out.push({ remote: `${REMOTE_ROOT}/${f}`, local: path.join(SRC_DIR, f), kind: 'text' })
  const binDir = path.join(SRC_DIR, 'bin64')
  for (const base of ['setup.exe', 'portable.exe']) {
    const parts = fs.readdirSync(binDir).filter((f) => f.startsWith(`${base}.part`) && f.endsWith('.b64')).sort()
    for (const p of parts) out.push({ remote: `${REMOTE_ROOT}/bin64/${p}`, local: path.join(binDir, p), kind: 'text' })
    // لا ننسى رقم آخر جزء في المانيفست — decode-and-verify يكتشف الأجزاء بنمط glob
    void base
  }
  return out
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
const sha256 = (buf: Uint8Array) => crypto.createHash('sha256').update(buf).digest('hex')

async function api(url: string, init: RequestInit): Promise<{ status: number; json: any; text: string }> {
  const res = await fetch(url, init)
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* ليس JSON */ }
  return { status: res.status, json, text }
}

const headers = () => ({ 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json' })

async function health(): Promise<any> {
  const r = await api(`${BASE}/health`, { headers: headers() })
  if (r.status !== 200) throw new Error(`health ${r.status}: ${r.text.slice(0, 200)}`)
  return r.json
}

async function listTools(): Promise<string[]> {
  const r = await api(`${BASE}/mcp`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} })
  })
  const names = (r.json?.result?.tools ?? []).map((t: any) => t.name)
  return names
}

let callId = 100
async function callTool(name: string, args: Record<string, unknown>, timeoutMs = 120000): Promise<any> {
  const id = ++callId
  const r = await api(`${BASE}/mcp`, {
    method: 'POST', headers: headers(),
    body: JSON.stringify({ jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: args } })
  })
  if (r.status === 429 || r.status >= 500) throw new Error(`TOOL_${r.status}`)
  if (r.json?.error) throw new Error(`RPC: ${JSON.stringify(r.json.error).slice(0, 200)}`)
  return r.json?.result
}

/** استخراج الهاش من رد file_hash بأي شكل معروف */
function extractHash(result: any): string | null {
  const s = JSON.stringify(result ?? '')
  const m = /"hash"\s*:\s*"([0-9a-f]{64})"/i.exec(s) ?? /([0-9a-f]{64})/i.exec(s)
  return m ? m[1].toLowerCase() : null
}

type State = { done: Record<string, string> } // remote → sha256(محتوى مكتوب متوقع بعد التطبيع)
function loadState(): State { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as State } catch { return { done: {} } } }
function saveState(s: State): void { fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1)) }

async function main(): Promise<void> {
  const remaining = BUDGET_MS - (Date.now() - START)
  if (remaining <= 0) { console.log('BUDGET=0'); process.exit(0) }

  const h = await health()
  console.log('HEALTH:', JSON.stringify(h).slice(0, 300))
  const tools = await listTools()
  console.log('TOOLS:', tools.join(', '))
  if (tools.length === 0) throw new Error('لا أدوات عبر tools/list')

  const uploadTool = tools.find((t) => t === 'file_upload' || t === 'upload_file')
  const writeTool = tools.find((t) => t === 'code_write_file' || t === 'file_write' || t === 'write_file')
  const hashTool = tools.find((t) => t === 'file_hash' || t === 'hash_file')
  const listTool = tools.find((t) => t === 'file_list' || t === 'list_files')
  console.log(`SELECTED: upload=${uploadTool ?? '-'} write=${writeTool ?? '-'} hash=${hashTool ?? '-'} list=${listTool ?? '-'}`)
  if (!writeTool && !uploadTool) throw new Error('لا أداة كتابة عبر الجسر')

  const state = loadState()
  const files = buildFileList()
  let ok = 0
  let mismatch = 0
  let skipped = 0

  for (const f of files) {
    if (Date.now() - START > BUDGET_MS) { console.log('BUDGET-STOP'); break }
    const content = fs.readFileSync(f.local)
    const expectedRaw = sha256(content)
    if (state.done[f.remote] === expectedRaw) { skipped++; ok++; console.log(`SKIP-VERIFIED | ${path.basename(f.remote)}`); continue }

    try {
      if (uploadTool) {
        // مسار الرفع الثنائي المباشر إن وُجدت الأداة
        const args: Record<string, unknown> = { path: f.remote, content_base64: content.toString('base64') }
        const r = await callTool(uploadTool, args)
        if (JSON.stringify(r ?? '').includes('error')) throw new Error('upload error')
      } else {
        const txt = content.toString('utf8')
        // مسار الأجزاء النصية: كل ملف نصي = سطر/سطور — نكتبه كنص واحد (لا LF داخليًا للأجزاء، فلا يتأثر بتطبيع CRLF)
        const r = await callTool(writeTool!, { path: f.remote, content: txt })
        if (r?.isError) throw new Error('write isError')
      }
      await sleep(1200)
      // تحقق الهاش
      const hr = await callTool(hashTool ?? 'file_hash', { path: f.remote })
      const got = extractHash(hr)
      // ملفات الأجزاء سطر واحد بلا LF → التطبيع لا يغيّر شيئًا → الهاش يطابق المحتوى الخام
      const txt = fs.readFileSync(f.local, 'utf8')
      const noLf = !txt.includes('\n')
      const candidates = new Set<string>([expectedRaw])
      if (!noLf) {
        // إن طبّق الخادم CRLF: الهاش المتوقع على المحتوى بعد التطبيع
        candidates.add(sha256(new Uint8Array(Buffer.from(txt.replace(/\r?\n/g, '\r\n'), 'utf8'))))
        candidates.add(sha256(new Uint8Array(Buffer.from(txt.replace(/\r?\n/g, '\n'), 'utf8'))))
      }
      if (got && candidates.has(got)) {
        state.done[f.remote] = expectedRaw
        saveState(state)
        ok++
        console.log(`OK | ${path.basename(f.remote)} (${content.length}B)`)
      } else {
        mismatch++
        console.log(`HASH-MISMATCH | ${path.basename(f.remote)} got=${got ?? '-'}`)
      }
    } catch (e) {
      mismatch++
      console.log(`ERROR | ${path.basename(f.remote)} | ${String(e).slice(0, 120)}`)
      await sleep(4000)
    }
    await sleep(2000)
  }

  console.log(`SUMMARY | ok=${ok} mismatch=${mismatch} skipped=${skipped} total=${files.length}`)
  console.log(ok === files.length ? 'DELIVERY: COMPLETE' : 'DELIVERY: INCOMPLETE — أعد التشغيل للاستئناف')
  process.exit(ok === files.length ? 0 : 1)
}

main().catch((e) => { console.error('FATAL', String(e).slice(0, 300)); process.exit(2) })
