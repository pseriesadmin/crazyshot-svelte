/**
 * hwpxFormatting.ts — HWPX 서식 보완 (한글 가져오기)
 *
 * hwp-convert 의 extractHtml 은 header.xml 의 스타일 참조(paraPrIDRef·charPrIDRef·borderFillIDRef)를 풀지 않아
 * 문단 정렬·들여쓰기·글꼴·표 너비·셀 배경/테두리색이 HTML 에 담기지 않는다. 이 모듈이 HWPX 를 직접 읽어
 * 변환된 HTML 에 그 정보를 순서 기준으로 덧붙인다(docxTableFormatting.ts 와 같은 방식).
 *
 * 매칭 규칙: 구역(section)의 최상위 문단 → `<p>` 1개, 그 문단 안(run 직속, secPr/ctrl run 제외)의 표 → 뒤따르는 `<table>`
 * (hwp-convert 의 출력 규칙과 같다). 문단·표·행·셀 개수가 하나라도 어긋나면 해당 부분은 건드리지 않는다(원본 HTML 유지).
 * 어떤 오류든 원본 HTML 을 그대로 돌려준다(서식 보완은 실패해도 가져오기를 막지 않는다).
 *
 * 한계: 줄 간격·문단 간격·셀 세로 정렬·표 테두리 '없음'·자동 번호는 편집기 스키마에 대응이 없어 반영하지 않는다.
 *       글꼴은 문단의 첫 글자 서식 기준 1개만 적용한다(문단 안에서 글꼴이 바뀌어도 첫 글꼴로 통일).
 */

import JSZip from 'jszip'
import { fitColumnWidthsToTarget, A4_CONTENT_WIDTH_PX } from './fitColumnWidths'

/** HWPUNIT(1/7200 inch) → CSS px(96dpi) */
const HWPUNIT_PER_PX = 75
const MAX_INDENT_LEVEL = 6
const MIN_COL_PX = 20

interface ParaPr { align: string; leftHwp: number; intentHwp: number }
interface CharPr { heightHwp: number; fontId: string | null }
interface BorderFill { color: string | null; fill: string | null }

interface HeaderInfo {
  paraPr: Map<string, ParaPr>
  charPr: Map<string, CharPr>
  fonts: Map<string, string>
  borderFill: Map<string, BorderFill>
}

interface ParaFmt {
  align: string | null
  indentLevel: number
  font: string | null
  tables: TableFmt[]
}
interface CellFmt { colSpan: number; widthHwp: number; align: string | null; font: string | null; background: string | null; border: string | null }
interface TableFmt { widthHwp: number; rows: CellFmt[][] }

function kids(el: Element, local: string): Element[] {
  return Array.from(el.children).filter((c) => c.localName === local)
}
function kid(el: Element, local: string): Element | null {
  return kids(el, local)[0] ?? null
}
function desc(el: Element | Document, local: string): Element[] {
  return Array.from(el.getElementsByTagNameNS('*', local))
}
function num(v: string | null | undefined, d = 0): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : d
}

function parseXml(text: string): Document {
  const doc = new DOMParser().parseFromString(text, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) throw new Error('xml parse error')
  return doc
}

