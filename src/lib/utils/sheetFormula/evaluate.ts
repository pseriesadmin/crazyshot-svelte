/**
 * evaluate.ts — 통합 문서(여러 시트) 수식 계산 (2026-10-29)
 *
 * 입력: 시트별 "원문" 칸 값(수식은 "=…" 로 시작하는 글자). 출력: 수식 칸마다 화면에 보일 글자.
 * 시트 간 참조(결과보고서!G3), 범위, 사칙·거듭제곱·연결·비교, 날짜 계산(일련번호), 약 40개 함수를 지원한다.
 * 순환 참조는 #CIRC!, 존재하지 않는 시트는 #REF!, 지원하지 않는 함수는 #NAME? 로 표시한다.
 *
 * 설계 참고: 오픈소스 GridCraft(MIT/Apache-2.0) — 입력을 믿지 않는 계산(범위 크기·재귀 깊이 상한), 오류값 체계, 참조 순환 감지.
 * 코드는 복사하지 않고 이 프로젝트용으로 새로 작성했다.
 */
import { cellAddress } from '$lib/types/sheet-format'
import { dateToSerial, formatNumber, isDateFormat, parseDateText, serialToDate } from './format'
import { tryParseFormula, type CellRef, type ErrorCode, type Node } from './parse'

export type Scalar = number | string | boolean | null | { err: ErrorCode }
type Grid = Scalar[][]

export interface FormulaSheetInput {
  name: string
  /** 칸 원문 — 수식 칸은 "=…" 로 시작 */
  raw: string[][]
  /** 수식 칸의 표시 형식 코드(주소 → 서식). 없으면 일반 */
  numFmts?: Record<string, string>
}

const MAX_RANGE_CELLS = 200_000
const MAX_DEPTH = 400

const err = (e: ErrorCode): Scalar => ({ err: e })
const isErr = (v: unknown): v is { err: ErrorCode } => typeof v === 'object' && v !== null && !Array.isArray(v) && 'err' in v

export function isFormulaRaw(raw: unknown): raw is string {
  return typeof raw === 'string' && raw.length > 1 && raw.startsWith('=')
}

/** 칸 원문 → 값. "1,200", "₩1,200", "25%", "TRUE" 같은 보이는 글자를 숫자·논리값으로 되돌린다 */
export function rawToScalar(raw: string | undefined): Scalar {
  if (raw === undefined || raw === null) return null
  if (raw.trim() === '') return null
  const t = raw.trim()
  const n = textToNumber(t)
  if (n !== null) return n
  const u = t.toUpperCase()
  if (u === 'TRUE') return true
  if (u === 'FALSE') return false
  return raw
}

/** 숫자처럼 보이는 글자 → 숫자(통화 기호·천 단위 쉼표·퍼센트 허용). 아니면 null */
export function textToNumber(t: string): number | null {
  let s = t.trim().replace(/^[₩$]\s*/, '')
  let pct = false
  if (s.endsWith('%')) { pct = true; s = s.slice(0, -1).trim() }
  if (/^[+-]?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) s = s.replace(/,/g, '')
  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(s)) return null
  const n = parseFloat(s)
  return Number.isFinite(n) ? (pct ? n / 100 : n) : null
}

class Evaluator {
  private memo = new Map<string, Scalar>()
  private stack = new Set<string>()
  private depth = 0
  private nameIndex = new Map<string, number>()

  constructor(private sheets: FormulaSheetInput[]) {
    sheets.forEach((s, i) => {
      if (!this.nameIndex.has(s.name)) this.nameIndex.set(s.name, i)
    })
  }

  private sheetIndex(name: string | null, current: number): number | null {
    if (name === null) return current
    const exact = this.nameIndex.get(name)
    if (exact !== undefined) return exact
    const lower = name.trim().toLowerCase()
    const i = this.sheets.findIndex((s) => s.name.trim().toLowerCase() === lower)
    return i >= 0 ? i : null
  }

