import type { ContentBlock } from '$lib/types/content-editor'

export interface ContractModule {
  id: string
  label: string
  category: 'customer' | 'reservation'
  blocks: ContentBlock[]
}

export interface ContractSubstitutionData {
  고객이름?: string
  연락처?: string
  이메일?: string
  주소?: string
  예약코드?: string
  상품코드?: string
  상품명?: string
  수량?: string
  수령형태?: string
  수령일시?: string
  반납형태?: string
  반납일시?: string
  기본대여요금?: string
  할인금액?: string
  부가세?: string
  최종합계?: string
}
