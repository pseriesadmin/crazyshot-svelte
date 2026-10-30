/**
 * inlineStyles.ts — 클래스·<style> 서식을 각 요소의 style 속성으로 풀어 넣기 (HTML형 양식 → 한글 파일용)
 *
 * 한글 엔진(rhwp)은 `<style>`·클래스 CSS를 읽지 못한다. HTML형 양식은 서식이 전부 클래스 CSS라서, 브라우저가 계산한 값
 * (getComputedStyle)을 요소 style 속성으로 옮긴 뒤 엔진에 넣는다.
 *  - applyComputedStylesInline(): 이미 서식이 계산되는 문서(Document)의 요소에 style을 써 넣는다(테스트·jsdom에서도 같은 함수).
 *  - inlineStylesViaIframe(): 화면 밖 격리 iframe(A4 폭)에서 위 함수를 돌려 본문 HTML을 돌려준다(브라우저 전용).
 * 옮기는 속성은 글꼴·크기·굵기·색·정렬·줄 간격·자간·배경·테두리·안쪽 여백·칸 너비로 한정한다(엔진이 읽는 범위).
 */

const TEXT_PROPS = ['font-family', 'font-size', 'font-weight', 'font-style', 'color', 'text-align', 'line-height', 'letter-spacing'] as const