  /** 칸 하나의 값(수식이면 계산) */
  cell(si: number, row: number, col: number): Scalar {
    const raw = this.sheets[si]?.raw[row]?.[col]
    if (!isFormulaRaw(raw)) return rawToScalar(raw)
    const key = `${si}:${row}:${col}`
    const hit = this.memo.get(key)
    if (hit !== undefined) return hit
    if (this.stack.has(key)) return err('#CIRC!')
    if (this.depth > MAX_DEPTH) return err('#REF!')
    this.stack.add(key)
    this.depth++
    let result: Scalar
    try {
      const ast = tryParseFormula(raw)
      result = ast ? this.scalar(this.eval(ast, si)) : err('#NAME?')
    } finally {
      this.depth--
      this.stack.delete(key)
    }
    this.memo.set(key, result)
    return result
  }

  /** 범위/단일 참조를 격자로 */
  private grid(node: Extract<Node, { t: 'ref' }>, current: number): Grid | { err: ErrorCode } {
    const si = this.sheetIndex(node.sheet, current)
    if (si === null) return { err: '#REF!' }
    const a = node.a
    const b = node.b ?? node.a
    const r1 = Math.min(a.row, b.row), r2 = Math.max(a.row, b.row)
    const c1 = Math.min(a.col, b.col), c2 = Math.max(a.col, b.col)
    if ((r2 - r1 + 1) * (c2 - c1 + 1) > MAX_RANGE_CELLS) return { err: '#VALUE!' }
    const g: Grid = []
    for (let r = r1; r <= r2; r++) {
      const line: Scalar[] = []
      for (let c = c1; c <= c2; c++) line.push(this.cell(si, r, c))
      g.push(line)
    }
    return g
  }

  /** 여러 칸이면 왼쪽 위 한 칸(암시적 교차는 지원하지 않음 → 단일 칸만 정상) */
  private scalar(v: Scalar | Grid): Scalar {
    if (!Array.isArray(v)) return v
    if (v.length === 1 && v[0].length === 1) return v[0][0]
    return err('#VALUE!')
  }

  private eval(n: Node, si: number): Scalar | Grid {
    switch (n.t) {
      case 'num': return n.v
      case 'str': return n.v
      case 'bool': return n.v
      case 'err': return err(n.v)
      case 'ref': {
        const g = this.grid(n, si)
        return Array.isArray(g) ? g : g
      }
      case 'un': {
        const v = this.num(this.eval(n.x, si))
        return isErr(v) ? v : n.op === '-' ? -v : v
      }
      case 'pct': {
        const v = this.num(this.eval(n.x, si))
        return isErr(v) ? v : v / 100
      }
      case 'bin': return this.binary(n.op, this.eval(n.a, si), this.eval(n.b, si))
      case 'fn': return this.call(n.name, n.args, si)
    }
  }

  // ── 형 변환 ──
  private num(v: Scalar | Grid): number | { err: ErrorCode } {
    const s = this.scalar(v)
    if (isErr(s)) return s
    if (s === null) return 0
    if (typeof s === 'number') return s
    if (typeof s === 'boolean') return s ? 1 : 0
    const n = textToNumber(s)
    if (n !== null) return n
    const d = parseDateText(s)
    if (d !== null) return d
    return { err: '#VALUE!' }
  }

  private text(v: Scalar | Grid): string | { err: ErrorCode } {
    const s = this.scalar(v)
    if (isErr(s)) return s
    if (s === null) return ''
    if (typeof s === 'string') return s
    if (typeof s === 'boolean') return s ? 'TRUE' : 'FALSE'
    return formatNumber(s)
  }

  private bool(v: Scalar | Grid): boolean | { err: ErrorCode } {
    const s = this.scalar(v)
    if (isErr(s)) return s
    if (s === null) return false
    if (typeof s === 'boolean') return s
    if (typeof s === 'number') return s !== 0
    const u = s.toUpperCase()
    if (u === 'TRUE') return true
    if (u === 'FALSE') return false
    return { err: '#VALUE!' }
  }

