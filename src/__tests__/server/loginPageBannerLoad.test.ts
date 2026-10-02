import { describe, it, expect } from 'vitest'
import { load } from '../../routes/auth/login/+page.server'

/**
 * /auth/login load — 관리 모달이 저장한 배너·설정을 읽는다 (2026-10-02)
 * banners(login_pc/login_mobile) + cms_settings.login_banner_mode. 배너가 없거나 조회가 실패하면 기존 고정 배너,
 * mobile_visible=false 면 모바일 배너 영역 숨김 플래그.
 */

type Rows = Record<string, unknown>
function makeLocals(opts: { pc?: Rows[]; mobile?: Rows[]; settings?: unknown; fail?: boolean }) {
  const calls: string[] = []
  const from = (table: string) => {
    calls.push(table)
    let slot = ''
    const chain: Record<string, unknown> = {}
    chain.select = () => chain
    chain.eq = (_c: string, v: string) => { slot = v; return chain }
    chain.is = () => chain
    chain.order = () => chain
    chain.maybeSingle = () => Promise.resolve({ data: opts.settings === undefined ? null : { value: opts.settings }, error: null })
    chain.then = (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
      if (opts.fail) return Promise.reject(new Error('db down')).then(res, rej)
      const data = slot === 'login_pc' ? (opts.pc ?? []) : (opts.mobile ?? [])
      return Promise.resolve({ data, error: null }).then(res, rej)
    }
    return chain
  }
  return { locals: { safeGetSession: async () => ({ session: null }), supabase: { from } }, calls }
}
const run = async (o: Parameters<typeof makeLocals>[0]) => {
  const { locals, calls } = makeLocals(o)
  const data = (await load({ locals, url: new URL('http://localhost/auth/login') } as unknown as Parameters<typeof load>[0])) as Record<string, unknown>
  return { data, calls }
}
const b = (id: string) => ({ id, title: `T${id}`, sub_copy: 'S', image_url: `https://x/${id}.png`, link_url: null })

describe('/auth/login load — 배너 연동', () => {
  it('배너·설정이 없으면 기존 고정 배너, 모바일 노출', async () => {
    const { data } = await run({})
    expect(data.pcBanners).toEqual([])
    expect(data.mobileBanners).toEqual([])
    expect(data.mobileVisible).toBe(true)
    expect((data.banner as { html_content: string }).html_content).toContain('m-welcome-kr')
  })
  it('등록된 PC·모바일 배너를 sort_order 순서 목록으로 반환(순서대로 노출)', async () => {
    const { data } = await run({ pc: [b('p1'), b('p2')], mobile: [b('m1')] })
    expect((data.pcBanners as { id: string }[]).map((x) => x.id)).toEqual(['p1', 'p2'])
    expect((data.mobileBanners as { id: string }[]).map((x) => x.id)).toEqual(['m1'])
  })
  it('랜덤 노출 설정이면 전부 포함한 목록(순서는 섞일 수 있음)', async () => {
    const { data } = await run({ pc: [b('p1'), b('p2'), b('p3')], settings: { pc_mode: 'random', mobile_mode: 'fixed', mobile_visible: true } })
    expect((data.pcBanners as { id: string }[]).map((x) => x.id).sort()).toEqual(['p1', 'p2', 'p3'])
  })
  it('mobile_visible=false 설정이면 숨김 플래그 false', async () => {
    const { data } = await run({ mobile: [b('m1')], settings: { pc_mode: 'fixed', mobile_mode: 'fixed', mobile_visible: false } })
    expect(data.mobileVisible).toBe(false)
  })
  it('존재하지 않는 promotion_banners·page_settings 는 더 이상 조회하지 않는다', async () => {
    const { calls } = await run({})
    expect(calls).not.toContain('promotion_banners')
    expect(calls).not.toContain('page_settings')
    expect(calls.filter((t) => t === 'banners').length).toBe(2)
    expect(calls).toContain('cms_settings')
  })
  it('조회 실패 시 기존 고정 배너로 안전 대체', async () => {
    const { data } = await run({ fail: true })
    expect(data.pcBanners).toEqual([])
    expect(data.mobileBanners).toEqual([])
    expect(data.mobileVisible).toBe(true)
  })
})
