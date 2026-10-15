// /cms/chat 고객정보 패널 — 본인증명·외국인증명 "요청" 버튼 노출 조건 테스트
// 노출 규칙: 미등록이거나 등록일 기준 6개월 경과(만료)일 때만 "요청" 버튼 노출, 유효 등록 시 미노출.
import { describe, it, expect } from 'vitest'
import { render } from 'svelte/server'
import CustomerDetailPanel from '$lib/components/chat/CustomerDetailPanel.svelte'

type DocInput = { urls: string[] | null; verifiedAt: string | null }

function monthsAgo(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  return d.toISOString()
}

function renderPanel(identity: DocInput, foreign: DocInput, requestingDocType: 'identity' | 'foreign' | null = null): string {
  const { body } = render(CustomerDetailPanel, {
    props: {
      detail: {
        profile: {
          name: '테스트', phone: '010-0000-0000', is_student: false, is_foreign: false,
          identity_type: null,
          identity_doc_url: identity.urls, identity_verified_at: identity.verifiedAt,
          foreign_doc_url: null, foreign_doc_urls: foreign.urls, foreign_verified_at: foreign.verifiedAt,
        },
        subscription: null,
        reservations: [],
      },
      summary: null,
      isLoading: false,
      requestingDocType,
      onrequestdoc: () => {},
    },
  })
  return body
}

/** 라벨(본인증명/외국인증명) 행 하나의 HTML 조각만 추출 */
function row(html: string, label: '본인증명' | '외국인증명'): string {
  const start = html.indexOf(`>${label}</span>`)
  expect(start).toBeGreaterThan(-1)
  const next = html.indexOf('info-row', start)
  return html.slice(start, next === -1 ? undefined : next)
}

const NONE: DocInput = { urls: null, verifiedAt: null }
const VALID: DocInput = { urls: ['a.pdf'], verifiedAt: monthsAgo(1) }
const EXPIRED: DocInput = { urls: ['a.pdf'], verifiedAt: monthsAgo(7) }

describe('/cms/chat 요청 버튼 노출', () => {
  it('미등록 → "미등록" 표시 + 요청 버튼 노출 (본인증명·외국인증명 각각)', () => {
    const html = renderPanel(NONE, NONE)
    for (const label of ['본인증명', '외국인증명'] as const) {
      const r = row(html, label)
      expect(r).toContain('미등록')
      expect(r).toContain('doc-request-btn')
      expect(r).toContain('>요청<')
    }
  })

  it('유효 등록(6개월 이내) → 등록완료 표시 + 요청 버튼 미노출', () => {
    const html = renderPanel(VALID, VALID)
    for (const label of ['본인증명', '외국인증명'] as const) {
      const r = row(html, label)
      expect(r).toContain('등록완료')
      expect(r).not.toContain('doc-request-btn')
    }
  })

  it('6개월 경과 → 만료됨 표시 + 요청 버튼 노출', () => {
    const html = renderPanel(EXPIRED, EXPIRED)
    for (const label of ['본인증명', '외국인증명'] as const) {
      const r = row(html, label)
      expect(r).toContain('만료됨')
      expect(r).toContain('doc-request-btn')
    }
  })

  it('두 문서 상태가 독립적 — 본인증명 유효 / 외국인증명 미등록', () => {
    const html = renderPanel(VALID, NONE)
    expect(row(html, '본인증명')).not.toContain('doc-request-btn')
    expect(row(html, '외국인증명')).toContain('doc-request-btn')
  })

  it('전송 중이면 해당 문서 버튼만 비활성화 + "전송 중..." 표시', () => {
    const html = renderPanel(NONE, NONE, 'foreign')
    const identityRow = row(html, '본인증명')
    const foreignRow = row(html, '외국인증명')
    expect(foreignRow).toContain('전송 중...')
    expect(foreignRow).toContain('disabled')
    expect(identityRow).toContain('>요청<')
    expect(identityRow).not.toContain('disabled')
  })

  it('등록 파일이 빈 배열이면 미등록으로 취급', () => {
    const html = renderPanel({ urls: [], verifiedAt: monthsAgo(1) }, NONE)
    const r = row(html, '본인증명')
    expect(r).toContain('미등록')
    expect(r).toContain('doc-request-btn')
  })
})

// ── 승인 상태 반영(2026-10-15): 승인 취소·재승인 대기 고객이 '등록완료'로 보이던 결함 ─────────────────
describe('본인증명 승인 상태 표시', () => {
  const REQUIRED = ['resident', 'resident_copy']
  function renderApproval(opts: { type?: string[] | null; verifiedAt: string; approvedAt: string | null | undefined; phone?: string }): string {
    const profile = {
      name: '테스트', phone: opts.phone ?? '01048602303', is_student: false, is_foreign: false,
      identity_type: opts.type === undefined ? REQUIRED : opts.type,
      identity_doc_url: ['a.pdf', 'b.pdf'], identity_verified_at: opts.verifiedAt,
      foreign_doc_url: null, foreign_doc_urls: null, foreign_verified_at: null,
      ...(opts.approvedAt === undefined ? {} : { identity_approved_at: opts.approvedAt }),
    }
    const { body } = render(CustomerDetailPanel, {
      props: { detail: { profile, subscription: null, reservations: [] }, summary: null, isLoading: false, onrequestdoc: () => {} },
    })
    return body
  }
  const now = new Date().toISOString()
  const earlier = new Date(Date.now() - 3600_000).toISOString()

  it('승인 취소(승인 시각 없음) → 승인대기로 표시하고 요청 버튼은 숨긴다', () => {
    const h = row(renderApproval({ verifiedAt: now, approvedAt: null }), '본인증명')
    expect(h).toContain('승인대기')
    expect(h).not.toContain('등록완료')
    expect(h).not.toContain('doc-request-btn')
  })
  it('등록 이후 승인됨 → 승인완료', () => {
    expect(row(renderApproval({ verifiedAt: earlier, approvedAt: now }), '본인증명')).toContain('승인완료')
  })
  it('승인 후 재제출(등록일이 승인보다 최신) → 승인대기', () => {
    expect(row(renderApproval({ verifiedAt: now, approvedAt: earlier }), '본인증명')).toContain('승인대기')
  })
  it('필수 서류 조합 미충족 → 필수 서류 미비 + 요청 버튼 노출', () => {
    const h = row(renderApproval({ type: ['resident'], verifiedAt: now, approvedAt: null }), '본인증명')
    expect(h).toContain('필수 서류 미비')
    expect(h).toContain('doc-request-btn')
  })
  it('승인 시각 필드가 없는 응답 → 기존처럼 등록완료', () => {
    expect(row(renderApproval({ verifiedAt: now, approvedAt: undefined }), '본인증명')).toContain('등록완료')
  })
  it('전화번호는 하이픈을 넣어 표시한다', () => {
    expect(renderApproval({ verifiedAt: now, approvedAt: now })).toContain('010-4860-2303')
  })
})
