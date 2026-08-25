/**
 * baseCodeDisplay.ts
 * '기준 품번'(대표/부모 상품 코드) 표시 문자열 계산 — 순수 함수, side-effect 없음.
 *
 * 원래 src/routes/cms/products/+page.svelte에 로컬 정의돼 있던 함수를 공유 유틸로 추출
 * (2026-08-17) — ProductDetailPanel.svelte에서도 동일 표시값을 재사용하기 위함.
 *
 * QR-LABEL-2: '기준 품번'은 실제 채번된(재고로 카운트되는) 자식 품번과 혼동되면 안 되므로,
 * 실제 저장값을 그대로 노출하지 않고 코드 구조 + 순번 '0'(자리수만큼 0 패딩)으로 재구성해 표시한다.
 *
 * 2026-08-16 수정(Stephen 확정): 2단 계층(parent_seq_digits 존재)일 때 기본순번(순번1)은
 * 부모 등록 시 이미 확정·불변으로 채번된 실제값(products.md §2-2 영구고정 정책)이라 마스킹할
 * 이유가 없다 — 실값 노출. 자식순번(순번2)은 재고 등록마다 새로 채번되는 값이라 계속 0-패딩 마스킹.
 */
export function baseCodeDisplay(rp: { product_code?: string | null; code_series?: Record<string, unknown> | null }): string | null {
  const cs = rp.code_series
  if (cs) {
    const prefix = (cs.prefix as string) || 'CS'
    const catCode = (cs.category_code as string) || ''
    const yearMonth = cs.year_month as string | undefined
    const datePart = yearMonth && yearMonth !== 'nodate' && yearMonth !== 'all' ? yearMonth : ''
    const seqDigits = (cs.seq_digits as number) ?? 3
    const suffix = (cs.suffix as string) || ''
    const parentSeqDigits = cs.parent_seq_digits as number | undefined
    const parentSeq = cs.parent_seq as number | undefined
    const parentPart = parentSeqDigits
      ? String(parentSeq ?? 0).padStart(parentSeqDigits, '0')
      : ''
    const seqPlaceholder = parentSeqDigits
      ? parentPart + '0'.repeat(seqDigits)
      : '0'.repeat(seqDigits)
    return `${prefix}${catCode}${datePart}${seqPlaceholder}${suffix}`
  }
  if (rp.product_code) {
    const seqDigits = 3
    return rp.product_code.length > seqDigits
      ? rp.product_code.slice(0, -seqDigits) + '0'.repeat(seqDigits)
      : '0'.repeat(seqDigits)
  }
  return null
}
