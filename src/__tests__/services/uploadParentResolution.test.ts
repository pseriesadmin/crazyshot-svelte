import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Bug 2 회귀 테스트 — 업로드 엔드포인트 자식→부모 치환 + image_urls 배열 갱신 로직 검증
 * Harness Flow v3.2 | 보완 2: 실제 POST/DELETE 핸들러를 import해 실제 함수 호출로 검증
 *
 * 대상: src/routes/api/cms/upload/+server.ts (POST 핸들러 · DELETE 핸들러)
 *
 * 검증 방식: vi.mock으로 @supabase/supabase-js createClient를 가로채 mock admin을 주입,
 *   실제 핸들러 함수를 호출해 mock 호출 인수를 검증 → 서버 코드가 실제로 변경되면
 *   테스트가 실패하므로 회귀 탐지 능력이 있는 진짜 단위 테스트
 *
 * 케이스:
 *   UP-1: 자식 product_id → parent_product_id 조회 → RPC를 부모 ID로 호출
 *   UP-2: 부모 product_id (parent_product_id=null) → RPC를 부모 ID 그대로 호출
 *   UP-3: "/" 포함 경로(이력 업로드) → parent_product_id 조회 스킵
 *   DEL-1: Storage URL에서 pathProductId를 추출해 products 행 조회
 *   DEL-2: largeUrl이 image_urls 배열에 있으면 제거 후 DB 갱신
 *   DEL-3: largeUrl이 배열에 없으면 DB UPDATE 미호출
 *   DEL-4: 외부(비-Supabase) URL → Storage 삭제·DB 갱신 없이 early return
 */

// ── 모듈 mock 선언 (vi.mock는 호이스팅됨) ────────────────────────────────────
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(),
}))

vi.mock('$env/dynamic/private', () => ({
  env: { SUPABASE_SERVICE_ROLE_KEY: 'test-service-key' },
}))

vi.mock('$lib/env/supabasePublic', () => ({
  getSupabaseUrl: () => 'https://test.supabase.co',
}))

// ── createClient mock 참조 가져오기 ──────────────────────────────────────────
import { createClient } from '@supabase/supabase-js'

// ── 실제 핸들러 dynamic import (mock 세팅 이후에 모듈이 초기화돼야 하므로 top-level await 사용)
const { POST, DELETE } = await import('../../routes/api/cms/upload/+server')

// ── 공통 상수 ──────────────────────────────────────────────────────────────────
const SUPABASE_URL = 'https://test.supabase.co'
const BUCKET = 'product-images'
const PARENT_ID = 'parent-uuid-0001'
const CHILD_ID  = 'child-uuid-0001'
const OTHER_URL = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PARENT_ID}/large_other.webp`
const LARGE_URL = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PARENT_ID}/large_abc123.webp`

// ── mock session / request 헬퍼 ───────────────────────────────────────────────
function makeLocals() {
  return {
    safeGetSession: vi.fn().mockResolvedValue({ session: { user: { id: 'admin-id' } } }),
  }
}

function makePostFormData(productId: string): FormData {
  const fd = new FormData()
  fd.append('product_id', productId)
  const webpBlob = new Blob([new Uint8Array(8)], { type: 'image/webp' })
  fd.append('thumb', new File([webpBlob], 'thumb.webp', { type: 'image/webp' }))
  fd.append('large', new File([webpBlob], 'large.webp', { type: 'image/webp' }))
  return fd
}

function makePostRequest(productId: string) {
  return { formData: vi.fn().mockResolvedValue(makePostFormData(productId)) }
}

function makeDeleteRequest(largeUrl: string) {
  return { json: vi.fn().mockResolvedValue({ largeUrl }) }
}

// ── POST mock admin 팩토리 ────────────────────────────────────────────────────
// POST 핸들러에서 admin.from('products') 흐름:
//   .select('parent_product_id').eq(id).maybeSingle() → { data: { parent_product_id } | null }
// admin.storage.from(BUCKET).upload(path, buf) → { error: null }
// admin.storage.from(BUCKET).getPublicUrl(path) → { data: { publicUrl } }
// admin.rpc('append_product_image_url', { p_product_id, p_url }) → { error: null }
function makePostAdmin(parentId: string | null) {
  const maybeSingleFn = vi.fn().mockResolvedValue({
    data: parentId !== null ? { parent_product_id: parentId } : null,
  })
  const fromChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: maybeSingleFn,
  }
  const uploadFn = vi.fn().mockResolvedValue({ error: null })
  const getPublicUrlFn = vi.fn().mockImplementation((path: string) => ({
    data: { publicUrl: `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}` },
  }))
  const storageBucket = { upload: uploadFn, getPublicUrl: getPublicUrlFn }
  const rpcFn = vi.fn().mockResolvedValue({ error: null })
  return {
    from: vi.fn().mockReturnValue(fromChain),
    storage: { from: vi.fn().mockReturnValue(storageBucket) },
    rpc: rpcFn,
    _fromChain: fromChain,
    _uploadFn: uploadFn,
    _rpcFn: rpcFn,
  }
}

