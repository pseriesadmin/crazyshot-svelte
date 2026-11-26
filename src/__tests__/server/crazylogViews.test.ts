import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Cookies } from '@sveltejs/kit'

/**
 * 크레이지로그 조회수 집계 + '많이 본 로그' 조회 (2026-11-26, Migration #851)
 *  · countPostView: 쿠키 중복 제외, 서비스 키 없음/RPC 오류/예외 시 화면을 막지 않음(fail-soft), 쿠키 최대 30개·맨 앞 삽입·위조값 제외, secure 옵션 전달
 *  · loadTopViewedPosts: 게시·공개·같은 분류·현재 글 제외·조회수 내림차순·최신순 보조·10개, 오류/빈 분류는 빈 목록, 썸네일 대체
 */

const env = { SUPABASE_SERVICE_ROLE_KEY: 'svc' } as Record<string, string | undefined>
vi.mock('$env/dynamic/private', () => ({ env }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://test.supabase.co' }))

const rpc = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc }) }))

const { countPostView, loadTopViewedPosts, TOP_VIEWED_LIMIT } = await import('$lib/server/crazylogViews')

const ID = '11111111-1111-4111-8111-111111111111'
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

function makeCookies(initial?: string) {
  const set = vi.fn()
  const cookies = { get: (name: string) => (name === 'cs_clv' ? initial : undefined), set } as unknown as Cookies
  return { cookies, set }
}

beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ error: null })
  env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

