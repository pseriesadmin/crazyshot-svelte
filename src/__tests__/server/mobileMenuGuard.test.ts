/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp -- 테스트가 소스 파일을 스캔하는 용도(고정된 프로젝트 경로, 사용자 입력 없음) */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { findCmsMenuKeyForPath } from '$lib/constants/cmsMenus'

/**
 * 1단계 1g — CMS 모바일(/cms/mobile/*) 예약대여현황(rental.reservation) 권한 서버 집행 (2026-10-05)
 *  A. 화면 경로 /cms/mobile/** → 레이아웃 접근 판정이 rental.reservation을 따름(별칭)
 *  B. 모바일 전용 API(mobile-search-rank·assets) → rental.reservation 단독
 *  C. 모바일 서버 액션(clearIssuedContract·processQrAction) → rental.reservation
 */
const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

function firstStatementAfter(src: string, re: RegExp): string | undefined {
  const m = src.match(re)
  if (!m) return undefined
  return src.slice(m.index! + m[0].length).split('\n').find((l) => l.trim() !== '' && !l.trim().startsWith('//'))?.trim()
}

describe('A 화면 경로 별칭', () => {
  for (const p of ['/cms/mobile', '/cms/mobile/rentals', '/cms/mobile/123', '/cms/mobile/qr/CSABC001', '/cms/mobile/qr/member/M1', '/cms/mobile/qr/reservation/R1']) {
    it(`${p} → rental.reservation`, () => {
      expect(findCmsMenuKeyForPath(p)).toBe('rental.reservation')
    })
  }
  it('기존 매핑 불변', () => {
    expect(findCmsMenuKeyForPath('/cms/rentals')).toBe('rental.reservation')
    expect(findCmsMenuKeyForPath('/cms/products')).toBe('products.list')
    expect(findCmsMenuKeyForPath('/cms/accounts')).toBeNull()
    expect(findCmsMenuKeyForPath('/cms/mobilex')).toBeNull()
  })
})

describe('B 모바일 전용 API', () => {
  const targets: [string, 'GET' | 'POST' | 'PATCH'][] = [
    ['src/routes/api/cms/mobile-search-rank/+server.ts', 'GET'],
    ['src/routes/api/cms/assets/+server.ts', 'POST'],
    ['src/routes/api/cms/assets/[id]/+server.ts', 'PATCH'],
  ]
  for (const [f, m] of targets) {
    it(`${f.replace('src/routes/api/cms/', '')} ${m}: 첫 문장이 rental.reservation 게이트`, () => {
      const src = read(f)
      expect(src).toContain("import { requireMenuAccessApi } from '$lib/server/requireMenuAccess'")
      expect(firstStatementAfter(src, new RegExp(`export const ${m}\\b[^\\n]*=>\\s*\\{\\n`))).toBe(
        "const denied = await requireMenuAccessApi(locals, 'rental.reservation')",
      )
    })
  }
})

describe('C 모바일 서버 액션', () => {
  const targets: [string, string][] = [
    ['src/routes/cms/mobile/rentals/+page.server.ts', 'clearIssuedContract'],
    ['src/routes/cms/mobile/qr/[product_id]/+page.server.ts', 'processQrAction'],
  ]
  for (const [f, a] of targets) {
    it(`${f.replace('src/routes/cms/', '')} ${a}: 첫 문장이 rental.reservation 액션 게이트`, () => {
      const src = read(f)
      expect(src).toContain("import { requireMenuAccessAction } from '$lib/server/requireMenuAccess'")
      expect(firstStatementAfter(src, new RegExp(`${a}: async \\([^\\n]*=>\\s*\\{\\n`))).toBe(
        "const denied = await requireMenuAccessAction(locals, 'rental.reservation')",
      )
    })
  }
})