function readHeader(xml: Document): HeaderInfo {
  const paraPr = new Map<string, ParaPr>()
  for (const el of desc(xml, 'paraPr')) {
    const id = el.getAttribute('id')
    if (id === null) continue
    const margin = kid(el, 'margin')
    paraPr.set(id, {
      align: (kid(el, 'align')?.getAttribute('horizontal') ?? '').toUpperCase(),
      leftHwp: num(margin ? kid(margin, 'left')?.getAttribute('value') : null),
      intentHwp: num(margin ? kid(margin, 'intent')?.getAttribute('value') : null),
    })
  }
  const charPr = new Map<string, CharPr>()
  for (const el of desc(xml, 'charPr')) {
    const id = el.getAttribute('id')
    if (id === null) continue
    charPr.set(id, { heightHwp: num(el.getAttribute('height'), 1000), fontId: kid(el, 'fontRef')?.getAttribute('hangul') ?? null })
  }
  const fonts = new Map<string, string>()
  const hangul = desc(xml, 'fontface').find((f) => (f.getAttribute('lang') ?? '').toUpperCase() === 'HANGUL')
  if (hangul) {
    for (const f of kids(hangul, 'font')) {
      const id = f.getAttribute('id')
      const face = f.getAttribute('face')
      if (id !== null && face) fonts.set(id, face)
    }
  }
  const borderFill = new Map<string, BorderFill>()
  for (const el of desc(xml, 'borderFill')) {
    const id = el.getAttribute('id')
    if (id === null) continue
    let color: string | null = null
    for (const side of ['leftBorder', 'rightBorder', 'topBorder', 'bottomBorder']) {
      const b = kid(el, side)
      const type = (b?.getAttribute('type') ?? 'NONE').toUpperCase()
      const c = b?.getAttribute('color') ?? ''
      if (type !== 'NONE' && /^#[0-9a-f]{6}$/i.test(c)) {
        color = c
        break
      }
    }
    let fill: string | null = null
    const brush = desc(el, 'winBrush')[0]
    const face = brush?.getAttribute('faceColor') ?? ''
    if (/^#[0-9a-f]{6}$/i.test(face) && face.toUpperCase() !== '#FFFFFF') fill = face
    borderFill.set(id, { color, fill })
  }
  return { paraPr, charPr, fonts, borderFill }
}

function cssAlign(horizontal: string): string | null {
  if (horizontal === 'CENTER') return 'center'
  if (horizontal === 'RIGHT') return 'right'
  if (horizontal === 'JUSTIFY' || horizontal === 'DISTRIBUTE' || horizontal === 'DISTRIBUTE_SPACE') return 'justify'
  return null
}

function fontFamilyCss(face: string): string {
  const serif = /바탕|명조|myeong|batang/i.test(face)
  return `'${face.replace(/['"]|;/g, '')}', ${serif ? 'serif' : 'sans-serif'}`
}

/** 문단(hp:p)의 첫 글자 서식(charPr)에서 글꼴·글자 높이를 구한다 */
function firstRunChar(p: Element, h: HeaderInfo): CharPr | null {
  for (const run of kids(p, 'run')) {
    const ref = run.getAttribute('charPrIDRef')
    if (ref === null) continue
    const hasText = desc(run, 't').some((t) => (t.textContent ?? '').trim().length > 0)
    if (hasText) return h.charPr.get(ref) ?? null
  }
  return null
}

function paraFmt(p: Element, h: HeaderInfo): { align: string | null; indentLevel: number; font: string | null } {
  const pr = h.paraPr.get(p.getAttribute('paraPrIDRef') ?? '')
  const ch = firstRunChar(p, h)
  const face = ch?.fontId !== null && ch?.fontId !== undefined ? h.fonts.get(ch.fontId) : undefined
  let indentLevel = 0
  // 내어쓰기(intent<0): 첫 줄 시작 위치(left+intent)를 기준으로 삼는다 — 편집기에는 첫 줄만 따로 들여쓰는 기능이 없어 나머지 줄도 같은 위치가 된다
  const firstLineLeft = pr ? pr.leftHwp + Math.min(0, pr.intentHwp) : 0
  if (pr && firstLineLeft > 0) {
    const em = firstLineLeft / Math.max(1, ch?.heightHwp ?? 1000)
    indentLevel = Math.max(0, Math.min(MAX_INDENT_LEVEL, Math.round(em / 2)))
  }
  return { align: pr ? cssAlign(pr.align) : null, indentLevel, font: face ? fontFamilyCss(face) : null }
}

function tablesInParagraph(p: Element): Element[] {
  const out: Element[] = []
  for (const run of kids(p, 'run')) {
    if (kid(run, 'secPr') || kid(run, 'ctrl')) continue
    out.push(...kids(run, 'tbl'))
  }
  return out
}

function tableFmt(tbl: Element, h: HeaderInfo): TableFmt {
  const rows: CellFmt[][] = kids(tbl, 'tr').map((tr) =>
    kids(tr, 'tc').map((tc) => {
      const sub = kid(tc, 'subList')
      const firstP = sub ? kid(sub, 'p') : kid(tc, 'p')
      const pf = firstP ? paraFmt(firstP, h) : { align: null, indentLevel: 0, font: null }
      const bf = h.borderFill.get(tc.getAttribute('borderFillIDRef') ?? '')
      return {
        colSpan: Math.max(1, num(kid(tc, 'cellSpan')?.getAttribute('colSpan'), 1)),
        widthHwp: num(kid(tc, 'cellSz')?.getAttribute('width')),
        align: pf.align,
        font: pf.font,
        background: bf?.fill ?? null,
        border: bf?.color ?? null,
      }
    }),
  )
  return { widthHwp: num(kid(tbl, 'sz')?.getAttribute('width')), rows }
}

async function readParagraphFormats(zip: JSZip, h: HeaderInfo): Promise<ParaFmt[]> {
  const sectionPaths = Object.keys(zip.files)
    .filter((p) => /(^|\/)section\d+\.xml$/i.test(p))
    .sort((a, b) => num(a.match(/section(\d+)/i)?.[1]) - num(b.match(/section(\d+)/i)?.[1]))
  const out: ParaFmt[] = []
  for (const path of sectionPaths) {
    const file = zip.file(path)
    if (!file) continue
    const xml = parseXml(await file.async('string'))
    const root = xml.documentElement
    for (const p of kids(root, 'p')) {
      out.push({ ...paraFmt(p, h), tables: tablesInParagraph(p).map((t) => tableFmt(t, h)) })
    }
  }
  return out
}

function wrapFont(el: Element, font: string): void {
  const doc = el.ownerDocument
  const span = doc.createElement('span')
  span.setAttribute('style', `font-family:${font}`)
  while (el.firstChild) span.appendChild(el.firstChild)
  el.appendChild(span)
}

function applyTable(table: HTMLTableElement, fmt: TableFmt): void {
  const rows = Array.from(table.rows)
  if (rows.length !== fmt.rows.length) return
  if (rows.some((r, i) => r.cells.length !== fmt.rows[i]!.length)) return
  const tablePx = fmt.widthHwp / HWPUNIT_PER_PX
  const scale = tablePx > A4_CONTENT_WIDTH_PX ? A4_CONTENT_WIDTH_PX / tablePx : 1
  rows.forEach((tr, i) => {
    Array.from(tr.cells).forEach((td, j) => {
      const c = fmt.rows[i]![j]!
      const styles: string[] = []
      const prev = td.getAttribute('style')
      if (prev) styles.push(prev.replace(/;\s*$/, ''))
      if (c.align && !/text-align/.test(prev ?? '')) styles.push(`text-align:${c.align}`)
      if (c.background) styles.push(`background-color:${c.background}`)
      if (c.border) styles.push(`border-color:${c.border}`)
      if (styles.length) td.setAttribute('style', styles.join(';'))
      if (c.widthHwp > 0) {
        const per = Math.max(MIN_COL_PX, Math.round((c.widthHwp * scale) / HWPUNIT_PER_PX / c.colSpan))
        td.setAttribute('colwidth', Array.from({ length: c.colSpan }, () => per).join(','))
      }
      if (c.font) wrapFont(td, c.font)
    })
  })
  // 열 폭 합이 본문 폭을 넘지 않게 마지막으로 한 번 더 맞춘다(병합 반올림 오차 보정)
  const first = rows[0]
  if (first) {
    const widths = Array.from(first.cells).flatMap((td) => (td.getAttribute('colwidth') ?? '').split(',').map((w) => Number(w) || null))
    const fitted = fitColumnWidthsToTarget(widths)
    if (fitted.some((w, k) => w !== widths[k])) {
      let k = 0
      Array.from(first.cells).forEach((td) => {
        const n = (td.getAttribute('colwidth') ?? '').split(',').length
        td.setAttribute('colwidth', fitted.slice(k, k + n).map((w) => w ?? 0).join(','))
        k += n
      })
    }
  }
}

/** 연속 공백·문단 앞 공백을 보존한다(HTML 은 공백을 한 칸으로 합쳐 '년   월   일' 같은 빈칸 입력란이 사라진다) */
function preserveSpaces(root: Element): void {
  const NBSP = '\u00a0'
  const walker = root.ownerDocument.createTreeWalker(root, 4 /* NodeFilter.SHOW_TEXT */)
  const nodes: Text[] = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text)
  const seenBlocks = new Set<Element>()
  for (const t of nodes) {
    const v = t.nodeValue ?? ''
    if (v.length === 0) continue
    const block = t.parentElement?.closest('p, td, th') ?? null
    const isFirstInBlock = block !== null && !seenBlocks.has(block)
    if (block) seenBlocks.add(block)
    let out: string
    if (/^ +$/.test(v)) out = NBSP.repeat(v.length) // 공백뿐인 조각(밑줄 칸 등)
    else {
      out = v.replace(/ {2,}/g, (m) => ' ' + NBSP.repeat(m.length - 1))
      if (isFirstInBlock) out = out.replace(/^ +/, (m) => NBSP.repeat(m.length)) // 문단·셀 맨 앞 공백
    }
    if (out !== v) t.nodeValue = out
  }
}

