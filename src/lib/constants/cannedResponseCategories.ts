// 빠른답변(캔드 리스폰스) 카테고리 — 단일 진실의 원천 (3곳 중복 정리)

export const CANNED_RESPONSE_CATEGORIES = [
  { value: 'return',      label: '반납' },
  { value: 'payment',     label: '결제' },
  { value: 'reservation', label: '예약' },
  { value: 'damage',      label: '파손' },
  { value: 'general',     label: '일반' },
] as const

export type CannedResponseCategory = typeof CANNED_RESPONSE_CATEGORIES[number]['value']

export const VALID_CATEGORIES: string[] = CANNED_RESPONSE_CATEGORIES.map((c) => c.value)

export function getCategoryLabel(value: string | null | undefined): string {
  if (!value) return '일반'
  return CANNED_RESPONSE_CATEGORIES.find((c) => c.value === value)?.label ?? '일반'
}
