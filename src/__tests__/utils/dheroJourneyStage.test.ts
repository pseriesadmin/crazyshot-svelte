// src/__tests__/utils/dheroJourneyStage.test.ts
import { describe, it, expect } from 'vitest'
import { dheroJourneyStage, DHERO_STAGE_LABELS } from '$lib/utils/dheroJourneyStage'

const DHERO = '두발히어로'

describe('dheroJourneyStage — DHERO_STAGE_LABELS', () => {
  it('고정 라벨이 5개이고 순서가 맞다', () => {
    expect(DHERO_STAGE_LABELS).toHaveLength(5)
    expect(DHERO_STAGE_LABELS[0]).toBe('접수')
    expect(DHERO_STAGE_LABELS[1]).toBe('수거완료')
    expect(DHERO_STAGE_LABELS[2]).toBe('입고완료')
    expect(DHERO_STAGE_LABELS[3]).toBe('배송출발')
    expect(DHERO_STAGE_LABELS[4]).toBe('배송완료')
  })
})

describe('dheroJourneyStage — null 반환 케이스', () => {
  it('courierCode가 null이면 null', () => {
    expect(dheroJourneyStage({ courierCode: null, dheroStatusCode: 0, dheroMeta: null })).toBeNull()
  })
  it('courierCode가 undefined이면 null', () => {
    expect(dheroJourneyStage({ courierCode: undefined, dheroStatusCode: 0, dheroMeta: null })).toBeNull()
  })
  it('courierCode가 두발히어로 외 문자열이면 null', () => {
    expect(dheroJourneyStage({ courierCode: 'CJ대한통운', dheroStatusCode: 5, dheroMeta: null })).toBeNull()
  })
  it('dheroStatusCode가 null이면 null', () => {
    expect(dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: null, dheroMeta: null })).toBeNull()
  })
  it('dheroStatusCode가 undefined이면 null', () => {
    expect(dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: undefined, dheroMeta: null })).toBeNull()
  })
  it('알 수 없는 statusCode(예: 99)이면 null', () => {
    expect(dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 99, dheroMeta: null })).toBeNull()
  })
})

describe('dheroJourneyStage — 코드별 매핑', () => {
  it('코드 0 → index=0, label=접수, tone=normal', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 0, dheroMeta: null })
    expect(r).toEqual({ index: 0, label: '접수', tone: 'normal' })
  })
  it('코드 1(수거배차) → index=0, tone=normal', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 1, dheroMeta: null })
    expect(r).toEqual({ index: 0, label: '수거배차', tone: 'normal' })
  })
  it('코드 2(수거완료) → index=1, tone=normal', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 2, dheroMeta: null })
    expect(r).toEqual({ index: 1, label: '수거완료', tone: 'normal' })
  })
  it('코드 3(입고완료) → index=2, tone=normal', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 3, dheroMeta: null })
    expect(r).toEqual({ index: 2, label: '입고완료', tone: 'normal' })
  })
  it('코드 8(배송대기) → index=2, tone=normal', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 8, dheroMeta: null })
    expect(r).toEqual({ index: 2, label: '배송대기', tone: 'normal' })
  })
  it('코드 4(배송출발) → index=3, tone=normal', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 4, dheroMeta: null })
    expect(r).toEqual({ index: 3, label: '배송출발', tone: 'normal' })
  })
  it('코드 12(배송연기) → index=3, tone=warn', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 12, dheroMeta: null })
    expect(r).toEqual({ index: 3, label: '배송연기', tone: 'warn' })
  })
  it('코드 5(배송완료) → index=4, tone=normal', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 5, dheroMeta: null })
    expect(r).toEqual({ index: 4, label: '배송완료', tone: 'normal' })
  })
  it('코드 6(반송완료) → index=4, tone=danger', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 6, dheroMeta: null })
    expect(r).toEqual({ index: 4, label: '반송완료', tone: 'danger' })
  })
  it('코드 7(분실완료) → index=4, tone=danger', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 7, dheroMeta: null })
    expect(r).toEqual({ index: 4, label: '분실완료', tone: 'danger' })
  })
})

describe('dheroJourneyStage — canceledAt / accidentAt 우선순위', () => {
  it('canceledAt이 비지 않은 문자열이면 label=취소, tone=danger (코드 우선순위 덮어씀)', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO,
      dheroStatusCode: 0,
      dheroMeta: { canceledAt: '2026-10-28T10:00:00Z' },
    })
    expect(r).toEqual({ index: 0, label: '취소', tone: 'danger' })
  })
  it('canceledAt이 빈 문자열이면 취소로 처리하지 않음', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO,
      dheroStatusCode: 2,
      dheroMeta: { canceledAt: '' },
    })
    expect(r?.label).toBe('수거완료')
  })
  it('canceledAt이 공백만 있어도 취소 아님', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO,
      dheroStatusCode: 2,
      dheroMeta: { canceledAt: '   ' },
    })
    expect(r?.label).toBe('수거완료')
  })
  it('accidentAt이 비지 않은 문자열이면 label=사고, tone=danger', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO,
      dheroStatusCode: 4,
      dheroMeta: { accidentAt: '2026-10-28T09:00:00Z' },
    })
    expect(r).toEqual({ index: 3, label: '사고', tone: 'danger' })
  })
  it('canceledAt이 있으면 accidentAt보다 우선', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO,
      dheroStatusCode: 4,
      dheroMeta: { canceledAt: '2026-10-28T10:00:00Z', accidentAt: '2026-10-28T09:00:00Z' },
    })
    expect(r?.label).toBe('취소')
  })
  it('dheroMeta가 null이면 canceledAt/accidentAt 없이 코드 매핑 적용', () => {
    const r = dheroJourneyStage({ courierCode: DHERO, dheroStatusCode: 5, dheroMeta: null })
    expect(r?.label).toBe('배송완료')
  })
  it('canceledAt이 숫자 타입이면 취소로 처리하지 않음', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO,
      dheroStatusCode: 0,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dheroMeta: { canceledAt: 123 as any },
    })
    expect(r?.label).toBe('접수')
  })
})
