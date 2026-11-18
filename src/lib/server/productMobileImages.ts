// 고객 화면 상품 카드용 '모바일 전용 대표 이미지' 일괄 조회 — 화면에 내려가는 상품 id 묶음으로 1회만 조회한다(N+1 금지).
// 모바일 전용 이미지(products.mobile_images = [{src, url, enabled?, primary?}], src = PC image_urls 값)는 PC 이미지를 모바일 비율로 다시 만든 것이다.
// 공개 읽기는 products_public_read(노출 중인 부모 상품만) 정책이 막아 준다. 실패해도 화면은 PC 이미지 그대로 정상 표시(fail-soft).

export const MAX_MOBILE_IMAGE_PRODUCT_IDS = 200

export type MobileImageMap = Record<string, string>

interface MobileImageEntry {
  src?: unknown
  url?: unknown
  enabled?: unknown
  primary?: unknown
}

interface QueryClient {
  from: (table: string) => {
    select: (cols: string) => {
      in: (col: string, ids: string[]) => PromiseLike<{ data: unknown; error: unknown }>
    }
  }
}

/**
 * 카드 대표 이미지로 쓸 모바일 전용 이미지 주소를 고른다(없으면 null → 호출부가 PC 이미지 사용).
 * 1순위: 모바일 대표(primary)로 지정한 이미지 / 2순위: PC 첫 이미지와 짝지어진 모바일 이미지.
 * 사용 안 함(enabled === false)·주소 없음은 제외한다.
 */
export function pickMobileRepresentativeImage(imageUrls: unknown, mobileImages: unknown): string | null {
  if (!Array.isArray(mobileImages)) return null
  const usable = (mobileImages as MobileImageEntry[]).filter(
    (m): m is MobileImageEntry & { url: string } =>
      !!m && typeof m === 'object' && typeof m.url === 'string' && m.url !== '' && m.enabled !== false,
  )
  if (usable.length === 0) return null
  const primary = usable.find((m) => m.primary === true)
  if (primary) return primary.url
  const first = Array.isArray(imageUrls) && typeof imageUrls[0] === 'string' ? imageUrls[0] : null
  if (!first) return null
  return usable.find((m) => m.src === first)?.url ?? null
}

export async function loadMobileImageMap(client: unknown, productIds: Array<string | null | undefined>): Promise<MobileImageMap> {
  const ids = [...new Set(productIds.filter((v): v is string => typeof v === 'string' && v !== ''))].slice(0, MAX_MOBILE_IMAGE_PRODUCT_IDS)
  if (ids.length === 0) return {}
  try {
    const { data, error } = await (client as QueryClient).from('products').select('id, image_urls, mobile_images').in('id', ids)
    if (error || !Array.isArray(data)) return {}
    const map: MobileImageMap = {}
    for (const r of data as Array<{ id: string; image_urls: unknown; mobile_images: unknown }>) {
      const url = pickMobileRepresentativeImage(r.image_urls, r.mobile_images)
      if (url) map[r.id] = url
    }
    return map
  } catch {
    return {}
  }
}
