/**
 * 모바일 GNB 중앙 '배지 배너' 설정 — 저장값(cms_settings 'gnb_badge_banner') 정규화와 노출 선택 로직.
 * 값 구조: { items: [{ id, url, path, link }], mode: 'random' | 'sequential' }
 *   · random     — 화면을 열거나 이동할 때마다 무작위로 한 장
 *   · sequential — 화면을 열거나 이동할 때마다 등록 순서대로 다음 한 장(이 기기에 마지막 순서를 저장)
 * DB 단 구조 검증이 없으므로 읽을 때 이 파일이 걸러낸다(이미지 주소는 https 또는 같은 사이트 경로만, 링크는 안전한 주소만).
 */

export type GnbBadgeMode = 'random' | 'sequential'

export interface GnbBadgeItem {
  id: string
  /** 공개 이미지 주소(PNG·JPEG·SVG) */
  url: string
  /** 스토리지 경로(교체·정리용) */
  path: string
  /** 누르면 이동할 주소 — 비어 있으면 누를 수 없는 배지 */
  link: string
}

export interface GnbBadgeSettings {
  items: GnbBadgeItem[]
  mode: GnbBadgeMode
}

export const GNB_BADGE_SETTING_KEY = 'gnb_badge_banner'
export const GNB_BADGE_LINK_MAX = 300

export const EMPTY_GNB_BADGE: GnbBadgeSettings = { items: [], mode: 'random' }

/** 이동 주소 검사 — 같은 사이트 경로('/…', '//' 제외) 또는 https 주소만 허용. 그 외(javascript:, http 등)는 빈 값 */
export function safeBadgeLink(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const v = raw.trim()
  if (!v || v.length > GNB_BADGE_LINK_MAX) return ''
  if (v.startsWith('/') && !v.startsWith('//') && !v.includes('\\')) return v
  try {
    const u = new URL(v)
    return u.protocol === 'https:' ? u.toString() : ''
  } catch {
    return ''
  }
}

function safeImageUrl(raw: unknown): string {
  if (typeof raw !== 'string') return ''
  const v = raw.trim()
  if (!v) return ''
  if (v.startsWith('/') && !v.startsWith('//')) return v
  try {
    return new URL(v).protocol === 'https:' ? v : ''
  } catch {
    return ''
  }
}

/** 저장값 → 안전한 설정(옛 데이터·깨진 값은 빈 목록·랜덤으로) */
export function normalizeGnbBadge(raw: unknown): GnbBadgeSettings {
  if (!raw || typeof raw !== 'object') return { items: [], mode: 'random' }
  const r = raw as { items?: unknown; mode?: unknown }
  const mode: GnbBadgeMode = r.mode === 'sequential' ? 'sequential' : 'random'
  const list = Array.isArray(r.items) ? r.items : []
  const items: GnbBadgeItem[] = []
  for (const it of list) {
    if (!it || typeof it !== 'object') continue
    const o = it as Record<string, unknown>
    const url = safeImageUrl(o.url)
    if (!url) continue
    items.push({
      id: typeof o.id === 'string' && o.id ? o.id : url,
      url,
      path: typeof o.path === 'string' ? o.path : '',
      link: safeBadgeLink(o.link),
    })
  }
  return { items, mode }
}

/**
 * 이번에 보여줄 배지 순번을 고른다.
 * @param count 등록 개수
 * @param mode 노출 방식
 * @param lastShown 순서 노출에서 직전에 보여준 순번(없으면 null → 첫 번째부터)
 * @param rand 0~1 난수(테스트에서 고정 가능)
 */
export function pickBadgeIndex(count: number, mode: GnbBadgeMode, lastShown: number | null, rand: () => number = Math.random): number {
  if (count <= 0) return -1
  if (mode === 'sequential') {
    if (lastShown === null || !Number.isInteger(lastShown) || lastShown < 0) return 0
    return (lastShown + 1) % count
  }
  return Math.min(count - 1, Math.floor(rand() * count))
}
