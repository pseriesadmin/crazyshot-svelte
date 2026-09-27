import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * ③ 사양·구성품 순서 저장 — [{key,value}] 배열 형식 (TDD RED→GREEN)
 * 대상: cms/products updateSection specs/components, products/new create,
 *       formatComponentsText, extractJsonbKeyValues
 */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))
const createClientMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => createClientMock(...a) }))
const { actions } = await import('../../routes/cms/products/+page.server')
const { formatComponentsText } = await import('$lib/utils/contractLineItems')
const { extractJsonbKeyValues } = await import('$lib/server/searchEngine/adapters/productSearchIndex')

function makeAdmin() {
  const updates: Record<string, unknown>[] = []
  const from = vi.fn()
  from.mockReturnValueOnce({
    select: () => ({ eq: () => ({ single: async () => ({ data: { parent_product_id: null }, error: null }) }) }),
  })
  from.mockReturnValue({
    update: (payload: Record<string, unknown>) => {
      updates.push(payload)
      return { eq: async () => ({ data: null, error: null }) }
    },
  })
  return { admin: { from, rpc: vi.fn().mockResolvedValue({ data: null, error: null }) }, updates }
}

async function call(section: string, field: string, value: string) {
  const fd = new FormData()
  fd.append('product_id', 'p1')
  fd.append('section_type', section)
  fd.append(field, value)
  return actions.updateSection({
    request: { formData: async () => fd } as Request,
    locals: { safeGetSession: async () => ({ session: { user: { id: 'a' } } }) },
  } as Parameters<typeof actions.updateSection>[0])
}

beforeEach(() => createClientMock.mockReset())

describe('updateSection — 사양·구성품은 순서 보존 배열로 저장', () => {
  for (const [section, field] of [['specs', 'specifications'], ['components', 'components']] as const) {
    it(`${section}: 배열 입력 → 순서·중복 키 보존 배열 저장(빈 키 제외)`, async () => {
      const { admin, updates } = makeAdmin()
      createClientMock.mockReturnValue(admin)
      await call(section, field, JSON.stringify([
        { key: 'zebra', value: '1' }, { key: '', value: 'x' }, { key: 'apple', value: '2' }, { key: 'apple', value: '3' },
      ]))
      expect(updates[0][field]).toEqual([
        { key: 'zebra', value: '1' }, { key: 'apple', value: '2' }, { key: 'apple', value: '3' },
      ])
    })
    it(`${section}: 레거시 객체 입력도 배열로 저장`, async () => {
      const { admin, updates } = makeAdmin()
      createClientMock.mockReturnValue(admin)
      await call(section, field, JSON.stringify({ a: '1', b: '2' }))
      expect(updates[0][field]).toEqual([{ key: 'a', value: '1' }, { key: 'b', value: '2' }])
    })
  }
})

describe('formatComponentsText — 배열형', () => {
  it('배열 순서대로 "key: value, key" 텍스트', () => {
    expect(formatComponentsText([{ key: 'z', value: '1' }, { key: 'a', value: '' }])).toBe('z: 1, a')
  })
  it('빈 배열은 -', () => {
    expect(formatComponentsText([])).toBe('-')
  })
})

describe('extractJsonbKeyValues — 배열형', () => {
  it('배열의 key·value를 순서대로 공백 연결', () => {
    expect(extractJsonbKeyValues([{ key: '배터리', value: '1개' }, { key: '케이블', value: '2개' }])).toBe('배터리 1개 케이블 2개')
  })
})
