/**
 * xlsBiff.test.ts — 구형 엑셀(.xls) 서식·그림 읽기 (2026-10-29)
 * 서식 레코드 해석, 그리기 레코드에서 그림 꺼내기, 실제로 만든 .xls 파일 읽기(깨지지 않음)를 확인한다.
 */
import { describe, it, expect } from 'vitest'
import * as XLSX from 'xlsx'
import {
  isLegacyXls, decodeXfRecord, decodeFontRecord, borderSideCss, fillColor, walkEscher, blipToImage, readBiffWorkbook,
} from '$lib/utils/docImport/xlsBiff'

function xfBytes(): Uint8Array {
  const d = new Uint8Array(20)
  const dv = new DataView(d.buffer)
  dv.setUint16(0, 5, true) // 글꼴 번호
  d[6] = 2 | 0x08 | (1 << 4) // 가운데·줄바꿈·세로 가운데
  // 테두리: 왼 가늘게(1) 오른 보통(2) 위 굵게(5) 아래 점선(3) / 색 왼 10 오른 12
  dv.setUint32(10, 1 | (2 << 4) | (5 << 8) | (3 << 12) | (10 << 16) | (12 << 23), true)
  // 위 색 8 · 아래 색 9 · 채우기 무늬 단색(1)
  dv.setUint32(14, 8 | (9 << 7) | (1 << 26), true)
  dv.setUint16(18, 22 | (9 << 7), true) // 앞색 22 · 뒷색 9
  return d
}

describe('xlsBiff — 서식 레코드 해석', () => {
  it('XF: 정렬·줄바꿈·테두리 굵기/색·채우기를 읽는다', () => {
    const xf = decodeXfRecord(xfBytes())
    expect(xf.fontIndex).toBe(5)
    expect(xf.horizontal).toBe(2)
    expect(xf.vertical).toBe(1)
    expect(xf.wrap).toBe(true)
    expect(xf.borderStyle).toEqual({ left: 1, right: 2, top: 5, bottom: 3 })
    expect(xf.borderColorIdx).toEqual({ left: 10, right: 12, top: 8, bottom: 9 })
    expect(xf.fillPattern).toBe(1)
    expect(xf.fillFgIdx).toBe(22)
    expect(xf.fillBgIdx).toBe(9)
  })

  it('FONT: 크기·굵기·기울임·취소선·밑줄·이름(8비트와 유니코드)', () => {
    const d = new Uint8Array(16 + 6)
    const dv = new DataView(d.buffer)
    dv.setUint16(0, 240, true) // 12pt
    dv.setUint16(2, 0x02 | 0x08, true) // 기울임 + 취소선
    dv.setUint16(4, 10, true)
    dv.setUint16(6, 700, true) // 굵게
    d[10] = 1 // 밑줄
    d[14] = 3 // 이름 길이
    d[15] = 1 // 유니코드
    '돋움'.split('').forEach((ch, i) => dv.setUint16(16 + i * 2, ch.charCodeAt(0), true))
    const f = decodeFontRecord(d)
    expect(f).toMatchObject({ sizePt: 12, bold: true, italic: true, strike: true, underline: true, colorIdx: 10 })
    expect(f.name.startsWith('돋움')).toBe(true)
  })

  it('테두리 한 변을 CSS 로: 굵기·종류·색(자동색은 검정)', () => {
    const pal = ['#111111']
    expect(borderSideCss(0, 8, pal)).toBeUndefined()
    expect(borderSideCss(1, 64, pal)).toBe('1px solid #000000')
    expect(borderSideCss(2, 8, pal)).toBe('2px solid #111111')
    expect(borderSideCss(5, 8, pal)).toBe('3px solid #111111')
    expect(borderSideCss(6, 8, pal)).toBe('3px double #111111')
    expect(borderSideCss(3, 8, pal)).toBe('1px dashed #111111')
    expect(borderSideCss(4, 8, pal)).toBe('1px dotted #111111')
  })

  it('채우기: 없음·단색·무늬(섞은 단색)', () => {
    expect(fillColor(0, '#FF0000', '#FFFFFF')).toBeUndefined()
    expect(fillColor(1, '#969696', '#FFFFFF')).toBe('#969696')
    expect(fillColor(2, '#000000', '#FFFFFF')).toBe('#808080')
    expect(fillColor(2, undefined, '#FFFFFF')).toBeUndefined()
  })
})

