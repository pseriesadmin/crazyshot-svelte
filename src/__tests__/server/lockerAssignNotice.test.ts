import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/**
 * 무인보관함 이용안내(locker_assign_notice, Migration #820) — 배정 확정 저장 즉시 푸시+문자 사전 고지 (2026-11-12, Stephen)
 *  · 등록한 문장이 있고 알림이 켜져 있을 때만, 예약당 1회, 취소·만료 제외
 *  · 문장은 100자 이내(서버 검증), 번호·비밀번호 변수는 쓸 수 없다
 *  · 무인함 비밀번호 저장 API 가 저장 성공 뒤에만 이 발송을 호출한다
 */

const mockOverride = vi.fn()
vi.mock('$lib/server/notifyMessages', () => ({ getNotifyMessageOverride: (...a: unknown[]) => mockOverride(...a) }))
const mockHub = vi.fn()
vi.mock('$lib/server/push', () => ({ sendReservationLifecyclePush: (...a: unknown[]) => mockHub(...a) }))

import { sendLockerAssignNotice } from '$lib/server/lockerAssignNotice'
import { validateNotifyMessage, getNotifySpec } from '$lib/utils/notifyTemplate'

function fakeAdmin(opts: { enabled?: boolean | null; claimRows?: { id: number }[]; claimError?: boolean }) {
  const updates: Record<string, unknown>[] = []
  const admin = {
    from(table: string) {
      const q: Record<string, unknown> = {}
      Object.assign(q, {
        select: () => q,
        eq: () => q,
        is: () => q,
        not: () => q,
        update: (v: Record<string, unknown>) => { updates.push(v); return q },
        maybeSingle: async () => ({ data: table === 'push_notification_config' && opts.enabled !== null ? { push_enabled: opts.enabled ?? true } : null }),
        then: (resolve: (v: unknown) => void) => resolve(opts.claimError ? { data: null, error: { message: 'boom' } } : { data: opts.claimRows ?? [{ id: 5 }], error: null }),
      })
      return q
    },
  }
  return { admin: admin as never, updates }
}

beforeEach(() => {
  mockOverride.mockReset()
  mockHub.mockReset()
})

describe('sendLockerAssignNotice', () => {
  it('등록한 문장이 있고 켜져 있으면 선점 후 푸시·문자 허브를 1회 호출한다', async () => {
    mockOverride.mockResolvedValue('무인보관함이 배정됐어요')
    const f = fakeAdmin({})
    const r = await sendLockerAssignNotice(f.admin, 5)
    expect(r).toEqual({ sent: true, reason: 'sent' })
    expect(f.updates[0]).toHaveProperty('locker_assign_notice_sent_at')
    expect(mockHub).toHaveBeenCalledTimes(1)
    expect(mockHub).toHaveBeenCalledWith(f.admin, 5, 'locker_assign_notice')
  })
  it('등록한 문장이 없으면 보내지도, 선점하지도 않는다', async () => {
    mockOverride.mockResolvedValue(null)
    const f = fakeAdmin({})
    const r = await sendLockerAssignNotice(f.admin, 5)
    expect(r.reason).toBe('no_message')
    expect(f.updates.length).toBe(0)
    expect(mockHub).not.toHaveBeenCalled()
  })
  it('알림을 꺼 둔 상태면 보내지 않는다', async () => {
    mockOverride.mockResolvedValue('안내')
    const f = fakeAdmin({ enabled: false })
    const r = await sendLockerAssignNotice(f.admin, 5)
    expect(r.reason).toBe('disabled')
    expect(mockHub).not.toHaveBeenCalled()
  })
  it('이미 보냈거나 취소·만료된 예약(선점 대상 없음)이면 보내지 않는다 — 예약당 1회', async () => {
    mockOverride.mockResolvedValue('안내')
    const f = fakeAdmin({ claimRows: [] })
    const r = await sendLockerAssignNotice(f.admin, 5)
    expect(r.reason).toBe('already_sent')
    expect(mockHub).not.toHaveBeenCalled()
  })
  it('선점 오류는 예외 없이 보내지 않는다', async () => {
    mockOverride.mockResolvedValue('안내')
    const f = fakeAdmin({ claimError: true })
    await expect(sendLockerAssignNotice(f.admin, 5)).resolves.toEqual({ sent: false, reason: 'error' })
    expect(mockHub).not.toHaveBeenCalled()
  })
})

describe('무인보관함 이용안내 문장 규칙', () => {
  it('푸시+문자 대상이며 100자까지 저장되고 101자는 거절된다', () => {
    expect(getNotifySpec('locker_assign_notice')?.sms).toBe(true)
    expect(validateNotifyMessage('locker_assign_notice', '가'.repeat(100)).error).toBeUndefined()
    const over = validateNotifyMessage('locker_assign_notice', '가'.repeat(101))
    expect(over.ok).toBe(false)
    expect(over.error).toContain('100자')
  })
  it('한글·영문·숫자·특수문자는 입력되고, 번호·비밀번호 변수는 쓸 수 없다', () => {
    expect(validateNotifyMessage('locker_assign_notice', 'Locker 7 배정! (1시간 전 재안내) #안내').ok).toBe(true)
    expect(validateNotifyMessage('locker_assign_notice', '비번 {{무인함비밀번호}}').ok).toBe(false)
  })
})

describe('배정 저장 API 연결(소스 점검)', () => {
  const src = readFileSync(resolve(process.cwd(), 'src/routes/api/cms/reservations/[id]/locker-password/+server.ts'), 'utf8')
  it('비밀번호를 저장한 경우에만, 저장 RPC 성공 뒤에 호출한다', () => {
    const rpcAt = src.indexOf("'update_reservation_locker_password'")
    const callAt = src.indexOf('sendLockerAssignNotice(')
    expect(rpcAt).toBeGreaterThan(-1)
    expect(callAt).toBeGreaterThan(rpcAt)
    expect(src).toMatch(/if \(lockerPassword !== null\) \{\s*assignNotice = \(await sendLockerAssignNotice/)
    expect(src).toContain('assign_notice: assignNotice') // 화면이 발송 여부로 토스트를 띄운다
  })
})

describe('배정 확정 화면 토스트 연결(소스 점검)', () => {
  const panel = readFileSync(resolve(process.cwd(), 'src/lib/components/cms/RentalDetailPanel.svelte'), 'utf8')
  it("응답 assign_notice 가 'sent'일 때만 '발송되었습니다' 토스트를 띄운다", () => {
    expect(panel).toContain("saved.assign_notice === 'sent'")
    expect(panel).toContain("'무인보관함 이용안내' 알림이 발송되었습니다.")
  })
})
