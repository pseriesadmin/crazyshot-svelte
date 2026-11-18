import { beforeEach, describe, expect, it, vi } from 'vitest'

// 동의어 불러오기 페이지 읽기 (2026-11-18, sp3 B-1) — PostgREST 기본 1000행 상한에서 오류 없이 잘리지 않고 끝까지 읽는지,
// 중간 실패 시 일부만 읽은 그룹을 캐시하지 않는지 고정한다.

const pages: { rows?: unknown[]; error?: unknown }[] = []
const rangeCalls: [number, number][] = []
const orderCalls: string[] = []

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        order: (col: string) => {
          orderCalls.push(col)
          return q
        },
        range: (from: number, to: number) => {
          rangeCalls.push([from, to])
          return q
        },
        returns: async () => {
          const p = pages.shift() ?? { rows: [] }
          return p.error ? { data: null, error: p.error } : { data: p.rows ?? [], error: null }
        },
      }
      return q
    },
  }),
}))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://x', PUBLIC_SUPABASE_ANON_KEY: 'k' }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))

function rows(n: number, canon: string, prefix: string) {
  return Array.from({ length: n }, (_, i) => ({ term: `${prefix}${i}`, synonym_groups: { canonical_term: canon } }))
}

beforeEach(() => {
  pages.length = 0
  rangeCalls.length = 0
  orderCalls.length = 0
  vi.resetModules()
})

describe('loadSynonymGroups 페이지 읽기', () => {
  it('1000행이 넘어도 id 정렬로 페이지를 이어 끝까지 읽는다', async () => {
    pages.push({ rows: rows(1000, 'A', 'a') }, { rows: rows(1000, 'B', 'b') }, { rows: rows(41, 'A', 'c') })
    const { loadSynonymGroups } = await import('$lib/server/synonymLearning')
    const groups = await loadSynonymGroups()
    expect(rangeCalls).toEqual([[0, 999], [1000, 1999], [2000, 2999]])
    expect(orderCalls.every((c) => c === 'id')).toBe(true)
    const total = groups.reduce((n, g) => n + g.confirmedTerms.length, 0)
    expect(total).toBe(2041)
    expect(groups.find((g) => g.canonicalTerm === 'A')?.confirmedTerms).toHaveLength(1041)
  })

  it('1000행 미만이면 한 번만 읽는다', async () => {
    pages.push({ rows: rows(10, 'A', 'a') })
    const { loadSynonymGroups } = await import('$lib/server/synonymLearning')
    await loadSynonymGroups()
    expect(rangeCalls).toEqual([[0, 999]])
  })

  it('중간 페이지가 실패하면 일부만 읽은 그룹을 돌려주지 않고 빈 배열로 폴백한다', async () => {
    pages.push({ rows: rows(1000, 'A', 'a') }, { error: { message: 'boom' } })
    const { loadSynonymGroups } = await import('$lib/server/synonymLearning')
    expect(await loadSynonymGroups()).toEqual([])
  })
})
