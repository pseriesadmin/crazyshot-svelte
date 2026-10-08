// read.ts — 에이전트가 지식 저장소를 읽는 입구(서버 전용)
// summarizeKnowledgeForAgent: 요약본을 AI/에이전트 프롬프트에 넣기 좋은 짧은 문장 목록으로 바꾼다(2000자 이내).
import type { FaqDigest, ProductDigest, ReservationDigest, ReviewDigest } from './digest'

export interface KnowledgeSnapshot { faq: FaqDigest | null; product: ProductDigest | null; review: ReviewDigest | null; reservation: ReservationDigest | null }

const top = (m: Record<string, number>, n = 3): string => Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(', ')

export function summarizeKnowledgeForAgent(k: KnowledgeSnapshot): string {
  const lines: string[] = []
  if (k.faq) {
    lines.push(`빠른답변 ${k.faq.count}건(분류: ${top(k.faq.byCategory, 5)}). 키워드 없는 항목 ${k.faq.noKeyword.length}건, 키워드 부족 ${k.faq.thinKeyword.length}건.`)
    if (k.faq.topUsed.length) lines.push(`자주 쓰인 답변: ${k.faq.topUsed.map((f) => f.title).join(' / ')}`)
  }
  if (k.product) {
    lines.push(`대여 상품 ${k.product.count}개(분류: ${top(k.product.byCategory, 5)}). 주요 브랜드: ${k.product.brands.slice(0, 5).map((b) => b.brand).join(', ')}.`)
    if (k.product.thinProducts.length) lines.push(`정보가 빈약한 상품 ${k.product.thinProducts.length}개.`)
  }
  if (k.review) lines.push(`공개 후기 ${k.review.count}건(후기 있는 상품 ${k.review.productsWithReviews}개). 자주 나온 말: ${k.review.topTerms.slice(0, 8).map((t) => t.term).join(', ') || '없음'}.`)
  if (k.reservation) lines.push(`예약 ${k.reservation.count}건(최근 30일 ${k.reservation.last30d}건), 평균 대여 ${k.reservation.avgRentalDays}일. 수령 방식: ${top(k.reservation.byPickup)}. 반납 방식: ${top(k.reservation.byReturn)}.`)
  return lines.join('\n').slice(0, 2000)
}
