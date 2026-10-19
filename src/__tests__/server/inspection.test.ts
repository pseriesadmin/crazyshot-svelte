import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * 반납 검수 승인·이슈 등록·해소 서버 로직 (2단계, Migration #724)
 *  · 승인: RPC 성공 시에만 대여완료 포인트 적립(완료된 모든 예약 id) + inspection_pass 알림
 *  · 이슈: 처음 이슈가 될 때만 고객 알림, 실패하면 알림 없음
 *  · 해소: 대여완료 포인트만 적립, 알림 없음
 *  · 완료(completed)로의 직접 전환 차단(updateStatus)
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k', FIREBASE_ADMIN_CLIENT_EMAIL: 'x', FIREBASE_ADMIN_PRIVATE_KEY: 'x' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://t.supabase.co', PUBLIC_FIREBASE_PROJECT_ID: 'p' }))
vi.mock('$env/dynamic/private', () => ({ env: {} }))

const mockAward = vi.fn()
vi.mock('$lib/server/awardRentalCompletePoints', () => ({ awardRentalCompletePoints: (...a: unknown[]) => mockAward(...a) }))
const mockPush = vi.fn()
const mockAdminPush = vi.fn()
vi.mock('$lib/server/push', () => ({
  CUSTOMER_LIFECYCLE_PUSH_COPY: {
    inspection_pass: { title: '대여 완료 안내', body: (p: string) => `${p} 이상 없음` },
    inspection_issue: { title: '검수 결과 안내', body: (p: string) => `${p} 이상 확인` },
  },
  sendReservationLifecyclePush: (...a: unknown[]) => mockPush(...a),
  sendPushToAdmins: (...a: unknown[]) => mockAdminPush(...a),
}))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => {} }))

import { approveInspection, registerInspectionIssue, resolveInspectionIssue } from '$lib/server/inspection'
import { INSPECTION_ISSUE_TYPES, normalizeInspectionStatus, validateIssueInput } from '$lib/utils/inspection'

function makeAdmin(rpcImpl: (fn: string, args: Record<string, unknown>) => unknown) {
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => rpcImpl(fn, args))
  const chain: Record<string, unknown> = {}
  for (const m of ['select', 'eq']) chain[m] = () => chain
  chain.maybeSingle = async () => ({ data: { products: { name: 'SONY FX3' } } })
  return { rpc, from: () => chain }
}

beforeEach(() => {
  mockAward.mockReset()
  mockPush.mockReset()
  mockAdminPush.mockReset()
})

describe('approveInspection', () => {
  it('성공: 완료된 모든 예약에 대여완료 포인트 + inspection_pass 카드·푸시', async () => {
    const admin = makeAdmin((fn) => {
      if (fn === 'approve_return_inspection') return { data: { ok: true, completed_ids: [10, 11] }, error: null }
      return { data: { ok: true }, error: null }
    })
    const r = await approveInspection(admin, 10, 'admin-1')
    expect(r.ok).toBe(true)
    expect(mockAward).toHaveBeenCalledTimes(2)
    expect(mockAward).toHaveBeenCalledWith(admin, 10)
    expect(mockAward).toHaveBeenCalledWith(admin, 11)
    expect(admin.rpc).toHaveBeenCalledWith('send_return_notice_card', expect.objectContaining({
      p_reservation_id: 10, p_notify_type: 'inspection_pass', p_content: 'SONY FX3 이상 없음',
    }))
    expect(mockPush).toHaveBeenCalledWith(admin, 10, 'inspection_pass')
  })

  it('실패(이슈 건 등): 오류를 돌려주고 적립·알림은 없다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: false, error: '검수 이슈가 등록된 건이에요.' }, error: null }))
    const r = await approveInspection(admin, 10, 'admin-1')
    expect(r).toEqual({ ok: false, error: '검수 이슈가 등록된 건이에요.' })
    expect(mockAward).not.toHaveBeenCalled()
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('DB 트리거의 INSPECTION_REQUIRED 접두어는 화면 문구에서 제거한다', async () => {
    const admin = makeAdmin(() => ({ data: null, error: { message: 'INSPECTION_REQUIRED: 반납 검수 승인 없이는 완료 처리할 수 없습니다.' } }))
    const r = await approveInspection(admin, 10, 'admin-1')
    expect(r.error).toBe('반납 검수 승인 없이는 완료 처리할 수 없습니다.')
  })
})

describe('registerInspectionIssue', () => {
  const input = { types: ['exterior_damage'], detail: '렌즈 스크래치', media: [] }

  it('처음 이슈가 될 때만 고객 알림 + 관리자 푸시', async () => {
    const admin = makeAdmin(() => ({ data: { ok: true, issue_id: 1, first: true }, error: null }))
    expect((await registerInspectionIssue(admin, 20, 'admin-1', input)).ok).toBe(true)
    expect(mockPush).toHaveBeenCalledWith(admin, 20, 'inspection_issue')
    expect(mockAdminPush).toHaveBeenCalledTimes(1)
    expect(mockAward).not.toHaveBeenCalled()
  })

  it('이미 이슈 상태에서 추가 등록하면 고객 알림은 반복하지 않는다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: true, issue_id: 2, first: false }, error: null }))
    await registerInspectionIssue(admin, 20, 'admin-1', input)
    expect(mockPush).not.toHaveBeenCalled()
  })

  it('실패하면 알림이 없다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: false, error: '반납완료 상태에서만 검수 이슈를 등록할 수 있습니다.' }, error: null }))
    const r = await registerInspectionIssue(admin, 20, 'admin-1', input)
    expect(r.ok).toBe(false)
    expect(mockPush).not.toHaveBeenCalled()
    expect(mockAdminPush).not.toHaveBeenCalled()
  })
})