/** 문서 맨 앞의 내용 없는 문단(쪽 설정용 빈 문단)을 지운다 */
function dropLeadingEmptyParagraphs(body: HTMLElement): void {
  for (;;) {
    const first = body.firstElementChild
    if (!first || first.tagName !== 'P') return
    const empty = (first.textContent ?? '').trim().length === 0 && !first.querySelector('img, table')
    if (!empty) return
    first.remove()
  }
}

/**
 * 변환된 HTML 에 HWPX 의 문단 정렬·들여쓰기·글꼴, 표의 열 폭·셀 배경/테두리색·정렬·글꼴을 덧붙인다.
 * 브라우저 DOMParser 가 없으면(서버 등) 원본을 그대로 반환한다.
 */
export async function applyHwpxFormatting(html: string, hwpx: Uint8Array): Promise<string> {
  if (typeof DOMParser === 'undefined') return html
  try {
    const zip = await JSZip.loadAsync(hwpx)
    const headerPath = Object.keys(zip.files).find((p) => /(^|\/)header\.xml$/i.test(p))
    const headerFile = headerPath ? zip.file(headerPath) : null
    if (!headerFile) return html
    const header = readHeader(parseXml(await headerFile.async('string')))
    const paras = await readParagraphFormats(zip, header)

    const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
    const top = Array.from(doc.body.children)
    const ps = top.filter((el) => el.tagName === 'P')
    const tables = top.filter((el) => el.tagName === 'TABLE')
    const expectedTables = paras.reduce((n, p) => n + p.tables.length, 0)
    const matched = ps.length === paras.length && tables.length === expectedTables // 구조가 어긋나면 서식 덧붙이기는 건너뛴다

    let pi = 0
    let ti = 0
    for (const el of matched ? top : []) {
      if (el.tagName === 'P') {
        const f = paras[pi++]!
        const styles: string[] = []
        const prev = el.getAttribute('style')
        if (prev) styles.push(prev.replace(/;\s*$/, ''))
        if (f.align && !/text-align/.test(prev ?? '')) styles.push(`text-align:${f.align}`)
        if (f.indentLevel > 0) styles.push(`padding-left:${f.indentLevel * 2}em`)
        if (styles.length) el.setAttribute('style', styles.join(';'))
        if (f.font && (el.textContent ?? '').trim().length > 0) wrapFont(el, f.font)
      } else if (el.tagName === 'TABLE') {
        // 표는 문단 순서대로 소비한다
        let remaining = ti
        for (const p of paras) {
          if (remaining < p.tables.length) {
            applyTable(el as HTMLTableElement, p.tables[remaining]!)
            break
          }
          remaining -= p.tables.length
        }
        ti++
      }
    }
    dropLeadingEmptyParagraphs(doc.body)
    preserveSpaces(doc.body)
    return doc.body.innerHTML
  } catch {
    return html
  }
}
