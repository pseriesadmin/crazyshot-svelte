/**
 * pageMeta.ts — 페이지별 title·description 만들기 (2026-10-27)
 *
 * 검색엔진·AI 검색이 읽는 <head> 정보. app.html에 고정돼 있던 title·description은 모든 페이지에 같은 값이 나가고
 * 페이지 자신의 <title>과 겹쳐 title이 2개가 되므로 제거하고, 페이지마다 아래 값을 <svelte:head>에 넣는다.
 */

export const SITE_NAME = 'CRAZYSHOT'

/** 홈·상품 전체보기 제목 — <title>과 공유 카드(og:title)가 같은 값을 쓴다 */
export const HOME_PAGE_TITLE = 'CRAZYSHOT — 비대면 AI 검수 렌탈 플랫폼'
export const PRODUCTS_PAGE_TITLE = '상품 전체보기 — CRAZYSHOT'

/** 홈 — 서비스 소개 */
export const HOME_META_DESCRIPTION =
  '카메라·렌즈·조명·드론·액션캠 등 촬영장비를 비대면으로 대여하는 크레이지샷. AI 검수와 간편한 예약·반납으로 완전 비대면 렌탈을 경험하세요.'

/** 상품 전체보기 */
export const PRODUCTS_META_DESCRIPTION =
  '크레이지샷에서 대여할 수 있는 카메라·렌즈·조명·드론·액션캠 등 촬영장비 전체 목록. 원하는 장비를 골라 비대면으로 예약하세요.'

/** 상품 정보를 아직 못 읽었을 때(이름 없음) */
export const PRODUCT_FALLBACK_DESCRIPTION =
  '크레이지샷에서 촬영장비를 비대면으로 대여하세요. 상품 상세 정보와 대여 요금을 확인할 수 있습니다.'

const META_MAX = 155

/** 공백·줄바꿈·꺾쇠(<>)를 정리하고 max 글자 안으로 줄인다(넘으면 끝을 …로). 글자 수는 문자(코드포인트) 기준 — 이모지 같은 서로게이트 쌍을 중간에서 자르지 않는다 */
export function truncateMeta(text: string, max: number = META_MAX): string {
  const clean = text.replace(/[<>]/g, ' ').replace(/\s+/g, ' ').trim()
  const chars = Array.from(clean)
  if (chars.length <= max) return clean
  return `${chars.slice(0, max - 1).join('').trimEnd()}…`
}

/** "이름 — CRAZYSHOT" (구역 이름이 있으면 "이름 — 구역 — CRAZYSHOT") */
export function buildPageTitle(name: string | null | undefined, section?: string): string {
  const n = (name ?? '').replace(/\s+/g, ' ').trim()
  if (!n) return SITE_NAME
  return section ? `${n} — ${section} — ${SITE_NAME}` : `${n} — ${SITE_NAME}`
}

export interface ProductMetaInput {
  name?: string | null
  brand?: string | null
  categoryLabel?: string | null
  caption?: string | null
  /** 1일 대여 요금(원) */
  priceDay?: number | null
  saleOnly?: boolean | null
  salePrice?: number | null
}

function won(n: number): string {
  return `${Math.round(n).toLocaleString('ko-KR')}원`
}

function positive(n: number | null | undefined): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n > 0
}

/** 상품 상세 description — 이름·분류·캡션·요금으로 상품마다 다른 한두 문장을 만든다 */
export function buildProductMetaDescription(p: ProductMetaInput): string {
  const name = (p.name ?? '').replace(/\s+/g, ' ').trim()
  if (!name) return PRODUCT_FALLBACK_DESCRIPTION

  const brand = (p.brand ?? '').trim()
  const label = (p.categoryLabel ?? '').trim()
  const sale = p.saleOnly === true
  const verb = sale ? '구매' : '대여'
  const brandPart = brand && !name.toLowerCase().includes(brand.toLowerCase()) ? ` (${brand})` : ''
  const head = label ? `${name}${brandPart} — ${label} ${verb}.` : `${name}${brandPart} ${verb}.`

  const sentences = [head]
  const caption = truncateMeta(p.caption ?? '', 200).replace(/[.。]+$/, '')
  if (caption) sentences.push(`${caption}.`)
  if (sale) {
    if (positive(p.salePrice)) sentences.push(`판매가 ${won(p.salePrice)}.`)
    sentences.push('크레이지샷에서 구매하세요.')
  } else {
    if (positive(p.priceDay)) sentences.push(`1일 ${won(p.priceDay)}부터.`)
    sentences.push('크레이지샷에서 비대면으로 예약하세요.')
  }
  return truncateMeta(sentences.join(' '), META_MAX)
}
