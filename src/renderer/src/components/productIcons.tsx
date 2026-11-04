// =============================================================
// مخبز الولاء الحديث — أيقونات منتجات SVG محلية (inline بلا أي تحميل من الإنترنت)
// رسم خطي نظيف: الخطوط بلون النص (currentColor) + لونان دافئان ثابتان للتعبئة
// مطابقان للهوية (عاجي/طحيني + عنبري). بلا أي شعارات أو علامات تجارية.
// =============================================================
import type { ReactNode } from 'react'

export interface IconProps {
  size?: number | undefined
  className?: string | undefined
}

/** لونان ثابتان للتعبئة بجانب currentColor */
const TONE_LIGHT = '#f4e7cd'
const TONE_DEEP = '#b06a2e'

function Svg(props: IconProps & { children: ReactNode }): ReactNode {
  const s = props.size ?? 22
  return (
    <svg
      width={s}
      height={s}
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
      className={props.className}
      style={{ flexShrink: 0, verticalAlign: 'middle' }}
    >
      {props.children}
    </svg>
  )
}

const stroke = {
  stroke: 'currentColor',
  strokeWidth: 1.5,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const
}

/** رغيف خبز (شكل عام) — الأبيض تعبئة فاتحة والأسود تعبئة داكنة */
function BreadLoaf(props: IconProps & { fill: string }): ReactNode {
  return (
    <Svg size={props.size} className={props.className}>
      <path
        d="M3.6 14.1c0-2.8 2.1-4.6 4.5-4.6h7.8c2.4 0 4.5 1.8 4.5 4.6 0 2.6-1.4 4.4-3.4 4.4H7c-2 0-3.4-1.8-3.4-4.4z"
        fill={props.fill}
        {...stroke}
      />
      <path d="M8.3 12.4v3.4M12 12.2v3.8M15.7 12.4v3.4" {...stroke} strokeWidth={1.3} />
    </Svg>
  )
}

export function IconBreadWhite(props: IconProps): ReactNode {
  return <BreadLoaf {...props} fill={TONE_LIGHT} />
}

export function IconBreadDark(props: IconProps): ReactNode {
  return <BreadLoaf {...props} fill={TONE_DEEP} />
}

/** كيس طحين/دقيق مع طية علوية وملصق */
export function IconFlourBag(props: IconProps): ReactNode {
  return (
    <Svg size={props.size} className={props.className}>
      <path d="M8.2 2.8h7.6l.7 2.7H7.5z" fill={TONE_DEEP} {...stroke} strokeWidth={1.3} />
      <path
        d="M6.7 5.5h10.6l.9 11.6a2.1 2.1 0 0 1-2.1 2.3H7.9a2.1 2.1 0 0 1-2.1-2.3z"
        fill={TONE_LIGHT}
        {...stroke}
      />
      <rect x="9.2" y="9.8" width="5.6" height="4.6" rx="0.9" fill="none" {...stroke} strokeWidth={1.2} />
      <path d="M10.6 12.1h2.8" {...stroke} strokeWidth={1.1} />
    </Svg>
  )
}

/** مكعبات سكر */
export function IconSugar(props: IconProps): ReactNode {
  return (
    <Svg size={props.size} className={props.className}>
      <rect x="4" y="12.2" width="7.2" height="7.2" rx="1.1" fill={TONE_LIGHT} {...stroke} strokeWidth={1.3} />
      <rect x="13.4" y="9.6" width="6.4" height="6.4" rx="1" fill={TONE_LIGHT} {...stroke} strokeWidth={1.3} />
      <circle cx="11.6" cy="6.6" r="0.8" fill="currentColor" />
      <circle cx="15.4" cy="4.6" r="0.6" fill="currentColor" />
    </Svg>
  )
}

/** ملعقة ملح مع حبيبات */
export function IconSalt(props: IconProps): ReactNode {
  return (
    <Svg size={props.size} className={props.className}>
      <ellipse cx="8.2" cy="16.6" rx="4.4" ry="3.1" fill={TONE_LIGHT} {...stroke} />
      <path d="M11.6 14.4 19.2 7" {...stroke} strokeWidth={1.6} />
      <path d="M5.9 16.3c.5-1.7 3.2-1.7 3.7 0" {...stroke} strokeWidth={1.2} />
      <circle cx="17.4" cy="4.4" r="0.9" fill="currentColor" />
      <circle cx="20.4" cy="3.4" r="0.6" fill="currentColor" />
    </Svg>
  )
}

