import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessApi: async () => null })) // 1e 메뉴권한 게이트 통과(게이트 자체는 customersMenuGuard.test.ts에서 검증)

/**
 * POST /api/cms/upload-doc — 관리자 대리 등록은 서류 종류 1건(슬롯)만 교체 (2026-10-03, 서류 비공개 전환 B3a)
 * 완료기준: 다른 종류는 보존(필수 조합 유지), 경로만 저장(공개 URL 아님), 외국인 제출완료 시각은 4종일 때만, 교체된 기존 파일 정리,
 *          종류 필수·화이트리스트·권한·사용자 없음·DB 실패 롤백
 */
vi.mock('@sveltejs/kit', () => ({
  json: (data: unknown, init?: { status?: number }) => ({ status: init?.status ?? 200, data }),
}))
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'service-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://example.supabase.co' }))
const roleRef: { role: string | null } = { role: 'manager' }
vi.mock('$lib/server/getCmsRoleForAction', () => ({ getCmsRoleForAction: async () => roleRef.role }))

const UID = '6a8f8ee1-ce6e-462f-b7eb-2bd8e0000000'
const profileRef: { row: Record<string, unknown> | null } = { row: null }
const updateRef: { payload: Record<string, unknown> | null; result: { data: unknown[] | null; error: { message: string } | null } } = {
  payload: null, result: { data: [{ user_id: UID }], error: null },
}
const upload = vi.fn()
const remove = vi.fn()
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profileRef.row, error: null }) }) }),
      update: (payload: Record<string, unknown>) => {
        updateRef.payload = payload
        return { eq: () => ({ select: async () => updateRef.result }) }
      },
    }),
    storage: { from: () => ({ upload, remove }) },
  }),
}))

const { POST } = await import('../../routes/api/cms/upload-doc/+server')

type R = { status: number; data: { ok: boolean; error?: string; verifiedAt?: string } }
function form(fields: Record<string, string>, file: File | null = new File(['x'], 'a.png', { type: 'image/png' })) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  if (file) fd.set('file', file)
  return fd
}
function call(fd: FormData) {
  return POST({
    request: { formData: async () => fd },
    locals: { safeGetSession: async () => ({ session: { user: { id: 'admin' } } }) },
  } as unknown as Parameters<typeof POST>[0]) as unknown as Promise<R>
}
const PUB = `https://x.supabase.co/storage/v1/object/public/user-documents/${UID}`

