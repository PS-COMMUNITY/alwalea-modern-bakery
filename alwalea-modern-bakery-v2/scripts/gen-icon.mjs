// توليد أيقونة PNG بسيطة 512×512 برمجيًا (بدون أي اعتماديات خارجية)
// تصميم: خلفية بنية داكنة بزوايا دائرية + رغيف خبز عنبري + شقوق عاجية
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const SIZE = 512

// ---------- PNG encoder ----------
const crcTable = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePNG(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  // scanlines مع فلتر 0
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    rgba.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  const idat = deflateSync(raw, { level: 9 })
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', idat), chunk('IEND', Buffer.alloc(0))])
}

// ---------- الرسم ----------
const W = SIZE, H = SIZE
const img = Buffer.alloc(W * H * 4)

function put(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return
  const i = (y * W + x) * 4
  // مزج ألفا فوق الخلفية الحالية
  const sa = a / 255
  const da = img[i + 3] / 255
  const oa = sa + da * (1 - sa)
  if (oa === 0) return
  img[i] = Math.round((r * sa + img[i] * da * (1 - sa)) / oa)
  img[i + 1] = Math.round((g * sa + img[i + 1] * da * (1 - sa)) / oa)
  img[i + 2] = Math.round((b * sa + img[i + 2] * da * (1 - sa)) / oa)
  img[i + 3] = Math.round(oa * 255)
}

function fillRect(x0, y0, w, h, r, g, b, a = 255) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) put(x, y, r, g, b, a)
}

// مستطيل بزوايا دائرية (حد خارجي ناعم عبر مسافة SDF مبسطة)
function roundRect(cx, cy, hw, hh, rad, color) {
  const [r, g, b, a] = color
  for (let y = Math.floor(cy - hh - 2); y <= cy + hh + 2; y++) {
    for (let x = Math.floor(cx - hw - 2); x <= cx + hw + 2; x++) {
      const dx = Math.max(Math.abs(x - cx) - (hw - rad), 0)
      const dy = Math.max(Math.abs(y - cy) - (hh - rad), 0)
      const d = Math.sqrt(dx * dx + dy * dy) - rad
      const cov = Math.min(1, Math.max(0, 0.5 - d))
      if (cov > 0) put(x, y, r, g, b, Math.round(a * cov))
    }
  }
}

function ellipse(cx, cy, rx, ry, color) {
  const [r, g, b, a] = color
  for (let y = Math.floor(cy - ry - 2); y <= cy + ry + 2; y++) {
    for (let x = Math.floor(cx - rx - 2); x <= cx + rx + 2; x++) {
      const nx = (x - cx) / rx, ny = (y - cy) / ry
      const d = Math.sqrt(nx * nx + ny * ny) - 1
      const cov = Math.min(1, Math.max(0, 0.5 - d * Math.min(rx, ry)))
      if (cov > 0) put(x, y, r, g, b, Math.round(a * cov))
    }
  }
}

// خلفية شفافة
for (let i = 0; i < W * H; i++) {
  img[i * 4 + 3] = 0
}

// 1) لوحة بنية داكنة بزوايا دائرية
roundRect(256, 256, 244, 244, 56, [0x3e, 0x27, 0x23, 255]) // #3E2723
// إطار داخلي عنبري خفيف
roundRect(256, 256, 232, 232, 48, [0x00, 0x00, 0x00, 0])
roundRect(256, 256, 231, 231, 47, [0xc7, 0x7b, 0x3f, 40]) // #C77B3F لمسة

// 2) ظل تحت الرغيف
ellipse(256, 356, 150, 26, [0x00, 0x00, 0x00, 70])

// 3) رغيف الخبز (شكل بيضاوي ممتلئ عنبري مع أعلى أفتح)
ellipse(256, 300, 168, 96, [0xb0, 0x6a, 0x2e, 255]) // #B06A2E
ellipse(256, 288, 160, 86, [0xc7, 0x7b, 0x3f, 255]) // #C77B3F
ellipse(246, 262, 120, 52, [0xd9, 0x96, 0x5c, 160]) // لمعة علوية

// 4) شقوق الرغيف (ثلاثة أقواس عاجية)
function slash(x0, y0, x1, y1, w, color) {
  const [r, g, b, a] = color
  const steps = 60
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    const x = x0 + (x1 - x0) * t
    const y = y0 + (y1 - y0) * t + Math.sin(t * Math.PI) * -14 // قوس بسيط
    const rad = w * (1 - Math.abs(t - 0.5) * 0.9)
    for (let dy = -rad; dy <= rad; dy++) {
      for (let dx = -rad; dx <= rad; dx++) {
        if (dx * dx + dy * dy <= rad * rad) put(Math.round(x + dx), Math.round(y + dy), r, g, b, a)
      }
    }
  }
}
const IVORY = [0xff, 0xf8, 0xf0, 235] // #FFF8F0
slash(176, 292, 216, 292, 6, IVORY)
slash(236, 292, 276, 292, 6, IVORY)
slash(296, 292, 336, 292, 6, IVORY)

// 5) سنابل قمح صغيرة أعلى (عنبري فاتح) — دوائر صغيرة
function wheat(cx, cy) {
  ellipse(cx, cy, 7, 12, [0xe8, 0xb0, 0x6e, 235])
  ellipse(cx - 9, cy + 8, 6, 9, [0xe8, 0xb0, 0x6e, 220])
  ellipse(cx + 9, cy + 8, 6, 9, [0xe8, 0xb0, 0x6e, 220])
  for (let i = 0; i < 26; i++) put(cx, cy + 20 + i, 0xe8, 0xb0, 0x6e, 220)
}
wheat(150, 150)
wheat(362, 150)

mkdirSync('assets', { recursive: true })
mkdirSync('build', { recursive: true })
const png = encodePNG(W, H, img)
writeFileSync('assets/icon.png', png)
writeFileSync('build/icon.png', png)
console.log('✔ assets/icon.png + build/icon.png (512×512)')
