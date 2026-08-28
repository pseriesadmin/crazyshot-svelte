/**
 * spreadsheetWidgetAdapter.ts — SpreadsheetSheet ↔ jspreadsheet-ce 설정 변환
 *
 * SpreadsheetDocument(자체 스키마)를 jspreadsheet-ce 위젯 설정으로 변환(sheetToWorksheetConfig)하고,
 * 위젯에서 편집된 데이터를 다시 SpreadsheetSheet 형식으로 읽어오는(worksheetConfigToSheet)
 * 순수 변환 어댑터.
 *
 * DOM 미사용 — XLSX.utils.encode_cell/decode_cell은 순수 산술 함수.
 * jspreadsheet-ce는 ContractSpreadsheetEditor.svelte의 onMount 내부에서만 동적 import됨.
 * 이 파일은 jspreadsheet-ce를 import하지 않아 SSR 번들에 포함되지 않는다.
 */

import * as XLSX from 'xlsx'
import type { SpreadsheetSheet } from '$lib/types/contract-document'
import type { SheetMergeRange, XlsxCellFormatting } from '$lib/types/sheet-format'

// ─────────────────────────────────────────────────────────────────────────────
// jspreadsheet-ce API duck-type 인터페이스 (런타임 import 없음)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * worksheetConfigToSheet()에서 사용하는 WorksheetInstance 메서드만 duck-type으로 정의.
 * jspreadsheet-ce를 직접 import하지 않아도 타입 안전성을 유지한다.
 */
export interface JssWorksheetInstance {
  /** 전체 셀 데이터를 2D 배열로 반환 */
  getData(): (string | number | boolean)[][]
  /** 병합 정보 전체(인수 없음)를 "셀주소→[colspan, rowspan]" 레코드로 반환 */
  getMerge(): Record<string, [number, number]>
  /** 전체 셀 스타일을 "셀주소→CSS 문자열" 레코드로 반환 */
  getStyle(): Record<string, string>
  /** 전체 컬럼 너비 배열 반환 */
  getWidth(): (number | string)[]
  /** 현재 선택 범위 좌표 [좌상단x, 좌상단y, 우하단x, 우하단y] */
  getSelection(): [number, number, number, number]
  /** 좌표로 셀 값 조회 */
  getValueFromCoords(x: number, y: number): string | number | boolean | null
  /** 좌표로 셀 값 설정 */
  setValueFromCoords(x: number, y: number, value: string | number | boolean): void
  /** 컬럼 너비 지정 — "A4 용지 맞춤" 보조도구(ContractSpreadsheetEditor.svelte)에서 사용 */
  setWidth(column: number, width: number): void
}

/**
 * sheetToWorksheetConfig()의 반환 타입 — jspreadsheet-ce에 전달하는 워크시트 설정.
 * 실제 WorksheetOptions의 부분 집합으로 구조적으로 호환된다.
 */
export interface JssWorksheetConfig {
  worksheetName: string
  data: string[][]
  columns: { width: number }[]
  mergeCells: Record<string, [number, number]>
  style: Record<string, string>
  tableOverflow: boolean
  tableWidth: string
}

// ─────────────────────────────────────────────────────────────────────────────
// 병합 좌표 ↔ 셀 주소 변환 (SheetMergeRange ↔ jss mergeCells 포맷)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SheetMergeRange[] → jspreadsheet-ce mergeCells 레코드.
 * 각 병합의 좌상단(anchor) {r, c}를 XLSX.utils.encode_cell로 "A1" 형식으로 변환한다.
 */
export function mergesToJss(merges: SheetMergeRange[]): Record<string, [number, number]> {
  const result: Record<string, [number, number]> = {}
  for (const m of merges) {
    if (m.e.r < m.s.r || m.e.c < m.s.c) continue // 비정상 범위 스킵
    const addr = XLSX.utils.encode_cell({ r: m.s.r, c: m.s.c })
    const colspan = m.e.c - m.s.c + 1
    const rowspan = m.e.r - m.s.r + 1
    result[addr] = [colspan, rowspan]
  }
  return result
}