// ── DELETE mock admin 팩토리 ──────────────────────────────────────────────────
// DELETE 핸들러에서 admin.from('products') 2회 호출:
//   1회: .select('image_urls').eq(id).maybeSingle() → 현재 image_urls 반환
//   2회(URL이 배열에 있을 때): .update({ image_urls: updatedUrls }).eq(id) → awaitable
// admin.storage.from(BUCKET).remove([path]) → { error: null }
function makeDeleteAdmin(existingUrls: string[]) {
  // 2회차 update 체인의 eq는 awaitable이어야 함
  const updateEqFn = vi.fn().mockResolvedValue({ error: null })
  const updateFn = vi.fn().mockReturnValue({ eq: updateEqFn })

  // 1회차 select 체인
  const maybeSingleFn = vi.fn().mockResolvedValue({
    data: { image_urls: existingUrls },
    error: null,
  })
  const selectChain = {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: maybeSingleFn,
  }

  let fromCallIdx = 0
  const fromFn = vi.fn().mockImplementation(() => {
    fromCallIdx++
    return fromCallIdx === 1 ? selectChain : { update: updateFn }
  })

  const removeFn = vi.fn().mockResolvedValue({ error: null })
  const storageBucket = { remove: removeFn }

  return {
    from: fromFn,
    storage: { from: vi.fn().mockReturnValue(storageBucket) },
    rpc: vi.fn(),
    _updateFn: updateFn,
    _updateEqFn: updateEqFn,
    _removeFn: removeFn,
  }
}

// ── 테스트 ────────────────────────────────────────────────────────────────────
describe('POST 핸들러 — 실제 핸들러 호출로 자식→부모 치환 회귀 검증', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('UP-1: 자식 product_id가 들어오면 parent_product_id를 조회해 RPC를 부모 ID로 호출', async () => {
    const mockAdmin = makePostAdmin(PARENT_ID)
    vi.mocked(createClient).mockReturnValue(mockAdmin as never)

    await POST({ request: makePostRequest(CHILD_ID), locals: makeLocals() } as never)

    // from('products')가 호출됐는가 (부모 조회 분기 진입)
    expect(mockAdmin.from).toHaveBeenCalledWith('products')
    // RPC의 p_product_id가 CHILD가 아닌 PARENT여야 함
    expect(mockAdmin._rpcFn).toHaveBeenCalledWith(
      'append_product_image_url',
      expect.objectContaining({ p_product_id: PARENT_ID }),
    )
    // Storage 업로드 경로가 PARENT_ID 폴더를 사용하는가
    const uploadCalls = mockAdmin._uploadFn.mock.calls as [string, ...unknown[]][]
    expect(uploadCalls.some(([path]) => (path as string).startsWith(`${PARENT_ID}/`))).toBe(true)
  })

  it('UP-2: 부모 product_id (parent_product_id=null) — RPC를 부모 ID 그대로 호출', async () => {
    const mockAdmin = makePostAdmin(null)
    vi.mocked(createClient).mockReturnValue(mockAdmin as never)

    await POST({ request: makePostRequest(PARENT_ID), locals: makeLocals() } as never)

    expect(mockAdmin.from).toHaveBeenCalledWith('products')
    // null 반환 → targetProductId는 PARENT_ID 그대로 유지
    expect(mockAdmin._rpcFn).toHaveBeenCalledWith(
      'append_product_image_url',
      expect.objectContaining({ p_product_id: PARENT_ID }),
    )
  })

  it('UP-3: "/" 포함 경로(이력 업로드)는 parent_product_id 조회를 스킵하고 RPC도 미호출', async () => {
    const historyProductId = `${CHILD_ID}/history/filename.webp`
    const mockAdmin = makePostAdmin(null)
    vi.mocked(createClient).mockReturnValue(mockAdmin as never)

    // "/" 포함이라 from('products') 자체가 불리지 않아야 함
    // 단, type 지정 없이 product 업로드 형태로 전달 — product_id에 "/" 포함 시 서버가
    // WebP 타입 체크를 통과하면 분기로 들어가므로 실제 업로드 흐름을 흉내냄
    const fd = new FormData()
    fd.append('product_id', historyProductId)
    const webpBlob = new Blob([new Uint8Array(8)], { type: 'image/webp' })
    fd.append('thumb', new File([webpBlob], 'thumb.webp', { type: 'image/webp' }))
    fd.append('large', new File([webpBlob], 'large.webp', { type: 'image/webp' }))
    const req = { formData: vi.fn().mockResolvedValue(fd) }

    await POST({ request: req, locals: makeLocals() } as never)

    // "/" 포함이라 from('products')를 호출하면 안 됨 (부모 조회 분기 스킵)
    expect(mockAdmin.from).not.toHaveBeenCalledWith('products')
    // RPC(append_product_image_url)도 "/" 포함 경로엔 미호출
    expect(mockAdmin._rpcFn).not.toHaveBeenCalledWith('append_product_image_url', expect.anything())
  })
})

