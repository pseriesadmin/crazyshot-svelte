/**
 * spreadsheetRender.ts — SpreadsheetDocument → HTML 변환 유틸
 *
 * - renderTiptapDocToHtml()과 동일 원칙: DOM 미사용 순수 문자열 함수
 * - SSR·Node.js 환경에서도 동작
 * - 셀 텍스트는 반드시 HTML 이스케이프 후 렌더링(XSS 방지)
 * - 멀티 시트: 시트별 <div class="ss-sheet-page">로 래핑, 2번째 시트부터 page-break-before
 * - 병합: computeMergeLayout()으로 rowspan·colspan 계산
 * - 컬럼 너비: fitColumnWidthsToTarget()으로 A4 폭 축소 후 <colgroup>으로 지정
 * - 배경색·테두리색: CSS 색상 검증(#RRGGBB) 후 인라인 스타일로 삽입
 *
 * 사용처:
 *   - /contract/[token]/+page.svelte (고객 서명화면 — spreadsheet 모드)
 *   - ContractTemplatePreviewModal.svelte (발송 전 미리보기 — spreadsheet 모드)
 */

import type { SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import type { XlsxCellFormatting } from '$lib/types/sheet-format'
import { hasImageOverlay, splitCellImageOverlay } from '$lib/types/sheet-format'
import { computeMergeLayout } from '$lib/utils/docImport/xlsxImport'
import { fitColumnWidthsToTarget } from '$lib/utils/docImport/fitColumnWidths'

/** 이미지 셀 URL로 허용하는 형식 — http(s) 절대 URL만 (javascript: 등 스킴 인젝션 방지) */
const SAFE_IMAGE_URL = /^https?:\/\//i

// ─────────────────────────────────────────────────────────────────────────────
// XSS 방지 HTML 이스케이프
// ─────────────────────────────────────────────────────────────────────────────

/** 셀 텍스트를 HTML에 안전하게 삽입하기 위한 이스케이프 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS 색상 검증
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 인라인 스타일 삽입 전 CSS 색상 형식 검증(XSS/CSS 인젝션 방지).
 *
 * ⚠️ 2026-08-20: 기존엔 '#RRGGBB' 헥스만 허용했다 — .xlsx 임포트 경로(xlsxImport.ts
 * toHexColor)는 항상 헥스를 생성하지만, jspreadsheet-ce 네이티브 툴바로 지정한 색상은
 * getStyle()이 'rgb(r, g, b)' 형식 그대로 돌려준다(Production DB 직접 조회로 확인 —
 * cellFormatting에 backgroundColor:"rgb(38, 48, 64)"가 정상 저장돼 있음에도 이 정규식이
 * 헥스가 아니라는 이유로 매번 렌더링을 통째로 버리고 있었다). 셀 배경색이 고객 화면에서
 * 감쪽같이 사라지는 현상의 실제 원인 — rgb()/rgba() 형식도 함께 허용하도록 확장.
 */
const CSS_HEX_COLOR = /^#[0-9A-Fa-f]{6}$/
const CSS_RGB_COLOR = /^rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)$/

function isValidCssColor(color: string): boolean {
  return CSS_HEX_COLOR.test(color) || CSS_RGB_COLOR.test(color)
}

/** CSS font-weight 허용값만 통과 (숫자 100단위 또는 표준 키워드) */
const CSS_FONT_WEIGHT = /^(normal|bold|bolder|lighter|[1-9]00)$/i

function isValidFontWeight(value: string): boolean {
  return CSS_FONT_WEIGHT.test(value.trim())
}

/** jspreadsheet 툴바 키워드 크기 또는 단위 있는 숫자 크기만 통과 */
const CSS_FONT_SIZE = /^(xx-small|x-small|small|medium|large|x-large|xx-large|\d+(\.\d+)?(px|pt|em|rem))$/i

function isValidFontSize(value: string): boolean {
  return CSS_FONT_SIZE.test(value.trim())
}

/** jspreadsheet 정렬 툴바가 실제로 저장하는 4개 값만 허용 */
const CSS_TEXT_ALIGN = /^(left|center|right|justify)$/i

function isValidTextAlign(value: string): boolean {
  return CSS_TEXT_ALIGN.test(value.trim())
}

/**
 * jspreadsheet 글꼴 툴바가 실제로 제공하는 3개 값만 허용(2026-08-29 추가 — "Default" 선택
 * 시엔 애초에 빈 문자열이 저장되므로 이 필드 자체가 채워지지 않음, node_modules/jspreadsheet-ce
 * 직접 확인). "Courier New"처럼 값 안에 공백이 들어가는 폰트명도 있어 전체 문자열 allowlist로
 * 고정 매칭 — 임의 폰트명 인젝션 방지.
 */
