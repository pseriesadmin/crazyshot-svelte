import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 고객용 상품 이력 조회가 '반납 등록 자동 반영' 이력(/return_history/)을 제외한다 — Migration 818 소스 점검(실제 DB 동작은 Stage 에서 SELECT 로 확인)
const sql = readFileSync('supabase/migrations/20261112190000_818_customer_history_hide_return_auto.sql', 'utf-8')

describe('Migration 818 — 고객 이력 조회 제외 규칙', () => {
  it('이미지 주소에 /return_history/ 가 있는 이력 행을 제외한다', () => {
    expect(sql).toContain("img->>'url' LIKE '%/return_history/%'")
    expect(sql).toContain('AND NOT (')
  })
  it('소유권 검사(예약 소유자만)와 authenticated 전용 권한은 그대로다', () => {
    expect(sql).toContain('AND rr.user_id = v_caller_id')
    expect(sql).toContain('REVOKE ALL     ON FUNCTION get_product_history_for_customer(BIGINT) FROM PUBLIC, anon')
    expect(sql).toContain('GRANT  EXECUTE ON FUNCTION get_product_history_for_customer(BIGINT) TO authenticated')
  })
  it('이미지 형식이 배열이 아닌 행에서 오류가 나지 않게 검사한다', () => {
    expect(sql).toContain("jsonb_typeof(h.images) = 'array'")
  })
})
