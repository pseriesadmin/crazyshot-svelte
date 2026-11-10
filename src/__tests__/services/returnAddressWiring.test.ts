/* eslint-disable security/detect-non-literal-fs-filename -- 고정된 프로젝트 소스 경로를 읽는 소스 점검 테스트 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// 반납 주소 저장(Migration #806, 2026-11-10) — 장바구니 입력값이 예약에 남고 관리자 화면에 보이는 연결 점검
const read = (p: string): string => readFileSync(join(process.cwd(), p), 'utf8')

describe('반납 주소 저장 연결 — 소스 점검', () => {
  const sql = read('supabase/migrations/20261110150000_806_return_address.sql')
  const cart = read('src/routes/cart/+page.svelte')

  it('마이그레이션: 칸 3개 + 길이 제한 + 본인 예약·출고 전 상태만 + anon 차단', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS return_address_road/)
    expect(sql).toMatch(/return_address_detail/)
    expect(sql).toMatch(/return_postal_code/)
    expect(sql).toMatch(/char_length\(return_postal_code\)\s+<= 10/)
    expect(sql).toMatch(/user_id = auth\.uid\(\)/)
    expect(sql).toMatch(/status IN \('draft', 'hold', 'pending', 'confirmed'\)/)
    expect(sql).toMatch(/REVOKE ALL ON FUNCTION public\.set_reservation_return_address\(bigint, text, text, text\) FROM PUBLIC, anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.set_reservation_return_address\(bigint, text, text, text\) TO authenticated, service_role/)
  })

  it('장바구니: 배송형 반납일 때만 별도 호출로 저장하고 실패해도 예약신청은 막지 않는다', () => {
    const i = cart.indexOf('async function saveReturnAddress')
    expect(i).toBeGreaterThan(-1)
    const body = cart.slice(i, i + 900)
    expect(body).toMatch(/isDeliveryTypeMethod\(return_\)/)
    expect(body).toMatch(/set_reservation_return_address/)
    expect(body).toMatch(/csToast\.warning/)
    expect(body).not.toMatch(/return \{ success: false/)
    expect(cart).toMatch(/await saveReturnAddress\(reservationId, returnMethodSafe,/)
  })
})