describe('POST /api/cms/upload-doc — 슬롯 1건 교체', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    roleRef.role = 'manager'
    updateRef.payload = null
    updateRef.result = { data: [{ user_id: UID }], error: null }
    upload.mockResolvedValue({ error: null })
    remove.mockResolvedValue({ error: null })
    profileRef.row = {
      identity_doc_url: [`${PUB}/identity_a.png`, `${UID}/identity_b.png`],
      identity_type: ['resident', 'resident_copy'],
      foreign_doc_url: null, foreign_doc_urls: null, foreign_type: null,
    }
  })

  it('본인증명: 주민등록증 슬롯만 교체 — 주민등록등본은 보존, 경로만 저장, 교체된 기존 파일 삭제', async () => {
    const r = await call(form({ user_id: UID, type: 'identity', slot_type: 'resident' }))
    expect(r.status).toBe(200)
    const p = updateRef.payload as { identity_doc_url: string[]; identity_type: string[]; identity_approved_at: unknown }
    expect(p.identity_type).toEqual(['resident_copy', 'resident'])
    expect(p.identity_doc_url[0]).toBe(`${UID}/identity_b.png`)
    expect(p.identity_doc_url[1]).toMatch(new RegExp(`^${UID}/identity_[0-9a-f-]{36}\\.png$`))
    expect(p.identity_doc_url.join('|')).not.toContain('http')
    expect(p.identity_approved_at).toBeNull()
    expect(remove).toHaveBeenCalledWith([`${UID}/identity_a.png`]) // 교체된 공개 URL 형식 값도 경로로 해석해 삭제
  })

  it('본인증명: 새 종류는 추가(기존 전부 보존, 삭제 없음)', async () => {
    await call(form({ user_id: UID, type: 'identity', slot_type: 'driver' }))
    const p = updateRef.payload as { identity_type: string[] }
    expect(p.identity_type).toEqual(['resident', 'resident_copy', 'driver'])
    expect(remove).not.toHaveBeenCalled()
  })

  it('외국인증명: 4종 미만이면 제출완료 시각 NULL, 4종 완성이면 기록 + 레거시 스칼라는 첫 파일', async () => {
    profileRef.row = {
      identity_doc_url: null, identity_type: null, foreign_doc_url: `${UID}/foreign_1.png`,
      foreign_doc_urls: [`${UID}/foreign_1.png`, `${UID}/foreign_2.png`], foreign_type: ['passport_photo', 'accommodation_reservation'],
    }
    await call(form({ user_id: UID, type: 'foreign', slot_type: 'entry_eticket' }))
    let p = updateRef.payload as { foreign_verified_at: unknown; foreign_type: string[]; foreign_doc_url: string; is_foreign: boolean }
    expect(p.foreign_type).toEqual(['passport_photo', 'accommodation_reservation', 'entry_eticket'])
    expect(p.foreign_verified_at).toBeNull()
    expect(p.is_foreign).toBe(true)

    profileRef.row = {
      identity_doc_url: null, identity_type: null, foreign_doc_url: `${UID}/foreign_1.png`,
      foreign_doc_urls: [`${UID}/foreign_1.png`, `${UID}/foreign_2.png`, `${UID}/foreign_3.png`],
      foreign_type: ['passport_photo', 'accommodation_reservation', 'entry_eticket'],
    }
    await call(form({ user_id: UID, type: 'foreign', slot_type: 'exit_eticket' }))
    p = updateRef.payload as typeof p
    expect(p.foreign_verified_at).toEqual(expect.any(String))
    expect(p.foreign_doc_url).toBe(`${UID}/foreign_1.png`)
  })

  it('외국인증명: 종류 정보가 없는 레거시 항목은 보존하지 않고 파일만 정리(레거시 스칼라 1개)', async () => {
    profileRef.row = { identity_doc_url: null, identity_type: null, foreign_doc_url: `${PUB}/foreign_old.png`, foreign_doc_urls: null, foreign_type: null }
    await call(form({ user_id: UID, type: 'foreign', slot_type: 'passport_photo' }))
    const p = updateRef.payload as { foreign_doc_urls: string[]; foreign_type: string[] }
    expect(p.foreign_type).toEqual(['passport_photo'])
    expect(p.foreign_doc_urls).toHaveLength(1)
    expect(remove).toHaveBeenCalledWith([`${UID}/foreign_old.png`])
  })

  it('종류 누락·화이트리스트 밖·다른 유형의 종류는 400, 업로드하지 않는다', async () => {
    expect((await call(form({ user_id: UID, type: 'identity' }))).status).toBe(400)
    expect((await call(form({ user_id: UID, type: 'identity', slot_type: 'passport_photo' }))).status).toBe(400)
    expect((await call(form({ user_id: UID, type: 'foreign', slot_type: 'resident' }))).status).toBe(400)
    expect((await call(form({ user_id: UID, type: 'identity', slot_type: 'bogus' }))).status).toBe(400)
    expect(upload).not.toHaveBeenCalled()
  })

  it('구버전 화면 호환: identity_type 필드도 종류로 인정', async () => {
    const r = await call(form({ user_id: UID, type: 'identity', identity_type: 'driver' }))
    expect(r.status).toBe(200)
  })

  it('권한 없음 403 / 잘못된 사용자 ID 400 / 파일 없음 400 / 사용자 없음 404', async () => {
    roleRef.role = 'partner'
    expect((await call(form({ user_id: UID, type: 'identity', slot_type: 'resident' }))).status).toBe(403)
    roleRef.role = 'manager'
    expect((await call(form({ user_id: 'bad', type: 'identity', slot_type: 'resident' }))).status).toBe(400)
    expect((await call(form({ user_id: UID, type: 'identity', slot_type: 'resident' }, null))).status).toBe(400)
    profileRef.row = null
    expect((await call(form({ user_id: UID, type: 'identity', slot_type: 'resident' }))).status).toBe(404)
    expect(upload).not.toHaveBeenCalled()
  })

  it('최대 개수 초과(보존분+1 > 5)는 업로드 전에 400', async () => {
    profileRef.row = {
      identity_doc_url: ['a', 'b', 'c', 'd', 'e'].map(n => `${UID}/identity_${n}.png`),
      identity_type: ['student', 'resident', 'resident_copy', 'driver', 'other'],
      foreign_doc_url: null, foreign_doc_urls: null, foreign_type: null,
    }
    const r = await call(form({ user_id: UID, type: 'identity', slot_type: 'enrollment' }))
    expect(r.status).toBe(400) // 허용 종류 밖
    const r2 = await call(form({ user_id: UID, type: 'identity', slot_type: 'student' }))
    expect(r2.status).toBe(200) // 교체(개수 유지)
  })

  it('DB 반영 실패 시 방금 올린 파일을 롤백하고 기존 파일은 지우지 않는다', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    updateRef.result = { data: null, error: { message: 'boom' } }
    const r = await call(form({ user_id: UID, type: 'identity', slot_type: 'resident' }))
    expect(r.status).toBe(500)
    expect(remove).toHaveBeenCalledTimes(1)
    expect((remove.mock.calls[0][0] as string[])[0]).toMatch(new RegExp(`^${UID}/identity_[0-9a-f-]{36}\\.png$`))
    err.mockRestore()
  })
})
