/**
 * xlsBiff.ts — 구형 엑셀(.xls, BIFF8 바이너리) 서식·그림 읽기 (2026-10-29)
 *
 * .xlsx 는 압축 파일 안의 XML 을 직접 읽어 테두리·글꼴·그림을 가져오지만, .xls 는 압축이 아닌 바이너리 레코드 묶음이라 그 읽기가 통하지 않는다.
 * 그리고 SheetJS(CE)는 .xls 의 값·병합·열 너비·행 높이·일부 배경색만 주고 테두리·글꼴·정렬·그림은 주지 않는다.
 * 이 파일은 같은 바이너리를 직접 읽어 그 빠진 것들을 .xlsx 읽기와 같은 모양(칸 주소 → 값 맵)으로 돌려준다.
 *
 * 읽는 것: 칸별 서식 번호(XF) → 테두리(변별 굵기·종류·색) · 배경색(단색·무늬 근사) · 정렬·줄바꿈 · 글꼴(이름·크기·굵기·기울임·밑줄·취소선·색),
 *          열·행 기본 서식, 숨김 시트, 시트별 그림(JPEG·PNG 만 — Escher 그리기 레코드의 그림 저장소 + 그림 위치).
 * 건너뛰는 것: 틀 고정·하이퍼링크·선/도형, EMF·WMF·DIB 그림(브라우저·저장소가 다루지 못하는 형식).
 * 실패하면 빈 결과(값·구조 가져오기에는 영향 없음). 브라우저·Node 모두에서 동작(DOM 비사용).
 */
import * as XLSX from 'xlsx'

// ─────────────────────────────────────────────────────────────────────────────
// 공개 타입 (xlsxImport 의 레이아웃 모양과 같다 — 순환 import 를 피하려고 여기서 구조적으로 정의)
// ─────────────────────────────────────────────────────────────────────────────

export interface BiffCellBorders { top?: string; right?: string; bottom?: string; left?: string }
export interface BiffCellAlign { horizontal?: 'left' | 'center' | 'right' | 'justify'; vertical?: 'top' | 'middle' | 'bottom'; wrap: boolean }
export interface BiffCellFont { name?: string; sizePt?: number; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; color?: string }

export interface BiffSheetLayout {
  borders: Map<string, BiffCellBorders>
  aligns: Map<string, BiffCellAlign>
  fonts: Map<string, BiffCellFont>
  fills: Map<string, string>
  /** 시트 기본 행 높이(px). 모르면 null */
  defaultRowPx: number | null
}

export interface BiffImage {
  /** 같은 그림이 여러 번 쓰였는지 구분하는 값 */
  mediaPath: string
  mime: 'image/png' | 'image/jpeg'
  bytes: Uint8Array
  col: number
  row: number
  colOffsetPx: number
  rowOffsetPx: number
  widthPx: number
  heightPx: number
}

/** 글상자(도형 안의 글) — 글자와 그 도형이 놓인 칸 */
export interface BiffTextBox {
  text: string
  /** 도형이 걸친 영역의 시작 칸과 끝 칸(0부터) */
  col1: number
  row1: number
  col2: number
  row2: number
}

export interface BiffWorkbook {
  sheets: { name: string; hidden: boolean }[]
  /** 시트 이름 → 그 시트의 글상자들(글자가 있는 것만) */
  textBoxesBySheet: Map<string, BiffTextBox[]>
  layoutBySheet: Map<string, BiffSheetLayout>
  imagesBySheet: Map<string, BiffImage[]>
  /** 형식이 맞지 않아(EMF·WMF·DIB 등) 가져오지 못한 그림 수 */
  skippedImages: number
}

// ─────────────────────────────────────────────────────────────────────────────
// 바이트 읽기 도우미
// ─────────────────────────────────────────────────────────────────────────────

const u8 = (b: Uint8Array, o: number): number => b[o] ?? 0
const u16 = (b: Uint8Array, o: number): number => (b[o] ?? 0) | ((b[o + 1] ?? 0) << 8)
const u32 = (b: Uint8Array, o: number): number => (u16(b, o) | (u16(b, o + 2) << 16)) >>> 0

