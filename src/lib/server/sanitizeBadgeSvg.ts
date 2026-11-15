// 배지 이미지(SVG) 업로드 정화 — 허용 목록 방식.
// 허용하지 않은 태그·속성은 모두 버리고, 스크립트·이벤트·외부 참조·style 은 아예 받지 않는다.
// 결과는 <img> 로만 렌더한다(인라인 삽입 금지).

import { BADGE_SVG_SIZE_MESSAGE, MAX_BADGE_SVG_BYTES, MAX_BADGE_SVG_TAGS } from '$lib/utils/badgeSvgUrl'
export { MAX_BADGE_SVG_BYTES }

export type SanitizeResult = { ok: true; svg: string } | { ok: false; error: string }

const ALLOWED_TAGS = [
  'svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'defs', 'use',
  'linearGradient', 'radialGradient', 'stop', 'clipPath', 'mask', 'title', 'desc', 'text', 'tspan', 'symbol',
]
const TAG_MAP = new Map(ALLOWED_TAGS.map((t) => [t.toLowerCase(), t]))

const ALLOWED_ATTRS = [
  'id', 'class', 'd', 'x', 'y', 'x1', 'x2', 'y1', 'y2', 'cx', 'cy', 'r', 'rx', 'ry', 'width', 'height', 'points',
  'fill', 'fill-opacity', 'fill-rule', 'clip-rule', 'stroke', 'stroke-width', 'stroke-opacity', 'stroke-linecap',
  'stroke-linejoin', 'stroke-miterlimit', 'stroke-dasharray', 'stroke-dashoffset', 'opacity', 'transform',
  'viewBox', 'preserveAspectRatio', 'offset', 'stop-color', 'stop-opacity', 'gradientUnits', 'gradientTransform',
  'fx', 'fy', 'clip-path', 'mask', 'maskUnits', 'clipPathUnits', 'font-size', 'font-family', 'font-weight',
  'text-anchor', 'dominant-baseline', 'dx', 'dy', 'xmlns', 'version', 'href', 'xlink:href', 'xmlns:xlink',
]
const ATTR_MAP = new Map(ALLOWED_ATTRS.map((a) => [a.toLowerCase(), a]))

// 내용까지 통째로 제거할 요소
const DROP_WITH_CONTENT = [
  'script', 'style', 'foreignObject', 'iframe', 'embed', 'object', 'image', 'animate', 'animateMotion',
  'animateTransform', 'set', 'audio', 'video', 'canvas', 'link', 'meta', 'a', 'switch', 'filter',
]

function safeAttrValue(name: string, value: string): boolean {
  // 제어문자·공백을 모두 제거한 뒤 검사(java\tscript: 같은 우회 차단)
  const v = [...value].filter((ch) => ch.charCodeAt(0) > 32).join('').toLowerCase()
  if (v.includes('javascript:') || v.includes('data:') || v.includes('vbscript:') || v.includes('expression(')) return false
  if (name === 'href' || name === 'xlink:href') return value.trim().startsWith('#')
  // url(...) 은 내부 #id 만 허용(fill="url(#g)")
  const urls = v.match(/url\(([^)]*)\)/g)
  if (urls) {
    for (const u of urls) {
      const inner = u.slice(4, -1).replace(/^['"]|['"]$/g, '')
      if (!inner.startsWith('#')) return false
    }
  }
  if (v.includes('@import')) return false
  return true
}

function escapeText(s: string): string {
  return s.replace(/&(?!amp;|lt;|gt;|quot;|#\d+;|#x[0-9a-f]+;)/gi, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

const ATTR_RE = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>`=]+)))?/g

export function sanitizeBadgeSvg(input: string): SanitizeResult {
  if (typeof input !== 'string' || input.trim() === '') return { ok: false, error: 'SVG 가 비어 있어요' }
  if (new TextEncoder().encode(input).length > MAX_BADGE_SVG_BYTES) {
    return { ok: false, error: BADGE_SVG_SIZE_MESSAGE }
  }
  // 요소가 많은 SVG 는 거절 — 썸네일 위에 겹치는 단순한 아이콘만 받는다(정화 비용 방어 겸)
  if (input.split('<').length - 1 > MAX_BADGE_SVG_TAGS) return { ok: false, error: 'SVG 가 너무 복잡해요(단순한 아이콘만 가능)' }

  let src = input
    .replace(/<\?[\s\S]*?\?>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<!\[CDATA\[[\s\S]*?\]\]>/g, '')
    .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
    .replace(/<!ENTITY[\s\S]*?>/gi, '')

  for (const name of DROP_WITH_CONTENT) {
    const re = new RegExp(`<${name}\\b(?:"[^"]*"|'[^']*'|[^>"'])*?(?:/>|>[\\s\\S]*?</${name}\\s*>)`, 'gi')
    src = src.replace(re, '')
  }

  const TAG_RE = /<(\/?)([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g
  let out = ''
  let last = 0
  let sawRoot = false
  let rootHasViewBox = false
  let rootViewBox = ''
  let depth = 0
  let m: RegExpExecArray | null
  while ((m = TAG_RE.exec(src)) !== null) {
    const text = src.slice(last, m.index)
    if (text.trim() && depth > 0) out += escapeText(text)
    last = TAG_RE.lastIndex

    const closing = m[1] === '/'
    const tag = TAG_MAP.get(m[2].toLowerCase())
    if (!tag) continue
    if (closing) {
      if (depth > 0) {
        out += `</${tag}>`
        depth -= 1
      }
      continue
    }
    if (!sawRoot && tag !== 'svg') return { ok: false, error: 'SVG 파일이 아니에요' }
    const isRoot = !sawRoot
    sawRoot = true

    let attrs = ''
    let hasXmlns = false
    for (const am of m[3].matchAll(ATTR_RE)) {
      const key = ATTR_MAP.get(am[1].toLowerCase())
      if (!key) continue
      const val = am[2] ?? am[3] ?? am[4] ?? ''
      if (!safeAttrValue(key, val)) continue
      if (isRoot && key === 'viewBox') { rootHasViewBox = true; rootViewBox = val }
      if (key === 'xmlns') hasXmlns = true
      attrs += ` ${key}="${val.replace(/"/g, '&quot;')}"`
    }
    if (isRoot && !hasXmlns) attrs = ` xmlns="http://www.w3.org/2000/svg"${attrs}`
    const selfClose = m[4] === '/'
    out += `<${tag}${attrs}${selfClose ? '/' : ''}>`
    if (!selfClose) depth += 1
  }
  while (depth > 0) {
    out += '</svg>'
    depth -= 1
  }

  if (!sawRoot) return { ok: false, error: 'SVG 파일이 아니에요' }
  if (!rootHasViewBox) return { ok: false, error: 'viewBox 가 있는 SVG 만 등록할 수 있어요' }
  // 비율은 제한하지 않는다(정사각이 권장일 뿐) — viewBox 형식만 검사
  const vb = rootViewBox.trim().split(/[\s,]+/).map(Number)
  if (vb.length !== 4 || vb.some((n) => !Number.isFinite(n)) || vb[2] <= 0 || vb[3] <= 0) {
    return { ok: false, error: 'viewBox 형식이 올바르지 않아요' }
  }
  if (new TextEncoder().encode(out).length > MAX_BADGE_SVG_BYTES) return { ok: false, error: BADGE_SVG_SIZE_MESSAGE }
  return { ok: true, svg: out }
}