const CSS_FONT_FAMILY = /^(Verdana|Arial|Courier New)$/i

function isValidFontFamily(value: string): boolean {
  return CSS_FONT_FAMILY.test(value.trim())
}

/** jspreadsheet 세로정렬 툴바가 실제로 저장하는 3개 값만 허용(2026-08-29 추가) */
const CSS_VERTICAL_ALIGN = /^(top|middle|bottom)$/i

function isValidVerticalAlign(value: string): boolean {
  return CSS_VERTICAL_ALIGN.test(value.trim())
}

/**
 * jspreadsheet 테두리 툴바가 border-top/right/bottom/left에 저장하는 "Npx 스타일 색상"
 * 형식만 허용(2026-08-28 추가). 예: "1px solid rgb(0, 0, 0)", "2px dashed #FF0000".
 *
 * 2026-08-28(같은 날 3차 후속): 순수 CSS 색상 키워드("black" 등)도 허용 —
 * 이미 사방 테두리가 있는 셀에 한 변만 툴바로 재지정하면 브라우저(CSSOM)가
 * border-color 축약형을 재직렬화하면서 새로 지정한 변만 'black' 같은 키워드로,
 * 나머지 변은 기존 'rgb(...)' 그대로 섞어서 돌려준다(실측 확인) — 문자만으로
 * 구성된 식별자라 콜론·괄호·세미콜론 등 인젝션에 쓰일 문자가 없어 안전.
 */