/**
 * jspreadsheet-ce getMerge() 레코드 → SheetMergeRange[].
 * 셀 주소 "A1"를 XLSX.utils.decode_cell로 {r, c}로 역변환하고 end 좌표를 계산한다.
 */
export function jssMergesToSheet(
  mergeRecord: Record<string, [number, number]>,
): SheetMergeRange[] {
  return Object.entries(mergeRecord).map(([addr, [colspan, rowspan]]) => {
    const { r, c } = XLSX.utils.decode_cell(addr)
    return {
      s: { r, c },
      e: { r: r + rowspan - 1, c: c + colspan - 1 },
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// XlsxCellFormatting ↔ CSS 문자열 (jspreadsheet-ce style 레코드 형식)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * XlsxCellFormatting → CSS 문자열 (비어 있으면 '' 반환)
 *
 * 2026-08-20: color/fontWeight/fontSize 3개 필드 추가 — jspreadsheet-ce 네이티브 툴바의
 * 글자색(k:"color")·굵게(font-weight:bold)·글자크기(font-size) 버튼이 실제로 적용하는
 * CSS 프로퍼티와 동일한 이름이다(node_modules/jspreadsheet-ce/dist/index.js 툴바 정의
 * 직접 확인). 이 필드들이 없던 이전에는 getStyle()로 읽은 CSS에 이 프로퍼티가 포함돼
 * 있어도 cssToFormatting()이 통째로 버려 — 저장 후 재로드하면 배경색만 남고 글자색·
 * 굵기·크기는 매번 소실됐다(실사용 계약서에서 어두운 배경 위 글자색이 기본값으로
 * 되돌아가 판독 불가 상태가 되는 것으로 확인).
 *
 * 2026-08-28: text-align 필드 추가 — 정렬 툴바(좌/가운데/우/양쪽정렬)로 지정한 값도
 * 동일한 이유로 저장 시 통째로 유실되고 있었다(CMS 실사용 중 발견 — 저장 후 재오픈하면
 * 정렬이 항상 기본값(가운데)으로 되돌아감).
 *
 * 2026-08-28(같은 날 후속): border-top/right/bottom/left 4개 필드 추가 — 테두리 툴바
 * (사방/외곽/안쪽/가로/세로/선 스타일 등)로 지정한 값도 동일한 이유로 유실되고 있었다.
 * 기존 borderColor(사방 통일 "border: 1px solid X" shorthand — .xlsx 임포트 전용 경로)는
 * 하위호환을 위해 그대로 유지, 신규 4필드와 별개로 함께 출력된다.
 */
function formattingToCss(fmt: XlsxCellFormatting): string {
  const parts: string[] = []
  if (fmt.backgroundColor) parts.push(`background-color: ${fmt.backgroundColor}`)
  if (fmt.borderColor) parts.push(`border: 1px solid ${fmt.borderColor}`)
  if (fmt.borderTop) parts.push(`border-top: ${fmt.borderTop}`)
  if (fmt.borderRight) parts.push(`border-right: ${fmt.borderRight}`)
  if (fmt.borderBottom) parts.push(`border-bottom: ${fmt.borderBottom}`)
  if (fmt.borderLeft) parts.push(`border-left: ${fmt.borderLeft}`)
  if (fmt.color) parts.push(`color: ${fmt.color}`)
  if (fmt.fontWeight) parts.push(`font-weight: ${fmt.fontWeight}`)
  if (fmt.fontSize) parts.push(`font-size: ${fmt.fontSize}`)
  if (fmt.textAlign) parts.push(`text-align: ${fmt.textAlign}`)
  return parts.join('; ')
}

/**
 * CSS 값 목록을 공백 기준으로 분리 — rgb()/rgba() 내부의 쉼표·공백은 분리하지 않는다
 * (괄호 depth를 추적해 함수값 내부 공백은 하나의 토큰으로 유지).
 */
function splitCssValueList(value: string): string[] {
  const tokens: string[] = []
  let depth = 0
  let current = ''
  for (const ch of value.trim()) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ' ' && depth === 0) {
      if (current) {
        tokens.push(current)
        current = ''
      }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

/** CSS box-model 축약형(1~4개 값) → [top, right, bottom, left] */
function expandBoxValues(tokens: string[]): [string, string, string, string] {
  if (tokens.length === 1) return [tokens[0], tokens[0], tokens[0], tokens[0]]
  if (tokens.length === 2) return [tokens[0], tokens[1], tokens[0], tokens[1]]
  if (tokens.length === 3) return [tokens[0], tokens[1], tokens[2], tokens[1]]
  if (tokens.length >= 4) return [tokens[0], tokens[1], tokens[2], tokens[3]]
  return ['', '', '', '']
}

/**
 * CSS 문자열 → XlsxCellFormatting
 *
 * ⚠️ "color:" 정규식은 "background-color:"의 부분 문자열이기도 하므로, 문자열 시작 또는
 * 세미콜론 직후에 오는 "color:"만 매칭하도록 (?:^|;)\s* 앵커를 둔다 — 앵커 없이 매칭하면
 * background-color 값이 fmt.color로도 잘못 이중 추출된다.
 *
 * 2026-08-28(같은 날 3차 후속) — border-width/border-style/border-color 축약형(box-model
 * 1~4값) 폴백 추가. 이미 사방 테두리("border: 1px solid X")가 있는 셀에 테두리 툴바로
 * 특정 한 변만 다시 지정하면, 브라우저(CSSOM)가 그 결과를 "border-top: ...;" 같은 단일
 * 선언이 아니라 border-width/border-style/border-color 3개 축약 선언(변마다 값이 다르면
 * 공백구분 2~4개 값)으로 자동 재직렬화한다 — 실사용 브라우저 자동화 검증으로 직접 확인된
 * 동작(jspreadsheet-ce가 cell.style.cssText를 그대로 getStyle()에 반영). 기존
 * border-top:/border-right:/... 단일 선언 매칭만으로는 이 형태를 전혀 못 읽어 테두리가
 * 저장 후 재오픈 시 통째로 유실됐다 — 이미 있던 통일 테두리까지 함께 사라지는 회귀였음.
 *
 * 2026-08-29 — 통일 border shorthand의 non-solid 스타일 유실 수정. 테두리 툴바에서
 * 두께·선스타일(점선/파선/이중선)을 먼저 지정한 뒤 사방 패턴(border_all 등 4변 동일값)을
 * 적용하면, 4변이 전부 같은 값이라 브라우저가 굳이 box-model 축약형(위 폴백)으로 안 쪼개고
 * "border: 3px dashed black" 같은 단일 border shorthand로 직렬화한다 — Stephen 실사용
 * 재현(launch-selected-element로 border 피커의 두께·점선/파선 서브컨트롤 직접 확인).
 * 기존 정규식(borderMatch)은 "solid" 리터럴을 필수로 요구해 dashed/dotted/double 값이
 * 오면 아예 매칭되지 않아 통째로 유실됐다 — 아래 unifiedBorderMatch가 스타일 무관하게
 * 폭·스타일·색상을 전부 캡처해 4변 모두에 반영한다(레거시 borderColor는 폭·스타일 정보를
 * "1px solid"로 고정 렌더링하는 한계가 있어 유지하되, 실제 렌더링은 이 4변 필드가 있으면
 * 더 구체적인 선언으로 뒤에서 덮어써 정확한 값으로 표시된다 — spreadsheetRender.ts 참고).
 */
function cssToFormatting(css: string): XlsxCellFormatting {
  const fmt: XlsxCellFormatting = {}
  const bgMatch = css.match(/background-color:\s*([^;]+)/i)
  if (bgMatch) fmt.backgroundColor = bgMatch[1].trim()
  const borderMatch = css.match(/border:[^;]*\bsolid\s+([^;]+)/i)
  if (borderMatch) fmt.borderColor = borderMatch[1].trim()
  const unifiedBorderMatch = css.match(
    /(?:^|;)\s*border:\s*(\d+(?:\.\d+)?px)\s+(solid|dashed|dotted|double)\s+([^;]+)/i,
  )
  const colorMatch = css.match(/(?:^|;)\s*color:\s*([^;]+)/i)
  if (colorMatch) fmt.color = colorMatch[1].trim()
  const weightMatch = css.match(/font-weight:\s*([^;]+)/i)
  if (weightMatch) fmt.fontWeight = weightMatch[1].trim()
  const sizeMatch = css.match(/font-size:\s*([^;]+)/i)
  if (sizeMatch) fmt.fontSize = sizeMatch[1].trim()
  const alignMatch = css.match(/(?:^|;)\s*text-align:\s*([^;]+)/i)
  if (alignMatch) fmt.textAlign = alignMatch[1].trim()
  const borderTopMatch = css.match(/(?:^|;)\s*border-top:\s*([^;]+)/i)
  if (borderTopMatch) fmt.borderTop = borderTopMatch[1].trim()
  const borderRightMatch = css.match(/(?:^|;)\s*border-right:\s*([^;]+)/i)
  if (borderRightMatch) fmt.borderRight = borderRightMatch[1].trim()
  const borderBottomMatch = css.match(/(?:^|;)\s*border-bottom:\s*([^;]+)/i)
  if (borderBottomMatch) fmt.borderBottom = borderBottomMatch[1].trim()
  const borderLeftMatch = css.match(/(?:^|;)\s*border-left:\s*([^;]+)/i)
  if (borderLeftMatch) fmt.borderLeft = borderLeftMatch[1].trim()

  const boxWidthMatch = css.match(/(?:^|;)\s*border-width:\s*([^;]+)/i)
  const boxStyleMatch = css.match(/(?:^|;)\s*border-style:\s*([^;]+)/i)
  const boxColorMatch = css.match(/(?:^|;)\s*border-color:\s*([^;]+)/i)
  if (boxWidthMatch || boxStyleMatch || boxColorMatch) {
    const widths = expandBoxValues(
      boxWidthMatch ? splitCssValueList(boxWidthMatch[1]) : ['1px'],
    )
    const styles = expandBoxValues(
      boxStyleMatch ? splitCssValueList(boxStyleMatch[1]) : ['solid'],
    )
    const colors = expandBoxValues(
      boxColorMatch ? splitCssValueList(boxColorMatch[1]) : ['currentColor'],
    )
    const sides: Array<['borderTop' | 'borderRight' | 'borderBottom' | 'borderLeft', number]> = [
      ['borderTop', 0],
      ['borderRight', 1],
      ['borderBottom', 2],
      ['borderLeft', 3],
    ]
    for (const [key, idx] of sides) {
      if (!fmt[key]) {
        fmt[key] = `${widths[idx]} ${styles[idx]} ${colors[idx]}`.trim()
      }
    }
  }

  if (unifiedBorderMatch) {
    const full = `${unifiedBorderMatch[1]} ${unifiedBorderMatch[2]} ${unifiedBorderMatch[3].trim()}`
    if (!fmt.borderTop) fmt.borderTop = full
    if (!fmt.borderRight) fmt.borderRight = full
    if (!fmt.borderBottom) fmt.borderBottom = full
    if (!fmt.borderLeft) fmt.borderLeft = full
  }

  return fmt
}

// ─────────────────────────────────────────────────────────────────────────────
// 주 변환 함수
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SpreadsheetSheet → jspreadsheet-ce 워크시트 설정.
 *
 * - colWidths: sheet.colWidths를 그대로 사용(재계산 없음) — A4 폭(642px) 자동축소는
 *   xlsx 최초 가져오기 시점(xlsxImport.ts parseSheet)에 1회만 적용된다. 여기서 매번
 *   다시 축소하면 관리자가 A4 폭보다 넓게 직접 조정해 저장한 값이 재오픈할 때마다
 *   조용히 되돌아가는 문제가 있었다(2026-08-27 실사용 중 발견 — "수정 저장 후 재오픈해도
 *   여전히 이상한 폭으로 열림"). A4 폭 유지가 필요하면 "A4 용지 맞춤" 버튼(수동)을 사용.
 * - merges: SheetMergeRange[] → 셀 주소 키 Record
 * - cellFormatting: [행][열] → "셀주소→CSS 문자열" Record
 */
export function sheetToWorksheetConfig(sheet: SpreadsheetSheet): JssWorksheetConfig {
  const columns: { width: number }[] = sheet.colWidths.map((w) => ({
    width: typeof w === 'number' && w > 0 ? w : 100,
  }))

  const mergeCells = mergesToJss(sheet.merges)

  const style: Record<string, string> = {}
  sheet.cellFormatting.forEach((rowFmts, rowIdx) => {
    rowFmts.forEach((fmt, colIdx) => {
      const css = formattingToCss(fmt)
      if (css) {
        const addr = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx })
        style[addr] = css
      }
    })
  })

  return {
    worksheetName: sheet.name,
    data: sheet.rows,
    columns,
    mergeCells,
    style,
    // ⛔ 2026-08-28 tableOverflow:true(+tableWidth:'100%') 폐기 — 이 옵션이 켜지면
    // jspreadsheet-ce가 `.jss_content`에 자체 overflow-x:auto를 걸어 가로 스크롤 전용
    // 내부 래퍼를 만드는데, CSS 스펙상 overflow-x가 'visible'이 아니면 overflow-y도
    // 자동으로 'auto'가 되어(브라우저 강제 계산값, 우회 불가) `.jss_content`가 세로축
    // 에서도 "스크롤 컨테이너"로 취급된다. 정작 세로 스크롤은 그 바깥의
    // `.spreadsheet-container`(ContractSpreadsheetEditor.svelte)가 담당하는데
    // `.jss_content` 자신은 실제로 세로로 스크롤되는 일이 없어(내용 높이만큼 그대로
    // 늘어남), 그 안의 thead td에 건 position:sticky의 top이 전혀 고정되지 않고
    // 콘텐츠와 함께 흘러가버리는 문제(스크롤 시 열 문자 기준자 바가 페이지 중간에
    // "떠 있는" 것처럼 보임 — Stephen 실사용 중 발견·재현)로 이어졌다. tableOverflow를
    // 꺼서(기본값 false) 이 내부 래퍼 자체를 만들지 않으면, 가로 스크롤도 세로 스크롤과
    // 동일하게 바깥 `.spreadsheet-container`(CSS overflow:auto — 원래도 양축 모두 처리
    // 가능) 하나가 전담하게 되어 sticky의 "가장 가까운 스크롤 조상"이 항상 올바른
    // 컨테이너로 일치한다 — 별도 JS 보정(translateY 트릭) 없이 순수 CSS만으로 해결.
    tableOverflow: false,
    // tableOverflow가 false면 jspreadsheet-ce는 tableWidth를 아예 읽지 않는다(source 확인:
    // `tableOverflow&&(...&&tableWidth&&(...))` 형태로 tableOverflow 뒤에 묶여있음) — 값은
    // 이제 무의미하지만 JssWorksheetConfig 타입이 필수 필드로 요구해 형식상 유지한다.
    tableWidth: '100%',
  }
}

/**
 * WorksheetInstance → SpreadsheetSheet.
 *
 * 편집 완료된 jspreadsheet-ce 위젯에서 자체 스키마로 데이터를 읽어온다.
 * getData()/getMerge()/getStyle()/getWidth() API를 순서대로 호출한다.
 */
export function worksheetConfigToSheet(
  name: string,
  ws: JssWorksheetInstance,
): SpreadsheetSheet {
  const rawData = ws.getData()
  const rows: string[][] = rawData.map((row) =>
    row.map((cell) => (cell == null ? '' : String(cell))),
  )

  const rowCount = rows.length
  const colCount = rows[0]?.length ?? 0

  const mergeRecord = ws.getMerge()
  const merges = jssMergesToSheet(mergeRecord ?? {})

  const rawWidths = ws.getWidth()
  const colWidths: (number | null)[] = Array.from({ length: colCount }, (_, i) => {
    const w = rawWidths[i]
    if (typeof w === 'number') return w > 0 ? w : null
    if (typeof w === 'string') {
      const n = parseInt(w, 10)
      return !isNaN(n) && n > 0 ? n : null
    }
    return null
  })

  const styleRecord = ws.getStyle()

  const cellFormatting: XlsxCellFormatting[][] = Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: colCount }, (_, c) => {
      const addr = XLSX.utils.encode_cell({ r, c })
      const css = styleRecord[addr]
      return css ? cssToFormatting(css) : {}
    }),
  )

  return { name, rows, merges, colWidths, cellFormatting }
}