/** 구형 엑셀(복합 문서 파일) 여부 — 파일 맨 앞 서명(D0 CF 11 E0 A1 B1 1A E1) */
export function isLegacyXls(arrayBuffer: ArrayBuffer): boolean {
  const b = new Uint8Array(arrayBuffer, 0, Math.min(8, arrayBuffer.byteLength))
  return b.length >= 8 && b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0 && b[4] === 0xa1 && b[5] === 0xb1 && b[6] === 0x1a && b[7] === 0xe1
}

// ─────────────────────────────────────────────────────────────────────────────
// 색상표 (엑셀 기본 56색 + 파일이 바꾼 색)
// ─────────────────────────────────────────────────────────────────────────────

/** 색 번호 8~63 의 기본 색 */
const DEFAULT_PALETTE: string[] = [
  '#000000', '#FFFFFF', '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', '#00FFFF',
  '#800000', '#008000', '#000080', '#808000', '#800080', '#008080', '#C0C0C0', '#808080',
  '#9999FF', '#993366', '#FFFFCC', '#CCFFFF', '#660066', '#FF8080', '#0066CC', '#CCCCFF',
  '#000080', '#FF00FF', '#FFFF00', '#00FFFF', '#800080', '#800000', '#008080', '#0000FF',
  '#00CCFF', '#CCFFFF', '#CCFFCC', '#FFFF99', '#99CCFF', '#FF99CC', '#CC99FF', '#FFCC99',
  '#3366FF', '#33CCCC', '#99CC00', '#FFCC00', '#FF9900', '#FF6600', '#666699', '#969696',
  '#003366', '#339966', '#003300', '#333300', '#993300', '#993366', '#333399', '#333333',
]

