/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 고정된 프로젝트 소스 경로를 읽는 용도 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 장바구니 공동현관 출입번호 전용 칸 — 구조 가드 (Migration #774, 2026-10-27, Stephen 확정 C안)
 *
 * CF-1 폼 상태(FormState)·기본값·통합 폼 병합 키·병합 함수에 frontdoor 가 모두 들어 있다(하나라도 빠지면 통합 폼 값이 조용히 사라진다)
 * CF-2 저장은 배송형(퀵 제외) 수령에서만, set_reservation_frontdoor_password RPC 로, 예약신청 저장 지점 2곳 모두에서 호출한다
 * CF-3 입력칸은 수령(rental) 폼의 배송형 방식에서만 보이고 maxlength 50, 반납 폼에는 보이지 않는다
 * CF-4 저장 실패는 예약신청을 막지 않고 안내만 한다(선택 입력)
 * CF-6 두발히어로 상태 조회 API 는 응답의 reservation 에서 출입번호를 빼서 내려준다(응답 최소화)
 * CF-5 두발히어로 전달: 접수 호출이 frontdoorPassword 를 싣고, 메모(운송장 인쇄)와 별도 칸이다
 */
const cart = readFileSync(join(process.cwd(), 'src/routes/cart/+page.svelte'), 'utf-8')
const saveFn = (cart.match(/async function saveFrontdoorPassword[\s\S]*?\n {2}}\n/) ?? [''])[0]

describe('장바구니 공동현관 출입번호 칸', () => {
  it('CF-1: 폼 상태·기본값·병합 키·병합 함수에 모두 있다', () => {
    expect(cart).toContain('    frontdoor: string;')
    expect(cart).toContain("notes: '', frontdoor: '', memberCheck: false")
    expect(cart).toContain("'notes', 'frontdoor', 'memberCheck'")
    expect(cart).toContain("frontdoor: pick('frontdoor'),")
  })

  it('CF-2: 배송형(퀵 제외) 수령에서만 RPC 로 저장하고 저장 지점 2곳 모두 호출한다', () => {
    const fn = saveFn
    expect(fn.length).toBeGreaterThan(50)
    expect(fn).toContain('isShippingFeeMethod(pickup)')
    expect(fn).toContain("'set_reservation_frontdoor_password'")
    expect(fn).toContain('!password.trim()') // 빈 값이면 호출하지 않는다(배포 순서 방어)
    expect(fn).toContain('p_password:       password.trim(),')
    const calls = cart.match(/await saveFrontdoorPassword\(/g) ?? []
    expect(calls).toHaveLength(2)
    expect(cart).toContain('await saveFrontdoorPassword(reservationId, pm, effectiveForms(it).rental.frontdoor)')
    expect(cart).toContain('await saveFrontdoorPassword(reservationId, pickupMethodSafe, effectiveForms(it).rental.frontdoor)')
  })

  it('CF-3: 입력칸은 수령 폼의 배송형 방식에서만 보이고 50자 제한이다', () => {
    expect(cart).toContain("showFrontdoor: props.type === 'rental' && isShippingFeeMethod(props.method)")
    const snippet = cart.slice(cart.indexOf('{#snippet NotesSection'), cart.indexOf('{/snippet}', cart.indexOf('{#snippet NotesSection')))
    expect(snippet).toContain('{#if p.showFrontdoor}')
    expect(snippet).toContain('maxlength={50}')
    expect(snippet).toContain('운송장에는 인쇄되지 않아요')
  })

  it('CF-4: 저장 실패는 안내만 하고 예약신청을 막지 않는다(return 없음)', () => {
    const fn = saveFn
    expect(fn.length).toBeGreaterThan(50)
    expect(fn).toContain('csToast.warning(')
    expect(fn).not.toMatch(/\breturn \{|\bthrow\b/)
  })

  it('CF-5: 두발히어로 접수 호출이 frontdoorPassword 를 메모와 별도로 싣는다', () => {
    const page = readFileSync(join(process.cwd(), 'src/routes/cms/reservation/+page.server.ts'), 'utf-8')
    const api = readFileSync(join(process.cwd(), 'src/routes/api/cms/reservations/[id]/dhero/+server.ts'), 'utf-8')
    const dhero = readFileSync(join(process.cwd(), 'src/lib/server/dhero.ts'), 'utf-8')
    expect(page).toContain('frontdoorPassword:         res.frontdoorPassword ?? undefined,')
    expect(api).toContain('frontdoorPassword:         res.frontdoorPassword ?? undefined,')
    expect(dhero).toContain('...(frontdoor ? { frontdoorPassword: frontdoor } : {}),')
  })

  it('CF-6: dhero 상태 조회 API 는 응답에 출입번호를 싣지 않는다(응답 최소화)', () => {
    const api = readFileSync(join(process.cwd(), 'src/routes/api/cms/reservations/[id]/dhero/+server.ts'), 'utf-8')
    expect(api).toContain('const resPublic = { ...res, frontdoorPassword: null }')
    expect(api).not.toContain('reservation: res,')
    expect((api.match(/reservation: resPublic/g) ?? []).length).toBe(3)
  })
})
