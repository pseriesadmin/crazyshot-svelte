import type { ContentBlock } from '$lib/types/content-editor'
import type { TiptapDocBlock, SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import type { ContractSubstitutionData, ContractLineItem } from '$lib/types/contract-module'
import type { SheetMergeRange } from '$lib/types/sheet-format'
import { substituteTiptapDoc } from '$lib/utils/tiptapRender'
import { escapeHtml } from '$lib/utils/spreadsheetRender'

// ─────────────────────────────────────────────────────────────────────────────
// 스칼라 치환 (배열 필드 스킵 — 반복 영역에서 별도 처리)
// ─────────────────────────────────────────────────────────────────────────────

function applySubstitution(text: string, data: ContractSubstitutionData): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim() as keyof ContractSubstitutionData
    const value = data[trimmed]
    // 스칼라(string)만 1:1 치환 — 배열(상품목록 등 반복영역 전용)은 Stage 2에서 별도 처리
    if (typeof value === 'string') return value
    return match
  })
}

/**
 * 반복영역 잉여 슬롯(미리 준비된 템플릿 행 수가 실제 항목 수보다 많을 때, 항목이 없는
 * 나머지 행)의 변수 자리를 공백으로 치환한다 — 2026-09-03, Stephen 확정: "항목 수만큼만
 * 반영하고 나머지 빈 반복 셀은 그냥 비워두면 된다". 이전 항목의 값이 남거나 {{}} 원문이
 * 그대로 노출되는 것을 방지한다.
 */
function blankVariables(text: string): string {
  return text.replace(/\{\{[^}]+\}\}/g, '')
}

// ─────────────────────────────────────────────────────────────────────────────
// 항목별 치환 (반복 영역 전용)
// 1순위: ContractLineItem 필드(상품명·상품코드·수량·금액·비고)
// 2순위: 스칼라 폴백 (applySubstitution)
// ─────────────────────────────────────────────────────────────────────────────

function applyItemSubstitution(
  text: string,
  item: ContractLineItem,
  data: ContractSubstitutionData,
): string {
  // 1순위: 항목 필드 치환
  const withItem = text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim() as keyof ContractLineItem
    const value = item[trimmed]
    if (value !== undefined && typeof value === 'string') return value
    return match // 항목 필드에 없으면 원문 유지 → 2순위로 넘김
  })
  // 2순위: 스칼라 폴백
  return applySubstitution(withItem, data)
}

// ─────────────────────────────────────────────────────────────────────────────
// 병합 범위 처리
// ─────────────────────────────────────────────────────────────────────────────

/**
 * repeatRegion 확장에 따라 merges 배열을 재계산한다.
 * - before region: 유지
 * - within region: 각 항목 행(startRow + i)에 인트라-행 span 복제 (cross-row merge는 드롭)
 * - after region: rowDelta(N - T) 만큼 행 인덱스 이동
 */
function expandMerges(
  merges: SheetMergeRange[],
  startRow: number,
  endRow: number,
  N: number,
  T: number,
): SheetMergeRange[] {
  const rowDelta = N - T
  const result: SheetMergeRange[] = []

  for (const merge of merges) {
    if (merge.e.r < startRow) {
      // ── before region: 변경 없음
      result.push(merge)
    } else if (merge.s.r > endRow) {
      // ── after region: 행 인덱스 보정
      result.push({
        s: { r: merge.s.r + rowDelta, c: merge.s.c },
        e: { r: merge.e.r + rowDelta, c: merge.e.c },
      })
    } else {
      // ── within region: 각 항목 행에 복제
      // 템플릿 안에서의 행 오프셋 (0-indexed)
      const templateRow = merge.s.r - startRow
      // cross-row merge (행을 넘는 병합)는 무시 — 단일 행 colspan만 복제
      const rowSpan = merge.e.r - merge.s.r
      for (let i = 0; i < N; i++) {
        // 이 항목이 이 템플릿 행을 사용하는가?
        if (Math.min(i, T - 1) === templateRow) {
          result.push({
            s: { r: startRow + i, c: merge.s.c },
            e: { r: startRow + i + rowSpan, c: merge.e.c },
          })
        }
      }
    }
  }

  return result
}

