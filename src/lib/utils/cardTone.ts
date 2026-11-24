/**
 * 슬라이드 카드 하단(요금·상품명) 바탕색 선택 — 관리자가 상품별로 고른다.
 *   white — 흰색 / lilac — 옅은 퍼플(--cs-purple-op10) / dark — 다크(--cs-dark)
 * 저장은 각 설정의 상품 항목({ id, order, tone })에 선택 필드로 담고, 읽을 때 이 파일로 화이트리스트 검사한다(그 외·없음 = null → 각 카드의 기본 모습).
 */
export type CardTone = 'white' | 'lilac' | 'dark'

export const CARD_TONES: readonly CardTone[] = ['white', 'lilac', 'dark']

export function normalizeCardTone(raw: unknown): CardTone | null {
  return raw === 'white' || raw === 'lilac' || raw === 'dark' ? raw : null
}
