/**
 * adjust.ts — 행·열을 넣거나 지울 때 수식의 참조 보정 (2026-10-29)
 *
 * 칸이 밀리면 그 칸을 가리키던 수식도 따라가야 한다(엑셀과 같은 규칙). 오픈소스 GridCraft 의 formula/adjust.rs 가 다루는 규칙을
 * 참고했다 — 삽입: 지점 이후 참조가 밀려난다(범위 안에 끼우면 범위가 늘어난다) / 삭제: 지워진 칸을 가리키던 단일 참조는 #REF!,
 * 범위는 남은 부분으로 줄어들고 전부 지워지면 #REF!, 이후 참조는 당겨진다. 절대($)·상대 구분 없이 구조 변경은 항상 따라간다.
 */
import { printFormula, tryParseFormula, type Node } from './parse'

export interface StructuralEdit {
  /** 구조가 바뀐 시트 이름 */
  sheet: string
  axis: 'row' | 'col'
  op: 'insert' | 'delete'
  /** 0부터: 삽입이면 새 줄이 들어가는 첫 위치, 삭제면 지워지는 첫 줄 */
  at: number
  count: number
}

function sameSheet(a: string, b: string): boolean {
  return a === b || a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** 좌표 하나(단일 참조)의 새 위치. 삭제돼 사라지면 null */
function shiftPoint(v: number, e: StructuralEdit): number | null {
  if (e.op === 'insert') return v >= e.at ? v + e.count : v
  if (v < e.at) return v
  if (v < e.at + e.count) return null
  return v - e.count
}

/** 범위 [start,end] 의 새 위치. 전부 지워지면 null */
function shiftSpan(start: number, end: number, e: StructuralEdit): [number, number] | null {
  if (e.op === 'insert') return [start >= e.at ? start + e.count : start, end >= e.at ? end + e.count : end]
  const s = start < e.at ? start : start < e.at + e.count ? e.at : start - e.count
  const t = end < e.at ? end : end < e.at + e.count ? e.at - 1 : end - e.count
  return t < s ? null : [s, t]
}

function walk(n: Node, ownerSheet: string, e: StructuralEdit, changed: { v: boolean }): Node {
  switch (n.t) {
    case 'ref': {
      if (!sameSheet(n.sheet ?? ownerSheet, e.sheet)) return n
      const key = e.axis === 'row' ? 'row' : 'col'
      const lo = Math.min(n.a[key], (n.b ?? n.a)[key])
      const hi = Math.max(n.a[key], (n.b ?? n.a)[key])
      if (!n.b) {
        const p = shiftPoint(n.a[key], e)
        if (p === null) { changed.v = true; return { t: 'err', v: '#REF!' } }
        if (p === n.a[key]) return n
        changed.v = true
        return { ...n, a: { ...n.a, [key]: p } }
      }
      const span = shiftSpan(lo, hi, e)
      if (span === null) { changed.v = true; return { t: 'err', v: '#REF!' } }
      if (span[0] === lo && span[1] === hi) return n
      changed.v = true
      // 시작/끝 방향(위↔아래)은 유지한다
      const forward = n.a[key] <= n.b[key]
      return { ...n, a: { ...n.a, [key]: forward ? span[0] : span[1] }, b: { ...n.b, [key]: forward ? span[1] : span[0] } }
    }
    case 'un': return { ...n, x: walk(n.x, ownerSheet, e, changed) }
    case 'pct': return { ...n, x: walk(n.x, ownerSheet, e, changed) }
    case 'bin': return { ...n, a: walk(n.a, ownerSheet, e, changed), b: walk(n.b, ownerSheet, e, changed) }
    case 'fn': return { ...n, args: n.args.map((a) => walk(a, ownerSheet, e, changed)) }
    default: return n
  }
}

/** 수식 문자열("=…")에 구조 변경을 반영한 새 문자열. 바뀐 게 없거나 해석할 수 없으면 원문 그대로 */
export function adjustFormulaForEdit(formula: string, ownerSheet: string, edit: StructuralEdit): string {
  const ast = tryParseFormula(formula)
  if (!ast) return formula
  const changed = { v: false }
  const next = walk(ast, ownerSheet, edit, changed)
  return changed.v ? `=${printFormula(next)}` : formula
}

/** 칸 주소("C3") 하나의 구조 변경 후 주소. 지워지면 null — 서식 번호 등 주소 키를 따라 옮길 때 쓴다 */
export function adjustAddress(addr: string, edit: StructuralEdit): string | null {
  const m = /^([A-Z]{1,3})(\d+)$/.exec(addr)
  if (!m) return addr
  let col = [...m[1]].reduce((a, ch) => a * 26 + ch.charCodeAt(0) - 64, 0) - 1
  let row = parseInt(m[2], 10) - 1
  const moved = shiftPoint(edit.axis === 'row' ? row : col, edit)
  if (moved === null) return null
  if (edit.axis === 'row') row = moved
  else col = moved
  let n = col + 1
  let letters = ''
  while (n > 0) { const k = (n - 1) % 26; letters = String.fromCharCode(65 + k) + letters; n = Math.floor((n - 1) / 26) }
  return `${letters}${row + 1}`
}
