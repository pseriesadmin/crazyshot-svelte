import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 크레이지로그 상세 — 조회수 form action(?/view) (2026-11-26)
 *  · 글 id 가 UUID 형식이 아니면 집계 함수를 부르지 않는다
 *  · https 요청이면 secure=true, http(로컬)이면 secure=false 로 넘긴다
 *  · 집계는 load 가 아니라 이 action 에서만 일어난다(hover 프리로드로 조회수가 오르지 않게)
 */

const countPostView = vi.fn(async (..._a: unknown[]) => undefined)
const loadTopViewedPosts = vi.fn(async (..._a: unknown[]) => [])
vi.mock('$lib/server/crazylogViews', () => ({
  countPostView: (...a: unknown[]) => countPostView(...a),
  loadTopViewedPosts: (...a: unknown[]) => loadTopViewedPosts(...a),
}))
vi.mock('$lib/server/sanitizeCrazylogHtml', () => ({ sanitizeCrazylogBlocks: (b: unknown) => b }))

const { actions, load } = await import('../../routes/crazylog/view/[slug]/+page.server')

const ID = '11111111-1111-4111-8111-111111111111'

function actionEvent(slug: string, href: string) {
  return { params: { slug }, cookies: { get: () => undefined, set: () => {} }, url: new URL(href) } as never
}

beforeEach(() => {
  countPostView.mockClear()
  loadTopViewedPosts.mockClear()
})

describe('actions.view', () => {
  it('UUID 형식이 아니면 집계 함수를 부르지 않고 counted:false', async () => {
    const res = await actions.view(actionEvent('not-a-uuid', 'https://x.test/crazylog/view/not-a-uuid?/view'))
    expect(res).toEqual({ counted: false })
    expect(countPostView).not.toHaveBeenCalled()
  })

  it('https 요청이면 secure=true 로 집계한다', async () => {
    const res = await actions.view(actionEvent(ID, `https://x.test/crazylog/view/${ID}?/view`))
    expect(res).toEqual({ counted: true })
    expect(countPostView).toHaveBeenCalledTimes(1)
    expect(countPostView.mock.calls[0][1]).toBe(ID)
    expect(countPostView.mock.calls[0][2]).toBe(true)
  })

  it('로컬 http 요청이면 secure=false 로 집계한다', async () => {
    await actions.view(actionEvent(ID, `http://localhost:5173/crazylog/view/${ID}?/view`))
    expect(countPostView.mock.calls[0][2]).toBe(false)
  })
})

describe('load', () => {
  it('소스 가드: load 본문 어디에도 countPostView 호출이 없다(글이 있는 경로 포함)', () => {
    const src = readFileSync(resolve(__dirname, '../../routes/crazylog/view/[slug]/+page.server.ts'), 'utf-8')
    const loadStart = src.indexOf('export const load')
    const actionsStart = src.indexOf('export const actions')
    expect(loadStart).toBeGreaterThan(-1)
    expect(actionsStart).toBeGreaterThan(loadStart)
    expect(src.slice(loadStart, actionsStart)).not.toMatch(/countPostView\s*\(/)
  })

  it('글이 없는 경로의 load 도 조회수를 올리지 않는다', async () => {
    const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => ({ data: null }) }
    const locals = { safeGetSession: async () => ({ session: null }), supabase: { from: () => chain } }
    await load({ locals, params: { slug: ID } } as never)
    expect(countPostView).not.toHaveBeenCalled()
  })
})
