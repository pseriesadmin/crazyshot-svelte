/**
 * /members "정기구독 이용안내" 영역 배경 사진 2장(상단·하단) 교체 설정 — cms_settings.members_benefits_photos
 *
 * 값 구조: { top: Photo | null, bottom: Photo | null }  (Photo = { url, path, x, y })
 *   - url·path: 관리모달에서 업로드한 이미지(공개 URL·스토리지 경로). 둘 다 null 이면 기본 사진을 쓰되 초점(x·y)만 적용한다.
 *   - x·y: 초점 위치(0~100 %) — CSS object-position. PC(넓은 가로 띠)와 모바일(좁은 띠) 어느 비율에서나
 *     같은 값으로 "이 지점이 잘 보이게" 잘려서, 얼굴·제품이 잘리는 것을 막는다.
 *   - 항목 자체가 null 이면 기본 사진·기본 초점.
 * DB 단 구조 검증이 없으므로(마이그레이션 #715) 읽는 쪽이 항상 normalizeBenefitsPhotos 로 정규화한다.
 */

export type BenefitsPhotoSlot = 'top' | 'bottom'

export interface BenefitsPhoto {
  /** 업로드한 이미지 공개 URL — null 이면 기본 사진 */
  url: string | null
  /** 업로드한 이미지 스토리지 경로 — url 과 함께 있거나 함께 없다 */
  path: string | null
  x: number
  y: number
}

export interface BenefitsPhotosSetting {
  top: BenefitsPhoto | null
  bottom: BenefitsPhoto | null
}

export const BENEFITS_PHOTOS_SETTING_KEY = 'members_benefits_photos'

/** 업로드 사진이 없을 때 쓰는 기본 사진 */
export const BENEFITS_DEFAULT_SRC: Record<BenefitsPhotoSlot, string> = {
  top: '/members/benefits-photo1.png',
  bottom: '/members/benefits-photo2.png',
}

/** 기본 초점(기본 사진의 구도에 맞춘 값 — PC 가로 띠·모바일 좁은 띠 양쪽에서 주요 피사체가 보이도록 잡은 중간값) */
export const BENEFITS_DEFAULT_FOCUS: Record<BenefitsPhotoSlot, { x: number; y: number }> = {
  top: { x: 50, y: 45 },
  bottom: { x: 50, y: 15 },
}

export function clampPercent(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.min(100, Math.max(0, Math.round(n)))
}

function hasText(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0
}

function normalizePhoto(raw: unknown, slot: BenefitsPhotoSlot): BenefitsPhoto | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const hasImage = hasText(r.url) && hasText(r.path)
  const hasFocus = r.x !== undefined || r.y !== undefined
  if (!hasImage && !hasFocus) return null
  const def = BENEFITS_DEFAULT_FOCUS[slot]
  return {
    url: hasImage ? (r.url as string) : null,
    path: hasImage ? (r.path as string) : null,
    x: clampPercent(r.x, def.x),
    y: clampPercent(r.y, def.y),
  }
}

/** DB 에서 읽은 값(없음·깨진 값 포함)을 안전한 설정 객체로 바꾼다. */
export function normalizeBenefitsPhotos(raw: unknown): BenefitsPhotosSetting {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  return { top: normalizePhoto(r.top, 'top'), bottom: normalizePhoto(r.bottom, 'bottom') }
}

/** 화면에 실제로 그릴 사진(업로드 사진 또는 기본 사진) + 초점 */
export function resolveBenefitsPhoto(
  setting: BenefitsPhotosSetting,
  slot: BenefitsPhotoSlot,
): { src: string; x: number; y: number; isCustom: boolean } {
  const photo = setting[slot]
  const def = BENEFITS_DEFAULT_FOCUS[slot]
  if (!photo) return { src: BENEFITS_DEFAULT_SRC[slot], x: def.x, y: def.y, isCustom: false }
  return {
    src: photo.url ?? BENEFITS_DEFAULT_SRC[slot],
    x: photo.x,
    y: photo.y,
    isCustom: photo.url !== null,
  }
}

/** 저장 전 정리: 기본 사진 + 기본 초점인 항목은 null 로 저장해 설정을 깨끗하게 유지한다. */
export function compactBenefitsPhoto(photo: BenefitsPhoto | null, slot: BenefitsPhotoSlot): BenefitsPhoto | null {
  if (!photo) return null
  const def = BENEFITS_DEFAULT_FOCUS[slot]
  if (photo.url === null && photo.x === def.x && photo.y === def.y) return null
  return photo
}
