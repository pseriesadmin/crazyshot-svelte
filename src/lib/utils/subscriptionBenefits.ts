export type BenefitType =
  | 'DISCOUNT_COUPON'
  | 'FREE_SHIPPING'
  | 'FREE_RENTAL'
  | 'INSURANCE_WAIVE'
  | 'LOYALTY_POINTS'

export const BENEFIT_TYPES: BenefitType[] = [
  'DISCOUNT_COUPON',
  'FREE_SHIPPING',
  'FREE_RENTAL',
  'INSURANCE_WAIVE',
  'LOYALTY_POINTS',
]

export interface BenefitParamField {
  key: string
  label: string
  type: 'number' | 'select' | 'checkbox'
  unit?: string
  options?: { value: string; label: string }[]
  defaultValue: number | string | boolean
}

export interface BenefitTypeDef {
  type: BenefitType
  label: string
  description: string
  fields: BenefitParamField[]
}

export const BENEFIT_DEFS: Record<BenefitType, BenefitTypeDef> = {
  DISCOUNT_COUPON: {
    type: 'DISCOUNT_COUPON',
    label: '할인쿠폰',
    description: '매 결제주기 자동으로 정액 할인쿠폰을 발급합니다.',
    fields: [
      { key: 'coupon_amount', label: '쿠폰 금액', type: 'number', unit: '원', defaultValue: 10000 },
      { key: 'coupon_frequency', label: '월 발행 횟수', type: 'number', unit: '회', defaultValue: 1 },
      { key: 'coupon_valid_days', label: '쿠폰 유효기간', type: 'number', unit: '일', defaultValue: 30 },
    ],
  },
  FREE_SHIPPING: {
    type: 'FREE_SHIPPING',
    label: '무료배송',
    description: '월 한도 내 왕복/편도 배송비를 면제합니다.',
    fields: [
      { key: 'monthly_limit', label: '월 제한 횟수', type: 'number', unit: '회', defaultValue: 2 },
      {
        key: 'shipping_type', label: '배송 방식', type: 'select', defaultValue: 'round_trip',
        options: [
          { value: 'round_trip', label: '왕복' },
          { value: 'one_way', label: '편도' },
        ],
      },
    ],
  },
  FREE_RENTAL: {
    type: 'FREE_RENTAL',
    label: '무료렌탈',
    description: '지정한 장비를 월 한도 내 무료로 대여할 수 있습니다.',
    fields: [
      { key: 'monthly_limit', label: '월 제한 횟수', type: 'number', unit: '회', defaultValue: 1 },
      { key: 'duration_hours', label: '무료렌탈 시간', type: 'number', unit: '시간', defaultValue: 24 },
      { key: 'max_items', label: '1회 최대 대여 개수', type: 'number', unit: '개', defaultValue: 1 },
    ],
  },
  INSURANCE_WAIVE: {
    type: 'INSURANCE_WAIVE',
    label: '보험료면제',
    description: '월 한도 내 안심렌탈케어 비용을 면제합니다.',
    fields: [
      { key: 'monthly_limit', label: '월 제한 횟수', type: 'number', unit: '회', defaultValue: 1 },
      { key: 'max_amount', label: '최대 면제 금액', type: 'number', unit: '원', defaultValue: 100000 },
    ],
  },
  LOYALTY_POINTS: {
    type: 'LOYALTY_POINTS',
    label: '적립포인트',
    description: '결제 금액의 일정 비율을 포인트로 추가 적립합니다.',
    fields: [
      { key: 'points_rate', label: '적립률', type: 'number', unit: '%', defaultValue: 2 },
      { key: 'min_purchase_amount', label: '최소 적립 기준금액', type: 'number', unit: '원', defaultValue: 10000 },
      { key: 'max_points_per_order', label: '1회 최대 적립 포인트', type: 'number', unit: 'P', defaultValue: 50000 },
      { key: 'points_expiry_days', label: '포인트 유효기간', type: 'number', unit: '일', defaultValue: 365 },
      { key: 'is_stackable', label: '다른 할인과 중복 적용', type: 'checkbox', defaultValue: true },
    ],
  },
}


export const MEMBERSHIP_GRADE_OPTIONS = [
  { value: '', label: '연동 없음' },
  { value: 'NONE', label: 'NONE' },
  { value: 'EASY', label: 'EASY' },
  { value: 'POP', label: 'POP' },
  { value: 'CRAZY', label: 'CRAZY' },
]

export const SPEC_LABEL_PRESETS: string[] = [
  '월 사용료',
  '이상적인 대상',
  '무료 배송',
  '신규 장비 조기 접근',
  '보증금',
  '할인',
  '보호',
  '프로 지원',
]

export function defaultBenefitParams(type: BenefitType): Record<string, number | string | boolean> {
  const params: Record<string, number | string | boolean> = {}
  // eslint-disable-next-line security/detect-object-injection -- type은 BenefitType 유니온으로 고정된 값만 옴
  for (const field of BENEFIT_DEFS[type].fields) {
    params[field.key] = field.defaultValue
  }
  return params
}

/**
 * CMS '혜택관리' 탭(tier_benefits)의 구조화 값을 front 'Plans & features' 표 행(label/value)으로
 * 변환한다. is_enabled=true인 혜택만 호출측에서 필터링해 넘길 것 — 이 함수는 포맷팅만 담당.
 */
export function formatBenefitForDisplay(
  benefitType: BenefitType,
  params: Record<string, number | string | boolean>
): { label: string; value: string } {
  const def = BENEFIT_DEFS[benefitType]
  const num = (key: string): number => (typeof params[key] === 'number' ? (params[key] as number) : 0)

  switch (benefitType) {
    case 'DISCOUNT_COUPON':
      return { label: def.label, value: `${num('coupon_amount').toLocaleString('ko-KR')}원 · 월 ${num('coupon_frequency')}회` }
    case 'FREE_SHIPPING': {
      const typeLabel = def.fields.find((f) => f.key === 'shipping_type')?.options
        ?.find((o) => o.value === params.shipping_type)?.label ?? ''
      return { label: def.label, value: `월 ${num('monthly_limit')}회${typeLabel ? ` (${typeLabel})` : ''}` }
    }
    case 'FREE_RENTAL':
      return { label: def.label, value: `월 ${num('monthly_limit')}회 · ${num('duration_hours')}시간` }
    case 'INSURANCE_WAIVE':
      return { label: def.label, value: `월 ${num('monthly_limit')}회` }
    case 'LOYALTY_POINTS':
      return { label: def.label, value: `${num('points_rate')}%` }
    default:
      return { label: def.label, value: '포함' }
  }
}