// ─────────────────────────────────────────────────────────────────────────────
// 시트 단위 확장
// ─────────────────────────────────────────────────────────────────────────────

function expandSheet(sheet: SpreadsheetSheet, data: ContractSubstitutionData): SpreadsheetSheet {
  const { repeatRegion } = sheet
  const items = data.상품목록

  // ── repeatRegion 없거나 items 미정의: 기존 1:1 스칼라 치환 동작 유지 ──────
  if (!repeatRegion || items === undefined) {
    return {
      ...sheet,
      rows: sheet.rows.map((row) => row.map((cell) => applySubstitution(cell, data))),
    }
  }

  const { startRow, endRow } = repeatRegion
  const T = endRow - startRow + 1 // 템플릿 행 수
  const N = items.length           // 항목 수 (0 포함)

  // ── 행·서식 분리 ─────────────────────────────────────────────────────────
  const beforeRows = sheet.rows.slice(0, startRow)
  const templateRows = sheet.rows.slice(startRow, endRow + 1)
  const afterRows = sheet.rows.slice(endRow + 1)

  const beforeFmt = sheet.cellFormatting.slice(0, startRow)
  const templateFmt = sheet.cellFormatting.slice(startRow, endRow + 1)
  const afterFmt = sheet.cellFormatting.slice(endRow + 1)

  // ── before / after 스칼라 치환 ──────────────────────────────────────────
  const substitutedBefore = beforeRows.map((row) => row.map((cell) => applySubstitution(cell, data)))
  const substitutedAfter = afterRows.map((row) => row.map((cell) => applySubstitution(cell, data)))

  // ── 항목수(N) ≤ 템플릿행수(T): 템플릿 행 수를 그대로 유지 ──────────────────
  // 2026-09-03 Stephen 확정: 항목 수가 미리 준비된 반복 슬롯보다 적어도 뒤쪽 행을
  // 통째로 없애지(shrink) 않는다 — 앞쪽 N행만 실제 항목으로 채우고 나머지(T-N)행은
  // 변수 자리만 공백 처리한 채 그대로 남긴다. 문서의 전체 행 수·인쇄 레이아웃이 항목
  // 수와 무관하게 항상 고정되도록 하기 위함(이전엔 N행으로 축소돼 이후 정적 영역까지
  // 위로 밀려 올라갔음 — E-1/E-3 테스트 케이스가 이 이전 동작을 검증하고 있었으나
  // 새 스펙에 맞춰 함께 갱신함). 행 수·위치가 전혀 바뀌지 않으므로 merges도 원본 그대로
  // 유지한다(expandMerges 재계산 불필요 — rowDelta가 항상 0).
  if (N <= T) {
    const filledRows: string[][] = templateRows.map((row, i) =>
      i < N
        ? row.map((cell) => applyItemSubstitution(cell, items[i], data))
        : row.map((cell) => blankVariables(cell)),
    )
    return {
      ...sheet,
      rows: [...substitutedBefore, ...filledRows, ...substitutedAfter],
      cellFormatting: [...beforeFmt, ...templateFmt, ...afterFmt],
      merges: sheet.merges,
    }
  }

  // ── 항목수(N) > 템플릿행수(T): 기존 오버플로우 확장 동작 유지 ──────────────
  // 항목 i → 템플릿 행 min(i, T-1): 마지막 템플릿 행 서식을 재사용해 행을 추가한다.
  const expandedRows: string[][] = items.map((item, i) =>
    templateRows[Math.min(i, T - 1)].map((cell) => applyItemSubstitution(cell, item, data)),
  )
  const expandedFmt = items.map((_, i) => templateFmt[Math.min(i, T - 1)] ?? [])

  // ── 병합 범위 재계산 ─────────────────────────────────────────────────────
  const newMerges = expandMerges(sheet.merges, startRow, endRow, N, T)

  return {
    ...sheet,
    rows: [...substitutedBefore, ...expandedRows, ...substitutedAfter],
    cellFormatting: [...beforeFmt, ...expandedFmt, ...afterFmt],
    merges: newMerges,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 공개 API
// ─────────────────────────────────────────────────────────────────────────────

/** content_blocks 배열에 포함될 수 있는 블록 타입 (레거시 + TipTap) */
export type AnyContentBlock = ContentBlock | TiptapDocBlock

/**
 * SpreadsheetDocument의 모든 셀 텍스트에서 {{변수명}} 패턴을 ContractSubstitutionData
 * 의 실제 값으로 치환한다. 치환하지 못한 변수는 {{변수명}} 원문을 그대로 유지.
 *
 * repeatRegion이 정의된 시트는 data.상품목록 배열 항목 수만큼 반복 행을 확장한다.
 * 원본 문서를 변경하지 않고 새 SpreadsheetDocument를 반환한다(immutable 처리).
 */
export function substituteSpreadsheetDocument(
  doc: SpreadsheetDocument,
  data: ContractSubstitutionData,
): SpreadsheetDocument {
  return {
    ...doc,
    sheets: doc.sheets.map((sheet) => expandSheet(sheet, data)),
  }
}

/**
 * content_blocks 배열의 변수 치환.
 * - 레거시 ContentBlock(text/html): {{변수명}} 정규식 치환
 * - tiptap-doc 블록: mergeField 노드를 실제 값으로 치환 (substituteTiptapDoc 위임)
 * - 기타 블록(divider 등): 그대로 반환
 */
export function substituteVariables(
  blocks: AnyContentBlock[],
  data: ContractSubstitutionData
): AnyContentBlock[] {
  return blocks.map((block): AnyContentBlock => {
    if (block.type === 'tiptap-doc') {
      return { ...block, doc: substituteTiptapDoc(block.doc, data) }
    }
    if (block.type === 'text') {
      return { ...block, html: applySubstitution(block.html, data) }
    }
    if (block.type === 'html') {
      return { ...block, content: applySubstitution(block.content, data) }
    }
    return block
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// HTML형(고정 템플릿) 계약서 치환
//
// 보안 원칙: 모든 사용자 입력(고객이름·주소·상품명 등)을 escapeHtml()로 필수 이스케이프.
// XSS 방어의 유일한 서버측 장벽이다 — 이 함수를 거치지 않고 html_document에 사용자
// 입력값을 삽입하는 경로를 절대로 추가하지 말 것.
//
// 반복 영역: <!--REPEAT:상품목록-->...<!--/REPEAT--> HTML 주석 마커로 지정.
// 마커 사이 HTML 조각을 ContractSubstitutionData.상품목록 배열 항목 수만큼 복제·치환한다.
// N=0 이면 마커만 제거하고 행 없음. N≥1 이면 각 행마다 {{NO.}}(1-based)·항목 필드 치환.
// ─────────────────────────────────────────────────────────────────────────────

const REPEAT_MARKER_RE = /<!--REPEAT:상품목록-->([\s\S]*?)<!--\/REPEAT-->/g

/**
 * HTML형 계약서의 스칼라 변수 치환 (XSS 이스케이프 적용).
 * @internal
 */
function applyHtmlSubstitution(text: string, data: ContractSubstitutionData): string {
  return text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim() as keyof ContractSubstitutionData
    const value = data[trimmed]
    // 스칼라(string)만 치환 — 배열(상품목록)은 반복 영역에서 별도 처리
    if (typeof value === 'string') return escapeHtml(value)
    // 치환 불가 변수 → 빈 문자열(원문 제거)
    return ''
  })
}

/**
 * 반복 행 안에서 ContractLineItem 필드 우선 치환 후 스칼라 폴백 치환 (XSS 이스케이프 적용).
 * {{NO.}} 는 1-based 순번으로 치환한다.
 * @internal
 */
function applyHtmlItemSubstitution(
  text: string,
  item: ContractLineItem,
  data: ContractSubstitutionData,
  index: number,
): string {
  // 1순위: 순번 {{NO.}} 및 ContractLineItem 필드
  const withItem = text.replace(/\{\{([^}]+)\}\}/g, (match, key: string) => {
    const trimmed = key.trim()
    // {{NO.}} → 1-based 순번
    if (trimmed === 'NO.' || trimmed === 'NO') return String(index + 1)
    // ContractLineItem 필드
    const itemValue = item[trimmed as keyof ContractLineItem]
    if (itemValue !== undefined && typeof itemValue === 'string') return escapeHtml(itemValue)
    return match // 항목 필드에 없으면 원문 유지 → 2순위 스칼라 폴백
  })
  // 2순위: 스칼라 폴백 (ContractSubstitutionData, 이스케이프 포함)
  return applyHtmlSubstitution(withItem, data)
}

/**
 * HTML형(고정 템플릿) 계약서의 변수 치환.
 *
 * 1. <!--REPEAT:상품목록-->...<!--/REPEAT--> 반복 영역: 상품목록 배열 항목 수만큼 확장 후 치환.
 * 2. 나머지 영역: 스칼라 변수 1:1 치환.
 * 3. 모든 치환값은 escapeHtml()로 이스케이프 (XSS 방어).
 * 4. 치환 불가 변수(키가 ContractSubstitutionData에 없음)는 빈 문자열로 대체(원문 제거).
 *
 * @param html  변수 치환 전 HTML 원본 (DEFAULT_RENTAL_CONTRACT_HTML 등)
 * @param data  치환 데이터 (ContractSubstitutionData)
 * @returns     치환 완료된 HTML — DB 저장 및 {@html} 렌더링에 안전
 */
export function substituteHtmlDocument(
  html: string,
  data: ContractSubstitutionData,
): string {
  const items = data.상품목록 ?? []

  // 반복 영역 처리
  const withRepeat = html.replace(REPEAT_MARKER_RE, (_match, innerTemplate: string) => {
    if (items.length === 0) return ''
    return items
      .map((item, i) => applyHtmlItemSubstitution(innerTemplate, item, data, i))
      .join('')
  })

  // 나머지 스칼라 치환
  return applyHtmlSubstitution(withRepeat, data)
}

// ─────────────────────────────────────────────────────────────────────────────
// CS2654 보완 — 발송 전 잔존/치환불가 변수 탐지 (CMS 전역 정밀검증 v6, 2026-09-07)
// ─────────────────────────────────────────────────────────────────────────────

const RESIDUAL_VAR_RE = /\{\{([^}]+)\}\}/g

/**
 * 이미 저장된 계약서 콘텐츠(authoring_mode 무관 — content_blocks/spreadsheet_document/
 * html_document/canvas_document 아무거나)에서 아직 {{변수명}} 원문으로 남아있는 값을
 * 전부 찾아 중복 제거된 변수명 목록으로 반환한다. 발송 직전 최종 안전장치(send-chat).
 *
 * ⚠️ html 모드는 치환 실패 시 applyHtmlSubstitution이 빈 문자열로 조용히 삭제하므로
 * (§HT-6, 의도된 사양) 저장 이후 시점에서는 이 스캔으로 잡히지 않는다 — html 모드의
 * 사전 검증은 findHtmlUnresolvedVariables()(치환 전 원본 템플릿 대상)를 별도로 쓴다.
 */
export function findUnresolvedVariables(content: unknown): string[] {
  if (content == null) return []
  const text = typeof content === 'string' ? content : JSON.stringify(content)
  const found = new Set<string>()
  for (const match of text.matchAll(RESIDUAL_VAR_RE)) {
    found.add(match[1].trim())
  }
  return [...found]
}

/**
 * HTML형 원본 템플릿(치환 전)을 대상으로, ContractSubstitutionData에 값이 없어(스칼라
 * string이 아니어서) applyHtmlSubstitution이 빈 문자열로 지워버릴 변수명을 미리 찾아
 * 중복 제거된 목록으로 반환한다. 저장/발송 전에 호출해 발송을 막는 용도(클라이언트 측
 * 사전 검증) — substituteHtmlDocument 자체의 반환 시그니처는 기존 호출부·테스트(HT-1~7)
 * 보호를 위해 변경하지 않는다.
 */
export function findHtmlUnresolvedVariables(
  html: string,
  data: ContractSubstitutionData,
): string[] {
  const found = new Set<string>()
  for (const match of html.matchAll(RESIDUAL_VAR_RE)) {
    const key = match[1].trim()
    if (key === 'NO.' || key === 'NO') continue // 반복영역 순번은 항상 치환됨
    if (typeof data[key as keyof ContractSubstitutionData] !== 'string') found.add(key)
  }
  return [...found]
}