  private binary(op: string, a: Scalar | Grid, b: Scalar | Grid): Scalar {
    if (op === '&') {
      const x = this.text(a), y = this.text(b)
      if (isErr(x)) return x
      if (isErr(y)) return y
      return x + y
    }
    if (['=', '<>', '<', '>', '<=', '>='].includes(op)) return this.compare(op, this.scalar(a), this.scalar(b))
    const x = this.num(a), y = this.num(b)
    if (isErr(x)) return x
    if (isErr(y)) return y
    switch (op) {
      case '+': return x + y
      case '-': return x - y
      case '*': return x * y
      case '/': return y === 0 ? err('#DIV/0!') : x / y
      case '^': {
        const r = Math.pow(x, y)
        return Number.isFinite(r) ? r : err('#NUM!')
      }
      default: return err('#VALUE!')
    }
  }

  private compare(op: string, a: Scalar, b: Scalar): Scalar {
    if (isErr(a)) return a
    if (isErr(b)) return b
    const rank = (v: Scalar): number => (typeof v === 'number' || v === null ? 0 : typeof v === 'string' ? 1 : 2)
    const norm = (v: Scalar, other: Scalar): number | string | boolean => {
      if (v === null) return typeof other === 'string' ? '' : typeof other === 'boolean' ? false : 0
      return v as number | string | boolean
    }
    const ra = rank(a), rb = rank(b)
    let cmp: number
    if (ra !== rb) cmp = ra < rb ? -1 : 1
    else {
      const x = norm(a, b), y = norm(b, a)
      if (typeof x === 'string' && typeof y === 'string') cmp = x.toLowerCase() < y.toLowerCase() ? -1 : x.toLowerCase() > y.toLowerCase() ? 1 : 0
      else cmp = (x as number) < (y as number) ? -1 : (x as number) > (y as number) ? 1 : 0
    }
    switch (op) {
      case '=': return cmp === 0
      case '<>': return cmp !== 0
      case '<': return cmp < 0
      case '>': return cmp > 0
      case '<=': return cmp <= 0
      default: return cmp >= 0
    }
  }

  // ── 함수 ──
  /** 인수들에서 숫자를 모은다. 범위 안의 글자·논리값·빈칸은 건너뛰고, 직접 쓴 인수는 숫자로 변환한다 */
  private numbers(args: Node[], si: number): number[] | { err: ErrorCode } {
    const out: number[] = []
    for (const a of args) {
      const v = this.eval(a, si)
      if (Array.isArray(v)) {
        for (const row of v) for (const c of row) {
          if (isErr(c)) return c
          if (typeof c === 'number') out.push(c)
        }
      } else {
        const n = this.num(v)
        if (isErr(n)) return n
        out.push(n)
      }
    }
    return out
  }

  private cells(args: Node[], si: number): Scalar[] {
    const out: Scalar[] = []
    for (const a of args) {
      const v = this.eval(a, si)
      if (Array.isArray(v)) for (const row of v) out.push(...row)
      else out.push(v)
    }
    return out
  }

