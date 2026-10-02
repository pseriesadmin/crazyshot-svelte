/**
 * 로그인 화면 배너(PC·모바일) — 설정 해석·노출 배너 선택 (2026-10-02)
 *
 * 관리: 로그인 화면의 "배너 관리"(LoginBannerModal) — 배너는 banners 테이블(slot_key 'login_pc'/'login_mobile'),
 * 노출 설정은 cms_settings.login_banner_mode { pc_mode, mobile_mode, mobile_visible }.
 */

export type LoginBannerMode = 'fixed' | 'random'

export interface LoginBannerSettings {
  pcMode: LoginBannerMode
  mobileMode: LoginBannerMode
  /** false 일 때만 모바일 로그인 화면의 배너 영역 전체를 숨긴다 */
  mobileVisible: boolean
}

export interface LoginBannerRow {
  id: string
  title: string | null
  sub_copy: string | null
  image_url: string
  link_url: string | null
}

const toMode = (v: unknown): LoginBannerMode => (v === 'random' ? 'random' : 'fixed')

export function parseLoginBannerSettings(value: unknown): LoginBannerSettings {
  const v = value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
  return {
    pcMode: toMode(v.pc_mode),
    mobileMode: toMode(v.mobile_mode),
    // 엄격 판정 — 설정이 없거나 값이 이상하면 노출(기존 동작 보호)
    mobileVisible: v.mobile_visible !== false,
  }
}

/**
 * 노출할 배너 목록을 순서대로 만든다(회전 노출용). rows 는 sort_order 순으로 정렬돼 있어야 한다.
 * fixed = 등록 순서 그대로, random = 섞은 순서(서버에서 한 번 섞어 내려보내 첫 화면 깜빡임을 막는다).
 * 이미지 없는 행은 제외하며 원본 배열은 바꾸지 않는다.
 */
export function orderLoginBanners(rows: LoginBannerRow[], mode: LoginBannerMode, rand: () => number = Math.random): LoginBannerRow[] {
  const usable = rows.filter((r) => !!r.image_url)
  if (mode === 'fixed') return usable
  for (let i = usable.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rand() * (i + 1)))
    ;[usable[i], usable[j]] = [usable[j], usable[i]]
  }
  return usable
}

/** 관리자가 입력한 배너 링크를 안전한 주소만 통과시킨다 — 내부 경로('/…', '//' 제외)와 http(s)만 허용, 그 외(javascript: 등)는 null */
export function safeBannerHref(url: string | null | undefined): string | null {
  const v = (url ?? '').trim()
  if (!v) return null
  if (v.startsWith('/') && !v.startsWith('//')) return v
  if (/^https?:\/\/[^\s]+$/i.test(v)) return v
  return null
}
