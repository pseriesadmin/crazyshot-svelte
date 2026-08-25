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
 *   - RPC 호출: 기존 3-param → 7-param(p_category_code_override) 교체
 *   - 재사용: buildComboCategoryCode()/getRootCode() (comboCategoryCode.ts, GATE E 통과)
 *            + generate_product_code 7-param 오버로드 (migration 222, stage 검증 완료)
 *
 * 버그 수정(2026-08-17): BND-PARTNERCODE-1(source.category의 depth=1 자식인지 검증)을 제거.
 *   협력사 전용코드(is_partner_type=true 그룹)는 product_category=null·depth=0·parent_id=null인
 *   완전 독립 코드 체계로 설계돼 있어(원본 상품 카테고리와 무관하게 별도 계열로 편입시키는 게
 *   기능 목적) 이 검증이 구조적으로 100% 항상 실패했다(활성 product_category_codes 25건 전부
 *   product_category=null, DB 직접 조회로 확인) — 협력사 코드를 무엇을 골라도 fail(400)만
 *   반환하고 복제 자체가 불가능했던 실사용 버그. new/+page.server.ts(카테고리 일치성 검증 없음,
 *   이미 GATE E 통과)와 동일하게 선택된 콤보를 그대로 신뢰하도록 단순화.
 *
 * 검증:
 *   [RED] 2개 코드 콤보 RPC 호출 시 p_category_code_override 없음 → 실패(RED)
 *   [GREEN] 수정 후 p_category_code_override = 'LENPTS' (TIER_ORDER 합산) → 통과
 *   [EC-1] 단일 코드(depth=1 middle) → p_category_code_override = 'PTS'
 *   [EC-2] 콤보의 코드가 전부 비활성/삭제라 allCodes가 비면 fail(400)(유효한 분류코드 없음 문구)
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
// 버그 수정(2026-08-17) 후 호출 시퀀스(6개 from 호출): products(1)=source lookup,
//   code_mapping_items(1), product_category_codes(1)=allCodes 단일조회, price_rules(1),
//   products(2)=slug체크, products(3)=INSERT — mainCode/subCode 조회 제거로 2단계 감소
interface ComboCode { id: string; code: string; depth: number; code_tier: string }

function makeTableAwareAdmin(options: {
  codes: ComboCode[]
  maxSequence?: number | null
  parentMaxSequence?: number | null
  // 콤보 자체엔 항목이 있는데(tcIds 존재) product_category_codes 활성 필터에서 전부 걸러지는
  // 상황(EC-2 "유효한 코드 없음" 케이스)을 재현하기 위해 comboItems의 소스 id 목록을 codes와
  // 독립적으로 지정 가능하게 함. 미지정 시 기존처럼 codes에서 그대로 파생.
  comboItemIds?: string[]
}) {
  const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = []
  const rpcFn = vi.fn((name: string, params: Record<string, unknown>) => {
    rpcCalls.push({ name, params })
    return Promise.resolve({ data: null, error: null })
  })

  const comboItems = (options.comboItemIds ?? options.codes.map((c) => c.id)).map((id) => ({
    taxonomy_code_id: id,
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
      // 단일 조회 — buildComboCategoryCode()용 전체 코드(활성/미삭제 필터는 실제 쿼리에서 적용,
      // mock은 options.codes를 그대로 반환)
      void n
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
// EC-2(2026-08-17 재정의): BND-PARTNERCODE-1(카테고리 일치성 검증) 제거 후 —
//   콤보의 코드가 전부 비활성/삭제라 allCodes가 비었을 때만 fail(400) 차단
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
describe('EC-2 — 콤보의 유효한 코드가 없으면 fail(400) 차단(카테고리 일치성 검증 아님)', () => {
  it('[GREEN] allCodes가 빈 배열이면 "유효한 분류코드가 없습니다" fail(400) 반환', async () => {
    const admin = makeTableAwareAdmin({
      codes: [],  // 활성 필터 통과한 코드가 하나도 없는 상황(전부 비활성/삭제) 시뮬레이션
      comboItemIds: ['deleted-code-id'],  // 콤보 자체엔 항목이 있어야 tcIds.length>0으로 진입
    })
    const { result } = await callCloneAndGetRpc(admin)
    const r = result as { status?: number; data?: { error?: string } }
    expect(r.status).toBe(400)
    expect(r.data?.error).toContain('유효한 분류코드가 없습니다')
  })

  it('[GREEN 회귀] 원본 상품의 카테고리와 무관한 코드(WRONG)를 골라도 이제는 정상 채번된다', async () => {
    // 버그 수정 전에는 이 케이스가 "카테고리 불일치"로 fail(400)됐으나, 협력사 전용코드는
    // 원본 카테고리와 무관한 별도 계열이 정상이므로 이제는 정상적으로 채번돼야 한다.
    const admin = makeTableAwareAdmin({
      codes: [{ id: 'wrong-id', code: 'WRONG', depth: 1, code_tier: 'middle' }],
    })
    const { rpcCalls, result } = await callCloneAndGetRpc(admin)
    expect((result as { status?: number }).status).toBeUndefined()
    const codeRpc = rpcCalls.find((c) => c.name === 'generate_product_code')
    expect(codeRpc?.params).toHaveProperty('p_category_code_override', 'WRONG')
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
