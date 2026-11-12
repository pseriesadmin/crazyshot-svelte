import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// 모바일 대여현황(/cms/mobile/rentals)의 예약 패널은 PC(/cms/rentals)와 같은 RentalDetailPanel 이다.
// PC 와 어긋나지 않게 유지해야 하는 두 가지(2026-11-06, Stephen 지시)를 소스로 고정한다.
const read = (p: string) => readFileSync(resolve(process.cwd(), p), 'utf8')
const mobilePage = read('src/routes/cms/mobile/rentals/+page.svelte')
const pcPage = read('src/routes/cms/rentals/+page.svelte')
const panel = read('src/lib/components/cms/RentalDetailPanel.svelte')

describe('모바일 대여현황 패널 — PC 와 같은 단계현황', () => {
  it('PC 와 같은 단계 목록(예약신청 hold 포함)을 넘긴다', () => {
    const pcSteps = pcPage.match(/stepFilter=\{(\[[^\]]*\])\}/)?.[1]
    const mobileSteps = mobilePage.match(/stepFilter=\{(\[[^\]]*\])\}/)?.[1]
    expect(pcSteps).toBeTruthy()
    expect(mobileSteps).toBe(pcSteps)
    expect(mobileSteps).toContain("'hold'")
  })
})

describe('모바일 대여현황 패널 — 탭 메뉴', () => {
  it('결제정보·계약서 탭은 숨기고(접근 차단) 탭 글자는 크게·볼드로 넘긴다', () => {
    const mount = mobilePage.slice(mobilePage.indexOf('<RentalDetailPanel'), mobilePage.indexOf('/>', mobilePage.indexOf('<RentalDetailPanel')))
    expect(mount).toContain("hiddenTabs={['payment', 'contract']}")
    expect(mount).toContain('largeTabs={true}')
  })

  it('PC 는 숨김·확대 옵션을 쓰지 않는다(PC 탭은 그대로)', () => {
    const pcMount = pcPage.slice(pcPage.indexOf('<RentalDetailPanel'), pcPage.indexOf('/>', pcPage.indexOf('<RentalDetailPanel')))
    expect(pcMount).not.toContain('hiddenTabs')
    expect(pcMount).not.toContain('largeTabs')
    expect(pcMount).not.toContain('hideCustomerLink')
  })

  it('모바일 패널의 제목↔값 여백은 모바일 페이지에서만 줄인다(패널 기본값 PC 는 그대로)', () => {
    expect(mobilePage).toMatch(/\.rental-card-detail-wrap :global\(\.info-label\) \{\s*flex: 0 0 72px;/)
    expect(mobilePage).toMatch(/\.rental-card-detail-wrap :global\(\.info-row\) \{\s*gap: 8px;\s*padding: 10px 12px;/)
    expect(panel).toMatch(/\.info-label \{\s*flex: 0 0 96px;/) // PC 기본값 유지
  })

  it("보기 전용 무인보관함 배정정보는 입력칸 없이 글자로만 보이고 비어 있으면 '-'", () => {
    expect(panel).toMatch(/\{:else if lockerReadOnly\}[\s\S]*?\{lockerNumber \|\| '-'\}[\s\S]*?\{lockerPassword \|\| '-'\}/)
    // 편집 가능한 쪽(PC 매니저)의 입력칸 배치는 그대로
    expect(panel).toMatch(/\.locker-no-input \{ flex: 0 0 130px; \}/)
    expect(mobilePage).not.toContain('locker-group') // 줄바꿈 우회 스타일 불필요(입력칸이 없어짐)
  })

  it("모바일은 고객정보 탭의 '고객 상세 보기' 링크를 숨긴다(링크 자체를 그리지 않음)", () => {
    const mount = mobilePage.slice(mobilePage.indexOf('<RentalDetailPanel'), mobilePage.indexOf('/>', mobilePage.indexOf('<RentalDetailPanel')))
    expect(mount).toContain('hideCustomerLink={true}')
    expect(panel).toMatch(/\{#if !hideCustomerLink\}\s*<a\s+href="\/cms\/customers\?selected=\{row\.user_id\}"[\s\S]*?고객 상세 보기 ↗<\/a>\s*\{\/if\}/)
  })

  it('패널은 숨긴 탭 버튼을 그리지 않고, 숨긴 탭이 선택되면 대여정보로 되돌린다', () => {
    // 2026-11-11: 파트너 숨김 탭(결제정보·계약서)을 합친 effectiveHiddenTabs 로 판정한다(원래 hiddenTabs 를 포함)
    expect(panel).toContain(".filter((t) => !effectiveHiddenTabs.includes(t.id))")
    expect(panel).toMatch(/if \(effectiveHiddenTabs\.includes\(activeTab\)\) activeTab = 'rental'/)
    expect(panel).toContain('[...hiddenTabs, ...PARTNER_HIDDEN_TABS]')
  })

  it('숨긴 탭이 초기 탭으로 지정돼도 첫 렌더부터 대여정보로 시작한다(첫 프레임에 숨긴 탭이 그려지지 않음)', () => {
    expect(panel).toMatch(/function startTab\(\)[^{]*\{\s*return initialTab && !effectiveHiddenTabs\.includes\(initialTab\) \? initialTab : 'rental'\s*\}/)
    expect(panel).toMatch(/let activeTab\s+= \$state<[^>]*>\(startTab\(\)\)/)
  })

  it("보기 전용(모바일)에서는 '무인보관함 정보를 설정해주세요' 안내 토스트를 띄우지 않는다", () => {
    expect(panel).toMatch(/if \(!lockerPassword\.trim\(\) && !lockerPwClosed && !lockerReadOnly\) \{\s*csToast\.warning\('무인보관함 정보를 설정해주세요\.'/)
  })

  it('큰 글자 탭은 한 사이즈 위 토큰(--text-pc-body-14)과 볼드로 지정한다', () => {
    expect(panel).toMatch(/\.panel-tabs--large \.tab \{ font: var\(--text-pc-body-14\); font-weight: 700; \}/)
  })
})

describe('모바일 대여현황 패널 — 무인보관함 배정정보 보기 전용', () => {
  it('편집 권한(cmsRole)은 넘기지 않고 보기 역할(lockerViewRole)만 넘긴다', () => {
    const mount = mobilePage.slice(mobilePage.indexOf('<RentalDetailPanel'), mobilePage.indexOf('/>', mobilePage.indexOf('<RentalDetailPanel')))
    expect(mount).toContain('lockerViewRole={data.cmsRole}')
    expect(mount).not.toMatch(/\bcmsRole=/) // 환불·취소·검수 승인 등 매니저 전용 변경 기능은 모바일에서 계속 열지 않는다
  })

  it('패널은 보기 전용에서 시범 발송·배정 확정 버튼을 숨기고 입력·수령/반납 선택을 잠근다', () => {
    expect(panel).toContain('lockerReadOnly = $derived(!canManagePaymentAndLocker)')
    expect(panel).toMatch(/\{#if !lockerReadOnly\}\s*<button[\s\S]*?시범 발송[\s\S]*?배정 확정[\s\S]*?\{\/if\}/)
    expect(panel.match(/disabled=\{lockerPwClosed \|\| lockerReadOnly\}/g)?.length).toBe(4) // 무인함 번호·비밀번호 입력 2 + 수령·반납 선택 2
  })

  it('보기 역할이 매니저 이상일 때만 섹션이 보인다(비밀번호가 보이는 화면)', () => {
    expect(panel).toMatch(/canViewLocker = \$derived\(canManagePaymentAndLocker \|\| hasSettingsAccess\(lockerViewRole \?\? ''\)\)/)
    expect(panel).toMatch(/showLockerPasswordField = \$derived\(\s*canViewLocker &&/)
  })
})
