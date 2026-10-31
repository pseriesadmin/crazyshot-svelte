/**
 * lockerReturnGuide.test.ts — 무인보관함 "반납용" 안내 (2026-10-31, Stephen 확정, Migration #787)
 *  R1 반납 문장은 별도 안내 유형(locker_return_guide)의 편집 문장 → 없으면 반납용 기본 문구
 *  R2 수령 문장은 기존 locker_guide 그대로(회귀 없음)
 *  R3 반납 기본 문구가 변수(무인함번호·비밀번호·반납기한·중앙현관)로 조립된다 / 값이 없으면 그 줄·부분이 빠진다
 *  R4 마이그레이션·API·화면이 발송 대상(수령/반납) 규칙을 지킨다(소스 점검)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

let overrides: Record<string, string | null> = {}
vi.mock('$lib/server/notifyMessages', () => ({
  getNotifyMessageOverride: async (_a: unknown, type: string) => overrides[type] ?? null,
}))
vi.mock('$lib/server/lockerEntrance', () => ({ getLockerEntrancePassword: async () => '#1234' }))
vi.mock('$lib/server/products/resolveParentProductFields', () => ({ applyParentFieldsToRowProducts: async () => undefined }))

import { composeLockerGuideMessage } from '$lib/server/lockerGuideMessage'
import { getNotifySpec, NOTIFY_SPECS } from '$lib/utils/notifyTemplate'
import { CUSTOMER_LIFECYCLE_PUSH_COPY } from '$lib/server/push'

const RESV = {
  user_id: 'u1',
  reservation_code: 'R-1',
  start_date: '2026-11-01',
  end_date: '2026-11-03',
  pickup_time: '09:00',
  return_time: '10:00',
  locker_number: '7',
  locker_password: '*8821',
  products: { name: '카메라' },
}
const fakeAdmin = (resv: Record<string, unknown> = RESV) => ({
  from: (table: string) => ({
    select: () => ({
      eq: () => ({ maybeSingle: async () => ({ data: table === 'rental_reservations' ? resv : { full_name: '홍길동' } }) }),
    }),
  }),
}) as never

beforeEach(() => { overrides = {} })

describe('R1·R2 — 수령/반납 문장 선택', () => {
  it('반납은 locker_return_guide 편집 문장을 쓴다(수령 편집 문장은 쓰지 않는다)', async () => {
    overrides = { locker_guide: '수령문 {{무인함번호}}', locker_return_guide: '반납문 {{무인함번호}}번함' }
    expect(await composeLockerGuideMessage(fakeAdmin(), 1, { leg: 'return' })).toBe('반납문 7번함')
  })
  it('수령은 기존 locker_guide 편집 문장 그대로', async () => {
    overrides = { locker_guide: '수령문 {{무인함번호}}', locker_return_guide: '반납문' }
    expect(await composeLockerGuideMessage(fakeAdmin(), 1, { leg: 'pickup' })).toBe('수령문 7')
    expect(await composeLockerGuideMessage(fakeAdmin(), 1)).toBe('수령문 7') // leg 생략 = 수령(기존 호출부 호환)
  })
  it('반납 편집 문장이 없으면 반납용 기본 문구 — 수령 편집 문장으로 대신하지 않는다', async () => {
    overrides = { locker_guide: '수령문 전용' }
    const text = await composeLockerGuideMessage(fakeAdmin(), 1, { leg: 'return' })
    expect(text).toContain('반납 안내예요')
    expect(text).not.toContain('수령문 전용')
  })
})

describe('R3 — 반납 기본 문구', () => {
  it('상품명·함 번호·비밀번호·반납기한·중앙현관이 채워진다', async () => {
    const text = (await composeLockerGuideMessage(fakeAdmin(), 1, { leg: 'return' })) ?? ''
    expect(text).toContain('카메라 반납 안내예요')
    expect(text).toContain('7번함')
    expect(text).toContain("'*8821'")
    expect(text).toContain('2026-11-03 10:00')
    expect(text).toContain('중앙현관 비밀번호: #1234')
    expect(text).toContain('연체 요금')
    expect(text).not.toContain('{{')
  })
  it('함 번호가 없으면 "N번함" 부분만 빠진다', async () => {
    const text = (await composeLockerGuideMessage(fakeAdmin({ ...RESV, locker_number: null }), 1, { leg: 'return' })) ?? ''
    expect(text).not.toContain('번함')
    expect(text).not.toContain('{{')
  })
  it('반납 유형 등록: 변수 목록에 무인함번호·반납기한 포함, 문자(sms) 대상, 푸시 제목/본문 있음', () => {
    const spec = getNotifySpec('locker_return_guide')
    expect(spec).toBeTruthy()
    expect(spec?.sms).toBe(true)
    expect(spec?.vars).toEqual(expect.arrayContaining(['무인함번호', '무인함비밀번호', '중앙현관비밀번호', '반납기한']))
    expect(NOTIFY_SPECS.filter((s) => s.notifyType === 'locker_return_guide')).toHaveLength(1)
    expect(CUSTOMER_LIFECYCLE_PUSH_COPY.locker_return_guide?.title).toBe('무인보관함 반납 안내')
  })
})

const read = (p: string): string => readFileSync(resolve(process.cwd(), p), 'utf8')

describe('R4 — 소스 점검', () => {
  const mig = read('supabase/migrations/20261031110000_787_locker_guide_legs.sql')
  it('마이그레이션: 컬럼·체크·4인자 RPC·수령/반납 조건·설정 행·권한', () => {
    expect(mig).toContain('locker_guide_legs')
    expect(mig).toContain("IN ('pickup', 'return', 'both')")
    expect(mig).toContain('p_legs')
    expect(mig).toContain("r.locker_guide_legs IN ('pickup', 'both')")
    expect(mig).toContain("r.locker_guide_legs IN ('return', 'both')")
    expect(mig).toContain("'locker_return_guide'")
    expect(mig).toContain('TO service_role')
    expect(mig).toContain('REVOKE ALL ON FUNCTION public.claim_reservations_due_for_locker_guide')
  })
  it('API: 저장은 발송 대상 필수·검증 후 p_legs 전달, 조회는 비밀번호가 있을 때만 발송 대상을 내린다', () => {
    const api = read('src/routes/api/cms/reservations/[id]/locker-password/+server.ts')
    expect(api).toContain('isValidLockerGuideLegs')
    expect(api).toContain('p_legs')
    expect(api).toContain('locker_guide_legs')
  })
  it('시범 발송 API: 선택한 발송 대상별로 같은 조립 함수를 쓴다', () => {
    const api = read('src/routes/api/cms/reservations/[id]/locker-password/test-send/+server.ts')
    expect(api).toContain('legListFromLegs')
    expect(api).toMatch(/composeLockerGuideMessage\(admin, reservationId, \{[^}]*leg/)
  })
  it('크론: 선점된 건의 leg로 문장을 만들고 푸시 유형도 leg로 고른다', () => {
    const cron = read('src/routes/api/cron/locker-guide/+server.ts')
    expect(cron).toMatch(/composeLockerGuideMessage\(admin, row\.reservation_id, \{[^}]*leg: row\.leg/)
    expect(cron).toContain("'locker_return_guide'")
  })
  it('화면: 수령/반납 콤보(aria-pressed)·미설정 경고 토스트·배정 확정 좌측 시범 발송', () => {
    const ui = read('src/lib/components/cms/RentalDetailPanel.svelte')
    expect(ui).toContain('무인보관함 정보를 설정해주세요.')
    expect(ui).toContain('locker-leg-btn')
    expect(ui).toContain('aria-pressed')
    expect(ui).toContain('legsFromSelection')
    const titleRow = ui.slice(ui.indexOf('<span class="section-title">무인보관함 배정정보</span>'))
    const sendIdx = titleRow.indexOf('sendLockerTest')
    const saveIdx = titleRow.indexOf('saveLockerPassword')
    expect(sendIdx).toBeGreaterThan(-1)
    expect(sendIdx).toBeLessThan(saveIdx) // 시범 발송이 배정 확정보다 앞(좌측)
  })
})
