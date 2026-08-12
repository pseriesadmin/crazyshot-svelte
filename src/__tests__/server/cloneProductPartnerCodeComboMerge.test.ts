import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TDD-CLONE-PARTNERCODE — cloneProduct new_product 파트너코드 조합 합산 채번 버그 수정
 *
 * 버그: +page.server.ts cloneProduct 액션 new_product 모드 파트너코드 분기(1076-1178행)에서
 *   code_mapping_items의 taxonomy_code_id만 수집하고 depth=1 subCode 단 하나만
 *   generate_product_code에 전달 → 콤보에 코드가 2개 이상이어도 1개만 채번에 반영.
 *   반면 UI 미리보기(comboCatCodeStr)는 전체 합산을 표시 → 미리보기와 실제 채번 불일치.
 *
 * 수정 방향:
 *   - code_mapping_items: date_option/max_sequence/parent_max_sequence도 함께 select
 *   - product_category_codes: tcIds 전체 depth 무관 조회 → buildComboCategoryCode() 합산
 *   - BND-PARTNERCODE-1 검증(depth=0→depth=1 확인)은 그대로 유지, 판정 로직과 채번 코드값 분리
 *   - RPC 호출: 기존 3-param → 7-param(p_category_code_override) 교체
 *   - 재사용: buildComboCategoryCode()/getRootCode() (comboCategoryCode.ts, GATE E 통과)
 *            + generate_product_code 7-param 오버로드 (migration 222, stage 검증 완료)
 *
 * 검증:
 *   [RED] 2개 코드 콤보 RPC 호출 시 p_category_code_override 없음 → 실패(RED)
 *   [GREEN] 수정 후 p_category_code_override = 'LENPTS' (TIER_ORDER 합산) → 통과
 *   [EC-1] 단일 코드(depth=1 middle) → p_category_code_override = 'PTS'
 *   [EC-2] BND-PARTNERCODE-1: 카테고리 불일치 콤보 → fail(400) 차단 (현행 유지 회귀)
 *   [EC-3] 3단 콤보(대+중+소) 역순 입력 → TIER_ORDER 정렬 후 'LENPTSCAM' 합산
 *   [EC-4] date_option/max_sequence/parent_max_sequence → 7-param에 정확히 전달
 */

// ── 모듈 모킹 ────────────────────────────────────────────────────────────────
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

const { actions } = await import('../../routes/cms/products/+page.server')

// ── 소스 상품 스텁 ─────────────────────────────────────────────────────────
const FAKE_SOURCE = {
  id: 'source-product-id',
  category: 'lens',
  name: 'Test Lens',
  slug: 'test-lens',
  brand: 'Sony',
  description: null,
  product_caption: null,
  image_urls: [],
  specifications: null,
  sale_price: null,
  sale_only: false,
  product_code: null,
  code_series: null,
  parent_product_id: null,
  content_blocks: [],
  keywords: [],
}

// ── makeFlexChain: 체인 패턴에 무관하게 data를 반환하는 유연한 mock ──────
function makeFlexChain(data: unknown) {
  const resolved = { data, error: null }
  const chain: Record<string, unknown> = {}
  for (const key of [
    'select', 'in', 'order', 'limit', 'eq', 'is', 'not', 'neq',
    'insert', 'update', 'upsert', 'single', 'maybeSingle',
  ]) {
    // eslint-disable-next-line security/detect-object-injection -- key는 고정 리터럴 배열 원소, 사용자 입력 아님
    chain[key] = vi.fn().mockReturnValue(chain)
  }
  // 직접 await 지원 (Promise thenable)
  chain.then = (onfulfilled: (v: unknown) => unknown) =>
    Promise.resolve(resolved).then(onfulfilled)
  return chain
}

// ── makeTableAwareAdmin: 테이블명 + 호출 순서 기반 스마트 mock ──────────────
// GREEN 설계(7개 from 호출): products(1), code_mapping_items(1), product_category_codes(3),
//   price_rules(1), products(2), products(3)=INSERT
// RED(현재): products(1), code_mapping_items(1), product_category_codes(2),
//   price_rules(1), products(2), products(3)=INSERT — allCodes 호출 없음
// → 테이블별 카운터로 양쪽 시나리오 모두 정상 동작
interface ComboCode { id: string; code: string; depth: number; code_tier: string }