describe('xlsBiff — 그리기 레코드에서 그림 꺼내기', () => {
  /** Escher 레코드 한 개(머리 8바이트 + 내용) */
  function rec(ver: number, inst: number, type: number, body: Uint8Array): Uint8Array {
    const out = new Uint8Array(8 + body.length)
    const dv = new DataView(out.buffer)
    dv.setUint16(0, ver | (inst << 4), true)
    dv.setUint16(2, type, true)
    dv.setUint32(4, body.length, true)
    out.set(body, 8)
    return out
  }

  it('컨테이너 안의 레코드를 순서대로 훑는다', () => {
    const inner = rec(2, 0, 0xf00a, new Uint8Array(8))
    const outer = rec(0xf, 0, 0xf004, inner)
    const types: number[] = []
    walkEscher(outer, 0, outer.length, (r) => types.push(r.type))
    expect(types).toEqual([0xf004, 0xf00a])
  })

  it('PNG 그림 레코드에서 파일 바이트를 꺼낸다(고유값 16바이트 + 태그 1바이트 뒤)', () => {
    const png = Uint8Array.from([137, 80, 78, 71, 1, 2, 3])
    const body = new Uint8Array(16 + 1 + png.length)
    body.set(png, 17)
    const blip = rec(0, 0x6e0, 0xf01e, body)
    let found: { mime: string; bytes: Uint8Array } | null = null
    walkEscher(blip, 0, blip.length, (r) => { found = blipToImage(blip, r) })
    expect(found).not.toBeNull()
    expect(found!.mime).toBe('image/png')
    expect(Array.from(found!.bytes)).toEqual(Array.from(png))
  })

  it('JPEG(고유값 2개 변형)도 읽고, EMF 같은 형식은 null', () => {
    const jpg = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])
    const body = new Uint8Array(32 + 1 + jpg.length)
    body.set(jpg, 33)
    const j = rec(0, 0x46b, 0xf01d, body)
    let img: { mime: string; bytes: Uint8Array } | null = null
    walkEscher(j, 0, j.length, (r) => { img = blipToImage(j, r) })
    expect(img!.mime).toBe('image/jpeg')
    expect(Array.from(img!.bytes)).toEqual(Array.from(jpg))
    const emf = rec(0, 0x3d4, 0xf01a, new Uint8Array(40))
    let none: unknown = 'x'
    walkEscher(emf, 0, emf.length, (r) => { none = blipToImage(emf, r) })
    expect(none).toBeNull()
  })
})

describe('xlsBiff — 파일 읽기', () => {
  it('.xlsx(압축) 파일은 구형이 아니므로 null', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a']]), 'S')
    const xlsx = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
    expect(isLegacyXls(xlsx)).toBe(false)
    expect(readBiffWorkbook(xlsx)).toBeNull()
  })

  it('실제로 만든 .xls 파일: 시트 이름·칸 서식(기본 글꼴·정렬)을 읽고 깨지지 않는다', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['제목', 1], ['값', 2]]), '시트1')
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['x']]), '시트2')
    const xls = XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer
    expect(isLegacyXls(xls)).toBe(true)
    const biff = readBiffWorkbook(xls)
    expect(biff).not.toBeNull()
    expect(biff!.sheets.map((s) => s.name)).toEqual(['시트1', '시트2'])
    expect(biff!.sheets.every((s) => !s.hidden)).toBe(true)
    const layout = biff!.layoutBySheet.get('시트1')!
    expect(layout.fonts.size).toBeGreaterThan(0)
    expect(layout.fonts.get('A1')?.name).toBeTruthy()
    expect(biff!.imagesBySheet.size).toBe(0)
  })
})

