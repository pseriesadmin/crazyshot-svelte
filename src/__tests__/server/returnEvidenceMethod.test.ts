import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 2026-10-19 실테스트 결함 회귀 방지: 조회 API 가 저장된 제출 방식('courier'|'quick'|'locker')에
// 예약 return_method 변환 함수(toReturnSubmitMethod)를 적용하면 항상 null 이 되어 택배 체크리스트가 비어 보인다.
describe('return-evidence API — 제출 방식 해석', () => {
  const src = readFileSync('src/routes/api/cms/reservations/[id]/return-evidence/+server.ts', 'utf-8')
  it('저장된 제출 방식 값을 직접 해석한다', () => {
    expect(src).toContain("s.method === 'courier' || s.method === 'quick' || s.method === 'locker'")
  })
  it('toReturnSubmitMethod(s.method) 를 쓰지 않는다', () => {
    expect(src).not.toMatch(/toReturnSubmitMethod\s*\(\s*s\.method/)
  })
})
