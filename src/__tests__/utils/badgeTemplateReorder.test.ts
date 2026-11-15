import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** '배지 설정'(템플릿) 목록 드래그 정렬 — 화면·서버 액션·DB 함수 연결 */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8')

describe('배지 설정 목록 드래그 정렬', () => {
  it('화면: 설정 목록도 CmsDragList 로 그리고 순서 변경 시 reorderBadgeTemplates 를 호출한다', () => {
    const tab = read('src/lib/components/cms/badge/BadgeTab.svelte')
    expect(tab).toContain('<CmsDragList bind:items={orderedTemplates}')
    expect(tab).toContain("postBadgeAction('reorderBadgeTemplates'")
  })
  it('서버 액션: 권한 가드 후 RPC 호출', () => {
    const srv = read('src/routes/cms/promotion/ad/+page.server.ts')
    const a = srv.slice(srv.indexOf('reorderBadgeTemplates:'), srv.indexOf('createBanner:'))
    expect(a).toContain('badgeGuard(locals)')
    expect(a).toContain("'cms_reorder_badge_templates'")
  })
  it('DB 함수: 매니저 이상 확인 + anon 회수 + sort_order 갱신(#828 파일)', () => {
    const sql = read('supabase/migrations/20261114030000_828_product_badges.sql')
    const f = sql.slice(sql.indexOf('FUNCTION public.cms_reorder_badge_templates'), sql.indexOf('-- ─── 4. 고객 읽기 함수'))
    expect(f).toContain("cms_role IN ('manager', 'superadmin')")
    expect(f).toContain('SET sort_order = o.ord - 1')
    expect(f).toContain('REVOKE ALL ON FUNCTION public.cms_reorder_badge_templates(uuid[]) FROM PUBLIC, anon')
    expect(f).toContain('TO authenticated, service_role')
  })

  it('배지 목록 카드: 토글 오른쪽에 표준 삭제 버튼(CmsDeleteButton)을 둔다', () => {
    const tab = read('src/lib/components/cms/badge/BadgeTab.svelte')
    const actions = tab.slice(tab.indexOf('<div class="card-actions">'), tab.indexOf('{/snippet}', tab.indexOf('<div class="card-actions">')))
    expect(actions.indexOf('status-toggle')).toBeGreaterThan(-1)
    expect(actions.indexOf('<CmsDeleteButton action="?/deleteProductBadge"')).toBeGreaterThan(actions.indexOf('status-toggle'))
    expect(tab).toContain('if (selectedId === id) selectedId = null')
  })
})