describe('xlsTextBoxes — 글상자 글자를 가까운 칸 값으로', () => {
  const blank = (r: number, c: number) => ({
    name: 'S', merges: [], colWidths: Array(c).fill(64),
    rows: Array.from({ length: r }, () => Array<string>(c).fill('')),
    cellFormatting: Array.from({ length: r }, () => Array.from({ length: c }, () => ({}))),
  })

  it('도형 영역의 가운데 칸에 글자를 넣고 가운데 정렬로 둔다', async () => {
    const { placeTextBoxes } = await import('$lib/utils/docImport/xlsTextBoxes')
    const { sheet, placed } = placeTextBoxes(blank(10, 10) as never, [{ text: '상호', col1: 2, row1: 2, col2: 6, row2: 4 }])
    expect(placed).toBe(1)
    expect(sheet.rows[3][4]).toBe('상호')
    expect(sheet.cellFormatting[3][4].textAlign).toBe('center')
  })

  it('가운데 칸에 값이 있으면 가까운 빈 칸에 넣고, 원래 값은 건드리지 않는다', async () => {
    const { placeTextBoxes } = await import('$lib/utils/docImport/xlsTextBoxes')
    const s = blank(10, 10)
    s.rows[3][4] = '기존'
    const { sheet } = placeTextBoxes(s as never, [{ text: '상호', col1: 2, row1: 2, col2: 6, row2: 4 }])
    expect(sheet.rows[3][4]).toBe('기존')
    expect(sheet.rows.flat().filter((v) => v === '상호')).toHaveLength(1)
  })

  it('병합 칸이면 병합의 앵커 칸에 넣는다', async () => {
    const { placeTextBoxes } = await import('$lib/utils/docImport/xlsTextBoxes')
    const s = { ...blank(10, 10), merges: [{ s: { r: 2, c: 2 }, e: { r: 4, c: 6 } }] }
    const { sheet } = placeTextBoxes(s as never, [{ text: '상호', col1: 2, row1: 2, col2: 6, row2: 4 }])
    expect(sheet.rows[2][2]).toBe('상호')
  })

  it('시트 범위를 벗어난 도형은 가장자리 칸으로 맞추고, 빈 칸이 없으면 건너뛴다', async () => {
    const { placeTextBoxes } = await import('$lib/utils/docImport/xlsTextBoxes')
    const { sheet } = placeTextBoxes(blank(3, 3) as never, [{ text: 'x', col1: 20, row1: 20, col2: 22, row2: 22 }])
    expect(sheet.rows[2][2]).toBe('x')
    const full = blank(1, 1)
    full.rows[0][0] = '꽉참'
    expect(placeTextBoxes(full as never, [{ text: 'y', col1: 0, row1: 0, col2: 0, row2: 0 }]).placed).toBe(0)
  })
})

describe('xlsBiff — 손상·악의적 입력에도 멈추거나 죽지 않는다', () => {
  function rec(ver: number, inst: number, type: number, body: Uint8Array): Uint8Array {
    const out = new Uint8Array(8 + body.length)
    const dv = new DataView(out.buffer)
    dv.setUint16(0, ver | (inst << 4), true)
    dv.setUint16(2, type, true)
    dv.setUint32(4, body.length, true)
    out.set(body, 8)
    return out
  }

  it('수십만 단계로 중첩된 Escher 컨테이너도 호출 스택을 넘지 않고 끝난다', () => {
    // 가장 안쪽부터 바깥으로 감싼 12단계짜리를 반복해 깊이 상한을 넘기는 입력을 만든다(바이트 수는 작게)
    let buf: Uint8Array = rec(2, 0, 0xf00a, new Uint8Array(8))
    for (let i = 0; i < 5000; i++) buf = rec(0xf, 0, 0xf004, buf)
    let count = 0
    expect(() => walkEscher(buf, 0, buf.length, () => { count++ })).not.toThrow()
    expect(count).toBeLessThanOrEqual(34) // 깊이 상한(32) 안쪽까지만 훑는다
  })

  it('선언 길이가 실제 데이터보다 훨씬 큰 레코드도 가진 범위까지만 읽는다', () => {
    const body = new Uint8Array(16)
    const r = new Uint8Array(8 + body.length)
    const dv = new DataView(r.buffer)
    dv.setUint16(0, 0x2, true); dv.setUint16(2, 0xf007, true); dv.setUint32(4, 0xfffffff0, true)
    r.set(body, 8)
    const seen: number[] = []
    expect(() => walkEscher(r, 0, r.length, (x) => seen.push(x.len))).not.toThrow()
    expect(seen[0]).toBeLessThanOrEqual(16)
  })

  it('서명만 맞고 내용이 엉터리인 .xls 는 예외 없이 null 또는 빈 결과', () => {
    const junk = new Uint8Array(4096)
    junk.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    let result: ReturnType<typeof readBiffWorkbook> | undefined
    expect(() => { result = readBiffWorkbook(junk.buffer) }).not.toThrow()
    expect(result === null || (result !== undefined && result.sheets.length === 0)).toBe(true)
  })

  it('실제 .xls 를 중간에서 잘라도 예외 없이 처리한다', () => {
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], ['c', 'd']]), 'S')
    const full = new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'biff8' }) as ArrayBuffer)
    for (const cut of [600, 2000, Math.floor(full.length / 2)]) {
      expect(() => readBiffWorkbook(full.slice(0, cut).buffer)).not.toThrow()
    }
  })
})
