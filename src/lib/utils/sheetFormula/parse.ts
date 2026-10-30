/**
 * parse.ts — 스프레드시트 수식 파서 (2026-10-29)
 *
 * 엑셀 수식 문자열 → AST. 시트 간 참조(`결과보고서!G3`, `'필증 '!A1:B2`), 절대/상대 표시($), 범위(A1:B2), 사칙·거듭제곱·연결(&)·비교·퍼센트(%),
 * 함수 호출, 숫자·글자·참/거짓·오류값 리터럴을 지원한다. 열/행 전체 참조(A:A, 1:3)·배열·이름·외부 통합 문서 참조는 지원하지 않는다
 * (파싱 실패 → 호출부가 "값만 가져오기"로 물러난다).
 *
 * 설계는 오픈소스 GridCraft(MIT/Apache-2.0)의 formula 크레이트(렉서→파서→AST, 앵커의 절대/상대 구분, 연산자 우선순위)를
 * 참고해 이 프로젝트의 TypeScript 로 새로 작성했다(코드 복사 없음).
 *
 * 입력은 신뢰할 수 없는 값으로 본다: 길이·중첩 깊이를 제한하고 재귀 하강은 깊이 상한을 둔다.
 */

export type ErrorCode = '#DIV/0!' | '#VALUE!' | '#REF!' | '#NAME?' | '#NUM!' | '#N/A' | '#CIRC!'

export interface CellRef {
  row: number
  col: number
  rowAbs: boolean
  colAbs: boolean
}

export type Node =
  | { t: 'num'; v: number }
  | { t: 'str'; v: string }
  | { t: 'bool'; v: boolean }
  | { t: 'err'; v: ErrorCode }
  | { t: 'ref'; sheet: string | null; a: CellRef; b: CellRef | null }
  | { t: 'un'; op: '-' | '+'; x: Node }
  | { t: 'pct'; x: Node }
  | { t: 'bin'; op: string; a: Node; b: Node }
  | { t: 'fn'; name: string; args: Node[] }

export class FormulaSyntaxError extends Error {}

const MAX_FORMULA_LENGTH = 8192
const MAX_DEPTH = 64

type Tok =
  | { k: 'num'; v: number }
  | { k: 'str'; v: string }
  | { k: 'name'; v: string } // 식별자(함수명·TRUE/FALSE·셀 참조 후보)
  | { k: 'sheet'; v: string } // `시트이름!` 한정자(이름 부분만)
  | { k: 'err'; v: ErrorCode }
  | { k: 'op'; v: string }

const ERROR_CODES: ErrorCode[] = ['#DIV/0!', '#VALUE!', '#REF!', '#NAME?', '#NUM!', '#N/A', '#CIRC!']

/** 열 문자 → 0부터 번호 ("A"=0). 3글자(XFD) 이내만 */
export function colFromLetters(letters: string): number {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n - 1
}

