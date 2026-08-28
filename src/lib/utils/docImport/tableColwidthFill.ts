/**
 * tableColwidthFill.ts — TipTap 표 노드의 colwidth 공백을 채워 고정폭 렌더링을 보장
 *
 * @tiptap/extension-table의 TableView는 표 안의 "모든" 셀이 colwidth를 가지고 있을 때만
 * <table style="width:합계px">로 고정 픽셀 폭을 적용한다(fixedWidth 판정). 열 하나라도
 * colwidth가 없으면 고정폭이 풀리고 table.style.width가 빈 문자열로 바뀌어, 계약서
 * 에디터 CSS의 `.ProseMirror table { width:100% }` 규칙이 대신 적용되면서 브라우저가
 * 컬럼 너비를 저장된 값과 무관하게 다시 배분한다 — 저장된 표가 열 때마다 벌어지거나
 * 좁혀지는 것처럼 보이는 원인(2026-08-27 실사용 중 발견).
 *
 * 표 생성 직후(insertTable), 행/열 추가(addColumnAfter 등), tblGrid가 없는 docx 임포트
 * 표는 모두 일부 열에 colwidth가 비어 있을 수 있다 — 이 유틸은 그런 표를 발견하면
 * 이미 알려진 열 너비의 평균(알려진 값이 없으면 기본값)으로 빈 열을 채워, 표가 항상
 * fixedWidth=true로 렌더링되도록 만든다. 이미 완전한 표는 원본 그대로 유지한다.
 */

import type { JSONContent } from '@tiptap/core'

/** 알려진 컬럼 너비가 하나도 없는 표에 사용할 기본 열 너비(px) */
const DEFAULT_COLUMN_WIDTH_PX = 100

function isTableCellNode(node: JSONContent): boolean {
  return node.type === 'tableCell' || node.type === 'tableHeader'
}

/**
 * 표 노드 하나(JSONContent, type==='table')의 colwidth 공백을 in-place로 채운다.
 *
 * ⚠️ @tiptap/extension-table의 updateColumns()/createColGroup()은 표의 "첫 번째 행"
 * (node.firstChild)의 셀 attrs만 읽어 컬럼 폭·고정폭 여부를 계산한다(다른 행의 colwidth는
 * 렌더링에 관여하지 않음) — 그래서 이 함수도 첫 번째 행을 기준으로 컬럼별 너비를 파악·보정한다.
 * 계산된 값은 이후 모든 행에 동일하게 반영해, 나중에 그 열의 아무 셀이나 다시 드래그해도
 * 일관된 값에서 출발하도록 한다.
 */
function fillTableNodeColwidths(table: JSONContent): void {
  const rows = (table.content ?? []).filter((r) => r.type === 'tableRow')
  const headRow = rows[0]
  if (!headRow) return

  let colCount = 0
  const knownByCol = new Map<number, number>()

  {
    let col = 0
    for (const cell of headRow.content ?? []) {
      if (!isTableCellNode(cell)) continue
      const colspan = (cell.attrs?.['colspan'] as number | undefined) ?? 1
      const colwidth = cell.attrs?.['colwidth'] as (number | null)[] | null | undefined
      for (let j = 0; j < colspan; j++) {
        const w = colwidth?.[j]
        if (typeof w === 'number' && w > 0) knownByCol.set(col + j, w)
      }
      col += colspan
    }
    colCount = col
  }

  // 첫 행의 모든 열이 이미 채워져 있으면 손대지 않는다(불필요한 변형 없음).
  if (colCount === 0 || knownByCol.size === colCount) return

  const knownValues = Array.from(knownByCol.values())
  const fallback = knownValues.length > 0
    ? Math.round(knownValues.reduce((a, b) => a + b, 0) / knownValues.length)
    : DEFAULT_COLUMN_WIDTH_PX

  const resolvedByCol: number[] = Array.from(
    { length: colCount },
    (_, i) => knownByCol.get(i) ?? fallback,
  )

  for (const row of rows) {
    let col = 0
    for (const cell of row.content ?? []) {
      if (!isTableCellNode(cell)) continue
      const colspan = (cell.attrs?.['colspan'] as number | undefined) ?? 1
      cell.attrs = {
        ...(cell.attrs ?? {}),
        colwidth: resolvedByCol.slice(col, col + colspan),
      }
      col += colspan
    }
  }
}

/**
 * 문서(JSONContent) 안의 모든 table 노드를 순회하며 colwidth 공백을 채운 새 문서를 반환한다.
 * 원본을 변형하지 않는다(깊은 복사 후 반환) — 호출부가 원본 참조를 안전하게 재사용 가능.
 */
export function fillMissingTableColwidths(doc: JSONContent): JSONContent {
  const cloned = JSON.parse(JSON.stringify(doc)) as JSONContent

  const walk = (node: JSONContent): void => {
    if (node.type === 'table') fillTableNodeColwidths(node)
    for (const child of node.content ?? []) walk(child)
  }

  walk(cloned)
  return cloned
}
