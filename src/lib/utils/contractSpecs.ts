// 예약별 사전 등록 특약(rental_reservations.contract_specifications, Migration #720) 공용 규칙 — 서버 API·자동발행·수동 발행 모달이 함께 쓴다.
export interface ContractSpecRow { key: string; value: string }

export const MAX_CONTRACT_SPEC_ROWS = 20
export const MAX_CONTRACT_SPEC_KEY = 50
export const MAX_CONTRACT_SPEC_VALUE = 500

/** 알 수 없는 입력을 [{key,value}]로 정리 — 항목명이 비면 제외, 길이·개수 상한 적용. */
export function normalizeContractSpecs(raw: unknown): ContractSpecRow[] {
  if (!Array.isArray(raw)) return []
  const rows: ContractSpecRow[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const k = typeof (item as { key?: unknown }).key === 'string' ? (item as { key: string }).key.trim() : ''
    const v = typeof (item as { value?: unknown }).value === 'string' ? (item as { value: string }).value.trim() : ''
    if (!k) continue
    rows.push({ key: k.slice(0, MAX_CONTRACT_SPEC_KEY), value: v.slice(0, MAX_CONTRACT_SPEC_VALUE) })
    if (rows.length >= MAX_CONTRACT_SPEC_ROWS) break
  }
  return rows
}

/** 양식 자체 특약 뒤에 예약 사전 등록 특약을 이어 붙인다(양식 특약이 먼저). */
export function mergeContractSpecs(
  templateSpecs: ContractSpecRow[] | null | undefined,
  reservationSpecs: ContractSpecRow[] | null | undefined,
): ContractSpecRow[] {
  return [...(templateSpecs ?? []), ...(reservationSpecs ?? [])]
}
