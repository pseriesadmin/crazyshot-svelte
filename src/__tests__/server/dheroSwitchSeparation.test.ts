/* eslint-disable security/detect-non-literal-fs-filename -- 테스트가 고정된 프로젝트 소스 경로를 스캔하는 용도 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/**
 * ⓪ 두발히어로 연동 전용 스위치 분리 — 재발 방지 가드 (2026-10-27, Stephen 지시)
 * 배경: 연동 대상 판정이 장바구니 "요청 A" 전용 스위치(is_bulk_delivery)를 재사용해, 장바구니 UX 를 만지면 두발히어로 접수가 따라 켜지고 꺼졌다.
 *  SW-1  옛 판정 유틸(isBulkDeliveryMethod.ts)은 사라지고 새 유틸이 is_dhero_integration 을 읽는다
 *  SW-2  두발히어로 API(dhero.ts)를 부르는 서버 파일은 is_bulk_delivery·옛 유틸을 참조하지 않는다 (소스 스캔 — 새 호출처도 자동 포함)
 *  SW-3  알려진 호출처 4곳이 새 유틸을 쓴다
 *  SW-4  마이그레이션: 컬럼 기본 false(운영·Stage 적용 순간 연동이 켜지지 않음) + 켜고 끄는 함수는 매니저 이상 + 익명 실행 불가 + 기존 값 복사 없음
 *  SW-5  CMS 설정 화면: 전용 액션(매니저 이상)·전용 행이 있고, 장바구니 스위치 행은 그대로다
 *  SW-6  패널은 API 응답 is_dhero_integration 으로 연동 화면을 고른다
 */

const ROOT = process.cwd()
const read = (p: string) => readFileSync(join(ROOT, p), 'utf-8')