describe('resolveInspectionIssue', () => {
  it('해소는 완료된 예약에 대여완료 포인트만 적립하고 고객 알림은 보내지 않는다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: true, completed_ids: [30, 31] }, error: null }))
    const r = await resolveInspectionIssue(admin, 30, 'admin-1', '추가청구 완료')
    expect(r.ok).toBe(true)
    expect(mockAward).toHaveBeenCalledTimes(2)
    expect(mockAward).toHaveBeenCalledWith(admin, 30)
    expect(mockAward).toHaveBeenCalledWith(admin, 31)
    expect(mockPush).not.toHaveBeenCalled()
    expect(admin.rpc).toHaveBeenCalledWith('resolve_return_inspection_issue', { p_reservation_id: 30, p_admin_id: 'admin-1', p_note: '추가청구 완료' })
    expect(admin.rpc).not.toHaveBeenCalledWith('send_return_notice_card', expect.anything())
  })

  it('실패하면 적립도 없다', async () => {
    const admin = makeAdmin(() => ({ data: { ok: false, error: '검수 이슈가 등록된 반납완료 건만 해소할 수 있습니다.' }, error: null }))
    const r = await resolveInspectionIssue(admin, 30, 'admin-1', '')
    expect(r.ok).toBe(false)
    expect(mockAward).not.toHaveBeenCalled()
  })
})

describe('이슈 입력 검증·상태 정규화', () => {
  const owns = (p: string) => /^7\/issue\/[0-9a-f-]{36}\.jpg$/.test(p)
  const UUID = '123e4567-e89b-12d3-a456-426614174000'

  it('이슈 항목 5종과 허용 키만 인정, 비면 거절', () => {
    expect(INSPECTION_ISSUE_TYPES.map((t) => t.key)).toEqual(['missing_part', 'mismatch', 'exterior_damage', 'malfunction', 'consumable_lost'])
    expect(validateIssueInput({ types: [] }, owns).ok).toBe(false)
    expect(validateIssueInput({ types: ['unknown'] }, owns).ok).toBe(false)
    const ok = validateIssueInput({ types: ['malfunction', 'malfunction'], detail: ' 전원 불량 ' }, owns)
    expect(ok.ok).toBe(true)
    if (ok.ok) {
      expect(ok.value.types).toEqual(['malfunction'])
      expect(ok.value.detail).toBe('전원 불량')
    }
  })

  it('증빙 경로는 주입된 소유 확인을 통과해야 한다', () => {
    expect(validateIssueInput({ types: ['mismatch'], media: [{ path: `7/issue/${UUID}.jpg`, kind: 'photo' }] }, owns).ok).toBe(true)
    expect(validateIssueInput({ types: ['mismatch'], media: [{ path: `8/issue/${UUID}.jpg`, kind: 'photo' }] }, owns).ok).toBe(false)
  })

  it('returned 이전에 만들어진 NULL 은 검수 대기로 본다', () => {
    expect(normalizeInspectionStatus(null)).toBe('pending')
    expect(normalizeInspectionStatus('issue')).toBe('issue')
    expect(normalizeInspectionStatus('pass')).toBe('pass')
    expect(normalizeInspectionStatus('weird')).toBe('pending')
  })
})
