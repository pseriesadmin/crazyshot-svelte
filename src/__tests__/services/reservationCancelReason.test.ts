import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public'
import { CANCEL_REASON_OPTIONS, CANCEL_REASON_NOTE_MAX, isCancelReasonCode } from '$lib/utils/cancelReason'

/**
 * 예약 취소·환불 사유(Migration #711) — 사유 항목 정의 + Stage 라이브(RPC 저장·검증·권한).
 * 정상: 취소된 예약에 코드+메모 저장·삭제 / 막아야할것: 취소 안 된 예약·잘못된 코드·200자 초과 거절, 로그인 사용자(anon 키)는 함수 실행 불가.
 */
describe('취소·환불 사유 항목', () => {
  it('대표 사유 5개 + 기타 = 6종, 마지막이 기타', () => {
    expect(CANCEL_REASON_OPTIONS).toHaveLength(6)
    expect(CANCEL_REASON_OPTIONS[5].id).toBe('other')
    expect(CANCEL_REASON_OPTIONS[5].label).toBe('기타')
    expect(CANCEL_REASON_NOTE_MAX).toBe(200)
  })
  it('코드 검증', () => {
    expect(isCancelReasonCode('stock_issue')).toBe(true)
    expect(isCancelReasonCode('nope')).toBe(false)
    expect(isCancelReasonCode(null)).toBe(false)
  })
})

const isStage = PUBLIC_SUPABASE_URL.includes('ezyvffjvuwmtuhpxdjrw')
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
let targetId: number | null = null
let backup: { cancel_reason_code: string | null; cancel_reason_note: string | null } | null = null

afterAll(async () => {
  if (isStage && targetId && backup) {
    await admin.rpc('cms_set_reservation_cancel_reason', { p_reservation_id: targetId, p_code: backup.cancel_reason_code, p_note: backup.cancel_reason_note })
  }
})

describe.skipIf(!isStage)('cms_set_reservation_cancel_reason (Stage)', () => {
  it('취소된 예약에 코드·메모를 저장하고 지우면 비워진다', async () => {
    const { data: c } = await admin.from('rental_reservations').select('id, cancel_reason_code, cancel_reason_note').eq('status', 'cancelled').limit(1).maybeSingle()
    expect(c).not.toBeNull()
    targetId = (c as { id: number }).id
    backup = { cancel_reason_code: (c as { cancel_reason_code: string | null }).cancel_reason_code, cancel_reason_note: (c as { cancel_reason_note: string | null }).cancel_reason_note }

    const ok = await admin.rpc('cms_set_reservation_cancel_reason', { p_reservation_id: targetId, p_code: 'stock_issue', p_note: '  재고 점검 중 불량 확인  ' })
    expect((ok.data as { ok?: boolean }).ok).toBe(true)
    const { data: after } = await admin.from('rental_reservations').select('cancel_reason_code, cancel_reason_note').eq('id', targetId).single()
    expect(after).toEqual({ cancel_reason_code: 'stock_issue', cancel_reason_note: '재고 점검 중 불량 확인' })

    const clear = await admin.rpc('cms_set_reservation_cancel_reason', { p_reservation_id: targetId, p_code: null, p_note: '' })
    expect((clear.data as { ok?: boolean }).ok).toBe(true)
    const { data: cleared } = await admin.from('rental_reservations').select('cancel_reason_code, cancel_reason_note').eq('id', targetId).single()
    expect(cleared).toEqual({ cancel_reason_code: null, cancel_reason_note: null })
  })
  it('잘못된 코드·200자 초과는 거절', async () => {
    const id = targetId as number
    const bad = await admin.rpc('cms_set_reservation_cancel_reason', { p_reservation_id: id, p_code: 'nope', p_note: '' })
    expect((bad.data as { error?: string }).error).toBe('invalid_code')
    const long = await admin.rpc('cms_set_reservation_cancel_reason', { p_reservation_id: id, p_code: 'other', p_note: 'ㄱ'.repeat(201) })
    expect((long.data as { error?: string }).error).toBe('note_too_long')
    const exact = await admin.rpc('cms_set_reservation_cancel_reason', { p_reservation_id: id, p_code: 'other', p_note: 'ㄱ'.repeat(200) })
    expect((exact.data as { ok?: boolean }).ok).toBe(true)
  })
  it('취소되지 않은 예약·없는 예약은 거절', async () => {
    const { data: h } = await admin.from('rental_reservations').select('id').neq('status', 'cancelled').limit(1).maybeSingle()
    const notCancelled = await admin.rpc('cms_set_reservation_cancel_reason', { p_reservation_id: (h as { id: number }).id, p_code: 'other', p_note: '' })
    expect((notCancelled.data as { error?: string }).error).toBe('not_cancelled')
    const nf = await admin.rpc('cms_set_reservation_cancel_reason', { p_reservation_id: 999999999, p_code: null, p_note: '' })
    expect((nf.data as { error?: string }).error).toBe('not_found')
  })
  it('일반(anon) 키로는 함수를 실행할 수 없다', async () => {
    const anon = createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY)
    const r = await anon.rpc('cms_set_reservation_cancel_reason', { p_reservation_id: targetId ?? 1, p_code: 'other', p_note: 'x' })
    expect(r.error).not.toBeNull()
  })
})