/** 0부터 열 번호 → 열 문자 */
export function colToLetters(col: number): string {
  let n = col + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

const CELL_RE = /^(\$?)([A-Za-z]{1,3})(\$?)(\d{1,7})$/
const IDENT_START = /[\p{L}_]/u
const IDENT_PART = /[\p{L}\p{N}_.]/u

function parseCell(text: string): CellRef | null {
  const m = CELL_RE.exec(text)
  if (!m) return null
  const col = colFromLetters(m[2])
  const row = parseInt(m[4], 10) - 1
  if (row < 0 || col < 0 || col > 16383 || row > 1048575) return null
  return { row, col, colAbs: m[1] === '$', rowAbs: m[3] === '$' }
}

function tokenize(src: string): Tok[] {
  const out: Tok[] = []
  let i = 0
  const n = src.length
  while (i < n) {
    const ch = src[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '"') {
      let j = i + 1
      let s = ''
      for (;;) {
        if (j >= n) throw new FormulaSyntaxError('닫히지 않은 따옴표')
        if (src[j] === '"') {
          if (src[j + 1] === '"') { s += '"'; j += 2; continue }
          break
        }
        s += src[j++]
      }
      out.push({ k: 'str', v: s })
      i = j + 1
      continue
    }
    if (ch === "'") {
      let j = i + 1
      let s = ''
      for (;;) {
        if (j >= n) throw new FormulaSyntaxError('닫히지 않은 시트 이름')
        if (src[j] === "'") {
          if (src[j + 1] === "'") { s += "'"; j += 2; continue }
          break
        }
        s += src[j++]
      }
      if (src[j + 1] !== '!') throw new FormulaSyntaxError('시트 이름 뒤에 ! 가 필요')
      out.push({ k: 'sheet', v: s })
      i = j + 2
      continue
    }
    if (ch === '#') {
      const code = ERROR_CODES.find((c) => src.slice(i, i + c.length).toUpperCase() === c)
      if (!code) throw new FormulaSyntaxError('알 수 없는 오류값')
      out.push({ k: 'err', v: code })
      i += code.length
      continue
    }
    if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i))
      if (!m) throw new FormulaSyntaxError('숫자 오류')
      // 숫자 바로 뒤에 글자가 붙으면(예: 1A) 셀 참조/이름 후보가 아니므로 오류
      const next = src[i + m[0].length]
      if (next !== undefined && IDENT_START.test(next)) throw new FormulaSyntaxError('숫자 뒤 글자')
      out.push({ k: 'num', v: parseFloat(m[0]) })
      i += m[0].length
      continue
    }
    if (ch === '$' || IDENT_START.test(ch)) {
      let j = i
      if (src[j] === '$') j++
      while (j < n && (IDENT_PART.test(src[j]) || src[j] === '$')) j++
      const text = src.slice(i, j)
      if (src[j] === '!') {
        out.push({ k: 'sheet', v: text })
        i = j + 1
        continue
      }
      out.push({ k: 'name', v: text })
      i = j
      continue
    }
    const two = src.slice(i, i + 2)
    if (two === '<>' || two === '<=' || two === '>=') { out.push({ k: 'op', v: two }); i += 2; continue }
    if ('+-*/^&=<>(),:%'.includes(ch)) { out.push({ k: 'op', v: ch }); i++; continue }
    throw new FormulaSyntaxError(`지원하지 않는 글자: ${ch}`)
  }
  return out
}

class Parser {
  private p = 0
  constructor(private toks: Tok[]) {}

  parse(): Node {
    const node = this.comparison(0)
    if (this.p < this.toks.length) throw new FormulaSyntaxError('수식 끝에 남은 내용')
    return node
  }

  private peek(): Tok | undefined { return this.toks[this.p] }
  private isOp(v: string): boolean { const t = this.peek(); return !!t && t.k === 'op' && t.v === v }
  private eatOp(v: string): boolean { if (this.isOp(v)) { this.p++; return true } return false }

  private comparison(d: number): Node {
    this.guard(d)
    let a = this.concat(d + 1)
    for (;;) {
      const t = this.peek()
      if (t && t.k === 'op' && ['=', '<>', '<', '>', '<=', '>='].includes(t.v)) { this.p++; a = { t: 'bin', op: t.v, a, b: this.concat(d + 1) } } else break
    }
    return a
  }

  private concat(d: number): Node {
    let a = this.additive(d + 1)
    while (this.eatOp('&')) a = { t: 'bin', op: '&', a, b: this.additive(d + 1) }
    return a
  }

  private additive(d: number): Node {
    let a = this.multiplicative(d + 1)
    for (;;) {
      const t = this.peek()
      if (t && t.k === 'op' && (t.v === '+' || t.v === '-')) { this.p++; a = { t: 'bin', op: t.v, a, b: this.multiplicative(d + 1) } } else break
    }
    return a
  }

  private multiplicative(d: number): Node {
    let a = this.power(d + 1)
    for (;;) {
      const t = this.peek()
      if (t && t.k === 'op' && (t.v === '*' || t.v === '/')) { this.p++; a = { t: 'bin', op: t.v, a, b: this.power(d + 1) } } else break
    }
    return a
  }

  // 엑셀은 단항 마이너스가 거듭제곱보다 먼저 묶인다(-2^2 = 4)
  private power(d: number): Node {
    let a = this.unary(d + 1)
    while (this.eatOp('^')) a = { t: 'bin', op: '^', a, b: this.unary(d + 1) }
    return a
  }

  private unary(d: number): Node {
    this.guard(d)
    const t = this.peek()
    if (t && t.k === 'op' && (t.v === '-' || t.v === '+')) { this.p++; return { t: 'un', op: t.v, x: this.unary(d + 1) } }
    return this.postfix(d + 1)
  }

  private postfix(d: number): Node {
    let x = this.primary(d + 1)
    while (this.eatOp('%')) x = { t: 'pct', x }
    return x
  }

