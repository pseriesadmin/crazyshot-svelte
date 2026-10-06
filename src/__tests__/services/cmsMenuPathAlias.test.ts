import { describe, it, expect } from 'vitest'
import { CMS_MENUS, CMS_MENU_PATH_ALIASES, findCmsMenuKeyForPath, hasMenuAccess } from '$lib/constants/cmsMenus'

/**
 * GNB에 없는 화면 경로의 메뉴 키 편입 — /cms/rentals(대여현황)를 rental.reservation(예약대여현황)에 연결 (1c, 2026-10-03)
 * 불변조건: 기존 모든 메뉴 경로의 매핑은 그대로, 별칭은 오직 자기 경로만 새로 연결한다.
 */
describe('CMS_MENU_PATH_ALIASES', () => {
  it('/cms/rentals(대여현황)와 하위 경로가 rental.reservation으로 매핑된다', () => {
    expect(findCmsMenuKeyForPath('/cms/rentals')).toBe('rental.reservation')
    expect(findCmsMenuKeyForPath('/cms/rentals/abc')).toBe('rental.reservation')
  })

  it('기존 메뉴 경로의 매핑은 모두 불변 — 각 메뉴 href는 자기 키로 매핑 (회귀 고정)', () => {
    for (const m of CMS_MENUS) {
      if (m.href && m.href !== '/cms') expect(findCmsMenuKeyForPath(m.href), m.href).toBe(m.menu_key)
      for (const s of m.subMenus) if (s.href) expect(findCmsMenuKeyForPath(s.href), s.href).toBe(s.menu_key)
    }
    expect(findCmsMenuKeyForPath('/cms')).toBe('dashboard')
  })

  it('접두사가 비슷한 다른 경로는 별칭의 영향을 받지 않는다', () => {
    expect(findCmsMenuKeyForPath('/cms/rental/history')).toBe('rental.history') // /cms/rentals가 아님
    expect(findCmsMenuKeyForPath('/cms/reservation')).toBe('rental.reservation')
    expect(findCmsMenuKeyForPath('/cms/rentalsX')).toBeNull() // 경계: 슬래시 구분
  })

  it('통제 밖으로 남는 경로는 그대로 null (이번 단계 범위 밖)', () => {
    expect(findCmsMenuKeyForPath('/cms/mobile')).toBe('rental.reservation') // 1g(2026-10-05)부터 예약대여현황 권한을 따름
    expect(findCmsMenuKeyForPath('/cms/set/signature')).toBeNull()
    expect(findCmsMenuKeyForPath('/cms/accounts/list')).toBeNull()
  })

  it('별칭 키가 실존하고 OFF 오버라이드 시 대여현황 접근이 막힌다(파트너·매니저)', () => {
    for (const a of CMS_MENU_PATH_ALIASES) {
      const key = findCmsMenuKeyForPath(a.href)!
      expect(hasMenuAccess('partner', [], key)).toBe(true)
      expect(hasMenuAccess('partner', [{ menu_key: key, allowed: false }], key)).toBe(false)
      expect(hasMenuAccess('manager', [{ menu_key: key, allowed: false }], key)).toBe(false)
    }
  })

  it('별칭은 GNB 메뉴 목록(CMS_MENUS)에 새 항목을 만들지 않는다', () => {
    const hrefs = CMS_MENUS.flatMap((m) => [m.href, ...m.subMenus.map((s) => s.href)])
    expect(hrefs).not.toContain('/cms/rentals')
  })
})
