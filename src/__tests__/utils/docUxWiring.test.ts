import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 서류 등록 UX 개선(2026-10-05) 배선 확인 — 화면 파일은 마운트 테스트가 없어 소스 문자열로 핵심 연결만 고정한다.
 */
const read = (p: string): string => readFileSync(p, 'utf-8')

describe('서류 등록 UX 배선', () => {
  const profile = read('src/lib/components/members/profile/ProfileTabContent.svelte')
  it('본인증명 안내 문구(확정)와 등록 직후 안내 함수가 업로드 성공 지점 2곳에서 쓰인다', () => {
    expect(profile).toContain('주민등록증(또는 운전면허증) + 주민등록등본을 등록해주세요.')
    expect(profile.match(/announceDocResult\(data\.missing/g)?.length).toBe(2)
    expect(profile).toContain("csToast.success('정보등록이 완료되어 관리자 승인을 요청했어요.'")
    expect(profile).toContain("actionLabel: '문의'")
  })

  it('이탈 경고는 빠진 서류 이름을 안내하고 막연한 문구를 쓰지 않는다', () => {
    expect(profile).not.toContain("'필수 파일을 등록하세요.'")
    expect(profile).toContain('buildMissingDocsMessage(missingIdentityDocs(identityType))')
  })

  it('상품상세·장바구니 둘 다 공용 게이트 토스트를 쓴다(장바구니에도 [확인]/[문의] 제공)', () => {
    expect(read('src/routes/products/[id]/+page.svelte')).toContain('showDocGateToast(docGate, docLandingKind(')
    expect(read('src/routes/cart/+page.svelte')).toContain('showDocGateToast(data.docGate, data.docLanding)')
    expect(read('src/routes/cart/+page.server.ts')).toContain('docLanding:')
  })

  it('upload-doc은 서버 재검증 missing을 응답하고, 필수 완비 시 고객 자동 안내를 남긴다', () => {
    const upload = read('src/routes/api/profile/upload-doc/+server.ts')
    expect(upload).toContain('missing })')
    expect(upload).toContain("postDocPendingChat(admin, session.user.id, { withUserMessage: false })")
  })

  it('상태 줄은 안내 박스(.doc-subtitle) 안에 있고, 본인·외국인 증명 헤더에는 중복 재등록 버튼이 없다', () => {
    expect(profile).toContain('class="doc-subtitle-text"')
    const box = profile.slice(profile.indexOf('<div class="doc-subtitle">'))
    expect(box.indexOf('doc-status-line')).toBeLessThan(box.indexOf('<p class="doc-file-hint">'))
    expect(profile).not.toContain('onclick={requestIdentityReRegister}')
    expect(profile).not.toContain('onclick={requestForeignReRegister}') // 외국인 탭도 같은 중복 버튼 제거(2026-10-05)
  })

  it('필수 서류 최초 완성 시에만 returnTo(없으면 홈)로 자동 복귀하고, 승인 대기 상태 줄에 상시 [문의하기]가 있다', () => {
    expect(profile).toContain('if (!wasComplete) scheduleReturnAfterDocsComplete()')
    expect(profile).toContain("?? '/'")
    expect(profile).toContain("searchParams.get('returnTo')")
    expect(profile.match(/class="doc-inquiry-link"/g)?.length).toBe(2)
  })
})