const CSS_BORDER_SIDE_VALUE =
  /^\d+(\.\d+)?px\s+(solid|dashed|dotted|double)\s+(#[0-9A-Fa-f]{6}|rgba?\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*(,\s*(0|1|0?\.\d+)\s*)?\)|[A-Za-z]{3,20})$/i

function isValidBorderSideValue(value: string): boolean {
  return CSS_BORDER_SIDE_VALUE.test(value.trim())
}

// ─────────────────────────────────────────────────────────────────────────────
// 셀 인라인 스타일 생성
// ─────────────────────────────────────────────────────────────────────────────

/** XlsxCellFormatting → 검증된 inline style 문자열 (빈 서식이면 '') */
function cellFormattingToStyle(fmt: XlsxCellFormatting): string {
  const parts: string[] = []
  if (fmt.backgroundColor && isValidCssColor(fmt.backgroundColor)) {
    parts.push(`background-color:${fmt.backgroundColor}`)
  }
  if (fmt.borderColor && isValidCssColor(fmt.borderColor)) {
    parts.push(`border:1px solid ${fmt.borderColor}`)
  }
  if (fmt.borderTop && isValidBorderSideValue(fmt.borderTop)) {
    parts.push(`border-top:${fmt.borderTop}`)
  }
  if (fmt.borderRight && isValidBorderSideValue(fmt.borderRight)) {
    parts.push(`border-right:${fmt.borderRight}`)
  }
  if (fmt.borderBottom && isValidBorderSideValue(fmt.borderBottom)) {
    parts.push(`border-bottom:${fmt.borderBottom}`)
  }
  if (fmt.borderLeft && isValidBorderSideValue(fmt.borderLeft)) {
    parts.push(`border-left:${fmt.borderLeft}`)
  }
  if (fmt.color && isValidCssColor(fmt.color)) {
    parts.push(`color:${fmt.color}`)
  }
  if (fmt.fontWeight && isValidFontWeight(fmt.fontWeight)) {
    parts.push(`font-weight:${fmt.fontWeight}`)
  }
  if (fmt.fontSize && isValidFontSize(fmt.fontSize)) {
    parts.push(`font-size:${fmt.fontSize}`)
  }
  if (fmt.fontFamily && isValidFontFamily(fmt.fontFamily)) {
    parts.push(`font-family:${fmt.fontFamily}`)
  }
  if (fmt.textAlign && isValidTextAlign(fmt.textAlign)) {
    parts.push(`text-align:${fmt.textAlign}`)
  }
  if (fmt.verticalAlign && isValidVerticalAlign(fmt.verticalAlign)) {
    parts.push(`vertical-align:${fmt.verticalAlign}`)
  }
  return parts.join(';')
}

// ─────────────────────────────────────────────────────────────────────────────
// 단일 시트 → HTML <table>
// ─────────────────────────────────────────────────────────────────────────────

function renderSheetToTable(sheet: SpreadsheetSheet): string {
  const { rows, merges, colWidths, cellFormatting } = sheet

  if (rows.length === 0) return '<table class="ss-table"><tbody></tbody></table>'

  const { coveredCells, anchorSpan } = computeMergeLayout(merges)
  const fittedWidths = fitColumnWidthsToTarget(colWidths)
  const colCount = rows[0]?.length ?? 0

  // 컬럼별 A4 축소 비율 — fitColumnWidthsToTarget()이 컬럼 폭만 축소하고 셀 내부의
  // 이미지 오버레이(서명/직인) 폭은 그대로 두면, 컬럼이 좁아질수록 이미지가 셀 경계를
  // 넘어 인접 셀을 침범해 "계약서 틀이 틀어져 보이는" 결함으로 이어졌다(2026-08-19
  // Stage 실측: colWidths 500px→렌더 214px인데 오버레이 이미지는 400px 그대로 렌더).
  // 컬럼별로 실제 적용된 축소 비율(fitted/original)을 구해 오버레이 이미지 폭에도
  // 동일하게 곱한다 — offsetX/offsetY(셀 중앙 기준 위치)는 의도적으로 스케일하지 않음
  // (splitCellImageOverlay 주석 — "셀 크기가 나중에 바뀌어도 위치 감각이 유지되도록"
  // 설계된 값이라 폭 축소와는 별개로 그대로 둔다).
  const colScales: number[] = colWidths.map((w, i) => {
    const fitted = fittedWidths[i]
    return typeof w === 'number' && w > 0 && typeof fitted === 'number' && fitted > 0
      ? fitted / w
      : 1
  })

  // <colgroup> — 컬럼 너비 지정
  const colgroupParts: string[] = ['<colgroup>']
  for (let c = 0; c < colCount; c++) {
    const w = fittedWidths[c]
    if (typeof w === 'number' && w > 0) {
      colgroupParts.push(`<col style="width:${w}px">`)
    } else {
      colgroupParts.push('<col>')
    }
  }
  colgroupParts.push('</colgroup>')

  // <tbody> — 각 행·셀 렌더링
  const tbodyParts: string[] = ['<tbody>']
  rows.forEach((row, rowIdx) => {
    tbodyParts.push('<tr>')
    row.forEach((cellText, colIdx) => {
      const key = `${rowIdx}:${colIdx}`
      if (coveredCells.has(key)) return // 병합에 덮인 셀: 스킵

      const span = anchorSpan.get(key)
      const attrs: string[] = []
      if (span && span.rowspan > 1) attrs.push(`rowspan="${span.rowspan}"`)
      if (span && span.colspan > 1) attrs.push(`colspan="${span.colspan}"`)

      // 이미지 오버레이(서명/직인) — 원본 텍스트는 유지하고 그 위에 <img>를 절대위치로
      // 겹쳐 그린다(도장을 인쇄된 텍스트 위에 찍는 개념). 절대위치의 기준(containing block)
      // 이 되려면 <td> 자체가 position:relative여야 하므로, 오버레이가 있을 때만 스타일에
      // 추가한다. offsetX/offsetY는 CMS 에디터에서 드래그로 옮긴 위치(셀 중앙 기준 px) —
      // 고객 화면도 그 최종 위치 그대로 반영해야 하므로 transform에 함께 반영한다
      // (CSS 클래스 .ss-cell-image의 기본 translate(-50%,-50%)를 인라인으로 덮어씀).
      let displayText = cellText
      let overlayHtml = ''
      let overlaySpacerHtml = ''
      if (hasImageOverlay(cellText)) {
        const { text, imageUrl, width, offsetX, offsetY } = splitCellImageOverlay(cellText)
        displayText = text
        // 방어적 검증 — http(s) 절대 URL이 아니면(예: 손상된 값) 이미지로 그리지 않고
        // 마커 원문을 그대로 이스케이프해 표시(마커 문자열이 그대로 보여도 안전이 우선).
        if (imageUrl && SAFE_IMAGE_URL.test(imageUrl)) {
          // ContractDocumentEditor.svelte 너비 입력(min 20 / max 1200)과 동일 범위로 clamp
          // — colScales[colIdx]로 컬럼 축소 비율을 먼저 반영한 뒤 clamp (컬럼이 A4 폭에
          // 맞춰 축소됐는데 이미지만 원본 크기 그대로면 셀 경계를 넘어 침범하는 결함 방지)
          const safeWidth = Math.min(1200, Math.max(20, Math.round(width * (colScales[colIdx] ?? 1))))
          const transform = `translate(calc(-50% + ${offsetX}px), calc(-50% + ${offsetY}px))`
          overlayHtml = `<img src="${escapeHtml(imageUrl)}" alt="서명/직인" class="ss-cell-image" style="width:${safeWidth}px;transform:${transform}" />`
          // 행 높이 보완(2026-08-19) — 컬럼 폭에 맞춰 이미지 폭은 축소했지만(위 safeWidth),
          // <tr>은 rowHeights 저장값 자체가 없어(SpreadsheetSheet 스키마 참고) 항상 텍스트
          // 콘텐츠 기준 auto-height다. 오버레이 이미지는 position:absolute라 정상 흐름에서
          // 빠져 있어 아무리 커도 행 높이를 넓히지 못하고, 그 결과 이미지가 아래·위 행까지
          // 침범해 보이는 문제가 축소 후에도 남아있었다(Stephen 실사용 재현).
          // ⚠️ 1차 시도(min-height를 <td> 인라인 스타일에 부여)는 실패 — <td>는
          // display:table-cell이라 CSS 테이블 레이아웃 알고리즘상 min-height가 행 높이
          // 계산에 반영되지 않는 잘 알려진 브라우저 동작(Stage 실측: computedMinHeight는
          // 171px로 정상 파싱되지만 실제 렌더 높이는 34.6px 그대로 — min-height 완전 무시).
          // 대신 절대위치가 아닌 "정상 흐름(normal flow)"에 참여하는 투명 스페이서 요소를
          // 셀 안에 함께 넣는다 — 일반 콘텐츠 기반 높이 계산은 테이블 셀에서도 항상
          // 정상 동작하므로(보이는 <img>가 원래 행을 늘리는 것과 동일 원리), 이 스페이서의
          // height만큼 행이 확실히 늘어난다. 이미지 자체 종횡비(원본 폭/높이)는 서버에서
          // 알 수 없어 정확한 높이 값은 아니지만, 서명/직인 자산은 대체로 정사각형에
          // 가까워 safeWidth를 안전한 근사 상한으로 사용(가로 스케일과 동일 원칙 유지).
          overlaySpacerHtml = `<span aria-hidden="true" style="display:block;width:1px;height:${safeWidth}px"></span>`
        } else {
          displayText = cellText
        }
      }

      // 인라인 스타일 (배경색·테두리색 + 오버레이 있을 때 position:relative)
      const fmt = cellFormatting[rowIdx]?.[colIdx] ?? {}
      const styleParts = [cellFormattingToStyle(fmt)].filter(Boolean)
      if (overlayHtml) styleParts.push('position:relative')
      const styleStr = styleParts.join(';')
      if (styleStr) attrs.push(`style="${styleStr}"`)

      const attrStr = attrs.length > 0 ? ' ' + attrs.join(' ') : ''
      const cellHtml = escapeHtml(displayText) + overlayHtml + overlaySpacerHtml
      tbodyParts.push(`<td${attrStr}>${cellHtml}</td>`)
    })
    tbodyParts.push('</tr>')
  })
  tbodyParts.push('</tbody>')

  return `<table class="ss-table">${colgroupParts.join('')}${tbodyParts.join('')}</table>`
}

// ─────────────────────────────────────────────────────────────────────────────
// SpreadsheetDocument → HTML (공개 API)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * SpreadsheetDocument를 계약서 렌더링용 HTML 문자열로 변환한다.
 *
 * 멀티 시트는 각 시트를 `<div class="ss-sheet-page">` 로 래핑하고,
 * 2번째 시트부터 `page-break-before:always` 스타일을 추가한다.
 * 각 시트 앞에는 시트 이름 `<h4 class="ss-sheet-name">` 제목이 붙는다.
 *
 * 셀 텍스트는 모두 HTML 이스케이프 처리됨 (XSS 안전).
 * 배경색·테두리색은 #RRGGBB 형식만 인라인 스타일로 허용 (그 외 값은 무시).
 */
export function renderSpreadsheetToHtml(doc: SpreadsheetDocument): string {
  if (doc.sheets.length === 0) return ''

  const sheetParts: string[] = []

  doc.sheets.forEach((sheet, idx) => {
    const pageBreak = idx > 0 ? ' style="page-break-before:always"' : ''
    const safeName = escapeHtml(sheet.name)
    const tableHtml = renderSheetToTable(sheet)
    sheetParts.push(
      `<div class="ss-sheet-page"${pageBreak}>` +
        `<h4 class="ss-sheet-name">${safeName}</h4>` +
        tableHtml +
        `</div>`,
    )
  })

  return sheetParts.join('')
}