function makeTableAwareAdmin(options: {
  codes: ComboCode[]
  maxSequence?: number | null
  parentMaxSequence?: number | null
  subCodeData?: { id: string } | null  // null = BND-PARTNERCODE-1 불일치
}) {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = []
  const rpcFn = vi.fn((name: string, params: Record<string, unknown>) => {
    rpcCalls.push({ name, params })
    return Promise.resolve({ data: null, error: null })
  })

  const comboItems = options.codes.map((c) => ({
    taxonomy_code_id: c.id,
    date_option: 'ym',
    max_sequence: options.maxSequence ?? null,
    parent_max_sequence: options.parentMaxSequence ?? null,
  }))

  // 테이블별 호출 카운터
  const tableCallCount: Record<string, number> = {}

  const fromFn = vi.fn((table: string) => {
    // eslint-disable-next-line security/detect-object-injection -- table은 Supabase .from() 호출 인자, 테스트 내부 고정 문자열
    tableCallCount[table] = (tableCallCount[table] ?? 0) + 1
    // eslint-disable-next-line security/detect-object-injection -- 위와 동일 사유
    const n = tableCallCount[table]

    if (table === 'products') {
      if (n === 1) return makeFlexChain(FAKE_SOURCE)   // source lookup
      if (n === 2) return makeFlexChain(null)           // slug check → existing=null → break
      // n === 3: INSERT
      return {
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            single: vi.fn().mockResolvedValue({
              data: { id: 'cloned-product-id' },
              error: null,
            }),
          }),
        }),
      }
    }

    if (table === 'code_mapping_items') {
      // 현재(RED): select('taxonomy_code_id')만 — comboItems에 taxonomy_code_id 포함이라 동작
      // 수정후(GREEN): select('taxonomy_code_id, date_option, ...') — 추가 필드도 반환
      return makeFlexChain(comboItems)
    }

    if (table === 'product_category_codes') {
      if (n === 1) return makeFlexChain({ id: 'main-cat-id' })          // mainCode (depth=0)
      if (n === 2) return makeFlexChain(options.subCodeData ?? null)     // subCode (BND 검증)
      // n === 3: allCodes (post-fix: buildComboCategoryCode용 전체 조회)
      return makeFlexChain(options.codes)
    }

    if (table === 'price_rules') {
      if (n === 1) return makeFlexChain([])  // source price rules (empty → insert 스킵)
      // n === 2: insert (loop 내부, sourcePriceRules=[]이면 도달 안 함)
      return { insert: vi.fn().mockResolvedValue({ data: null, error: null }) }
    }

    return makeFlexChain(null)
  })

  return { from: fromFn, rpc: rpcFn, _rpcCalls: rpcCalls }
}

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────
function makeLocals() {
  return {
    safeGetSession: async () => ({ session: { user: { id: 'test-admin-id' } } }),
  }
}

function makeCloneRequest(overrides: Record<string, string> = {}) {
  const fd = new FormData()
  fd.append('source_product_id', 'source-product-id')
  fd.append('mode', 'new_product')
  fd.append('partner_code', 'true')
  fd.append('partner_combo_row_id', 'combo-row-1')
  fd.append('count', '1')
  for (const [k, v] of Object.entries(overrides)) fd.set(k, v)
  return { formData: async () => fd } as Request
}

async function callCloneAndGetRpc(
  admin: ReturnType<typeof makeTableAwareAdmin>,
  overrides: Record<string, string> = {},
) {
  createClientMock.mockReturnValue(admin)
  const result = await actions.cloneProduct({
    request: makeCloneRequest(overrides),
    locals: makeLocals(),
  } as Parameters<typeof actions.cloneProduct>[0])
  return { rpcCalls: admin._rpcCalls, result }
}

