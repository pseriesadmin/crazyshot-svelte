/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 계약서 옵션 줄 장비번호 연동 (2026-10-07).
 * 옵션 줄의 상품코드는 옵션 실물 배정 기록(reservation_option_assets)을 우선 읽는다 — 재배정이 이 기록을 바꾸므로 계약서가 따라간다.
 * 기록이 없으면 기존처럼 옵션 상품 자체의 품번으로 폴백한다.
 */
const src = readFileSync(join(process.cwd(), 'src/routes/api/cms/reservations/[id]/contract-data/+server.ts'), 'utf-8')

describe('contract-data — 옵션 장비번호', () => {
  it('배정 기록 조회 함수가 옵션 행 id 기준으로 품번을 모은다', () => {
    expect(src).toContain("from('reservation_option_assets')")
    expect(src).toContain('reservation_option_assets_asset_product_id_fkey')
    expect(src).toContain(".in('reservation_option_id', optionRowIds)")
    expect(src).toContain("v.join(', ')")
  })

  it('묶음 주문·단독 예약 두 경로 모두 배정 품번을 우선 쓰고 옵션 상품 품번으로 폴백한다', () => {
    expect(src).toMatch(/product_code: assignedOptionCodes\[o\.id as number\]\s*\?\? \(o\.option_product_id \? \(optionCodeMap/)
    expect(src).toMatch(/product_code: soloAssignedOptionCodes\[o\.id as number\]\s*\?\? \(o\.option_product_id \? \(soloCodeMap/)
  })

  it('옵션 조회가 id를 선택한다(두 경로)', () => {
    expect(src).toContain(".select('id, reservation_id, option_name, qty, unit_price, option_product_id')")
    expect(src).toContain(".select('id, option_name, qty, unit_price, option_product_id')")
  })

  it('조회 실패는 폴백으로 흡수한다(계약서 미리보기를 막지 않음)', () => {
    expect(src).toMatch(/if \(assetErr\) return byOpt/)
  })
})
