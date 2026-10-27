import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/** 두발히어로 접수 직후 운송장 등록 안내 (2026-10-27) */
const pushMock = vi.hoisted(() => vi.fn(async () => undefined))
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: pushMock }))

import { notifyTrackingRegistered } from '$lib/server/notifyTrackingRegistered'

beforeEach(() => { pushMock.mockClear(); pushMock.mockImplementation(async () => undefined) })

describe('notifyTrackingRegistered', () => {
  it('NT-1 채팅카드 RPC(tracking_notify)와 푸시·문자 허브를 같은 예약으로 호출한다', async () => {
    const rpc = vi.fn(async () => ({ data: null, error: null }))
    await notifyTrackingRegistered({ rpc } as never, 55)
    expect(rpc).toHaveBeenCalledWith('send_rental_chat_notification', { p_reservation_id: 55, p_notify_type: 'tracking_notify' })
    expect(pushMock).toHaveBeenCalledWith(expect.anything(), 55, 'tracking_notify')
  })
  it('NT-2 채팅 RPC 예외여도 푸시는 시도하고, 푸시 예외여도 throw 하지 않는다(fail-soft)', async () => {
    const rpc = vi.fn(async () => { throw new Error('rpc down') })
    pushMock.mockImplementation(async () => { throw new Error('push down') })
    await expect(notifyTrackingRegistered({ rpc } as never, 55)).resolves.toBeUndefined()
    expect(pushMock).toHaveBeenCalledTimes(1)
  })
  it('NT-2b 채팅 RPC가 throw 대신 { error }를 돌려줘도 로그를 남기고 푸시는 계속 시도한다', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const rpc = vi.fn(async () => ({ data: null, error: { message: 'rpc failed' } }))
    await expect(notifyTrackingRegistered({ rpc } as never, 55)).resolves.toBeUndefined()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('[55]'), 'rpc failed')
    expect(pushMock).toHaveBeenCalledTimes(1)
    spy.mockRestore()
  })
  it('NT-3 두 접수 경로(상태 전환 shipped · CMS 접수 API)가 저장 성공 뒤 이 안내를 호출한다', () => {
    const status = readFileSync('src/routes/cms/reservation/+page.server.ts', 'utf8')
    const api = readFileSync('src/routes/api/cms/reservations/[id]/dhero/+server.ts', 'utf8')
    expect(status).toContain("from '$lib/server/notifyTrackingRegistered'")
    expect(api).toContain("from '$lib/server/notifyTrackingRegistered'")
    // 저장(update_reservation_dhero_shipment) 뒤에 위치
    expect(status.indexOf('await notifyTrackingRegistered(')).toBeGreaterThan(status.indexOf("'update_reservation_dhero_shipment'"))
    expect(api.indexOf('await notifyTrackingRegistered(')).toBeGreaterThan(api.indexOf("'update_reservation_dhero_shipment'"))
  })
})
