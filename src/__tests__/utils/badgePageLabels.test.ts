import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'

/** /cms/promotion/ad 화면 문구·메뉴 구성 — '배지 설정' 탭 제거, 목록 툴바 '설정' 버튼으로 이동 */
const read = (p: string) => readFileSync(path.resolve(process.cwd(), p), 'utf8')
const page = read('src/routes/cms/promotion/ad/+page.svelte')
const tab = read('src/lib/components/cms/badge/BadgeTab.svelte')

describe('배너 및 배지 관리 화면', () => {
  it('제목·부제 문구', () => {
    expect(page).toContain('<h1 class="page-title">배너 및 배지 관리</h1>')
    expect(page).toContain('<p class="page-sub">배너 슬롯 이미지 설정관리와 배지 목록 설정 관리</p>')
  })
  it("탭 메뉴에 '배지타입 목록'이 '배지 목록' 다음에 있고, 선택 시 배지 타입 목록 화면(badge-settings)이 활성이 된다", () => {
    expect(page).not.toContain("label: '배지 설정'")
    expect(page).toMatch(/id: 'badge',\s+label: '배지 목록' \},\s+\{ id: 'badge-settings', label: '배지타입 목록' \}/)
    expect(page).toContain('aria-selected={activeTab === t.id}')
  })
  it("툴바: '+ 신규목록등록' 만 있고 '배지타입등록' 버튼은 없다(배지타입 탭으로 대체)", () => {
    expect(tab).toContain("'+ 신규목록등록'")
    expect(tab).not.toContain('+ 배지 노출 등록')
    expect(tab).not.toContain('배지타입등록')
    expect(tab).not.toContain('cta-btn-sub')
  })
  it("패널 제목: '배지목록 등록정보'", () => {
    expect(read('src/lib/components/cms/badge/BadgeRulePanel.svelte')).toContain("rule ? '배지목록 등록정보'")
  })
})
