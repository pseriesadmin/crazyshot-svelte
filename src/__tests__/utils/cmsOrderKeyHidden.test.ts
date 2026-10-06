/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 예약코드 = 장바구니 1회 신청(묶음 포함)의 단일 최상위 코드(2026-10-06, Stephen 확정).
 * CMS 예약목록·대여현황 행에는 별도 '주문 ORD-…' 번호를 노출하지 않는다 — DB의 orders·order_key는 결제·정산 연결용 내부 값으로만 유지.
 */
const read = (p: string) => readFileSync(join(process.cwd(), p), 'utf-8')

for (const page of ['src/routes/cms/reservation/+page.svelte', 'src/routes/cms/rentals/+page.svelte']) {
  describe(page, () => {
    const src = read(page)
    it('주문번호 태그(order-key-tag)와 order_key 노출이 없다', () => {
      expect(src).not.toContain('order-key-tag')
      expect(src).not.toMatch(/주문 \{row\.order_key\}/)
    })
    it('예약코드 표시는 유지', () => {
      expect(src).toContain('class="rsv-code"')
    })
  })
}
