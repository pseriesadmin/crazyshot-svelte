import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TDD-COMBO-MERGE — 조합코드 분류코드 합산 채번 버그 수정 (RED → GREEN)
 *
 * 버그: 콤보 내 코드가 2개 이상(예: 대+소)일 때, 현재 코드는 depth가 가장 높은
 *       단일 코드만 generate_product_code에 전달 → code_series.category_code에
 *       1개 코드만 저장. 반면 미리보기(comboCatCodeStr)는 전체 합산을 표시
 *       → 미리보기와 실제 채번값 불일치가 근본 원인.
 *
 * 수정 방향:
 *   - 신규 7-param generate_product_code 오버로드(migration 221) 추가
 *   - +page.server.ts 콤보 채번 호출부에서 p_category_code_override = 합산 문자열 전달
 *   - 모든 콤보 경로(6/5/3-param)를 7-param 단일 호출로 통일
 *
 * 검증:
 *   [RED] 2개 코드 콤보 RPC 호출 시 p_category_code_override 없음 → 실패(RED)
 *   [GREEN] 수정 후 p_category_code_override = 'CAMSLR' (TIER_ORDER 순 합산) → 통과
 *
 *   [EC-1] 단일 코드 콤보 → p_category_code_override = 'CAM'
 *   [EC-2] 비-콤보(combo_row_id 없음) → p_category_code_override 없음 (회귀 방지)
 *   [EC-3] 3단 콤보(대+중+소) → TIER_ORDER: major→middle→minor 합산 순서 검증
 *   [EC-4] 2단 계층(parent_max_sequence 있음) 콤보 → p_parent_max_sequence도 올바르게 전달
 */

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key' },
}))
vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}))

const createClientMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: (...args: unknown[]) => createClientMock(...args),
}))

const { actions } = await import('../../routes/cms/products/new/+page.server')

interface RpcCall {
  name: string
  params: Record<string, unknown>
}

// ── makeFlexChain ─────────────────────────────────────────────────────────────
// 어떤 Supabase 쿼리 체인에서도 await하면 { data, error } 반환하는 유연한 mock.
// .select().in().order().limit() 또는 .select().in() 등 다양한 체인 패턴을 지원.
function makeFlexChain(data: unknown) {
  const resolved = { data, error: null }
  const chain: Record<string, unknown> = {}
  for (const key of ['select', 'in', 'order', 'limit', 'eq', 'is', 'update', 'insert', 'single', 'maybeSingle', 'upsert']) {
    // eslint-disable-next-line security/detect-object-injection -- key는 고정 리터럴 배열 원소, 사용자 입력 아님
    chain[key] = vi.fn().mockReturnValue(chain)
  }
  // 직접 await 지원 (Promise thenable)
  chain.then = (onfulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolved).then(onfulfilled)
  return chain
}

// ── makeComboStub ────────────────────────────────────────────────────────────
function makeComboStub(options: {
  codes: Array<{ id: string; code: string; depth: number; code_tier: string }>
  parentMaxSequence?: number | null
  maxSequence?: number | null
}) {
  const rpcCalls: RpcCall[] = []
  const rpcFn = vi.fn((name: string, params: Record<string, unknown>) => {
    rpcCalls.push({ name, params })
    return Promise.resolve({ data: null, error: null })
  })

  const fromFn = vi.fn()

  // 1: slug 중복 체크 (select.eq.is.maybeSingle)
  fromFn.mockReturnValueOnce({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        is: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
        }),
      }),
    }),
  })

  // 2: products INSERT
  fromFn.mockReturnValueOnce({
    insert: vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: 'test-product-id' },
          error: null,
        }),
      }),
    }),
  })

  // 3: QR UPDATE
  fromFn.mockReturnValueOnce({
    update: vi.fn().mockReturnValue({
      eq: vi.fn().mockResolvedValue({ data: null, error: null }),
    }),
  })

  // 4: code_mapping_items (콤보 아이템 — 각 코드 id + 공통 속성)
  const comboItems = options.codes.map((c) => ({
    taxonomy_code_id: c.id,
    date_option: 'ym',
    max_sequence: options.maxSequence ?? null,
    parent_max_sequence: options.parentMaxSequence ?? null,
  }))
  fromFn.mockReturnValueOnce(makeFlexChain(comboItems))

  // 5: product_category_codes (모든 코드 조회 — 현재 코드는 limit(1), 수정 후 전체)
  //    makeFlexChain으로 체인 패턴에 무관하게 전체 rows 반환
  fromFn.mockReturnValueOnce(makeFlexChain(options.codes))

  // 이후: price_rules insert 등 — 성공 기본값
  fromFn.mockReturnValue({
    insert: vi.fn().mockResolvedValue({ data: null, error: null }),
  })

  return { from: fromFn, rpc: rpcFn, _rpcCalls: rpcCalls }
}

