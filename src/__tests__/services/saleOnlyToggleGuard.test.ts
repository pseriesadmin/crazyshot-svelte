import { describe, it, expect, vi, beforeEach } from 'vitest'
vi.mock('$lib/server/requireMenuAccess', () => ({ requireMenuAccessAction: async () => null })) // 메뉴 권한 게이트 통과(게이트는 productsMenuGuard.test.ts가 별도 검증)

/**
 * ④ toggleStatus — 판매 자동 비활성 재고 켜기 거부 + 수동 토글 시 마커 정리 (대여·판매 공통)
 */
vi.mock('$env/dynamic/private', () => ({ env: { SUPABASE_SERVICE_ROLE_KEY: 'k' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://t.supabase.co' }))
const createClientMock = vi.fn()
vi.mock('@supabase/supabase-js', () => ({ createClient: (...a: unknown[]) => createClientMock(...a) }))
const { actions } = await import('../../routes/cms/products/+page.server')

interface Fixture { marker: number | null; resStatus?: string }

function makeAdmin(fx: Fixture) {
  const updates: Record<string, unknown>[] = []
  const from = vi.fn((table: string) => {
    if (table === 'rental_reservations') {
      return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: fx.resStatus ? { status: fx.resStatus } : null, error: null }) }) }) }
    }
    return {
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { auto_deactivated_reservation_id: fx.marker }, error: null }) }) }),
      update: (payload: Record<string, unknown>) => {
        updates.push(payload)
        return { eq: async () => ({ error: null }) }
      },
    }
  })
  return { admin: { from }, updates }
}

async function toggle(isActive: boolean) {
  const fd = new FormData()
  fd.append('id', 'c1')
  fd.append('is_active', String(isActive))
  return actions.toggleStatus({
    request: { formData: async () => fd } as Request,
    locals: { safeGetSession: async () => ({ session: { user: { id: 'a' } } }) },
  } as Parameters<typeof actions.toggleStatus>[0])
}

beforeEach(() => createClientMock.mockReset())

describe('toggleStatus 안전장치', () => {
  it('S7 판매로 자동 비활성 중(마커, 예약 confirmed) 재고를 켜려 하면 400 거부, 업데이트 없음', async () => {
    const { admin, updates } = makeAdmin({ marker: 5, resStatus: 'confirmed' })
    createClientMock.mockReturnValue(admin)
    const res = (await toggle(false)) as { status: number; data: { error: string } }
    expect(res.status).toBe(400)
    expect(res.data.error).toBe('판매 완료된 재고입니다. 환불·취소 처리 후 자동 복원됩니다.')
    expect(updates).toHaveLength(0)
  })

  it('마커 예약이 이미 취소/만료 상태면(잔존 마커) 켜기 허용 + 마커 정리', async () => {
    const { admin, updates } = makeAdmin({ marker: 5, resStatus: 'cancelled' })
    createClientMock.mockReturnValue(admin)
    const res = await toggle(false)
    expect(res).toEqual({ success: true })
    expect(updates[0]).toEqual({ is_active: true, auto_deactivated_reservation_id: null })
  })

  it('마커 재고를 수동으로 끄면(신중: 켜져 있다는 폼) 마커 NULL 정리', async () => {
    const { admin, updates } = makeAdmin({ marker: 5, resStatus: 'confirmed' })
    createClientMock.mockReturnValue(admin)
    await toggle(true)
    expect(updates[0]).toEqual({ is_active: false, auto_deactivated_reservation_id: null })
  })

  it('S9 마커 없는 일반 재고는 기존 동작 그대로(마커 컬럼 미포함)', async () => {
    const { admin, updates } = makeAdmin({ marker: null })
    createClientMock.mockReturnValue(admin)
    expect(await toggle(true)).toEqual({ success: true })
    expect(updates[0]).toEqual({ is_active: false })
    expect(await toggle(false)).toEqual({ success: true })
    expect(updates[1]).toEqual({ is_active: true })
  })
})