function tsFiles(dir: string): string[] {
  const out: string[] = []
  for (const name of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${name}`
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...tsFiles(rel))
    else if (name.endsWith('.ts') || name.endsWith('.svelte')) out.push(rel)
  }
  return out
}

describe('두발히어로 연동 스위치 분리', () => {
  it('SW-1: 옛 판정 유틸은 없고 새 유틸이 is_dhero_integration 을 읽는다', () => {
    // 옛 유틸은 삭제 대상 — 파일이 남아 있어도 내용 없는 표지(export 함수 없음)여야 한다
    const oldPath = 'src/lib/server/isBulkDeliveryMethod.ts'
    if (existsSync(join(ROOT, oldPath))) expect(read(oldPath)).not.toMatch(/export\s+(async\s+)?function|export\s+const/)
    const util = read('src/lib/server/isDheroIntegrationMethod.ts')
    expect(util).toContain("select('is_dhero_integration')")
    expect(util).not.toContain("select('is_bulk_delivery')")
  })

  it('SW-2: dhero API 를 부르는 서버 파일은 is_bulk_delivery 를 참조하지 않는다', () => {
    const offenders: string[] = []
    for (const f of [...tsFiles('src/routes'), ...tsFiles('src/lib/server')]) {
      if (f.endsWith('dhero.ts') || f.includes('__tests__')) continue
      // 예외: CMS 대여관리 설정 화면은 두 스위치(장바구니 요청 A·두발히어로 연동)를 각각 관리하는 곳이라 둘 다 참조한다
      if (f === 'src/routes/cms/set/rental/+page.server.ts') continue
      const src = read(f)
      const callsDhero = /\$lib\/server\/dhero['"]/.test(src) || src.includes('isDheroIntegrationMethod')
      if (callsDhero && /is_bulk_delivery|isBulkDeliveryMethod/.test(src.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, ''))) offenders.push(f)
    }
    expect(offenders).toEqual([])
  })

  it('SW-3: 알려진 호출처가 새 유틸을 쓴다', () => {
    for (const f of [
      'src/routes/cms/reservation/+page.server.ts',
      'src/routes/api/cms/reservations/[id]/dhero/+server.ts',
      'src/lib/server/registerDheroReturn.ts',
      'src/routes/api/cart/validate-delivery-address/+server.ts',
    ]) {
      const src = read(f)
      expect(src, f).toContain('isDheroIntegrationMethod')
      expect(src, f).not.toContain('isBulkDeliveryMethod')
    }
  })

  it('SW-4: 마이그레이션은 기본 false·매니저 이상·익명 불가·값 복사 없음', () => {
    const dir = join(ROOT, 'supabase/migrations')
    const file = readdirSync(dir).find((n) => /_772_.*dhero_integration/.test(n))
    expect(file, '772 마이그레이션 파일').toBeTruthy()
    const sql = readFileSync(join(dir, file as string), 'utf-8')
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS is_dhero_integration BOOLEAN NOT NULL DEFAULT false/)
    expect(sql).toContain('is_cms_manager_or_above()')
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.toggle_rental_method_dhero_integration\(UUID\) FROM anon/)
    expect(sql).toMatch(/GRANT EXECUTE ON FUNCTION public\.toggle_rental_method_dhero_integration\(UUID\) TO authenticated/)
    // 기존 스위치 값을 새 컬럼으로 복사하거나 true 로 시딩하는 문장이 없어야 한다(적용 순간 연동이 켜지는 사고 방지) — 토글 함수의 NOT 반전만 허용
    const body = sql.replace(/--.*$/gm, '')
    expect(body).not.toMatch(/is_dhero_integration\s*=\s*(true|is_bulk_delivery)/i)
    expect(body).not.toMatch(/SELECT[^;]*is_bulk_delivery/i) // 기존 스위치 값을 읽어 복사하는 SELECT 없음
    expect(body.match(/UPDATE\s+rental_method_options/gi)?.length ?? 0).toBe(1) // 토글 함수 안의 1건뿐
  })

  it('SW-5: 설정 화면에 전용 액션·행이 있고 장바구니 스위치 행은 그대로다', () => {
    const server = read('src/routes/cms/set/rental/+page.server.ts')
    expect(server).toMatch(/toggleDheroIntegration:\s*async/)
    expect(server).toContain('toggle_rental_method_dhero_integration')
    const action = server.slice(server.indexOf('toggleDheroIntegration'))
    expect(action.slice(0, 700)).toContain('hasSettingsAccess')
    expect(server).toContain('is_dhero_integration')
    const page = read('src/routes/cms/set/rental/+page.svelte')
    expect(page).toContain('?/toggleDheroIntegration')
    expect(page).toContain('두발히어로 연동')
    expect(page).toContain('CmsHelpBubble')
    expect(page).toContain('?/toggleBulkDelivery')
    expect(page).toContain('대여옵션(수령/반납) 일괄적용')
    // 배송송출연동 관리 — "대여 방법 조건 설정" 카드와 분리된 별도 블록(2026-10-27, Stephen 지시). 업체는 deliveryCarriers 배열 한 줄로 추가한다
    expect(page).toContain('배송송출연동 관리')
    expect(page).toContain('deliveryCarriers')
    expect(page).toContain('carrierVisibleMethods')
    // 장바구니 "일괄적용" 행~"휴무일 제한 방식" 행 사이(같은 카드)에는 더 이상 두발히어로 연동 행이 없다
    const between = page.slice(page.indexOf('대여옵션(수령/반납) 일괄적용</span>'), page.indexOf('휴무일 제한 방식</span>'))
    expect(between).not.toContain('두발히어로')
    expect(between).not.toContain('toggleDheroIntegration')
  })

  it('SW-6: 패널은 is_dhero_integration 응답으로 연동 화면을 고른다', () => {
    const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')
    expect(panel).toContain('d.is_dhero_integration')
    expect(panel).not.toContain('d.is_bulk_delivery')
    const api = read('src/routes/api/cms/reservations/[id]/dhero/+server.ts')
    expect(api).toContain('is_dhero_integration')
    expect(api).not.toMatch(/is_bulk_delivery:/)
  })
})