function rgbToHex(value: string): string | null {
  const v = value.trim()
  if (/^#[0-9a-f]{3,8}$/i.test(v)) return v.toLowerCase()
  if (!/^rgba?\(/i.test(v)) return null
  const nums = v.match(/[\d.]+/g)
  if (!nums || nums.length < 3) return null
  if (nums.length >= 4 && Number(nums[3]) === 0) return null // 투명
  const h = (n: string) => Math.min(255, Math.round(Number(n))).toString(16).padStart(2, '0')
  return `#${h(nums[0])}${h(nums[1])}${h(nums[2])}`
}

function isZeroLength(v: string): boolean {
  return !v || /^0(px|pt|em)?$/.test(v.trim())
}

function declarationsFor(el: Element, win: Window): string[] {
  const cs = win.getComputedStyle(el)
  const parent = el.parentElement ? win.getComputedStyle(el.parentElement) : null
  const out: string[] = []

  // 상속되는 글자 속성: 부모와 다를 때만(모든 요소에 반복해서 쓰지 않는다)
  for (const prop of TEXT_PROPS) {
    const v = cs.getPropertyValue(prop)
    if (!v || v === 'normal' && prop !== 'font-weight' && prop !== 'font-style') continue
    if (parent && parent.getPropertyValue(prop) === v) continue
    if (prop === 'color') {
      const hex = rgbToHex(v)
      if (hex) out.push(`color:${hex}`)
    } else if (prop === 'font-weight' && (v === '400' || v === 'normal')) {
      continue
    } else if (prop === 'font-style' && v === 'normal') {
      continue
    } else {
      out.push(`${prop}:${v}`)
    }
  }

  const deco = cs.getPropertyValue('text-decoration-line') || cs.getPropertyValue('text-decoration')
  if (deco && /underline|line-through/.test(deco) && !(parent && (parent.getPropertyValue('text-decoration-line') || '').includes(deco.split(' ')[0]))) {
    out.push(`text-decoration:${/underline/.test(deco) ? 'underline' : 'line-through'}`)
  }

  // 상속 안 되는 속성: 값이 있을 때만
  const bg = rgbToHex(cs.getPropertyValue('background-color'))
  if (bg) out.push(`background-color:${bg}`)

  const sides = ['top', 'right', 'bottom', 'left'] as const
  const borders = sides.map((s) => {
    const w = cs.getPropertyValue(`border-${s}-width`)
    const st = cs.getPropertyValue(`border-${s}-style`)
    const c = rgbToHex(cs.getPropertyValue(`border-${s}-color`)) ?? '#000000'
    return st && st !== 'none' && st !== 'hidden' && !isZeroLength(w) ? `${w} ${st} ${c}` : ''
  })
  if (borders.every((b) => b && b === borders[0])) out.push(`border:${borders[0]}`)
  else borders.forEach((b, i) => { if (b) out.push(`border-${sides[i]}:${b}`) })

  const pads = sides.map((s) => cs.getPropertyValue(`padding-${s}`))
  if (pads.some((p) => !isZeroLength(p))) out.push(`padding:${pads.map((p) => p || '0').join(' ')}`)

  const tag = el.tagName
  if (tag === 'TD' || tag === 'TH' || tag === 'TABLE') {
    const w = cs.getPropertyValue('width')
    if (w && w !== 'auto' && /px$/.test(w) && parseFloat(w) > 0) out.push(`width:${Math.round(parseFloat(w))}px`)
  }
  const va = cs.getPropertyValue('vertical-align')
  if ((tag === 'TD' || tag === 'TH') && va && va !== 'baseline' && va !== 'auto') out.push(`vertical-align:${va}`)
  return out
}

/** doc 안의 모든 요소에 계산된 서식을 style 속성으로 덧붙이고, <style>·<link>·<script>는 지운다. */
export function applyComputedStylesInline(doc: Document): void {
  const win = doc.defaultView
  if (!win) throw new Error('서식을 계산할 수 없는 문서입니다.')
  const els = Array.from(doc.body.querySelectorAll('*')).filter((el) => !['STYLE', 'SCRIPT', 'LINK', 'META', 'TITLE'].includes(el.tagName))
  // 모든 계산을 먼저 끝낸 뒤에 쓴다(쓰는 도중 style 속성이 바뀌어 뒤 요소의 계산에 영향을 주지 않도록)
  const decls = els.map((el) => declarationsFor(el, win))
  els.forEach((el, i) => {
    if (decls[i].length) el.setAttribute('style', `${el.getAttribute('style') ? el.getAttribute('style') + ';' : ''}${decls[i].join(';')}`)
    el.removeAttribute('class')
  })
  doc.querySelectorAll('style, link, script').forEach((n) => n.remove())
}

/** A4 본문 폭(96dpi 기준 px) — 표 칸 너비 계산의 기준 */
const A4_WIDTH_PX = 794

/** 브라우저 전용: 격리 iframe에서 서식을 계산해 본문 HTML(서식 풀어 넣음)을 돌려준다. */
export function inlineStylesViaIframe(fullHtml: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const iframe = document.createElement('iframe')
    iframe.setAttribute('aria-hidden', 'true')
    iframe.tabIndex = -1
    iframe.style.cssText = `position:fixed;left:-10000px;top:0;width:${A4_WIDTH_PX}px;height:1200px;border:0;visibility:hidden`
    // 스크립트가 있어도 실행되지 않게 샌드박스(스크립트 불가, 같은 출처 접근만 허용)
    iframe.setAttribute('sandbox', 'allow-same-origin')
    const cleanup = () => iframe.remove()
    const timer = setTimeout(() => { cleanup(); reject(new Error('서식을 계산하는 중 시간이 초과되었습니다.')) }, 15_000)
    iframe.onload = () => {
      try {
        const doc = iframe.contentDocument
        if (!doc) throw new Error('서식을 계산할 수 없습니다.')
        applyComputedStylesInline(doc)
        const html = doc.body.innerHTML
        if (!html.trim()) throw new Error('서식을 계산한 결과가 비어 있습니다.')
        clearTimeout(timer)
        cleanup()
        resolve(html)
      } catch (e) {
        clearTimeout(timer)
        cleanup()
        reject(e instanceof Error ? e : new Error('서식을 계산하지 못했습니다.'))
      }
    }
    // srcdoc 를 먼저 지정한 뒤 붙인다 — 붙이는 순간 빈 문서(about:blank)의 load 가 먼저 한 번 더 발생해 빈 본문을 읽는 것을 막는다
    iframe.srcdoc = fullHtml
    document.body.appendChild(iframe)
  })
}
