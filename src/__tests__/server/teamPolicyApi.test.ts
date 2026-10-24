import { describe, it, expect, vi } from 'vitest'

vi.mock('@sveltejs/kit', () => ({
  json: (body: unknown, init?: { status?: number; headers?: Record<string, string> }) =>
    new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) } }),
}))

const { GET } = await import('../../routes/api/team-policy/+server')

function ev(rpcResult: { data: unknown; error: { message: string } | null }) {
  const rpc = vi.fn(async () => rpcResult)
  return { event: { locals: { supabase: { rpc } } } as never, rpc }
}

describe('GET /api/team-policy (공개)', () => {
  it('저장된 블록을 정화해서 돌려준다(스크립트 제거)', async () => {
    const { event, rpc } = ev({ data: { content_blocks: [{ type: 'text', html: '<p>팀 소개</p><script>alert(1)</script>' }, { type: 'divider' }] }, error: null })
    const res = await (GET as (e: never) => Promise<Response>)(event)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(rpc).toHaveBeenCalledWith('get_team_policy_settings')
    expect(body.ok).toBe(true)
    expect(JSON.stringify(body.blocks)).toContain('팀 소개')
    expect(JSON.stringify(body.blocks)).not.toMatch(/script/i)
    expect(body.blocks).toHaveLength(2)
  })
  it('내용이 없으면 빈 배열', async () => {
    const { event } = ev({ data: { content_blocks: [] }, error: null })
    const body = await (await (GET as (e: never) => Promise<Response>)(event)).json()
    expect(body).toEqual({ ok: true, blocks: [] })
  })
  it('조회 오류면 500과 안내 문구(내부 오류 내용은 노출하지 않는다)', async () => {
    const { event } = ev({ data: null, error: { message: 'relation "x" does not exist' } })
    const res = await (GET as (e: never) => Promise<Response>)(event)
    expect(res.status).toBe(500)
    const text = JSON.stringify(await res.json())
    expect(text).not.toContain('relation')
  })
})
