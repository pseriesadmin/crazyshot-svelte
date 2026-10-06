import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 크레이지로그 프로필 사진 연동(2026-10-05) — 개인정보 화면에서 올린 사진(user_profiles.avatar_url)을
 * 작성·목록·상세 화면의 사용자 카드가 그대로 쓴다. 로드 실패 시 이니셜로 되돌린다.
 */
const read = (p: string): string => readFileSync(p, 'utf-8')

describe('크레이지로그 아바타 연동', () => {
  it('작성 화면 서버: avatar_url 을 조회해 profile.avatarUrl 로 내려보낸다(null 고정 제거)', () => {
    const s = read('src/routes/crazylog/[slug]/+page.server.ts')
    expect(s).toContain("select('full_name, membership_grade, credit_score, cms_role, avatar_url')")
    expect(s).toContain('avatarUrl: profile?.avatar_url ?? null')
    expect(s).not.toMatch(/avatarUrl:\s*null/)
  })

  it('목록 서버: currentUser.avatarUrl 이 프로필 값', () => {
    const s = read('src/routes/crazylog/list/+page.server.ts')
    expect(s).toContain("cms_role, avatar_url')")
    expect(s).toContain('avatarUrl:       p?.avatar_url ?? null')
    expect(s).not.toMatch(/avatarUrl:\s*null/)
  })

  it('상세 서버: currentUser.avatarUrl 이 프로필 값', () => {
    const s = read('src/routes/crazylog/view/[slug]/+page.server.ts')
    expect(s).toContain('credit_score, avatar_url')
    expect(s).toContain('avatarUrl:   profileData?.avatar_url ?? null')
    expect(s).not.toMatch(/avatarUrl:\s*null/)
  })

  it('작성 화면(PC·모바일): 사진이 있으면 표시하고 로드 실패 시 이니셜로 되돌린다', () => {
    const s = read('src/routes/crazylog/[slug]/+page.svelte')
    expect(s).toContain('let avatarFailed = $state(false)')
    expect(s.match(/\{#if avatarUrl && !avatarFailed\}/g)?.length).toBe(2)
    expect(s.match(/onerror=\{\(\) => \(avatarFailed = true\)\}/g)?.length).toBe(2)
  })

  it('작성 카드(목록·상세 하단): 실패한 URL만 기억해 이니셜로 대체, URL이 바뀌면 재시도', () => {
    const s = read('src/lib/components/common/CrazylogWriteCard.svelte')
    expect(s).toContain('currentUser.avatarUrl && failedAvatarUrl !== currentUser.avatarUrl')
    expect(s).toContain('onerror={() => (failedAvatarUrl = currentUser?.avatarUrl ?? null)}')
  })
})