describe('DELETE 핸들러 — 실제 핸들러 호출로 image_urls 배열 갱신 회귀 검증', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('DEL-1: Storage URL에서 pathProductId를 추출해 products 행을 조회', async () => {
    const mockAdmin = makeDeleteAdmin([LARGE_URL, OTHER_URL])
    vi.mocked(createClient).mockReturnValue(mockAdmin as never)

    await DELETE({ request: makeDeleteRequest(LARGE_URL), locals: makeLocals() } as never)

    // from('products')가 PARENT_ID를 대상으로 조회됐는가
    expect(mockAdmin.from).toHaveBeenCalledWith('products')
    // select 체인의 eq에 PARENT_ID가 전달됐는가
    const selectChain = (mockAdmin.from as ReturnType<typeof vi.fn>).mock.results[0].value as {
      eq: ReturnType<typeof vi.fn>
    }
    expect(selectChain.eq).toHaveBeenCalledWith('id', PARENT_ID)
  })

  it('DEL-2: largeUrl이 image_urls에 있으면 그 URL을 제거해 DB UPDATE 호출', async () => {
    const mockAdmin = makeDeleteAdmin([LARGE_URL, OTHER_URL])
    vi.mocked(createClient).mockReturnValue(mockAdmin as never)

    await DELETE({ request: makeDeleteRequest(LARGE_URL), locals: makeLocals() } as never)

    // update가 호출됐는가
    expect(mockAdmin._updateFn).toHaveBeenCalledWith({ image_urls: [OTHER_URL] })
    // eq도 호출됐는가
    expect(mockAdmin._updateEqFn).toHaveBeenCalledWith('id', PARENT_ID)
  })

  it('DEL-3: largeUrl이 배열에 없으면 DB UPDATE 미호출', async () => {
    const MISSING_URL = `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${PARENT_ID}/large_missing.webp`
    const mockAdmin = makeDeleteAdmin([LARGE_URL])
    vi.mocked(createClient).mockReturnValue(mockAdmin as never)

    await DELETE({ request: makeDeleteRequest(MISSING_URL), locals: makeLocals() } as never)

    // URL이 배열에 없으므로 updatedUrls.length === currentUrls.length → update 미호출
    expect(mockAdmin._updateFn).not.toHaveBeenCalled()
  })

  it('DEL-4: 외부(비-Supabase) URL은 Storage 삭제·DB 갱신 없이 deleted:false early return', async () => {
    const externalUrl = 'https://res.cloudinary.com/demo/image/upload/sample.jpg'
    // 외부 URL이면 createClient가 아예 호출되지 않으므로 mock 불필요 — 단, clearAllMocks 이후
    // createClient가 undefined 반환하지 않도록 빈 mock 설정
    const mockAdmin = makeDeleteAdmin([])
    vi.mocked(createClient).mockReturnValue(mockAdmin as never)

    const response = await DELETE({ request: makeDeleteRequest(externalUrl), locals: makeLocals() } as never)
    const body = await response.json() as { deleted: boolean; reason?: string }

    expect(body.deleted).toBe(false)
    expect(body.reason).toBe('external_url')
    // 외부 URL이면 DB 조회 전혀 없어야 함
    expect(mockAdmin.from).not.toHaveBeenCalled()
    expect(mockAdmin._removeFn).not.toHaveBeenCalled()
  })
})
