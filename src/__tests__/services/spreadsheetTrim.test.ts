import { describe, it, expect } from 'vitest'
import type { SpreadsheetSheet } from '$lib/types/contract-document'
import { trimSheetToUsedRange, gridDimensionsToFill } from '$lib/components/cms/contract-editor/spreadsheetWidgetAdapter'

function blank(rows: number, cols: number): SpreadsheetSheet {
  return {
    name: 'S',
    rows: Array.from({ length: rows }, () => Array.from({ length: cols }, () => '')),
    merges: [],
    colWidths: Array.from({ length: cols }, () => 100),
    cellFormatting: Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({}))),
  }
}

describe('trimSheetToUsedRange — 저장 시 뒤쪽 빈칸 정리', () => {
  it('값이 있는 마지막 행·열까지만 남긴다', () => {
    const s = blank(50, 26)
    s.rows[2][3] = '내용'
    const t = trimSheetToUsedRange(s)
    expect(t.rows).toHaveLength(3)
    expect(t.rows[0]).toHaveLength(4)
    expect(t.colWidths).toHaveLength(4)
    expect(t.cellFormatting).toHaveLength(3)
    expect(t.cellFormatting[0]).toHaveLength(4)
    expect(t.rows[2][3]).toBe('내용')
  })
  it('중간의 빈 행·열은 그대로 둔다(위치 유지)', () => {
    const s = blank(10, 10)
    s.rows[0][0] = 'a'
    s.rows[5][5] = 'b'
    const t = trimSheetToUsedRange(s)
    expect(t.rows).toHaveLength(6)
    expect(t.rows[5][5]).toBe('b')
    expect(t.rows[3].every((v) => v === '')).toBe(true)
  })
  it('값이 없어도 서식(배경색 등)이 있는 칸은 쓰인 영역으로 본다', () => {
    const s = blank(10, 10)
    s.rows[0][0] = 'a'
    s.cellFormatting[4][2] = { backgroundColor: '#FFFF00' }
    const t = trimSheetToUsedRange(s)
    expect(t.rows).toHaveLength(5)
    expect(t.rows[0]).toHaveLength(3)
  })
  it('값 없는 칸의 글자 서식(편집기 기본 가운데 정렬 등)은 쓰인 것으로 보지 않는다', () => {
    const s = blank(10, 10)
    s.rows[0][0] = 'a'
    s.cellFormatting = s.cellFormatting.map((row) => row.map(() => ({ textAlign: 'center', fontSize: '12pt', fontWeight: 'bold' })))
    expect(trimSheetToUsedRange(s).rows).toHaveLength(1)
    expect(trimSheetToUsedRange(s).rows[0]).toHaveLength(1)
  })
  it('서식 값이 빈 문자열/undefined뿐이면 쓰인 것으로 보지 않는다', () => {
    const s = blank(10, 10)
    s.rows[0][0] = 'a'
    s.cellFormatting[6][6] = { color: undefined, fontSize: '' }
    expect(trimSheetToUsedRange(s).rows).toHaveLength(1)
  })
  it('병합 범위와 반복 영역 끝까지는 남긴다', () => {
    const s = blank(20, 10)
    s.rows[0][0] = 'a'
    s.merges = [{ s: { r: 0, c: 0 }, e: { r: 2, c: 4 } }]
    s.repeatRegion = { startRow: 3, endRow: 7 }
    const t = trimSheetToUsedRange(s)
    expect(t.rows).toHaveLength(8)
    expect(t.rows[0]).toHaveLength(5)
    expect(t.merges).toEqual(s.merges)
    expect(t.repeatRegion).toEqual({ startRow: 3, endRow: 7 })
  })
  it('완전히 빈 시트도 최소 1행 1열을 남긴다', () => {
    const t = trimSheetToUsedRange(blank(30, 20))
    expect(t.rows).toEqual([['']])
    expect(t.colWidths).toHaveLength(1)
  })
  it('서명·직인 이미지 표식만 있는 셀도 값으로 본다', () => {
    const s = blank(10, 10)
    s.rows[3][1] = 'cs-image://200:0:0:https://x.test/a.png'
    expect(trimSheetToUsedRange(s).rows).toHaveLength(4)
  })
})

describe('gridDimensionsToFill — 화면을 채울 빈 격자 크기', () => {
  it('열은 화면 폭과 상관없이 최소 A~Z(26열)를 열어 두고, 행은 화면 높이를 채운다', () => {
    expect(gridDimensionsToFill(954, 445, 2, 1)).toEqual([26, 19])
    expect(gridDimensionsToFill(4000, 445, 2, 1)).toEqual([40, 19])
  })
  it('시트가 26열·화면보다 크면 시트 크기를 유지한다', () => {
    expect(gridDimensionsToFill(954, 445, 34, 200)).toEqual([34, 200])
  })
  it('크기를 알 수 없어도 최소 26열 × 1행', () => {
    expect(gridDimensionsToFill(0, 0, 0, 0)).toEqual([26, 1])
  })
})