/** مكعبات خميرة صغيرة مع فقاعات */
export function IconYeast(props: IconProps): ReactNode {
  return (
    <Svg size={props.size} className={props.className}>
      <rect x="3.8" y="12.8" width="5.2" height="5.2" rx="0.9" fill={TONE_LIGHT} {...stroke} strokeWidth={1.3} />
      <rect x="10.4" y="15.4" width="4.4" height="4.4" rx="0.8" fill={TONE_LIGHT} {...stroke} strokeWidth={1.3} />
      <rect x="15.2" y="8.6" width="5" height="5" rx="0.9" fill={TONE_DEEP} {...stroke} strokeWidth={1.3} />
      <circle cx="8.6" cy="7.2" r="1.1" fill="currentColor" />
      <circle cx="12.8" cy="4.8" r="0.8" fill="currentColor" />
    </Svg>
  )
}

/** قارورة محسّن (مسحوق) */
export function IconImprover(props: IconProps): ReactNode {
  return (
    <Svg size={props.size} className={props.className}>
      <rect x="9.4" y="2.4" width="5.2" height="2.2" rx="0.7" fill={TONE_DEEP} {...stroke} strokeWidth={1.2} />
      <path
        d="M10 4.6h4v2.2l1.3 1.6v9.8a1.9 1.9 0 0 1-1.9 1.9h-2.8a1.9 1.9 0 0 1-1.9-1.9V8.4L10 6.8z"
        fill={TONE_LIGHT}
        {...stroke}
      />
      <path d="M8.7 14.6h6.6" {...stroke} strokeWidth={1.2} />
    </Svg>
  )
}

/** كيس تغليف بمقبض */
export function IconBags(props: IconProps): ReactNode {
  return (
    <Svg size={props.size} className={props.className}>
      <path
        d="M7.4 8.2h9.2l.9 9.8a2 2 0 0 1-2 2.2H8.5a2 2 0 0 1-2-2.2z"
        fill={TONE_LIGHT}
        {...stroke}
      />
      <path d="M9.6 8.2V6.4a2.4 2.4 0 0 1 4.8 0v1.8" {...stroke} />
      <path d="M9.6 12.6h4.8" {...stroke} strokeWidth={1.2} />
    </Svg>
  )
}

/** سلة خبز عامة (fallback) */
export function IconBreadBasket(props: IconProps): ReactNode {
  return (
    <Svg size={props.size} className={props.className}>
      <ellipse cx="12" cy="9.4" rx="4.6" ry="2.6" fill={TONE_DEEP} {...stroke} strokeWidth={1.3} />
      <path
        d="M4 12.4h16l-1.5 5.6a2.2 2.2 0 0 1-2.1 1.6H7.6a2.2 2.2 0 0 1-2.1-1.6z"
        fill={TONE_LIGHT}
        {...stroke}
      />
      <path d="M8.3 13v6M12 13v6.2M15.7 13v6M4.7 15.9h14.6" {...stroke} strokeWidth={1.1} />
    </Svg>
  )
}

// ---------- مطابقة بالكلمات المفتاحية (الترتيب مهم) ----------
const RULES: Array<{ keys: string[]; Icon: (props: IconProps) => ReactNode }> = [
  { keys: ['خبز أبيض', 'عيش أبيض', 'بلدي', 'صمون'], Icon: IconBreadWhite },
  { keys: ['خبز أسود', 'عيش أسود', 'شعير', 'بر'], Icon: IconBreadDark },
  { keys: ['طحين', 'دقيق'], Icon: IconFlourBag },
  { keys: ['سكر'], Icon: IconSugar },
  { keys: ['ملح'], Icon: IconSalt },
  { keys: ['خميرة'], Icon: IconYeast },
  { keys: ['محسن'], Icon: IconImprover },
  { keys: ['تغليف', 'أكياس', 'نايلون', 'شوال', 'ورق'], Icon: IconBags }
]

/** أيقونة مناسبة لاسم المنتج — fallback سلة خبز عامة */
export function iconForProduct(name: string, size = 22): ReactNode {
  const n = (name ?? '').trim()
  for (const r of RULES) {
    if (r.keys.some((k) => n.includes(k))) {
      const Icon = r.Icon
      return <Icon size={size} />
    }
  }
  return <IconBreadBasket size={size} />
}
