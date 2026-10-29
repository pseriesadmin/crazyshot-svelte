import { describe, it, expect, vi } from 'vitest'
import { fetchReturnLegForDisplay, DHERO_RETURN_DISPLAY_TIMEOUT_MS } from '$lib/server/dheroReturnLegDisplay'
import type { DheroDeliveryStatus } from '$lib/server/dhero'

const MOCK_RETURN_STATUS: DheroDeliveryStatus = {
  bookId:  'RTN-001',
  status:  0,           // 접수
}

describe('fetchReturnLegForDisplay — 반납 leg 표시용 조회', () => {

  it('dheroReturnBookId=null → null (반납 미접수)', async () => {
    const getDelivery = vi.fn()
    const result = await fetchReturnLegForDisplay(null, '두발히어로', getDelivery)
    expect(result).toBeNull()
    expect(getDelivery).not.toHaveBeenCalled()
  })

  it('dheroReturnBookId=undefined → null', async () => {
    const getDelivery = vi.fn()
    const result = await fetchReturnLegForDisplay(undefined, '두발히어로', getDelivery)
    expect(result).toBeNull()
    expect(getDelivery).not.toHaveBeenCalled()
  })

  it('두발히어로가 아닌 택배사 → null (조회 건너뜀)', async () => {
    const getDelivery = vi.fn()
    const result = await fetchReturnLegForDisplay('RTN-001', 'CJ대한통운', getDelivery)
    expect(result).toBeNull()
    expect(getDelivery).not.toHaveBeenCalled()
  })

  it('두발히어로 + 반납번호 있음 → 조회 성공 → DheroDeliveryStatus 반환', async () => {
    const getDelivery = vi.fn().mockResolvedValue(MOCK_RETURN_STATUS)
    const result = await fetchReturnLegForDisplay('RTN-001', '두발히어로', getDelivery)
    expect(result).toEqual(MOCK_RETURN_STATUS)
    expect(getDelivery).toHaveBeenCalledWith('RTN-001')
  })

  it('조회 실패 → fail-soft → null (메인 응답 차단 안 함)', async () => {
    const getDelivery = vi.fn().mockRejectedValue(new Error('dhero API 오류'))
    const result = await fetchReturnLegForDisplay('RTN-001', '두발히어로', getDelivery)
    expect(result).toBeNull()
  })

  it('타임아웃 초과 → fail-soft → null', async () => {
    const getDelivery = vi.fn().mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve(MOCK_RETURN_STATUS), 200)),
    )
    // 50ms 타임아웃으로 강제 초과
    const result = await fetchReturnLegForDisplay('RTN-001', '두발히어로', getDelivery, 50)
    expect(result).toBeNull()
  })

  it('courier_code=null (구형 예약) + 반납번호 있음 → 두발히어로로 간주, 조회 시도', async () => {
    // isDheroBooking(null) === true (하위 호환)
    const getDelivery = vi.fn().mockResolvedValue(MOCK_RETURN_STATUS)
    const result = await fetchReturnLegForDisplay('RTN-001', null, getDelivery)
    expect(result).toEqual(MOCK_RETURN_STATUS)
  })

  it('DHERO_RETURN_DISPLAY_TIMEOUT_MS === 8000', () => {
    expect(DHERO_RETURN_DISPLAY_TIMEOUT_MS).toBe(8000)
  })
})
