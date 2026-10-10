import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 관리대상 등록·수정·삭제 서버 액션 — 권한 게이트·입력 정규화·오류 메시지 매핑 (Migration #686)
 *
 * 완료기준:
 *   정상동작: manager 이상이 이름·전화·사유로 등록하면 RPC에 정규화된 값이 전달되고 id·회원코드를 돌려준다.
 *   막아야할것: 파트너(manager 미만)·미로그인·메뉴 권한 OFF 계정은 RPC 호출 전에 거절된다.
 *             RPC 오류 코드는 사용자 문구로 바뀌고 중복 전화 시 기존 id를 함께 돌려준다.
 */

const rpcMock = vi.fn()

vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'test-key' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://example.supabase.co' }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ rpc: (...a: unknown[]) => rpcMock(...a) }) }))

let menuDenied: unknown = null
vi.mock('$lib/server/requireMenuAccess', () => ({
  requireMenuAccessAction: vi.fn(async () => menuDenied),
}))

let cmsRole: string | null = 'manager'
vi.mock('$lib/server/getCmsRoleForAction', () => ({
  getCmsRoleForAction: vi.fn(async () => cmsRole),
}))

import { actions } from '../../routes/cms/customers/+page.server'

function ev(fields: Record<string, string>, session: { user: { id: string } } | null = { user: { id: 'admin-1' } }) {
  const fd = new FormData()
  for (const [k, v] of Object.entries(fields)) fd.set(k, v)
  return {
    request: new Request('http://localhost/cms/customers', { method: 'POST', body: fd }),
    locals: { safeGetSession: async () => ({ session }) },
  } as never
}

const base = { name: ' 홍길동 ', phone: '01012345678', email: '', birth_date: '1990-05-06', reason: ' 분쟁 이력 ' }

beforeEach(() => {
  rpcMock.mockReset()
  menuDenied = null
  cmsRole = 'manager'
})

describe('registerManagedPerson', () => {
  it('manager: 입력값을 정리해 RPC에 전달하고 id·회원코드를 돌려준다', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, id: 'mp-1', member_code: 'CSMG2610001' }, error: null })
    const res = await actions.registerManagedPerson(ev(base))
    expect(rpcMock).toHaveBeenCalledWith('cms_register_managed_person', {
      p_name: '홍길동', p_phone: '01012345678', p_email: null, p_birth_date: '1990-05-06', p_reason: '분쟁 이력', p_created_by: 'admin-1',
    })
    expect(res).toMatchObject({ ok: true, registered: true, id: 'mp-1', member_code: 'CSMG2610001' })
  })

  it('잘못된 생년월일 형식은 null로 정리', async () => {
    rpcMock.mockResolvedValue({ data: { ok: true, id: 'x', member_code: 'c' }, error: null })
    await actions.registerManagedPerson(ev({ ...base, birth_date: '90.05.06' }))
    expect(rpcMock.mock.calls[0][1].p_birth_date).toBeNull()
  })

  it('파트너(manager 미만)는 RPC 호출 없이 403', async () => {
    cmsRole = 'partner'
    const res = await actions.registerManagedPerson(ev(base)) as { status: number }
    expect(res.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('미로그인은 403, 메뉴 권한 OFF는 메뉴 가드 응답 그대로', async () => {
    const noSession = await actions.registerManagedPerson(ev(base, null)) as { status: number }
    expect(noSession.status).toBe(403)
    menuDenied = { status: 403, data: { ok: false, error: '메뉴 권한 없음' } }
    const denied = await actions.registerManagedPerson(ev(base))
    expect(denied).toBe(menuDenied)
    expect(rpcMock).not.toHaveBeenCalled()
  })

  it('RPC 오류 코드를 사용자 문구로 바꾸고, 중복 전화는 기존 id를 돌려준다', async () => {
    rpcMock.mockResolvedValue({ data: { ok: false, error: 'duplicate_phone', existing_id: 'mp-0' }, error: null })
    const dup = await actions.registerManagedPerson(ev(base)) as { status: number; data: { error: string; existingId: string } }
    expect(dup.status).toBe(400)
    expect(dup.data.error).toBe('이미 관리대상으로 등록된 전화번호입니다.')
    expect(dup.data.existingId).toBe('mp-0')

    rpcMock.mockResolvedValue({ data: { ok: false, error: 'reason_required' }, error: null })
    const noReason = await actions.registerManagedPerson(ev({ ...base, reason: '' })) as { data: { error: string } }
    expect(noReason.data.error).toBe('관리대상 등록 사유를 입력하세요.')
  })
})

describe('updateManagedPerson · deleteManagedPerson', () => {
  it('수정: id 필수, 파트너 거절, 정상 시 RPC 전달', async () => {
    const noId = await actions.updateManagedPerson(ev(base)) as { status: number }
    expect(noId.status).toBe(400)
    expect(rpcMock).not.toHaveBeenCalled()

    cmsRole = 'partner'
    const partner = await actions.updateManagedPerson(ev({ ...base, id: 'mp-1' })) as { status: number }
    expect(partner.status).toBe(403)

    cmsRole = 'superadmin'
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null })
    const ok = await actions.updateManagedPerson(ev({ ...base, id: 'mp-1' }))
    expect(rpcMock).toHaveBeenCalledWith('cms_update_managed_person', expect.objectContaining({ p_id: 'mp-1', p_name: '홍길동' }))
    expect(ok).toMatchObject({ ok: true, updated: true })
  })

  it('삭제: id 필수, 파트너 거절, 정상 시 삭제자 기록', async () => {
    const noId = await actions.deleteManagedPerson(ev({})) as { status: number }
    expect(noId.status).toBe(400)

    cmsRole = 'partner'
    const partner = await actions.deleteManagedPerson(ev({ id: 'mp-1' })) as { status: number }
    expect(partner.status).toBe(403)
    expect(rpcMock).not.toHaveBeenCalled()

    cmsRole = 'manager'
    rpcMock.mockResolvedValue({ data: { ok: true }, error: null })
    const ok = await actions.deleteManagedPerson(ev({ id: 'mp-1' }))
    expect(rpcMock).toHaveBeenCalledWith('cms_delete_managed_person', { p_id: 'mp-1', p_deleted_by: 'admin-1' })
    expect(ok).toMatchObject({ ok: true, deleted: true })
  })
})
