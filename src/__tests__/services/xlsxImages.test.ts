// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import ExcelJS from 'exceljs'
import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import { extractWorkbookImages, placeImageInSheet, applyImageMarkers, type SheetImage } from '$lib/utils/docImport/xlsxImages'
import { splitCellImageOverlay } from '$lib/types/sheet-format'

// 1x1 PNG
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

const sheet = (over: Partial<SpreadsheetSheet> = {}): SpreadsheetSheet => ({
  name: 'S', rows: [['a', 'b', 'c'], ['d', 'e', 'f']], merges: [], colWidths: [100, 100, 100], rowHeights: [20, 20],
  cellFormatting: [], ...over,
})
const img = (over: Partial<SheetImage> = {}): SheetImage => ({
  mediaPath: 'xl/media/image1.png', mime: 'image/png', bytes: new Uint8Array([1]), col: 0, row: 0, colOffsetPx: 0, rowOffsetPx: 0, widthPx: 40, heightPx: 40, ...over,
})

describe('placeImageInSheet — 그림 중심이 놓인 칸과 이동량', () => {
  it('칸 중심에 놓인 그림은 이동량 0', () => {
    // 그림 40x40, 시작(30,0) → 중심 (50,20)... 첫 칸(0~100, 0~20)의 중심은 (50,10)
    const p = placeImageInSheet(sheet(), img({ colOffsetPx: 30, rowOffsetPx: -10 }))
    expect(p).toMatchObject({ row: 0, col: 0, offsetX: 0, offsetY: 0, width: 40 })
  })
  it('다른 칸으로 걸쳐 있으면 중심이 놓인 칸 기준', () => {
    const p = placeImageInSheet(sheet(), img({ col: 0, colOffsetPx: 90, widthPx: 100, heightPx: 10 }))
    expect(p?.col).toBe(1) // 중심 x=140 → 두 번째 칸
  })
  it('병합 영역 안이면 앵커 칸 + 병합 전체 중심 기준', () => {
    const s = sheet({ merges: [{ s: { r: 0, c: 0 }, e: { r: 1, c: 1 } }] })
    const p = placeImageInSheet(s, img({ col: 1, row: 1, widthPx: 20, heightPx: 10 }))
    expect(p).toMatchObject({ row: 0, col: 0 })
    // 병합 영역 200x40 의 중심은 (100,20), 그림 중심은 (110, 25)
    expect(p?.offsetX).toBe(10)
    expect(p?.offsetY).toBe(5)
  })
  it('시트 밖에 놓이면 마지막 칸으로', () => {
    const p = placeImageInSheet(sheet(), img({ col: 50, row: 50 }))
    expect(p).toMatchObject({ row: 1, col: 2 })
  })
})

describe('applyImageMarkers', () => {
  it('칸 값 끝에 표식을 붙이고 원본 문서는 바꾸지 않는다', () => {
    const doc: SpreadsheetDocument = { activeSheetIndex: 0, sheets: [sheet()] }
    const out = applyImageMarkers(doc, [{ sheetIndex: 0, placement: { row: 1, col: 1, width: 76, offsetX: 3, offsetY: -4 }, url: 'https://x.test/a.png' }])
    expect(doc.sheets[0].rows[1][1]).toBe('e')
    const parsed = splitCellImageOverlay(out.sheets[0].rows[1][1])
    expect(parsed).toMatchObject({ text: 'e', imageUrl: 'https://x.test/a.png', width: 76, offsetX: 3, offsetY: -4 })
  })
})

describe('extractWorkbookImages — 실제 xlsx 에서 그림 꺼내기', () => {
  it('PNG 그림의 위치·크기·파일을 읽는다', async () => {
    const wb = new ExcelJS.Workbook()
    const ws = wb.addWorksheet('Img')
    ws.getCell('A1').value = 'x'
    const id = wb.addImage({ base64: PNG_B64, extension: 'png' })
    ws.addImage(id, { tl: { col: 2, row: 3 }, ext: { width: 76, height: 76 } })
    const buf = (await wb.xlsx.writeBuffer()) as ArrayBuffer
    const found = await extractWorkbookImages(buf)
    const list = found.bySheet.get('Img')
    expect(list).toHaveLength(1)
    expect(list![0]).toMatchObject({ mime: 'image/png', col: 2, row: 3, widthPx: 76, heightPx: 76 })
    expect(list![0].bytes.byteLength).toBeGreaterThan(10)
  })
  it('그림이 없거나 손상된 파일은 빈 결과', async () => {
    expect((await extractWorkbookImages(new ArrayBuffer(8))).bySheet.size).toBe(0)
  })
})