describe('countPostView', () => {
  it('처음 보는 글이면 서버 함수를 호출하고 쿠키에 id 를 맨 앞으로 기록한다', async () => {
    const { cookies, set } = makeCookies(uuid(1))
    await countPostView(cookies, ID)
    expect(rpc).toHaveBeenCalledWith('increment_crazylog_post_view', { p_post_id: ID })
    expect(set).toHaveBeenCalledTimes(1)
    const [name, value, opts] = set.mock.calls[0]
    expect(name).toBe('cs_clv')
    expect(value).toBe(`${ID},${uuid(1)}`)
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/', secure: true })
  })

  it('쿠키에 이미 있는 글이면 호출하지 않는다(새로고침 중복 제외)', async () => {
    const { cookies, set } = makeCookies(`${uuid(1)},${ID}`)
    await countPostView(cookies, ID)
    expect(rpc).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('secure 옵션을 호출자가 넘긴 값으로 쿠키에 반영한다(로컬 http)', async () => {
    const { cookies, set } = makeCookies()
    await countPostView(cookies, ID, false)
    expect(set.mock.calls[0][2]).toMatchObject({ secure: false })
  })

  it('서비스 키가 없으면 호출하지 않고 오류도 내지 않는다', async () => {
    env.SUPABASE_SERVICE_ROLE_KEY = undefined
    const { cookies, set } = makeCookies()
    await expect(countPostView(cookies, ID)).resolves.toBeUndefined()
    expect(rpc).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('서버 함수가 오류를 돌려주면 쿠키를 남기지 않고 예외도 내지 않는다(fail-soft)', async () => {
    rpc.mockResolvedValue({ error: { message: 'boom' } })
    const { cookies, set } = makeCookies()
    await expect(countPostView(cookies, ID)).resolves.toBeUndefined()
    expect(set).not.toHaveBeenCalled()
  })

  it('서버 함수 호출이 예외를 던져도 삼킨다', async () => {
    rpc.mockRejectedValue(new Error('network'))
    const { cookies, set } = makeCookies()
    await expect(countPostView(cookies, ID)).resolves.toBeUndefined()
    expect(set).not.toHaveBeenCalled()
  })

  it('쿠키는 최대 30개까지만 유지하고 새 id 가 맨 앞이다', async () => {
    const seen = Array.from({ length: 30 }, (_, i) => uuid(i + 1)).join(',')
    const { cookies, set } = makeCookies(seen)
    await countPostView(cookies, ID)
    const ids = String(set.mock.calls[0][1]).split(',')
    expect(ids).toHaveLength(30)
    expect(ids[0]).toBe(ID)
    expect(ids).not.toContain(uuid(30))
  })

  it('형식이 맞지 않는 위조 쿠키 값은 무시한다', async () => {
    const { cookies, set } = makeCookies(`<script>,not-a-uuid,${uuid(2)}`)
    await countPostView(cookies, ID)
    expect(String(set.mock.calls[0][1])).toBe(`${ID},${uuid(2)}`)
  })
})

// supabase 조회 체인 모의 — 호출된 조건을 기록하고 마지막에 { data, error } 를 돌려준다
function makeQuery(result: { data: unknown; error: { message: string } | null }) {
  const calls: Array<[string, ...unknown[]]> = []
  const q: Record<string, unknown> = {}
  for (const m of ['select', 'eq', 'neq', 'order', 'limit']) {
    q[m] = (...a: unknown[]) => {
      calls.push([m, ...a])
      return m === 'limit' ? Promise.resolve(result) : q
    }
  }
  const client = { from: (t: string) => { calls.push(['from', t]); return q } }
  return { client: client as never, calls }
}

describe('loadTopViewedPosts', () => {
  it('게시·공개·같은 분류·현재 글 제외·조회수 순·최신순 보조·10개 조건으로 조회한다', async () => {
    const { client, calls } = makeQuery({ data: [], error: null })
    await loadTopViewedPosts(client, '상품리뷰', ID)
    expect(calls).toContainEqual(['from', 'user_posts'])
    expect(calls).toContainEqual(['eq', 'status', 'published'])
    expect(calls).toContainEqual(['eq', 'is_public', true])
    expect(calls).toContainEqual(['eq', 'log_type', '상품리뷰'])
    expect(calls).toContainEqual(['neq', 'id', ID])
    const orders = calls.filter((c) => c[0] === 'order')
    expect(orders[0]).toEqual(['order', 'view_count', { ascending: false }])
    expect(orders[1]).toEqual(['order', 'created_at', { ascending: false }])
    expect(calls).toContainEqual(['limit', TOP_VIEWED_LIMIT])
    expect(TOP_VIEWED_LIMIT).toBe(10)
  })

  it('분류가 비어 있으면 조회하지 않고 빈 목록을 돌려준다', async () => {
    const { client, calls } = makeQuery({ data: [], error: null })
    expect(await loadTopViewedPosts(client, '', ID)).toEqual([])
    expect(calls).toHaveLength(0)
  })

  it('조회 오류면 빈 목록을 돌려준다', async () => {
    const { client } = makeQuery({ data: null, error: { message: 'fail' } })
    expect(await loadTopViewedPosts(client, '상품리뷰', ID)).toEqual([])
  })

  it('썸네일이 없으면 본문 첫 이미지로 대체하고, 조회수 null 은 0 으로 본다', async () => {
    const { client } = makeQuery({
      data: [
        { id: 'a', title: 'A', log_type: '상품리뷰', content_blocks: [{ type: 'text' }, { type: 'image', images: [{ url: 'https://img/1.png' }] }], thumbnail_url: null, created_at: '2026-11-01T00:00:00Z', view_count: null },
        { id: 'b', title: 'B', log_type: '상품리뷰', content_blocks: [], thumbnail_url: 'https://thumb/b.png', created_at: '2026-11-02T00:00:00Z', view_count: 7 },
        { id: 'c', title: 'C', log_type: null, content_blocks: null, thumbnail_url: '', created_at: '2026-11-03T00:00:00Z', view_count: 3 },
      ],
      error: null,
    })
    const rows = await loadTopViewedPosts(client, '상품리뷰', ID)
    expect(rows.map((r) => r.thumbnailUrl)).toEqual(['https://img/1.png', 'https://thumb/b.png', null])
    expect(rows.map((r) => r.viewCount)).toEqual([0, 7, 3])
    expect(rows[2].logType).toBe('')
  })
})