  private call(name: string, args: Node[], si: number): Scalar {
    const n1 = (i: number): number | { err: ErrorCode } => (args[i] ? this.num(this.eval(args[i], si)) : err('#VALUE!') as { err: ErrorCode })
    const s1 = (i: number): string | { err: ErrorCode } => (args[i] ? this.text(this.eval(args[i], si)) : '')
    const need = (min: number, max = min): boolean => args.length >= min && args.length <= max
    switch (name) {
      case 'SUM': { const v = this.numbers(args, si); return isErr(v) ? v : v.reduce((a, b) => a + b, 0) }
      case 'PRODUCT': { const v = this.numbers(args, si); return isErr(v) ? v : v.length ? v.reduce((a, b) => a * b, 1) : 0 }
      case 'AVERAGE': { const v = this.numbers(args, si); return isErr(v) ? v : v.length ? v.reduce((a, b) => a + b, 0) / v.length : err('#DIV/0!') }
      case 'MIN': { const v = this.numbers(args, si); return isErr(v) ? v : v.length ? Math.min(...v) : 0 }
      case 'MAX': { const v = this.numbers(args, si); return isErr(v) ? v : v.length ? Math.max(...v) : 0 }
      case 'COUNT': return this.cells(args, si).filter((c) => typeof c === 'number').length
      case 'COUNTA': return this.cells(args, si).filter((c) => c !== null && c !== '').length
      case 'ABS': { if (!need(1)) return err('#VALUE!'); const v = n1(0); return isErr(v) ? v : Math.abs(v) }
      case 'INT': { if (!need(1)) return err('#VALUE!'); const v = n1(0); return isErr(v) ? v : Math.floor(v) }
      case 'SQRT': { if (!need(1)) return err('#VALUE!'); const v = n1(0); return isErr(v) ? v : v < 0 ? err('#NUM!') : Math.sqrt(v) }
      case 'MOD': { if (!need(2)) return err('#VALUE!'); const a = n1(0), b = n1(1); if (isErr(a)) return a; if (isErr(b)) return b; return b === 0 ? err('#DIV/0!') : a - b * Math.floor(a / b) }
      case 'POWER': { if (!need(2)) return err('#VALUE!'); return this.binary('^', this.eval(args[0], si), this.eval(args[1], si)) }
      case 'ROUND': case 'ROUNDUP': case 'ROUNDDOWN': {
        if (!need(1, 2)) return err('#VALUE!')
        const v = n1(0)
        const d = args[1] ? n1(1) : 0
        if (isErr(v)) return v
        if (isErr(d)) return d
        const f = Math.pow(10, Math.trunc(d))
        const x = v * f
        const r = name === 'ROUND' ? Math.sign(x) * Math.round(Math.abs(x)) : name === 'ROUNDUP' ? Math.sign(x) * Math.ceil(Math.abs(x)) : Math.sign(x) * Math.floor(Math.abs(x))
        return r / f
      }
      case 'IF': {
        if (!need(2, 3)) return err('#VALUE!')
        const c = this.bool(this.eval(args[0], si))
        if (isErr(c)) return c
        if (c) return this.scalar(this.eval(args[1], si))
        return args[2] ? this.scalar(this.eval(args[2], si)) : false
      }
      case 'IFERROR': {
        if (!need(2)) return err('#VALUE!')
        const v = this.scalar(this.eval(args[0], si))
        return isErr(v) ? this.scalar(this.eval(args[1], si)) : v
      }
      case 'AND': case 'OR': {
        const vals = this.cells(args, si).filter((c) => c !== null && c !== '')
        if (!vals.length) return err('#VALUE!')
        const bs: boolean[] = []
        for (const c of vals) { const b = this.bool(c); if (isErr(b)) return b; bs.push(b) }
        return name === 'AND' ? bs.every(Boolean) : bs.some(Boolean)
      }
      case 'NOT': { if (!need(1)) return err('#VALUE!'); const b = this.bool(this.eval(args[0], si)); return isErr(b) ? b : !b }
      case 'CONCAT': case 'CONCATENATE': {
        let s = ''
        for (const c of this.cells(args, si)) { const t = this.text(c); if (isErr(t)) return t; s += t }
        return s
      }
      case 'LEN': { if (!need(1)) return err('#VALUE!'); const t = s1(0); return isErr(t) ? t : [...t].length }
      case 'TRIM': { if (!need(1)) return err('#VALUE!'); const t = s1(0); return isErr(t) ? t : t.trim().replace(/\s+/g, ' ') }
      case 'UPPER': { if (!need(1)) return err('#VALUE!'); const t = s1(0); return isErr(t) ? t : t.toUpperCase() }
      case 'LOWER': { if (!need(1)) return err('#VALUE!'); const t = s1(0); return isErr(t) ? t : t.toLowerCase() }
      case 'LEFT': case 'RIGHT': {
        if (!need(1, 2)) return err('#VALUE!')
        const t = s1(0); const k = args[1] ? n1(1) : 1
        if (isErr(t)) return t
        if (isErr(k)) return k
        if (k < 0) return err('#VALUE!')
        const chars = [...t]
        return name === 'LEFT' ? chars.slice(0, k).join('') : k === 0 ? '' : chars.slice(-k).join('')
      }
      case 'MID': {
        if (!need(3)) return err('#VALUE!')
        const t = s1(0), st = n1(1), ln = n1(2)
        if (isErr(t)) return t
        if (isErr(st)) return st
        if (isErr(ln)) return ln
        if (st < 1 || ln < 0) return err('#VALUE!')
        return [...t].slice(st - 1, st - 1 + ln).join('')
      }
      case 'VALUE': { if (!need(1)) return err('#VALUE!'); const v = n1(0); return v }
      case 'TEXT': {
        if (!need(2)) return err('#VALUE!')
        const v = n1(0); const f = s1(1)
        if (isErr(v)) return v
        if (isErr(f)) return f
        return formatNumber(v, f)
      }
      case 'TODAY': { const d = new Date(); return dateToSerial(d.getFullYear(), d.getMonth() + 1, d.getDate()) }
      case 'DATE': {
        if (!need(3)) return err('#VALUE!')
        const y = n1(0), m = n1(1), d = n1(2)
        if (isErr(y)) return y
        if (isErr(m)) return m
        if (isErr(d)) return d
        return dateToSerial(Math.trunc(y), Math.trunc(m), Math.trunc(d))
      }
      case 'YEAR': case 'MONTH': case 'DAY': {
        if (!need(1)) return err('#VALUE!')
        const v = n1(0)
        if (isErr(v)) return v
        const p = serialToDate(v)
        return name === 'YEAR' ? p.y : name === 'MONTH' ? p.m : p.d
      }
      default: return err('#NAME?')
    }
  }

