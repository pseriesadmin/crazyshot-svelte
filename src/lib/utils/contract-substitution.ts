import type { ContentBlock } from '$lib/types/content-editor'
import type { TiptapDocBlock, SpreadsheetDocument, SpreadsheetSheet } from '$lib/types/contract-document'
import type { ContractSubstitutionData, ContractLineItem } from '$lib/types/contract-module'
import type { SheetMergeRange } from '$lib/types/sheet-format'
import { substituteTiptapDoc } from '$lib/utils/tiptapRender'

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

  // ── 반복 영역 확장 (N행, N=0이면 빈 배열) ────────────────────────────────
  // 항목 i → 템플릿 행 min(i, T-1): 항목 수 > 템플릿 수이면 마지막 행 재사용
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
