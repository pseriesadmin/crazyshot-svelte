/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * 메뉴권한 서버 집행 2단계 (2026-10-06, Stephen 결정 Q0·Q1 + 권장안)
 *  2-A. customers/[id]/{coupons,summary} → 상담 단독 / contract-templates GET → 예약대여현황·상담·계약서양식 중 하나 / coupons/available GET → 상담
 */
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')
function firstStatementAfter(src: string, re: RegExp): string | undefined {
  const m = src.match(re)
  if (!m) return undefined
  return src.slice(m.index! + m[0].length).split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('//'))?.trim()
}
const GET_RE = /export const GET\b[^\n]*=>\s*\{\n/

describe('2-A 읽기 갭', () => {
  for (const f of ['src/routes/api/cms/customers/[id]/coupons/+server.ts', 'src/routes/api/cms/customers/[id]/summary/+server.ts', 'src/routes/api/cms/coupons/available/+server.ts']) {
    it(`${f.replace('src/routes/api/cms/', '')}: 상담 단독 게이트`, () => {
      const src = read(f)
      expect(src).toContain("import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'")
      expect(firstStatementAfter(src, GET_RE)).toBe("const denied = await requireMenuAccessApi(locals, 'consulting.chat')")
    })
  }
  it('contract-templates GET: 예약대여현황·상담·계약서양식 any-of', () => {
    const src = read('src/routes/api/cms/contract-templates/+server.ts')
    expect(src).toContain("import { requireAnyMenuAccessApi } from '$lib/server/requireMenuAccess'")
    expect(firstStatementAfter(src, GET_RE)).toBe(
      "const denied = await requireAnyMenuAccessApi(locals, ['rental.reservation', 'consulting.chat', 'rental.contracts'])",
    )
  })
})

describe('2-E 환불 처리 API', () => {
  it('payment PUT: 예약대여현황 게이트 다음 문장이 rental.change_cancel 게이트(환불은 예약변경·취소 권한)', () => {
    const src = read('src/routes/api/cms/reservations/[id]/payment/+server.ts')
    const m = src.match(/export const PUT\b[^\n]*=>\s*\{\n/)
    expect(m).not.toBeNull()
    const lines = src.slice(m!.index! + m![0].length).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('//'))
    expect(lines[0]).toBe("const denied = await requireMenuAccessApi(locals, 'rental.reservation')")
    expect(lines[1]).toBe('if (denied) return denied')
    expect(lines[2]).toBe("const cancelDenied = await requireMenuAccessApi(locals, 'rental.change_cancel')")
    expect(lines[3]).toBe('if (cancelDenied) return cancelDenied')
  })
})