/** 색 번호 → '#RRGGBB'. 0~7 은 8~15 와 같은 색, 64·65(시스템 글자색·배경색)는 undefined(= 기본색) */
function paletteColor(palette: string[], idx: number): string | undefined {
  if (idx >= 0 && idx <= 7) return DEFAULT_PALETTE[idx]
  if (idx >= 8 && idx <= 63) return palette[idx - 8] ?? DEFAULT_PALETTE[idx - 8]
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────────
// 서식 레코드 해석 (순수 함수 — 테스트 대상)
// ─────────────────────────────────────────────────────────────────────────────

export interface DecodedXf {
  fontIndex: number
  /** 가로 정렬 코드 0 일반·1 왼쪽·2 가운데·3 오른쪽·4 채움·5 양쪽·6 선택 영역 가운데 */
  horizontal: number
  /** 세로 정렬 코드 0 위·1 가운데·2 아래·3 양쪽·4 분산 */
  vertical: number
  wrap: boolean
  borderStyle: { left: number; right: number; top: number; bottom: number }
  borderColorIdx: { left: number; right: number; top: number; bottom: number }
  fillPattern: number
  fillFgIdx: number
  fillBgIdx: number
}

/** XF 레코드(셀 서식) 한 개 — BIFF8 20바이트 */
export function decodeXfRecord(d: Uint8Array): DecodedXf {
  const align = u8(d, 6)
  const b1 = u32(d, 10)
  const b2 = u32(d, 14)
  const fill = u16(d, 18)
  return {
    fontIndex: u16(d, 0),
    horizontal: align & 0x07,
    wrap: (align & 0x08) !== 0,
    vertical: (align >> 4) & 0x07,
    borderStyle: { left: b1 & 0xf, right: (b1 >>> 4) & 0xf, top: (b1 >>> 8) & 0xf, bottom: (b1 >>> 12) & 0xf },
    borderColorIdx: { left: (b1 >>> 16) & 0x7f, right: (b1 >>> 23) & 0x7f, top: b2 & 0x7f, bottom: (b2 >>> 7) & 0x7f },
    fillPattern: (b2 >>> 26) & 0x3f,
    fillFgIdx: fill & 0x7f,
    fillBgIdx: (fill >>> 7) & 0x7f,
  }
}

export interface DecodedFont {
  sizePt: number
  bold: boolean
  italic: boolean
  strike: boolean
  underline: boolean
  colorIdx: number
  name: string
}

/** FONT 레코드 한 개 */
export function decodeFontRecord(d: Uint8Array): DecodedFont {
  const flags = u16(d, 2)
  const nameLen = u8(d, 14)
  const utf16 = (u8(d, 15) & 1) === 1
  let name = ''
  if (utf16) {
    for (let i = 0; i < nameLen; i++) name += String.fromCharCode(u16(d, 16 + i * 2))
  } else {
    for (let i = 0; i < nameLen; i++) name += String.fromCharCode(u8(d, 16 + i))
  }
  return {
    sizePt: u16(d, 0) / 20,
    bold: u16(d, 6) >= 600,
    italic: (flags & 0x02) !== 0,
    strike: (flags & 0x08) !== 0,
    underline: u8(d, 10) !== 0,
    colorIdx: u16(d, 4),
    name,
  }
}

/** 테두리 한 변 → CSS "Npx 종류 색". 선이 없으면 undefined. 자동색(64)은 검정 */
export function borderSideCss(style: number, colorIdx: number, palette: string[]): string | undefined {
  if (!style) return undefined
  let width = 1
  let kind: 'solid' | 'dashed' | 'dotted' | 'double' = 'solid'
  if (style === 2 || style === 8 || style === 10 || style === 12) width = 2 // 보통 굵기·보통 점선류
  if (style === 5) width = 3 // 굵게
  if (style === 6) { width = 3; kind = 'double' }
  if (style === 3 || style === 8 || style === 9 || style === 10 || style === 11 || style === 12 || style === 13) kind = 'dashed'
  if (style === 4 || style === 7) kind = 'dotted'
  const color = paletteColor(palette, colorIdx) ?? '#000000'
  return `${width}px ${kind} ${color}`
}

/** 채우기 무늬: 1 = 단색, 그 밖에는 앞색·뒷색을 무늬 농도만큼 섞어 단색으로 근사한다. 0 = 채우기 없음 */
export function fillColor(pattern: number, fg: string | undefined, bg: string | undefined): string | undefined {
  if (pattern === 0) return undefined
  if (pattern === 1) return fg
  if (!fg) return undefined
  const density = pattern === 2 ? 0.5 : pattern === 3 ? 0.75 : 0.25
  const base = bg ?? '#FFFFFF'
  const mix = (a: number, b: number): number => Math.round(a * density + b * (1 - density))
  const f = parseInt(fg.slice(1), 16)
  const g = parseInt(base.slice(1), 16)
  const ch = (shift: number): number => mix((f >> shift) & 255, (g >> shift) & 255)
  return '#' + [ch(16), ch(8), ch(0)].map((c) => c.toString(16).padStart(2, '0')).join('').toUpperCase()
}

// ─────────────────────────────────────────────────────────────────────────────
// 그리기(Escher) 레코드 읽기
// ─────────────────────────────────────────────────────────────────────────────

export interface EscherRec { ver: number; inst: number; type: number; body: number; len: number }

/** Escher 레코드 나무를 앞에서부터 훑는다(컨테이너는 안으로 들어간다). 잘린 데이터에도 멈추지 않고 가진 범위까지만 */
/** 컨테이너 중첩 깊이 상한 — 악의적으로 깊게 중첩된 파일이 호출 스택을 소진하지 못하게 한다(정상 파일은 5단계 안팎) */
const MAX_ESCHER_DEPTH = 32

export function walkEscher(b: Uint8Array, start: number, end: number, cb: (rec: EscherRec) => void, depth = 0): void {
  if (depth > MAX_ESCHER_DEPTH) return
  let off = start
  while (off + 8 <= end) {
    const verInst = u16(b, off)
    const ver = verInst & 0xf
    const inst = verInst >>> 4
    const type = u16(b, off + 2)
    const declared = u32(b, off + 4)
    const body = off + 8
    const bodyEnd = Math.min(end, body + declared)
    cb({ ver, inst, type, body, len: Math.max(0, bodyEnd - body) })
    if (ver === 0xf) walkEscher(b, body, bodyEnd, cb, depth + 1)
    if (declared === 0 && ver !== 0xf && type === 0) break // 잘못된 레코드(무한 반복 방지)
    off = body + declared
  }
}

/** 그림 레코드(0xF01A~0xF02A) 한 개에서 JPEG·PNG 바이트를 꺼낸다. 그 밖의 형식은 null */
export function blipToImage(b: Uint8Array, rec: EscherRec): { mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array } | null {
  let uids: number
  let mime: 'image/png' | 'image/jpeg'
  if (rec.type === 0xf01d || rec.type === 0xf02a) {
    mime = 'image/jpeg'
    uids = rec.inst === 0x46b || rec.inst === 0x6e3 ? 2 : 1
  } else if (rec.type === 0xf01e) {
    mime = 'image/png'
    uids = rec.inst === 0x6e1 ? 2 : 1
  } else {
    return null
  }
  const from = rec.body + uids * 16 + 1 // 고유값(16 또는 32바이트) + 태그 1바이트
  const to = rec.body + rec.len
  if (from >= to) return null
  return { mime, bytes: b.slice(from, to) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 통합 문서 읽기
// ─────────────────────────────────────────────────────────────────────────────

const REC = {
  BOF: 0x809, EOF: 0x0a, CONTINUE: 0x3c, FONT: 0x31, XF: 0xe0, PALETTE: 0x92, BOUNDSHEET: 0x85,
  DIMENSIONS: 0x200, DEFCOLWIDTH: 0x55, DEFAULTROWHEIGHT: 0x225, COLINFO: 0x7d, ROW: 0x208,
  BLANK: 0x201, NUMBER: 0x203, LABEL: 0x204, BOOLERR: 0x205, LABELSST: 0xfd, RK: 0x27e, FORMULA: 0x06, RSTRING: 0xd6, MULRK: 0xbd, MULBLANK: 0xbe,
  MSODRAWINGGROUP: 0xeb, MSODRAWING: 0xec, TXO: 0x1b6,
} as const

/** 엑셀 표준 열 너비 글자당 px(.xlsx 가져오기와 같은 값) */
const PX_PER_CHAR = 7
const DEFAULT_COL_PX = 64

interface RecIndex { type: number; hdr: number; body: number; len: number }

/** 레코드 머리말을 모두 훑어 목록으로 만든다 */
function scanRecords(b: Uint8Array): RecIndex[] {
  const recs: RecIndex[] = []
  let o = 0
  while (o + 4 <= b.length) {
    const type = u16(b, o)
    const len = u16(b, o + 2)
    recs.push({ type, hdr: o, body: o + 4, len: Math.min(len, Math.max(0, b.length - (o + 4))) })
    o += 4 + len
  }
  return recs
}

/** 레코드 i 와 바로 뒤따르는 CONTINUE 들의 내용을 하나로 이어 붙인다(큰 그림·그리기 레코드가 이렇게 쪼개져 있다) */
function joined(b: Uint8Array, recs: RecIndex[], i: number): Uint8Array {
  const parts: Uint8Array[] = [b.subarray(recs[i].body, recs[i].body + recs[i].len)]
  for (let j = i + 1; j < recs.length && recs[j].type === REC.CONTINUE; j++) parts.push(b.subarray(recs[j].body, recs[j].body + recs[j].len))
  if (parts.length === 1) return parts[0]
  const total = parts.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return out
}

/** 그림 저장소(MSODRAWINGGROUP)는 큰 그림이 있으면 같은 종류 레코드와 CONTINUE 가 이어져 하나의 데이터가 된다 — 이어진 것을 모두 붙인다 */
function joinedDrawingGroup(b: Uint8Array, recs: RecIndex[], i: number): { data: Uint8Array; next: number } {
  const parts: Uint8Array[] = []
  let j = i
  for (; j < recs.length && (recs[j].type === REC.MSODRAWINGGROUP || recs[j].type === REC.CONTINUE); j++) {
    parts.push(b.subarray(recs[j].body, recs[j].body + recs[j].len))
  }
  const total = parts.reduce((sum, p) => sum + p.length, 0)
  const out = new Uint8Array(total)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.length }
  return { data: out, next: j }
}

/** 글상자 레코드(TXO)의 글자 — 바로 뒤 CONTINUE 에 (1바이트: 8비트/유니코드) + 글자들이 있다. 길이는 TXO 안의 글자 수 */
function readTxoText(b: Uint8Array, recs: RecIndex[], i: number): string {
  const total = u16(b.subarray(recs[i].body, recs[i].body + recs[i].len), 10)
  let out = ''
  for (let j = i + 1; j < recs.length && recs[j].type === REC.CONTINUE && out.length < total; j++) {
    const d = b.subarray(recs[j].body, recs[j].body + recs[j].len)
    const wide = (u8(d, 0) & 1) === 1
    const want = total - out.length
    const have = wide ? Math.floor((d.length - 1) / 2) : d.length - 1
    for (let k = 0; k < Math.min(want, have); k++) out += String.fromCharCode(wide ? u16(d, 1 + k * 2) : u8(d, 1 + k))
  }
  return out
}

function readBoundSheetName(d: Uint8Array): string {
  const cch = u8(d, 6)
  const utf16 = (u8(d, 7) & 1) === 1
  let s = ''
  for (let i = 0; i < cch; i++) s += String.fromCharCode(utf16 ? u16(d, 8 + i * 2) : u8(d, 8 + i))
  return s
}

const cellKey = (r: number, c: number): string => XLSX.utils.encode_cell({ r, c })

const biffCache = new WeakMap<ArrayBuffer, BiffWorkbook | null>()

/** readBiffWorkbook 결과를 같은 ArrayBuffer 에 대해 한 번만 계산해 둔다(시트마다 큰 파일을 다시 읽지 않도록) */
export function readBiffWorkbookCached(arrayBuffer: ArrayBuffer): BiffWorkbook | null {
  if (biffCache.has(arrayBuffer)) return biffCache.get(arrayBuffer) ?? null
  const wb = readBiffWorkbook(arrayBuffer)
  biffCache.set(arrayBuffer, wb)
  return wb
}

/** 구형 엑셀 파일을 읽는다. 읽을 수 없으면 null */
export function readBiffWorkbook(arrayBuffer: ArrayBuffer): BiffWorkbook | null {
  try {
    if (!isLegacyXls(arrayBuffer)) return null
    const cfb = XLSX.CFB.read(new Uint8Array(arrayBuffer), { type: 'array' })
    const entry = XLSX.CFB.find(cfb, 'Workbook') ?? XLSX.CFB.find(cfb, 'Book')
    const content = entry?.content
    if (!content) return null
    const b = content instanceof Uint8Array ? content : Uint8Array.from(content as ArrayLike<number>)
    const recs = scanRecords(b)
    if (recs.length === 0) return null

    // ── 통합 문서 전역(첫 BOF ~ 짝 EOF) ──
    const fonts: DecodedFont[] = []
    const xfs: DecodedXf[] = []
    const palette: string[] = [...DEFAULT_PALETTE]
    const sheetsMeta: { name: string; hidden: boolean; pos: number; isWorksheet: boolean }[] = []
    const blips: ({ mime: 'image/png' | 'image/jpeg'; bytes: Uint8Array } | null)[] = []
    let depth = 0
    let i = 0
    for (; i < recs.length; i++) {
      const r = recs[i]
      const d = b.subarray(r.body, r.body + r.len)
      if (r.type === REC.BOF) depth++
      else if (r.type === REC.EOF) { depth--; if (depth <= 0) { i++; break } }
      else if (r.type === REC.FONT) fonts.push(decodeFontRecord(d))
      else if (r.type === REC.XF) xfs.push(decodeXfRecord(d))
      else if (r.type === REC.PALETTE) {
        const n = u16(d, 0)
        for (let k = 0; k < n && 2 + k * 4 + 3 <= d.length; k++) {
          const rgb = (u8(d, 2 + k * 4) << 16) | (u8(d, 3 + k * 4) << 8) | u8(d, 4 + k * 4)
          palette[k] = '#' + rgb.toString(16).padStart(6, '0').toUpperCase()
        }
      } else if (r.type === REC.BOUNDSHEET) {
        sheetsMeta.push({ name: readBoundSheetName(d), hidden: u8(d, 4) !== 0, pos: u32(d, 0), isWorksheet: u8(d, 5) === 0 })
      } else if (r.type === REC.MSODRAWINGGROUP) {
        const group = joinedDrawingGroup(b, recs, i)
        i = group.next - 1 // 이어진 레코드는 한꺼번에 처리했다
        const data = group.data
        walkEscher(data, 0, data.length, (rec) => {
          if (rec.type !== 0xf007) return // BSE(그림 저장소 항목) — 그림이 안에 들어 있다
          const cbName = u8(data, rec.body + 33)
          const blipOff = rec.body + 36 + cbName
          if (blipOff + 8 > rec.body + rec.len) { blips.push(null); return }
          const verInst = u16(data, blipOff)
          const inner: EscherRec = { ver: verInst & 0xf, inst: verInst >>> 4, type: u16(data, blipOff + 2), body: blipOff + 8, len: Math.min(u32(data, blipOff + 4), data.length - (blipOff + 8)) }
          blips.push(blipToImage(data, inner))
        })
      }
    }

    const fontAt = (idx: number): DecodedFont | undefined => fonts[idx >= 4 ? idx - 1 : idx] // 글꼴 번호 4 는 비어 있다

    const xfStyle = (xf: DecodedXf): {
      borders?: BiffCellBorders; align?: BiffCellAlign; font?: BiffCellFont; fill?: string
    } => {
      const out: { borders?: BiffCellBorders; align?: BiffCellAlign; font?: BiffCellFont; fill?: string } = {}
      const top = borderSideCss(xf.borderStyle.top, xf.borderColorIdx.top, palette)
      const right = borderSideCss(xf.borderStyle.right, xf.borderColorIdx.right, palette)
      const bottom = borderSideCss(xf.borderStyle.bottom, xf.borderColorIdx.bottom, palette)
      const left = borderSideCss(xf.borderStyle.left, xf.borderColorIdx.left, palette)
      if (top || right || bottom || left) out.borders = { top, right, bottom, left }
      const h = xf.horizontal === 1 || xf.horizontal === 4 ? 'left' : xf.horizontal === 2 || xf.horizontal === 6 ? 'center' : xf.horizontal === 3 ? 'right' : xf.horizontal === 5 ? 'justify' : undefined
      const v = xf.vertical === 0 || xf.vertical === 3 || xf.vertical === 4 ? 'top' : xf.vertical === 1 ? 'middle' : 'bottom'
      out.align = { horizontal: h, vertical: v, wrap: xf.wrap }
      const fo = fontAt(xf.fontIndex)
      if (fo) {
        out.font = {
          name: fo.name || undefined,
          sizePt: fo.sizePt || undefined,
          bold: fo.bold || undefined,
          italic: fo.italic || undefined,
          underline: fo.underline || undefined,
          strike: fo.strike || undefined,
          color: paletteColor(palette, fo.colorIdx),
        }
      }
      const fill = fillColor(xf.fillPattern, paletteColor(palette, xf.fillFgIdx), paletteColor(palette, xf.fillBgIdx))
      if (fill) out.fill = fill
      return out
    }

    const styleCache = new Map<number, ReturnType<typeof xfStyle>>()
    const styleOf = (xfIdx: number): ReturnType<typeof xfStyle> | undefined => {
      const xf = xfs[xfIdx]
      if (!xf) return undefined
      let s = styleCache.get(xfIdx)
      if (!s) { s = xfStyle(xf); styleCache.set(xfIdx, s) }
      return s
    }

    // ── 시트별 ──
    // 시트 수·도형 수 상한 — 악의적으로 많은 항목을 넣은 파일이 가져오기를 멈추지 못하게 한다
    const MAX_SHEETS = 256
    const MAX_SHAPES = 2000
    const recIndexByPos = new Map<number, number>()
    recs.forEach((r, idx) => recIndexByPos.set(r.hdr, idx))
    const result: BiffWorkbook = { sheets: [], textBoxesBySheet: new Map(), layoutBySheet: new Map(), imagesBySheet: new Map(), skippedImages: 0 }
    for (const meta of sheetsMeta.slice(0, MAX_SHEETS)) {
      result.sheets.push({ name: meta.name, hidden: meta.hidden })
      if (!meta.isWorksheet) continue
      const startIdx = recIndexByPos.get(meta.pos) ?? -1
      if (startIdx < 0) continue

      const cellXf = new Map<string, number>()
      const colXf = new Map<number, number>()
      const rowXf = new Map<number, number>()
      const colPx = new Map<number, number>()
      const rowPx = new Map<number, number>()
      let dims = { r0: 0, r1: 0, c0: 0, c1: 0 }
      let defaultRowPt = 15
      let defaultColChars = 0
      const drawing: Uint8Array[] = []
      const txoTexts: string[] = []

      let d2 = 0
      for (let k = startIdx; k < recs.length; k++) {
        const r = recs[k]
        const d = b.subarray(r.body, r.body + r.len)
        if (r.type === REC.BOF) { d2++; continue }
        if (r.type === REC.EOF) { d2--; if (d2 <= 0) break; continue }
        if (d2 !== 1) continue // 시트 안 차트 등 중첩 부분은 건너뛴다
        switch (r.type) {
          case REC.DIMENSIONS: dims = { r0: u32(d, 0), r1: u32(d, 4), c0: u16(d, 8), c1: u16(d, 10) }; break
          case REC.DEFAULTROWHEIGHT: defaultRowPt = u16(d, 2) / 20 || 15; break
          case REC.DEFCOLWIDTH: defaultColChars = u16(d, 0); break
          case REC.COLINFO: {
            const first = u16(d, 0)
            const last = Math.min(u16(d, 2), 255)
            const hidden = (u16(d, 8) & 1) === 1
            const px = hidden ? 0 : Math.round((u16(d, 4) / 256) * PX_PER_CHAR)
            for (let c = first; c <= last; c++) { colPx.set(c, px); colXf.set(c, u16(d, 6)) }
            break
          }
          case REC.ROW: {
            const row = u16(d, 0)
            const h = u16(d, 6)
            if ((h & 0x8000) === 0 && h > 0) rowPx.set(row, Math.round((h / 20) * (96 / 72)))
            if ((u16(d, 12) & 0x80) !== 0) rowXf.set(row, u16(d, 14) & 0xfff)
            break
          }
          case REC.BLANK: case REC.NUMBER: case REC.LABEL: case REC.BOOLERR: case REC.LABELSST: case REC.RK: case REC.FORMULA: case REC.RSTRING:
            cellXf.set(cellKey(u16(d, 0), u16(d, 2)), u16(d, 4))
            break
          case REC.MULRK: {
            const row = u16(d, 0)
            const c0 = u16(d, 2)
            const n = Math.floor((d.length - 6) / 6)
            for (let m = 0; m < n; m++) cellXf.set(cellKey(row, c0 + m), u16(d, 4 + m * 6))
            break
          }
          case REC.MULBLANK: {
            const row = u16(d, 0)
            const c0 = u16(d, 2)
            const n = Math.floor((d.length - 6) / 2)
            for (let m = 0; m < n; m++) cellXf.set(cellKey(row, c0 + m), u16(d, 4 + m * 2))
            break
          }
          case REC.MSODRAWING: drawing.push(joined(b, recs, k)); break
          case REC.TXO: txoTexts.push(readTxoText(b, recs, k)); break
          default: break
        }
      }

      // 칸별 서식 맵 — 칸에 서식이 따로 없으면 그 행·열의 기본 서식을 쓴다(사용 범위 안에서만)
      const layout: BiffSheetLayout = { borders: new Map(), aligns: new Map(), fonts: new Map(), fills: new Map(), defaultRowPx: Math.round(defaultRowPt * (96 / 72)) }
      const put = (key: string, xfIdx: number): void => {
        const s = styleOf(xfIdx)
        if (!s) return
        if (s.borders) layout.borders.set(key, s.borders)
        if (s.align) layout.aligns.set(key, s.align)
        if (s.font) layout.fonts.set(key, s.font)
        if (s.fill) layout.fills.set(key, s.fill)
      }
      const rowEnd = Math.min(dims.r1, 5000)
      const colEnd = Math.min(dims.c1, 256)
      for (let r = dims.r0; r < rowEnd; r++) {
        for (let c = dims.c0; c < colEnd; c++) {
          const key = cellKey(r, c)
          const own = cellXf.get(key)
          const xfIdx = own ?? rowXf.get(r) ?? colXf.get(c)
          if (xfIdx !== undefined) put(key, xfIdx)
        }
      }
      result.layoutBySheet.set(meta.name, layout)

      // ── 그림 ──
      if (drawing.length > 0 && blips.length > 0) {
        const total = drawing.reduce((s, p) => s + p.length, 0)
        const buf = new Uint8Array(total)
        let at = 0
        for (const p of drawing) { buf.set(p, at); at += p.length }
        const colW = (c: number): number => {
          const w = colPx.get(c)
          return w !== undefined ? w : defaultColChars ? Math.round(defaultColChars * PX_PER_CHAR) : DEFAULT_COL_PX
        }
        const rowH = (r: number): number => rowPx.get(r) ?? Math.round(defaultRowPt * (96 / 72))
        type Shape = { pib: number | null; anchor: number[] | null; textbox: boolean }
        const shapes: Shape[] = []
        walkEscher(buf, 0, buf.length, (rec) => {
          if (rec.type === 0xf004) shapes.push({ pib: null, anchor: null, textbox: false }) // SpContainer — 도형 하나의 시작
          const cur = shapes[shapes.length - 1]
          if (!cur) return
          if (rec.type === 0xf00d) cur.textbox = true // ClientTextbox — 이 도형은 글상자
          if (rec.type === 0xf00b) { // 도형 속성 — 그림 번호(pib)
            for (let p = 0; p < rec.inst && rec.body + p * 6 + 6 <= rec.body + rec.len; p++) {
              const id = u16(buf, rec.body + p * 6)
              if ((id & 0x3fff) === 0x0104) cur.pib = u32(buf, rec.body + p * 6 + 2)
            }
          } else if (rec.type === 0xf010 && rec.len >= 18) { // 칸 기준 위치
            cur.anchor = [2, 4, 6, 8, 10, 12, 14, 16].map((off) => u16(buf, rec.body + off)) // col1 dx1 row1 dy1 col2 dx2 row2 dy2
          }
        })
        // 글상자 — 글상자 도형과 글상자 글자(TXO)를 나온 순서대로 짝지어, 글자가 있는 것만 남긴다(개수가 다르면 짝이 확실한 앞쪽까지만)
        if (shapes.length > MAX_SHAPES) shapes.length = MAX_SHAPES
        const boxes = shapes.filter((sh) => sh.textbox && sh.anchor)
        const pairs = Math.min(boxes.length, txoTexts.length)
        const textBoxes: BiffTextBox[] = []
        for (let t = 0; t < pairs; t++) {
          const text = txoTexts[t].replace(/\r/g, '').trim()
          const a = boxes[t].anchor
          if (!text || !a) continue
          textBoxes.push({ text, col1: a[0], row1: a[2], col2: a[4], row2: a[6] })
        }
        if (textBoxes.length) result.textBoxesBySheet.set(meta.name, textBoxes)
        const images: BiffImage[] = []
        for (const sh of shapes) {
          if (!sh.pib || !sh.anchor) continue
          const blip = blips[sh.pib - 1]
          if (!blip) { result.skippedImages++; continue }
          const [col1, dx1, row1, dy1, col2, dx2, row2, dy2] = sh.anchor
          const colOff = Math.round((dx1 / 1024) * colW(col1))
          const rowOff = Math.round((dy1 / 256) * rowH(row1))
          let width = -colOff
          for (let c = col1; c < col2; c++) width += colW(c)
          width += Math.round((dx2 / 1024) * colW(col2))
          let height = -rowOff
          for (let r = row1; r < row2; r++) height += rowH(r)
          height += Math.round((dy2 / 256) * rowH(row2))
          if (width <= 0 || height <= 0) { result.skippedImages++; continue }
          images.push({ mediaPath: `biff:${sh.pib}`, mime: blip.mime, bytes: blip.bytes, col: col1, row: row1, colOffsetPx: colOff, rowOffsetPx: rowOff, widthPx: width, heightPx: height })
        }
        // 그림 저장소에 있는데 이 시트의 도형이 가리키지 않거나 JPEG·PNG 가 아닌 항목은 위에서 건너뛴 수에 포함된다
        if (images.length) result.imagesBySheet.set(meta.name, images)
      }
    }
    // JPEG·PNG 가 아니어서 그림 저장소 단계에서 null 이 된 항목 중 실제로 쓰인 것은 위 루프에서 이미 센다
    return result
  } catch {
    return null
  }
}
