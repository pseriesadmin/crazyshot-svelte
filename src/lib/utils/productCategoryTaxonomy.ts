// 상품 카테고리 9종 고정 체계 — code_mapping_groups.default_category CHECK 제약(마이그레이션 91)과 동일한 값 도메인.
// 한글 라벨·품번 프리픽스 정의를 이 파일 한 곳으로 통합(기존 products/new의 CATEGORIES,
// cms/codes/_shared.ts의 PRODUCT_CATS가 동일 9개 값을 각자 따로 들고 있던 중복을 제거).
// 값 자체(9종 enum)는 유지 — code_mapping_groups에 그룹이 없는 예외 상황의 폴백 경로에서도 쓰임.

export const PRODUCT_CATEGORY_VALUES = [
  'camera',
  'lens',
  'camcorder',
  'action_cam',
  'drone',
  'lighting',
  'audio',
  'accessory',
  'package',
] as const

export type ProductCategoryValue = (typeof PRODUCT_CATEGORY_VALUES)[number]

// 소비처(카테고리 선택값을 자유 문자열 상태로 다루는 폼 등)와의 인덱싱 호환을 위해
// 조회용 Record는 넓은 string 키로 export — 정의 자체는 위 9종으로 고정.
const CATEGORY_LABELS_STRICT: Record<ProductCategoryValue, string> = {
  camera: '카메라',
  lens: '렌즈',
  camcorder: '캠코더',
  action_cam: '액션캠',
  drone: '드론',
  lighting: '조명',
  audio: '오디오',
  accessory: '악세서리',
  package: '패키지',
}

const CATEGORY_CODES_STRICT: Record<ProductCategoryValue, string> = {
  camera: 'CAM',
  lens: 'LNS',
  camcorder: 'CMC',
  action_cam: 'ACT',
  drone: 'DRN',
  lighting: 'LGT',
  audio: 'AUD',
  accessory: 'ACC',
  package: 'PKG',
}

export const CATEGORY_LABELS: Record<string, string> = CATEGORY_LABELS_STRICT
export const CATEGORY_CODES: Record<string, string> = CATEGORY_CODES_STRICT

export const PRODUCT_CATEGORY_OPTIONS: { value: string; label: string }[] =
  PRODUCT_CATEGORY_VALUES.map((value) => ({ value, label: CATEGORY_LABELS_STRICT[value] }))
