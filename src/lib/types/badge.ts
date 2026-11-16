// 상품 배지 — CMS·고객 화면 공용 타입

export type BadgeKind = 'image' | 'textbar'

export interface BadgeTemplate {
  id: string
  kind: BadgeKind
  name: string
  svg_url: string | null
  text: string | null
  bg_color: string | null
  text_color: string
  is_active: boolean
}

export interface BadgeRule {
  id: string
  /** 배지 목록 품번 — 만들 때 한 번 부여되는 고유번호(영구 고정, Migration #831). 열이 없는 환경에서는 없을 수 있다 */
  badge_no?: number
  name: string
  /** 선택한 첫 번째 배지타입(호환용) — 전체 목록은 template_ids */
  template_id: string
  /** 한 배지목록에 연결한 배지타입(선택한 순서 = 고객 화면 표시 순서, 개수 제한 없음) */
  template_ids: string[]
  coupon_id: string | null
  priority: number
  valid_from: string | null
  valid_until: string | null
  is_active: boolean
  product_ids: string[]
  categories: string[]
}

/** 배지 대상 상품의 표시 이름(CMS 목록·패널용) */
export interface BadgeProductName {
  id: string
  name: string
}

export interface BadgeCouponOption {
  id: string
  label: string
}

/** get_product_badges 가 돌려주는 고객 화면용 표시 필드 */
export interface CustomerBadge {
  product_id: string
  badge_id: string
  /** 배지목록 1개가 여러 배지로 펼쳐지므로 같은 badge_id 안에서 배지를 구분하는 키(each 키는 badge_id:template_id) */
  template_id: string
  priority: number
  kind: BadgeKind
  svg_url: string | null
  text: string | null
  bg_color: string | null
  text_color: string
}