function makeLocals() {
  return {
    safeGetSession: async () => ({ session: { user: { id: 'test-admin-id' } } }),
  }
}

function makeComboRequest(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('name', 'Combo Product')
  fd.append('slug', 'combo-product')
  fd.append('category', 'camera')
  fd.append('is_active', 'true')
  fd.append('sale_only', 'false')
  fd.append('price_24h', '50000')
  fd.append('combo_row_id', 'combo-row-1')
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return { formData: async () => fd } as Request
}

async function callCreate(admin: ReturnType<typeof makeComboStub>) {
  createClientMock.mockReturnValue(admin)
  try {
    await actions.create({
      request: makeComboRequest(),
      locals: makeLocals(),
    } as Parameters<typeof actions.create>[0])
  } catch {
    // redirect — 무시
  }
  return admin._rpcCalls
}

beforeEach(() => {
  createClientMock.mockReset()
})

// ── 메인 RED 테스트: 2개 코드 콤보 ──────────────────────────────────────────
describe('COMBO-MERGE RED — 2개 코드(대+소) 콤보 채번 시 합산 override 전달', () => {
  it('[RED] CAM(major,depth=0) + SLR(minor,depth=2) 콤보 → p_category_code_override = "CAMSLR"', async () => {
    const admin = makeComboStub({
      codes: [
        { id: 'code-a', code: 'CAM', depth: 0, code_tier: 'major' },
        { id: 'code-b', code: 'SLR', depth: 2, code_tier: 'minor' },
      ],
      maxSequence: null,
      parentMaxSequence: null,
    })
    const rpcCalls = await callCreate(admin)

    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc, 'generate_product_code RPC가 호출돼야 함').toBeDefined()

    // [RED] 현재 코드는 p_category_code_override를 전달하지 않음 → 이 assertion이 실패(RED)
    // [GREEN] 수정 후 'CAMSLR' (major→minor TIER_ORDER 합산) 전달 → 통과
    expect(codeRpc?.params).toHaveProperty('p_category_code_override', 'CAMSLR')
  })
})

// ── EC-1 RED: 단일 코드 콤보도 override 전달 ────────────────────────────────
describe('EC-1 RED — 단일 코드 콤보 (p_category_code_override 단일값 전달)', () => {
  it('[RED] CAM(major,depth=0) 단일 콤보 → p_category_code_override = "CAM"', async () => {
    const admin = makeComboStub({
      codes: [{ id: 'code-a', code: 'CAM', depth: 0, code_tier: 'major' }],
      maxSequence: null,
      parentMaxSequence: null,
    })
    const rpcCalls = await callCreate(admin)

    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc).toBeDefined()
    expect(codeRpc?.params).toHaveProperty('p_category_code_override', 'CAM')
  })
})

