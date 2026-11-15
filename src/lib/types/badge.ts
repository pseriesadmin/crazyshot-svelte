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
  name: string
  template_id: string
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
  priority: number
  kind: BadgeKind
  svg_url: string | null
  text: string | null
  bg_color: string | null
  text_color: string
}
