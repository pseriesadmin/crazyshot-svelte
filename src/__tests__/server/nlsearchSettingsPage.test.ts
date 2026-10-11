/**
 * nlsearchSettingsPage.test.ts — CMS 검색 설정(/cms/set/search) 서버 계약(소스 스캔)
 * 로드·액션 모두 manager 이상 게이트, 저장은 서버 범위 검증 후 RPC + 감사로그, 메뉴는 manager+ 전용.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CMS_MENUS, roleAllowsMenuByDefault } from '$lib/constants/cmsMenus'

const src = readFileSync(join(process.cwd(), 'src/routes/cms/set/search/+page.server.ts'), 'utf-8')

describe('/cms/set/search 서버', () => {
  it('load는 hasSettingsAccess 게이트를 가진다', () => {
    expect(src).toMatch(/export const load[\s\S]*?hasSettingsAccess\(cmsRole\)/)
  })

  it('액션은 공용 authorize(세션 + getCmsRoleForAction + hasSettingsAccess)를 거친다', () => {
    expect(src).toContain('getCmsRoleForAction(locals)')
    expect(src).toMatch(/save: async[\s\S]*?authorize\(locals\)/)
    expect(src).toMatch(/restore: async[\s\S]*?authorize\(locals\)/)
    expect(src).not.toContain('locals.cmsRole')
  })

  it('저장·복원은 서버에서 범위를 검증하고 RPC로 저장하며 감사로그를 남긴다', () => {
    expect(src).toContain('validateNlsearchParams')
    expect(src).toContain("rpc('cms_save_nlsearch_settings'")
    expect(src).toContain("actionType: 'nlsearch_setting_change'")
    expect(src).not.toMatch(/\.from\('nlsearch_settings'\)\s*\.(insert|update|upsert)/)
  })
})

describe('settings.search 메뉴', () => {
  it('설정 메뉴에 있고 partner 기본 차단, manager 허용', () => {
    const keys = CMS_MENUS.find((m) => m.menu_key === 'settings')!.subMenus.map((s) => s.menu_key)
    expect(keys).toContain('settings.search')
    expect(roleAllowsMenuByDefault('partner', 'settings.search')).toBe(false)
    expect(roleAllowsMenuByDefault('manager', 'settings.search')).toBe(true)
  })
})
