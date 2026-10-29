/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/** 마이그레이션 #782 — 레거시 부가 정보(구매금액·메모·생년월일) 보관 구조 (소스 점검) */
const sql = readFileSync(join(process.cwd(), 'supabase/migrations/20261029110000_782_legacy_carry_over_fields.sql'), 'utf-8')

describe('#782 레거시 부가 정보 보관', () => {
  it('대기 목록·프로필에 구매금액, 대기 목록에 메모·생년월일 칸을 추가한다', () => {
    expect(sql).toMatch(/ALTER TABLE legacy_member_staging[\s\S]*ADD COLUMN IF NOT EXISTS legacy_purchase_amount/)
    expect(sql).toContain('legacy_memo')
    expect(sql).toMatch(/legacy_member_staging[\s\S]*birth_date\s+DATE/)
    expect(sql).toMatch(/ALTER TABLE user_profiles[\s\S]*ADD COLUMN IF NOT EXISTS legacy_purchase_amount/)
  })

  it('관리자 메모는 서버 전용 테이블(service_role 만, RLS 정책 없음)에 보관한다 — 고객 프로필에는 메모 칸을 만들지 않는다', () => {
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS public.legacy_member_notes')
    expect(sql).toContain('ENABLE ROW LEVEL SECURITY')
    expect(sql).toMatch(/REVOKE ALL ON public\.legacy_member_notes FROM PUBLIC, anon, authenticated/)
    expect(sql).toMatch(/GRANT SELECT, INSERT, UPDATE, DELETE ON public\.legacy_member_notes TO service_role/)
    expect(/CREATE\s+POLICY/i.test(sql)).toBe(false)
    expect(/ALTER TABLE user_profiles[^;]*legacy_memo/.test(sql)).toBe(false)
  })

  it('find_legacy_member 가 새 항목을 돌려주고 서버 전용 권한을 유지한다', () => {
    expect(sql).toContain("'legacy_purchase_amount'")
    expect(sql).toContain("'legacy_memo'")
    expect(sql).toContain("'birth_date'")
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION find_legacy_member\(TEXT, TEXT\) FROM anon/)
    expect(sql).toMatch(/GRANT\s+EXECUTE ON FUNCTION find_legacy_member\(TEXT, TEXT\) TO service_role/)
  })

  it('구매금액은 음수를 막는다', () => {
    expect(sql).toMatch(/legacy_purchase_amount[^;]*CHECK \(legacy_purchase_amount >= 0\)|CHECK \(legacy_purchase_amount >= 0\)/)
  })
})

describe('미인증 대기 목록 — 인증 완료 표시만 남은(보존) 행은 숨긴다', () => {
  it('legacy-import 화면 조회가 claimed_at 이 비어 있는 행만 가져온다', () => {
    const src = readFileSync(join(process.cwd(), 'src/routes/cms/customers/legacy-import/+page.server.ts'), 'utf-8')
    expect(src).toMatch(/from\('legacy_member_staging'\)[\s\S]*?\.is\('claimed_at', null\)/)
  })
})