  private primary(d: number): Node {
    this.guard(d)
    const t = this.toks[this.p++]
    if (!t) throw new FormulaSyntaxError('수식이 끝났습니다')
    if (t.k === 'num') return { t: 'num', v: t.v }
    if (t.k === 'str') return { t: 'str', v: t.v }
    if (t.k === 'err') return { t: 'err', v: t.v }
    if (t.k === 'op' && t.v === '(') {
      const inner = this.comparison(d + 1)
      if (!this.eatOp(')')) throw new FormulaSyntaxError('닫는 괄호가 없습니다')
      return inner
    }
    if (t.k === 'sheet') {
      const nameTok = this.toks[this.p++]
      if (!nameTok || nameTok.k !== 'name') throw new FormulaSyntaxError('시트 이름 뒤에 셀 주소가 필요')
      return this.refFrom(nameTok.v, t.v)
    }
    if (t.k === 'name') {
      if (this.isOp('(')) {
        this.p++
        const args: Node[] = []
        if (!this.eatOp(')')) {
          for (;;) {
            args.push(this.comparison(d + 1))
            if (this.eatOp(',')) continue
            if (this.eatOp(')')) break
            throw new FormulaSyntaxError('인수 구분이 올바르지 않습니다')
          }
        }
        return { t: 'fn', name: t.v.toUpperCase(), args }
      }
      const upper = t.v.toUpperCase()
      if (upper === 'TRUE') return { t: 'bool', v: true }
      if (upper === 'FALSE') return { t: 'bool', v: false }
      return this.refFrom(t.v, null)
    }
    throw new FormulaSyntaxError('예상하지 못한 기호')
  }

  private refFrom(first: string, sheet: string | null): Node {
    const a = parseCell(first)
    if (!a) throw new FormulaSyntaxError(`이름 또는 지원하지 않는 참조: ${first}`)
    if (this.isOp(':')) {
      this.p++
      const t = this.toks[this.p++]
      const b = t && t.k === 'name' ? parseCell(t.v) : null
      if (!b) throw new FormulaSyntaxError('범위의 끝 주소가 올바르지 않습니다')
      return { t: 'ref', sheet, a, b }
    }
    return { t: 'ref', sheet, a, b: null }
  }

  private guard(d: number): void {
    if (d > MAX_DEPTH) throw new FormulaSyntaxError('수식이 너무 깊게 중첩돼 있습니다')
  }
}

/** 수식 문자열("=A1+B1" 또는 "A1+B1") → AST. 실패하면 FormulaSyntaxError */
export function parseFormula(text: string): Node {
  const src = text.startsWith('=') ? text.slice(1) : text
  if (src.length === 0 || src.length > MAX_FORMULA_LENGTH) throw new FormulaSyntaxError('수식 길이 오류')
  return new Parser(tokenize(src)).parse()
}

/** 파싱 가능 여부(예외 없이) */
export function tryParseFormula(text: string): Node | null {
  try {
    return parseFormula(text)
  } catch {
    return null
  }
}

// ───────────────────────────── 출력(AST → 문자열) ─────────────────────────────

function quoteSheet(name: string): string {
  return /^[\p{L}_][\p{L}\p{N}_.]*$/u.test(name) && !CELL_RE.test(name) ? name : `'${name.replace(/'/g, "''")}'`
}

function printCell(c: CellRef): string {
  return `${c.colAbs ? '$' : ''}${colToLetters(c.col)}${c.rowAbs ? '$' : ''}${c.row + 1}`
}

const PREC: Record<string, number> = { '=': 1, '<>': 1, '<': 1, '>': 1, '<=': 1, '>=': 1, '&': 2, '+': 3, '-': 3, '*': 4, '/': 4, '^': 5 }

/** AST → 수식 본문(맨 앞 "=" 없음). 필요한 괄호만 붙여 의미를 보존한다 */
export function printFormula(node: Node, parentPrec = 0): string {
  switch (node.t) {
    case 'num': return String(node.v)
    case 'str': return `"${node.v.replace(/"/g, '""')}"`
    case 'bool': return node.v ? 'TRUE' : 'FALSE'
    case 'err': return node.v
    case 'ref': {
      const prefix = node.sheet === null ? '' : `${quoteSheet(node.sheet)}!`
      return node.b ? `${prefix}${printCell(node.a)}:${printCell(node.b)}` : `${prefix}${printCell(node.a)}`
    }
    case 'un': return `${node.op}${printFormula(node.x, 6)}`
    case 'pct': return `${printFormula(node.x, 7)}%`
    case 'fn': return `${node.name}(${node.args.map((a) => printFormula(a)).join(',')})`
    case 'bin': {
      const p = PREC[node.op] ?? 1
      const s = `${printFormula(node.a, p)}${node.op}${printFormula(node.b, p + 1)}`
      return p < parentPrec ? `(${s})` : s
    }
  }
}