// ── EC-3: 3단 콤보 TIER_ORDER 순서 검증 ─────────────────────────────────────
describe('EC-3 RED — 3단 콤보(대+중+소) TIER_ORDER 순서 = major→middle→minor', () => {
  it('[RED] CAM(major) + MIR(middle) + SLR(minor) → p_category_code_override = "CAMMIRSRL"', async () => {
    const admin = makeComboStub({
      // 의도적으로 역순 제공 → 정렬 후 major→middle→minor 순서 검증
      codes: [
        { id: 'code-c', code: 'SLR', depth: 2, code_tier: 'minor' },
        { id: 'code-a', code: 'CAM', depth: 0, code_tier: 'major' },
        { id: 'code-b', code: 'MIR', depth: 1, code_tier: 'middle' },
      ],
      maxSequence: 999,
      parentMaxSequence: 99,
    })
    const rpcCalls = await callCreate(admin)

    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc).toBeDefined()
    // TIER_ORDER: major(0)→middle(1)→minor(2) → "CAM"+"MIR"+"SLR" = "CAMMIRSLR"
    // (수정: 오타 'CAMMIRSRL' → 실제 연결 결과 'CAMMIRSLR')
    expect(codeRpc?.params).toHaveProperty('p_category_code_override', 'CAMMIRSLR')
  })
})

// ── EC-4: 2단 계층 콤보 p_parent_max_sequence 전달 확인 ─────────────────────
describe('EC-4 RED — 2단 계층 콤보 (p_parent_max_sequence 유지)', () => {
  it('[RED] parent_max_sequence=99 콤보 → 7-param에 p_parent_max_sequence = 99 전달', async () => {
    const admin = makeComboStub({
      codes: [
        { id: 'code-a', code: 'CAM', depth: 0, code_tier: 'major' },
        { id: 'code-b', code: 'SLR', depth: 2, code_tier: 'minor' },
      ],
      maxSequence: 999,
      parentMaxSequence: 99,
    })
    const rpcCalls = await callCreate(admin)

    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc).toBeDefined()
    expect(codeRpc?.params).toHaveProperty('p_category_code_override', 'CAMSLR')
    expect(codeRpc?.params).toHaveProperty('p_parent_max_sequence', 99)
    expect(codeRpc?.params).toHaveProperty('p_max_sequence', 999)
  })
})

// ── EC-2 회귀: 비-콤보 경로 → override 없음 ─────────────────────────────────
describe('EC-2 회귀 — 비-콤보(combo_row_id 없음) → p_category_code_override 없음', () => {
  it('combo_row_id 없는 단순 등록 → generate_product_code에 p_category_code_override 없음', async () => {
    const rpcCalls: RpcCall[] = []
    const rpcFn = vi.fn((name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params })
      return Promise.resolve({ data: null, error: null })
    })
    const fromFn = vi.fn()
    fromFn.mockReturnValueOnce({
      select: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
          }),
        }),
      }),
    })
    fromFn.mockReturnValueOnce({
      insert: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          single: vi.fn().mockResolvedValue({ data: { id: 'prod-id' }, error: null }),
        }),
      }),
    })
    fromFn.mockReturnValueOnce({
      update: vi.fn().mockReturnValue({
        eq: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    })
    fromFn.mockReturnValue({
      insert: vi.fn().mockResolvedValue({ data: null, error: null }),
    })
    createClientMock.mockReturnValue({ from: fromFn, rpc: rpcFn })

    const fd = new FormData()
    fd.append('name', 'Simple'); fd.append('slug', 'simple')
    fd.append('category', 'camera'); fd.append('is_active', 'true')
    fd.append('sale_only', 'false'); fd.append('price_24h', '50000')
    // combo_row_id 없음

    try {
      await actions.create({
        request: { formData: async () => fd } as Request,
        locals: makeLocals(),
      } as Parameters<typeof actions.create>[0])
    } catch { /* redirect 무시 */ }

    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc, 'generate_product_code가 호출돼야 함').toBeDefined()
    // 회귀 방지: 비-콤보 경로는 p_category_code_override 없음
    expect(codeRpc?.params).not.toHaveProperty('p_category_code_override')
  })
})
