/**
 * fitColumnWidths.ts — 임포트된 표의 컬럼너비(colwidth)를 A4 문서 폭에 맞춰 축소
 *
 * docx(w:tblGrid)·xlsx(!cols) 양쪽에서 추출한 원본 컬럼너비(px)를 그대로 TipTap colwidth로
 * 주입하면, 컬럼 수가 많거나 원본이 넓게 디자인된 표(예: 17열짜리 계약서 표)는 합계 폭이
 * A4 본문 폭(문서형 에디터 .ProseMirror padding:20mm 제외한 실제 너비)을 훨씬 초과해
 * 표가 페이지 밖으로 비정상적으로 넓게 펼쳐져 보인다(2026-08-15 실사용 중 발견).
 *
 * .tableWrapper의 overflow-x:auto로 가로 스크롤은 가능하지만, "A4 문서처럼 보여야 한다"는
 * 요구에는 맞지 않음 — Word/Google Docs가 셀 붙여넣기 시 표를 페이지 폭에 맞게 비율대로
 * 축소하는 것과 동일하게, 합계가 목표 폭을 넘으면 전체 컬럼을 비율 유지한 채 축소한다.
 */

/**
 * 문서형(TipTap) 에디터의 A4 본문 폭(px) — ContractDocumentEditor.svelte의
 * `.cde-editor-content { width:210mm }` + `.ProseMirror { padding:20mm }` 기준
 * (210mm - 20mm*2 = 170mm), 96dpi 환산: 170mm * 96/25.4 ≈ 642px.
 */
export const A4_CONTENT_WIDTH_PX = 642

/** 축소 시 컬럼이 너무 얇아져 읽을 수 없게 되는 것을 막는 최소 폭(px) */
const MIN_COLUMN_WIDTH_PX = 20

/**
 * 컬럼너비 배열(px, null=정보없음)의 합이 targetWidthPx를 넘으면 비율을 유지한 채
 * targetWidthPx에 맞도록 축소한다. 넘지 않으면 원본 그대로 반환(불필요한 변형 없음).
 *
 * @param widths        컬럼별 너비(px). null 항목은 스킵(정보 없음 그대로 유지)
 * @param targetWidthPx 맞춰야 할 목표 폭(px, 기본 A4_CONTENT_WIDTH_PX)
 */
export function fitColumnWidthsToTarget(
  widths: (number | null)[],
  targetWidthPx: number = A4_CONTENT_WIDTH_PX,
): (number | null)[] {
  const known = widths.filter((w): w is number => typeof w === 'number' && w > 0)
  if (known.length === 0) return widths

  const total = known.reduce((a, b) => a + b, 0)
  if (total <= targetWidthPx) return widths // 이미 폭 안에 들어오면 축소 불필요

  const scale = targetWidthPx / total
  return widths.map((w) =>
    typeof w === 'number' && w > 0 ? Math.max(MIN_COLUMN_WIDTH_PX, Math.round(w * scale)) : w,
  )
}
