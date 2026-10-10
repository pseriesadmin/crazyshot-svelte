// CMS 고객 상세 패널 — 관리대상(회원 가입 이력 없는 인물) 모드 렌더 테스트 (Migration #686)
// 규칙: managed·new 모드는 '기본정보'+'관리대상' 탭만 노출, 회원 전용 항목·탭 미노출,
//       신규(new)는 [등록], 기존(managed)은 [관리대상 삭제]+[저장], 회원(member) 모드는 기존 구성 유지('블랙리스트' 탭명만 '관리대상').
import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import CustomerDetailPanel from '$lib/components/cms/CustomerDetailPanel.svelte'

const baseRow = {
  user_id: 'mp-1', email: '', phone: '010-1234-5678', name: '홍길동', member_code: 'CSMG2610001', member_type: null,
  membership_grade: 'NONE', credit_score: 70, rental_count: 0, late_return_count: 0, damage_count: 0, points: 0,
  blacklisted: true, blacklist_reason: '분쟁 이력', is_student: false, is_foreign: false,
  identity_type: null, identity_doc_url: null, identity_verified_at: null,
  foreign_doc_url: null, foreign_doc_urls: null, foreign_type: null, foreign_stay_type: null, foreign_verified_at: null,
  password_set: false, created_at: '2026-10-09T00:00:00Z', total_count: 1, birth_date: null,
  withdrawal_status: 'none', withdrawal_requested_at: null, withdrawal_purge_at: null, is_managed_person: true,
}

function panel(props: Record<string, unknown>): string {
  return render(CustomerDetailPanel, { props: { onclose: () => {}, ...props } as never }).body
}

const TAB_LABELS = ['크레이지스코어', '구독이력', '포인트이력', '상품대여이력', '빠른문의']

describe('관리대상 신규(new) — 빈 패널', () => {
  const html = panel({ row: { ...baseRow, user_id: '', member_code: null, name: null, blacklist_reason: null }, mode: 'new' })

  it('헤더·탭: 기본정보 + 관리대상만, 회원 전용 탭 없음', () => {
    expect(html).toContain('관리대상 등록')
    expect(html).toContain('>기본정보<')
    expect(html).toContain('>관리대상<')
    for (const t of TAB_LABELS) expect(html, t).not.toContain(`>${t}<`)
    expect(html).not.toContain('>블랙리스트<')
  })

  it('기본정보 입력(이름·전화·이메일·생년월일), 회원 전용 행(포인트·서류·가입일) 없음', () => {
    for (const l of ['이름', '전화번호', '이메일', '생년월일']) expect(html, l).toContain(`>${l}</span>`)
    for (const l of ['포인트', '본인 증명', '회원유형', '대여 횟수']) expect(html, l).not.toContain(`>${l}</span>`)
  })

  it('하단: [등록] 버튼만 — 삭제 버튼 없음, QR 자동 생성 안내', () => {
    expect(html).toContain('>등록<')
    expect(html).not.toContain('관리대상 삭제')
    expect(html).toContain('/cms/customers?/registerManagedPerson')
    expect(html).toContain('전용 QR 자동 생성')
  })
})

describe('관리대상 기존(managed)', () => {
  const html = panel({ row: baseRow, mode: 'managed' })

  it('QR 영역 + 회원코드 노출, 하단 [관리대상 삭제] + [저장]', () => {
    expect(html).toContain('member-qr-wrap')
    expect(html).toContain('CSMG2610001')
    expect(html).toContain('관리대상 삭제')
    expect(html).toContain('/cms/customers?/deleteManagedPerson')
    expect(html).toContain('/cms/customers?/updateManagedPerson')
    expect(html).toContain('>저장<')
  })

  it('관리대상 탭 초기 진입 시 등록 중 배너 + 사유', () => {
    const bl = panel({ row: baseRow, mode: 'managed', initialTab: 'blacklist' })
    expect(bl).toContain('관리대상 등록 중')
    expect(bl).toContain('분쟁 이력')
  })

  it('managed 모드는 허용되지 않은 탭(rental 등) 딥링크도 기본정보로 정리', () => {
    const h = panel({ row: baseRow, mode: 'managed', initialTab: 'rental' })
    expect(h).toContain('>이름</span>')
    expect(h).not.toContain('상품대여이력')
  })
})

describe('회원(member) 모드 — 기존 구성 유지', () => {
  const memberRow = { ...baseRow, user_id: 'u-1', email: 'a@b.co', is_managed_person: false, blacklisted: false, blacklist_reason: null }
  const html = panel({ row: memberRow })

  it('7개 탭 전부 노출, 블랙리스트 탭명만 관리대상으로 변경', () => {
    for (const t of TAB_LABELS) expect(html, t).toContain(`>${t}<`)
    expect(html).toContain('>관리대상<')
    expect(html).not.toContain('>블랙리스트<')
  })

  it('회원 삭제 버튼 유지, 관리대상 전용 액션 없음', () => {
    expect(html).toContain('/cms/customers?/deleteCustomer')
    expect(html).not.toContain('registerManagedPerson')
    expect(html).not.toContain('deleteManagedPerson')
  })
})