beforeEach(() => {
  createClientMock.mockReset()
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 메인 RED: 2개 코드(대+중) 콤보 → p_category_code_override = 'LENPTS'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('PARTNER-COMBO-MERGE RED — 2개 코드 콤보 채번 시 합산 override 전달', () => {
  it('[RED] LEN(major,depth=0) + PTS(middle,depth=1) → p_category_code_override = "LENPTS"', async () => {
    const admin = makeTableAwareAdmin({
      codes: [
        { id: 'len-id', code: 'LEN', depth: 0, code_tier: 'major' },
        { id: 'pts-id', code: 'PTS', depth: 1, code_tier: 'middle' },
      ],
      subCodeData: { id: 'pts-id' },  // depth=1 PTS → BND 통과
    })
    const { rpcCalls } = await callCloneAndGetRpc(admin)

    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc, 'generate_product_code RPC가 호출돼야 함').toBeDefined()

    // [RED] 현재: 3-param, p_category_code_override 없음 → FAILS
    // [GREEN] 수정 후: 7-param, p_category_code_override='LENPTS' → PASSES
    expect(codeRpc?.params).toHaveProperty('p_category_code_override', 'LENPTS')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EC-1: 단일 코드(depth=1 middle) → p_category_code_override = 'PTS' (회귀 방지)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('EC-1 RED — 단일 코드(PTS middle) 콤보 → p_category_code_override = "PTS"', () => {
  it('[RED] PTS(middle,depth=1) 단일 콤보 → p_category_code_override = "PTS"', async () => {
    const admin = makeTableAwareAdmin({
      codes: [{ id: 'pts-id', code: 'PTS', depth: 1, code_tier: 'middle' }],
      subCodeData: { id: 'pts-id' },
    })
    const { rpcCalls } = await callCloneAndGetRpc(admin)

    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc, 'generate_product_code RPC가 호출돼야 함').toBeDefined()
    // [RED] 3-param without override → FAILS
    // [GREEN] 7-param p_category_code_override='PTS' → PASSES
    expect(codeRpc?.params).toHaveProperty('p_category_code_override', 'PTS')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EC-2: BND-PARTNERCODE-1 — 카테고리 불일치 → fail(400) 차단 (현행 유지 회귀)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('EC-2 BND-PARTNERCODE-1 유지 — 카테고리 불일치 콤보 → fail(400) 차단', () => {
  it('[GREEN 유지] subCode 미발견(카테고리 불일치) → 여전히 fail(400) 반환', async () => {
    const admin = makeTableAwareAdmin({
      codes: [{ id: 'wrong-id', code: 'WRONG', depth: 1, code_tier: 'middle' }],
      subCodeData: null,  // subCode 없음 → BND 불일치 → fail(400)
    })
    const { result } = await callCloneAndGetRpc(admin)
    expect((result as { status?: number }).status).toBe(400)
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EC-3: 3단 콤보(대+중+소) 역순 입력 → TIER_ORDER 합산 = 'LENPTSCAM'
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('EC-3 RED — 3단 콤보(대+중+소) 역순 입력 → TIER_ORDER 정렬 후 "LENPTSCAM"', () => {
  it('[RED] CAM(minor)+LEN(major)+PTS(middle) 역순 → p_category_code_override = "LENPTSCAM"', async () => {
    // 의도적으로 역순 제공 → TIER_ORDER 정렬(major→middle→minor) 검증
    const admin = makeTableAwareAdmin({
      codes: [
        { id: 'cam-id', code: 'CAM', depth: 2, code_tier: 'minor' },
        { id: 'len-id', code: 'LEN', depth: 0, code_tier: 'major' },
        { id: 'pts-id', code: 'PTS', depth: 1, code_tier: 'middle' },
      ],
      maxSequence: 999,
      parentMaxSequence: 99,
      subCodeData: { id: 'pts-id' },  // depth=1 PTS → BND 통과
    })
    const { rpcCalls } = await callCloneAndGetRpc(admin)

    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc, 'generate_product_code RPC가 호출돼야 함').toBeDefined()
    // TIER_ORDER: major(LEN) → middle(PTS) → minor(CAM) = 'LENPTSCAM'
    expect(codeRpc?.params).toHaveProperty('p_category_code_override', 'LENPTSCAM')
  })
})

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// EC-4: code_mapping_items에서 date_option/max_sequence/parent_max_sequence 전달
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('EC-4 RED — code_mapping_items date_option/max_sequence/parent_max_sequence 전달', () => {
  it('[RED] parent_max_sequence=99, max_sequence=999 → 7-param에 p_parent_max_sequence=99 전달', async () => {
    const admin = makeTableAwareAdmin({
      codes: [
        { id: 'len-id', code: 'LEN', depth: 0, code_tier: 'major' },
        { id: 'pts-id', code: 'PTS', depth: 1, code_tier: 'middle' },
      ],
      maxSequence: 999,
      parentMaxSequence: 99,
      subCodeData: { id: 'pts-id' },
    })
    const { rpcCalls } = await callCloneAndGetRpc(admin)

    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc, 'generate_product_code RPC가 호출돼야 함').toBeDefined()
    // [RED] 현재 3-param: p_category_code_override·p_parent_max_sequence·p_max_sequence 없음 → FAILS
    expect(codeRpc?.params).toHaveProperty('p_category_code_override', 'LENPTS')
    expect(codeRpc?.params).toHaveProperty('p_parent_max_sequence', 99)
    expect(codeRpc?.params).toHaveProperty('p_max_sequence', 999)
    expect(codeRpc?.params).toHaveProperty('p_date_option', 'ym')
  })
})
