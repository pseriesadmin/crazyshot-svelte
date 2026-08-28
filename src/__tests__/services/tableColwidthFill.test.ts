/**
 * tableColwidthFill.test.ts
 *
 * 표 노드 일부 열에 colwidth가 비어 있으면 TipTap TableView가 고정폭 렌더링을 포기하고
 * 표 전체가 CSS width:100%로 대체돼 저장된 폭과 무관하게 재배치되는 문제(2026-08-27
 * 실사용 중 발견)를 막기 위한 유틸 검증.
 */

import { describe, it, expect } from 'vitest'
import type { JSONContent } from '@tiptap/core'
import { fillMissingTableColwidths } from '$lib/utils/docImport/tableColwidthFill'

function cell(colwidth: number[] | null, colspan = 1): JSONContent {
  const attrs: Record<string, unknown> = { colspan, rowspan: 1 }
  if (colwidth) attrs.colwidth = colwidth
  return { type: 'tableCell', attrs, content: [{ type: 'paragraph' }] }
}

function table(rows: JSONContent[][]): JSONContent {
  return {
    type: 'table',
    content: rows.map((cells) => ({ type: 'tableRow', content: cells })),
  }
}

describe('fillMissingTableColwidths', () => {
  it('모든 열에 colwidth가 이미 있으면 그대로 유지된다(불필요한 변형 없음)', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [table([[cell([100]), cell([200])]])],
    }
    const result = fillMissingTableColwidths(doc)
    const cells = result.content?.[0].content?.[0].content ?? []
    expect(cells[0].attrs?.colwidth).toEqual([100])
    expect(cells[1].attrs?.colwidth).toEqual([200])
  })

  it('일부 열에 colwidth가 없으면 알려진 값들의 평균으로 채워진다', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [table([[cell([100]), cell(null), cell([300])]])],
    }
    const result = fillMissingTableColwidths(doc)
    const cells = result.content?.[0].content?.[0].content ?? []
    expect(cells[0].attrs?.colwidth).toEqual([100])
    expect(cells[1].attrs?.colwidth).toEqual([200]) // (100+300)/2
    expect(cells[2].attrs?.colwidth).toEqual([300])
  })

  it('알려진 폭이 하나도 없으면 기본값(100px)으로 채워진다', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [table([[cell(null), cell(null)]])],
    }
    const result = fillMissingTableColwidths(doc)
    const cells = result.content?.[0].content?.[0].content ?? []
    expect(cells[0].attrs?.colwidth).toEqual([100])
    expect(cells[1].attrs?.colwidth).toEqual([100])
  })

  it('TipTap TableView는 첫 번째 행만 참조하므로, 첫 행 기준으로 판단·보정하고 나머지 행에도 동일하게 반영한다', () => {
    // 첫 행(row0)은 col1이 비어 있음 → col1을 row0의 알려진 값(150)으로 채우고,
    // 그 결과를 모든 행에 동일하게 반영한다. row1의 원래 값(col1=250)은 렌더링에
    // 관여하지 않는 값이었으므로 첫 행 기준값으로 덮어써지는 것이 의도된 동작이다.
    const doc: JSONContent = {
      type: 'doc',
      content: [
        table([
          [cell([150]), cell(null)],
          [cell(null), cell([250])],
        ]),
      ],
    }
    const result = fillMissingTableColwidths(doc)
    const row0 = result.content?.[0].content?.[0].content ?? []
    const row1 = result.content?.[0].content?.[1].content ?? []
    expect(row0[0].attrs?.colwidth).toEqual([150])
    expect(row0[1].attrs?.colwidth).toEqual([150])
    expect(row1[0].attrs?.colwidth).toEqual([150])
    expect(row1[1].attrs?.colwidth).toEqual([150])
  })

  it('colspan이 있는 셀은 해당 범위만큼 colwidth 배열을 채운다(첫 행 기준 — 알려진 값이 없으면 기본값)', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        table([
          [cell(null, 2)],
          [cell([80]), cell([120])],
        ]),
      ],
    }
    const result = fillMissingTableColwidths(doc)
    const row0 = result.content?.[0].content?.[0].content ?? []
    expect(row0[0].attrs?.colwidth).toEqual([100, 100])
  })

  it('표가 없는 문서는 변형 없이 그대로 반환된다', () => {
    const doc: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
    const result = fillMissingTableColwidths(doc)
    expect(result).toEqual(doc)
  })

  it('원본 문서 객체를 변형하지 않는다(깊은 복사)', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [table([[cell([100]), cell(null)]])],
    }
    fillMissingTableColwidths(doc)
    const originalCells = doc.content?.[0].content?.[0].content ?? []
    expect(originalCells[1].attrs?.colwidth).toBeUndefined()
  })

  it('여러 표가 있으면 각 표를 독립적으로 처리한다', () => {
    const doc: JSONContent = {
      type: 'doc',
      content: [
        table([[cell([100]), cell(null)]]),
        table([[cell([500]), cell(null)]]),
      ],
    }
    const result = fillMissingTableColwidths(doc)
    const t1 = result.content?.[0].content?.[0].content ?? []
    const t2 = result.content?.[1].content?.[0].content ?? []
    expect(t1[1].attrs?.colwidth).toEqual([100])
    expect(t2[1].attrs?.colwidth).toEqual([500])
  })
})
