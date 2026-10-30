/**
 * xlsTextBoxes.ts — .xls 글상자 글자를 가까운 칸의 값으로 넣기 (2026-10-29)
 *
 * 엑셀의 글상자는 칸 위에 떠 있는 도형이라 칸 격자 안에는 값이 없다. 이 편집기는 도형을 그리지 않으므로, 글상자 글자를
 * 그 도형이 놓인 영역의 가운데 칸(비어 있지 않으면 가까운 빈 칸)의 값으로 옮겨 글자가 사라지지 않게 한다.
 * 이미 값이 있는 칸은 건드리지 않는다. 병합된 칸이면 병합의 앵커 칸이 대상이다.
 */
import type { SpreadsheetSheet } from '$lib/types/contract-document'
import type { BiffTextBox } from './xlsBiff'

/** 가운데 칸에서 이 거리(칸 수) 안에서만 빈 칸을 찾는다 */
const MAX_SEARCH_RADIUS = 4

/** 칸이 병합에 가려진 칸(앵커가 아님)이면 그 병합의 앵커 좌표, 아니면 자기 자신 */
function anchorOf(sheet: SpreadsheetSheet, r: number, c: number): { r: number; c: number } {
  const m = sheet.merges.find((mm) => r >= mm.s.r && r <= mm.e.r && c >= mm.s.c && c <= mm.e.c)
  return m ? { r: m.s.r, c: m.s.c } : { r, c }
}

/**
 * 글상자 글자를 칸 값으로 넣은 새 시트를 돌려준다(원본은 바꾸지 않는다). 넣을 빈 칸을 못 찾은 글상자는 건너뛴다.
 * 글자는 가운데·세로 가운데 정렬로 둔다(글상자처럼 보이도록).
 */
export function placeTextBoxes(sheet: SpreadsheetSheet, boxes: BiffTextBox[]): { sheet: SpreadsheetSheet; placed: number } {
  if (boxes.length === 0 || sheet.rows.length === 0) return { sheet, placed: 0 }
  const rows = sheet.rows.map((row) => [...row])
  const fmt = sheet.cellFormatting.map((row) => row.map((f) => ({ ...f })))
  const rowCount = rows.length
  const colCount = rows[0]?.length ?? 0
  let placed = 0

  for (const box of boxes) {
    const midR = Math.min(rowCount - 1, Math.max(0, Math.round((box.row1 + box.row2) / 2)))
    const midC = Math.min(colCount - 1, Math.max(0, Math.round((box.col1 + box.col2) / 2)))
    // 가운데에서 가까운 순서로 후보 칸을 훑는다(거리 0 → 4)
    let target: { r: number; c: number } | null = null
    for (let d = 0; d <= MAX_SEARCH_RADIUS && !target; d++) {
      for (let dr = -d; dr <= d && !target; dr++) {
        for (let dc = -d; dc <= d && !target; dc++) {
          if (Math.max(Math.abs(dr), Math.abs(dc)) !== d) continue
          const r = midR + dr
          const c = midC + dc
          if (r < 0 || c < 0 || r >= rowCount || c >= colCount) continue
          const a = anchorOf(sheet, r, c)
          if ((rows[a.r][a.c] ?? '') === '') target = a
        }
      }
    }
    if (!target) continue
    rows[target.r][target.c] = box.text
    const f = fmt[target.r][target.c]
    f.textAlign = 'center'
    f.verticalAlign = 'middle'
    f.wrapText = false
    placed++
  }
  return { sheet: { ...sheet, rows, cellFormatting: fmt }, placed }
}
