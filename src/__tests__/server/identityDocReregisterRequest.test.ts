import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

// 재등록 요청(2026-10-15): 서류 상태와 무관하게(force) 카드·푸시·SMS를 보내고, 파일·승인은 건드리지 않는다
const helper = readFileSync('src/lib/server/identityDocRequest.ts', 'utf-8')
const route = readFileSync('src/routes/api/cms/customers/[id]/doc-request/+server.ts', 'utf-8')
const rows = readFileSync('src/lib/components/cms/CustomerDocRows.svelte', 'utf-8')

describe('재등록 요청', () => {
  it('force면 서류 상태 게이트를 건너뛰고 5분 중복 방지만 적용', () => {
    expect(helper).toContain('if (!force)')
    expect(helper).toContain('FORCE_DEDUPE_MINUTES')
  })
  it('엔드포인트는 manager 이상 + 고객목록 메뉴 + force 호출, 서류 삭제·승인 변경 없음', () => {
    expect(route).toContain('hasSettingsAccess')
    expect(route).toContain("requireMenuAccessApi(locals, 'customers.list')")
    expect(route).toContain('force: true')
    expect(route).not.toMatch(/\.update\(|\.delete\(|storage/)
  })
  it('재등록 버튼은 요청 API를 호출한다', () => {
    expect(rows).toContain('/doc-request')
    expect(rows).toContain('upload-doc') // 직접 등록(대리 업로드)도 함께 제공
  })
})