  /** 수식 칸의 표시 글자 */
  display(si: number, row: number, col: number, fmt: string | undefined): string {
    const v = this.cell(si, row, col)
    return toDisplay(v, fmt)
  }
}

export const SUPPORTED_FUNCTIONS = new Set([
  'SUM', 'PRODUCT', 'AVERAGE', 'MIN', 'MAX', 'COUNT', 'COUNTA', 'ABS', 'INT', 'SQRT', 'MOD', 'POWER', 'ROUND', 'ROUNDUP', 'ROUNDDOWN',
  'IF', 'IFERROR', 'AND', 'OR', 'NOT', 'CONCAT', 'CONCATENATE', 'LEN', 'TRIM', 'UPPER', 'LOWER', 'LEFT', 'RIGHT', 'MID', 'VALUE', 'TEXT',
  'TODAY', 'DATE', 'YEAR', 'MONTH', 'DAY',
])

/** 이 수식이 전부 지원하는 함수만 쓰는지 */
export function usesOnlySupportedFunctions(n: Node): boolean {
  switch (n.t) {
    case 'fn': return SUPPORTED_FUNCTIONS.has(n.name) && n.args.every(usesOnlySupportedFunctions)
    case 'bin': return usesOnlySupportedFunctions(n.a) && usesOnlySupportedFunctions(n.b)
    case 'un': case 'pct': return usesOnlySupportedFunctions(n.x)
    default: return true
  }
}

/** 계산 결과 → 화면 글자. 서식이 날짜 서식이면 날짜 글자("2026.10.19")를 일련번호로 되돌려 서식으로 다시 표시한다 */
export function toDisplay(v: Scalar, fmt?: string): string {
  if (isErr(v)) return v.err
  if (v === null) return formatNumber(0, fmt)
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') return formatNumber(v, fmt)
  if (isDateFormat(fmt)) {
    const serial = parseDateText(v)
    if (serial !== null) return formatNumber(serial, fmt)
  }
  return v
}

/**
 * 통합 문서의 모든 수식을 계산한다. 반환: 시트 순서대로, 수식 칸 주소("C1") → 화면 글자
 */
export function computeWorkbook(sheets: FormulaSheetInput[]): Array<Map<string, string>> {
  const ev = new Evaluator(sheets)
  return sheets.map((sheet, si) => {
    const out = new Map<string, string>()
    sheet.raw.forEach((row, r) => {
      row.forEach((raw, c) => {
        if (!isFormulaRaw(raw)) return
        const addr = cellAddress(r, c)
        out.set(addr, ev.display(si, r, c, sheet.numFmts?.[addr]))
      })
    })
    return out
  })
}

export type { CellRef }
