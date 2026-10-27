import { describe, it, expect } from 'vitest'
import { buildJourneyStepDetails, formatTrackingLines } from '$lib/utils/journeyStepInfo'

const base = { status: 'confirmed', start_date: '2026-10-30', end_date: '2026-10-31', created_at: '2026-10-26T08:50:34Z', return_time: null, tracking_number: null, courier_code: null }

describe('formatTrackingLines', () => {
  it('JS-1 택배사·운송장 번호 중 있는 것만, 공백 값은 제외', () => {
    expect(formatTrackingLines('두발히어로', 'T-1')).toEqual(['택배사: 두발히어로', '운송장 번호: T-1'])
    expect(formatTrackingLines(null, 'T-1')).toEqual(['운송장 번호: T-1'])
    expect(formatTrackingLines('  ', '')).toEqual([])
  })
})

describe('buildJourneyStepDetails', () => {
  it('JS-2 계약완료 상태: 지난 단계는 안내문, 이후 단계는 아직 진행 전', () => {
    const d = buildJourneyStepDetails(base)
    expect(d.hold).toEqual(['예약신청이 접수되었어요.', '신청일: 2026-10-26'])
    expect(d.confirmed).toEqual(['전자계약 서명과 결제가 완료되어 예약이 확정되었어요.', '대여기간: 2026-10-30 ~ 2026-10-31'])
    expect(d.shipped).toEqual(['아직 진행 전이에요.'])
    expect(d.in_use).toEqual(['아직 진행 전이에요.'])
    expect(d.returned).toEqual(['아직 진행 전이에요.'])
  })
  it('JS-3 반출중 + 운송장: 택배사·운송장 번호를 보여준다', () => {
    const d = buildJourneyStepDetails({ ...base, status: 'shipped', courier_code: '두발히어로', tracking_number: 'TEST-QA-1026' })
    expect(d.shipped).toEqual(['배송이 시작되었어요.', '택배사: 두발히어로', '운송장 번호: TEST-QA-1026'])
  })
  it('JS-4 반출중이지만 운송장이 없으면 등록 안내(번호 줄 없음)', () => {
    const d = buildJourneyStepDetails({ ...base, status: 'shipped' })
    expect(d.shipped?.join(' ')).toContain('운송장이 등록되면')
    expect(d.shipped?.join(' ')).not.toContain('운송장 번호:')
  })
  it('JS-5 대여중: 반납 기한(시각 있으면 함께)', () => {
    expect(buildJourneyStepDetails({ ...base, status: 'in_use' }).in_use).toEqual(['대여 중이에요.', '반납 기한: 2026-10-31'])
    expect(buildJourneyStepDetails({ ...base, status: 'in_use', return_time: '18:00' }).in_use).toEqual(['대여 중이에요.', '반납 기한: 2026-10-31 18:00'])
  })
  it('JS-6 완료(completed)는 마지막 단계까지 지난 것으로 본다', () => {
    const d = buildJourneyStepDetails({ ...base, status: 'completed' })
    expect(d.returned?.[0]).toContain('반납이 완료')
    expect(d.shipped?.[0]).toBe('대여 장비를 준비·전달하고 있어요.')
  })
  it('JS-7 신청대기(hold): 예약신청만 지난 단계, 계약완료는 확정 조건 안내', () => {
    const d = buildJourneyStepDetails({ ...base, status: 'hold' })
    expect(d.hold?.[0]).toBe('예약신청이 접수되었어요.')
    expect(d.confirmed).toEqual(['전자계약 서명과 결제가 끝나면 예약이 확정돼요.'])
  })
  it('JS-8 날짜가 없으면 해당 줄만 생략', () => {
    const d = buildJourneyStepDetails({ ...base, start_date: null, end_date: null, created_at: null })
    expect(d.hold).toEqual(['예약신청이 접수되었어요.'])
    expect(d.confirmed).toEqual(['전자계약 서명과 결제가 완료되어 예약이 확정되었어요.'])
  })
})
