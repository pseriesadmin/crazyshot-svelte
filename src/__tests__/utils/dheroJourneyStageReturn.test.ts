// src/__tests__/utils/dheroJourneyStageReturn.test.ts
// 반납 leg 검증 — dheroJourneyStage returnBookId 파라미터
import { describe, it, expect } from 'vitest'
import { dheroJourneyStage } from '$lib/utils/dheroJourneyStage'

const DHERO = '두발히어로'
const RETURN_ID = 'RETURN-001'

describe('dheroJourneyStage — returnBookId=null (반납 접수번호 없음)', () => {
  it('returnBookId=null → null (반납 접수번호 미등록, 토글 미표시)', () => {
    expect(dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 4, dheroMeta: null,
      returnBookId: null,
    })).toBeNull()
  })

  it('returnBookId=null → null (dheroStatusCode가 있어도)', () => {
    expect(dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 0,
      dheroMeta: { bookId: RETURN_ID },
      returnBookId: null,
    })).toBeNull()
  })
})

describe('dheroJourneyStage — returnBookId 일치(meta.bookId === returnBookId)', () => {
  it('bookId 일치 + code 4 → 배송출발 normal', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 4,
      dheroMeta: { bookId: RETURN_ID },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 3, label: '배송출발', tone: 'normal' })
  })

  it('bookId 일치 + code 6 → 반송완료 danger', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 6,
      dheroMeta: { bookId: RETURN_ID },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 4, label: '반송완료', tone: 'danger' })
  })

  it('bookId 일치 + code 7 → 분실완료 danger', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 7,
      dheroMeta: { bookId: RETURN_ID },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 4, label: '분실완료', tone: 'danger' })
  })

  it('bookId 일치 + code 12 → 배송연기 warn', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 12,
      dheroMeta: { bookId: RETURN_ID },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 3, label: '배송연기', tone: 'warn' })
  })

  it('bookId 일치 + canceledAt 있음 → 취소 danger (신뢰함)', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 2,
      dheroMeta: { bookId: RETURN_ID, canceledAt: '2026-10-28T10:00:00Z' },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 1, label: '취소', tone: 'danger' })
  })

  it('bookId 일치 + accidentAt 있음 → 사고 danger (신뢰함)', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 3,
      dheroMeta: { bookId: RETURN_ID, accidentAt: '2026-10-28T09:00:00Z' },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 2, label: '사고', tone: 'danger' })
  })

  it('bookId 일치 + dheroStatusCode null → null (상태 코드 없음)', () => {
    expect(dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: null,
      dheroMeta: { bookId: RETURN_ID },
      returnBookId: RETURN_ID,
    })).toBeNull()
  })
})

describe('dheroJourneyStage — returnBookId 불일치 (meta.bookId !== returnBookId)', () => {
  it('bookId 불일치 → { index:0, label:접수, tone:normal }', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 5,
      dheroMeta: { bookId: 'OTHER-ID' },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 0, label: '접수', tone: 'normal' })
  })

  it('meta=null (bookId 없음) → { index:0, label:접수, tone:normal }', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 4,
      dheroMeta: null,
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 0, label: '접수', tone: 'normal' })
  })

  it('meta에 bookId 키 없음 → { index:0, label:접수, tone:normal }', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 4,
      dheroMeta: { canceledAt: undefined },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 0, label: '접수', tone: 'normal' })
  })

  it('bookId 불일치 + canceledAt 있어도 취소 아님 (신뢰 안 함)', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 4,
      dheroMeta: { bookId: 'OTHER-ID', canceledAt: '2026-10-28T10:00:00Z' },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 0, label: '접수', tone: 'normal' })
  })

  it('bookId 불일치 + accidentAt 있어도 사고 아님 (신뢰 안 함)', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 4,
      dheroMeta: { bookId: 'OTHER-ID', accidentAt: '2026-10-28T09:00:00Z' },
      returnBookId: RETURN_ID,
    })
    expect(r).toEqual({ index: 0, label: '접수', tone: 'normal' })
  })
})

describe('dheroJourneyStage — returnBookId=undefined (기존 동작 유지)', () => {
  it('returnBookId 미지정 → 기존 동작 그대로 (code 5 → 배송완료)', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 5,
      dheroMeta: { bookId: 'ANY' },
      // returnBookId 미지정 (undefined)
    })
    expect(r).toEqual({ index: 4, label: '배송완료', tone: 'normal' })
  })

  it('returnBookId=undefined + meta.bookId 없음 → 기존 동작 그대로 (code 3 → 입고완료)', () => {
    const r = dheroJourneyStage({
      courierCode: DHERO, dheroStatusCode: 3, dheroMeta: null,
    })
    expect(r).toEqual({ index: 2, label: '입고완료', tone: 'normal' })
  })
})

describe('dheroJourneyStage — returnBookId 있어도 courierCode 불일치 → null', () => {
  it('courierCode !== 두발히어로 + returnBookId → null', () => {
    expect(dheroJourneyStage({
      courierCode: 'CJ대한통운', dheroStatusCode: 5,
      dheroMeta: { bookId: RETURN_ID },
      returnBookId: RETURN_ID,
    })).toBeNull()
  })

  it('courierCode=null + returnBookId → null', () => {
    expect(dheroJourneyStage({
      courierCode: null, dheroStatusCode: 0,
      dheroMeta: { bookId: RETURN_ID },
      returnBookId: RETURN_ID,
    })).toBeNull()
  })
})
