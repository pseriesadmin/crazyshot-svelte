import { describe, it, expect, vi } from 'vitest'
import { isDheroIntegrationMethod } from '../../lib/server/isDheroIntegrationMethod'

/**
 * ⓪ 두발히어로 연동 전용 스위치 분리 (2026-10-27, Stephen 지시 — 4번 작업 첫 단계)
 * 연동 대상 판정은 rental_method_options.is_dhero_integration 한 컬럼만 본다.
 * (장바구니 "요청 A" 스위치 is_bulk_delivery 와 완전히 분리 — 서로 영향을 주지 않는다)
 *
 *  DI-1  켜진 방식(true)만 연동 대상
 *  DI-2  꺼진 방식·방식 없음·조회 실패·컬럼 없음(마이그레이션 미적용 환경)은 전부 false (fail-safe — 접수·반품 호출이 새어 나가지 않는다)
 *  DI-3  판정은 is_dhero_integration 만 조회한다 (is_bulk_delivery 를 읽지 않는다)
 */

function makeAdmin(result: { data: unknown; error: unknown }) {
  const selectSpy = vi.fn()
  const eqSpy = vi.fn()
  const admin = {
    from: vi.fn(() => ({
      select: (cols: string) => {
        selectSpy(cols)
        return {
          eq: (col: string, val: string) => {
            eqSpy(col, val)
            return { is: () => ({ maybeSingle: async () => result }) }
          },
        }
      },
    })),
  }
  return { admin, selectSpy, eqSpy }
}

describe('isDheroIntegrationMethod', () => {
  it('DI-1: is_dhero_integration=true 인 방식만 연동 대상이다', async () => {
    const { admin } = makeAdmin({ data: { is_dhero_integration: true }, error: null })
    expect(await isDheroIntegrationMethod(admin, 'delivery')).toBe(true)
  })

  it('DI-2: 꺼짐·방식 없음·조회 오류(컬럼 없음 포함)는 false', async () => {
    expect(await isDheroIntegrationMethod(makeAdmin({ data: { is_dhero_integration: false }, error: null }).admin, 'delivery')).toBe(false)
    expect(await isDheroIntegrationMethod(makeAdmin({ data: null, error: null }).admin, 'delivery')).toBe(false)
    expect(await isDheroIntegrationMethod(makeAdmin({ data: null, error: { message: 'column "is_dhero_integration" does not exist' } }).admin, 'delivery')).toBe(false)
    expect(await isDheroIntegrationMethod(makeAdmin({ data: { is_dhero_integration: true }, error: null }).admin, null)).toBe(false)
    expect(await isDheroIntegrationMethod(makeAdmin({ data: { is_dhero_integration: true }, error: null }).admin, '')).toBe(false)
  })

  it('DI-3: is_dhero_integration 컬럼만 조회하고 method_key 로 찾는다', async () => {
    const { admin, selectSpy, eqSpy } = makeAdmin({ data: { is_dhero_integration: false }, error: null })
    await isDheroIntegrationMethod(admin, 'quick')
    expect(selectSpy).toHaveBeenCalledWith('is_dhero_integration')
    expect(eqSpy).toHaveBeenCalledWith('method_key', 'quick')
  })
})
