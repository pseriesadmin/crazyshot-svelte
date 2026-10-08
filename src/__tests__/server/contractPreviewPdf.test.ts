import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 최종본이 없는 서명 완료 계약서의 임시 미리보기 PDF(관리자 PDF 뷰어용) — 생성기·라우트 테스트 (2026-10-08)
 */

vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'k' }))
vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' }))
vi.mock('$env/dynamic/public', () => ({ env: { PUBLIC_SUPABASE_URL: 'https://proj.supabase.co' } }))
vi.mock('$lib/env/supabasePublic', () => ({ getSupabaseUrl: () => 'https://proj.supabase.co' }))
vi.mock('$lib/server/contractArchive/renderPdf', () => ({ renderHtmlToPdf: vi.fn() }))

import { renderSignedContractPreview } from '$lib/server/contractArchive/previewPdf'
import { buildPreviewHtml } from '$lib/server/contractArchive/archiveHtml'

type Row = Record<string, unknown>
interface World { signing: Row | null; contract: Row | null; signingFull: Row | null; writes: string[] }
let w: World

function fakeAdmin(): SupabaseClient {
  const from = (table: string) => {
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'order', 'limit', 'in', 'is']) b[m] = () => b
    b.maybeSingle = async () => {
      if (table === 'contracts') return { data: w.contract, error: null }
      if (table === 'contract_signings') return { data: w.signingFull ?? w.signing, error: null }
      return { data: null, error: null }
    }
    for (const m of ['insert', 'update', 'delete', 'upsert']) b[m] = async () => { w.writes.push(`${table}.${m}`); return { error: null } }
    return b
  }
  return { from, storage: { from: () => ({ upload: async () => { w.writes.push('storage.upload'); return { error: null } } }) } } as unknown as SupabaseClient
}

const fakePdf = new Uint8Array([...new TextEncoder().encode('%PDF-1.4\n'), ...new Uint8Array(2000).fill(65)])
const MARKER_HTML = '<div class="contract-wrap"><p>대여료 120,000원</p><!--CUSTOMER_SIGNATURE--></div>'
const SIG = 'data:image/png;base64,iVBORw0KGgo='

beforeEach(() => {
  w = {
    signing: { id: 's1', signed_at: '2026-10-02T06:46:00Z' },
    contract: { authoring_mode: 'html', html_document: '<p>현재</p>' },
    signingFull: { id: 's1', signed_at: '2026-10-02T06:46:00Z', signature_data: SIG, signed_content_snapshot: { authoring_mode: 'html', html_document: MARKER_HTML } },
    writes: [],
  }
})

describe('renderSignedContractPreview — 임시 미리보기 PDF', () => {
  it('서명 시점 스냅샷에 서명 이미지를 합성해 PDF로 만든다(저장·증적 기록 없음)', async () => {
    let html = ''
    const r = await renderSignedContractPreview(fakeAdmin(), 'c1', { render: async (h) => { html = h; return { pdf: fakePdf } } })
    expect(r.ok).toBe(true)
    expect(html).toContain('대여료 120,000원')
    expect(html).toContain(SIG) // 서명 이미지 합성
    expect(html).not.toContain('<!--CUSTOMER_SIGNATURE-->')
    expect(html).toContain('<title>전자계약서 미리보기</title>')
    expect(html).not.toContain('서명 증적 요약') // 증적 요약·약관 부록 없음
    expect(w.writes).toEqual([]) // DB·스토리지에 아무것도 쓰지 않는다
  })

  it('서명이 완료되지 않았으면 409', async () => {
    w.signing = null
    w.signingFull = null
    const r = await renderSignedContractPreview(fakeAdmin(), 'c1', { render: async () => ({ pdf: fakePdf }) })
    expect(r).toMatchObject({ ok: false, status: 409, reason: 'not_signed' })
  })

  it('html 방식이 아니거나 서명 이미지가 없으면 422(안내 문구에 "보기" 버튼 안내)', async () => {
    w.signingFull = { id: 's1', signed_at: '2026-10-02T06:46:00Z', signature_data: SIG, signed_content_snapshot: { authoring_mode: 'canvas', html_document: null } }
    const a = await renderSignedContractPreview(fakeAdmin(), 'c1', { render: async () => ({ pdf: fakePdf }) })
    expect(a).toMatchObject({ ok: false, status: 422, reason: 'unsupported_authoring_mode' })
    expect(a.ok ? '' : a.message).toContain('보기')
    w.signingFull = { id: 's1', signed_at: '2026-10-02T06:46:00Z', signature_data: null, signed_content_snapshot: { authoring_mode: 'html', html_document: MARKER_HTML } }
    const b = await renderSignedContractPreview(fakeAdmin(), 'c1', { render: async () => ({ pdf: fakePdf }) })
    expect(b).toMatchObject({ ok: false, status: 422, reason: 'signature_data_missing' })
  })

  it('계약이 없으면 404, 엔진 오류·잘못된 PDF는 500', async () => {
    w.contract = null
    expect(await renderSignedContractPreview(fakeAdmin(), 'c1', { render: async () => ({ pdf: fakePdf }) })).toMatchObject({ ok: false, status: 404 })
    w.contract = { authoring_mode: 'html', html_document: '<p>x</p>' }
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const boom = await renderSignedContractPreview(fakeAdmin(), 'c1', { render: async () => { throw new Error('chromium boom with secret detail') } })
    expect(boom).toMatchObject({ ok: false, status: 500, reason: 'preview_failed' }) // 내부 오류 메시지는 응답 사유에 싣지 않는다
    expect(JSON.stringify(boom)).not.toContain('secret detail')
    expect(await renderSignedContractPreview(fakeAdmin(), 'c1', { render: async () => ({ pdf: new Uint8Array([1, 2, 3]) }) })).toMatchObject({ ok: false, status: 500, reason: 'invalid_pdf_output' })
    spy.mockRestore()
  })

  it('계약서 본문 안의 스크립트는 제거된다(sanitize 경유)', async () => {
    w.signingFull = { id: 's1', signed_at: '2026-10-02T06:46:00Z', signature_data: SIG, signed_content_snapshot: { authoring_mode: 'html', html_document: `<p>본문</p><script>alert(1)</script>${'<!--CUSTOMER_SIGNATURE-->'}` } }
    let html = ''
    await renderSignedContractPreview(fakeAdmin(), 'c1', { render: async (h) => { html = h; return { pdf: fakePdf } } })
    expect(html).not.toContain('<script>alert(1)</script>')
  })
})

describe('buildPreviewHtml — 저장·인쇄한 사본이 최종본으로 오인되지 않게 표식', () => {
  it('모든 쪽에 반복되는 워터마크와 하단 문구가 들어간다', async () => {
    const { buildPreviewHtml, PREVIEW_WATERMARK_TEXT, PREVIEW_FOOTER_TEXT } = await import('$lib/server/contractArchive/archiveHtml')
    const h = buildPreviewHtml({ contractHtml: '<p>본문</p>' })
    expect(h).toContain(`<div class="preview-watermark" aria-hidden="true">${PREVIEW_WATERMARK_TEXT}</div>`)
    expect(h).toContain(`<div class="preview-footer" aria-hidden="true">${PREVIEW_FOOTER_TEXT}</div>`)
    expect(PREVIEW_WATERMARK_TEXT).toContain('최종본 아님')
    expect(PREVIEW_FOOTER_TEXT).toContain('법적 증빙 최종본')
    expect(h).toMatch(/\.preview-watermark \{[^}]*position: fixed/) // fixed = 인쇄 시 쪽마다 반복
    expect(h.indexOf('preview-watermark')).toBeLessThan(h.indexOf('<p>본문</p>'))
  })

  it('폰트가 있으면 표식에도 같은 폰트를 강제하고, 본문(서명 위치)을 덮지 않도록 옅은 색을 쓴다', async () => {
    const { buildPreviewHtml } = await import('$lib/server/contractArchive/archiveHtml')
    const h = buildPreviewHtml({ contractHtml: '<p>x</p>', fontCss: '@font-face{font-family:"Archive KR";src:url(data:,)}' })
    expect(h).toContain(".preview-watermark, .preview-footer { font-family: 'Archive KR', sans-serif !important; }")
    expect(h).toMatch(/\.preview-watermark \{[^}]*rgba\(200, 0, 0, 0\.13\)/)
  })
})

describe('buildPreviewHtml', () => {
  it('본문을 가공하지 않고 스크립트 차단 CSP를 넣는다', () => {
    const h = buildPreviewHtml({ contractHtml: '<p id="x">본문</p>' })
    expect(h).toContain('<p id="x">본문</p>')
    expect(h).toContain("script-src 'none'")
  })
})

describe('미리보기 응답에 내부 정보가 새지 않는다', () => {
  it('공개 사유 코드 목록이 정의돼 있고 라우트는 사유 코드만 싣는다', async () => {
    const { PREVIEW_PUBLIC_REASONS } = await import('$lib/server/contractArchive/previewPdf')
    expect([...PREVIEW_PUBLIC_REASONS]).toEqual(['not_signed', 'contract_not_found', 'unsupported_authoring_mode', 'signature_data_missing', 'invalid_pdf_output', 'preview_failed'])
    const src = readFileSync('src/routes/api/cms/contracts/[id]/preview-pdf/+server.ts', 'utf8')
    expect(src).toContain('{ error: preview.message, reason: preview.reason }')
  })
})

describe('preview-pdf 라우트 배선(소스 점검)', () => {
  it('계약 ID는 UUID 형식만 받는다(권한·속도 제한 확인 뒤, DB 조회 전)', () => {
    const s = readFileSync('src/routes/api/cms/contracts/[id]/preview-pdf/+server.ts', 'utf8')
    expect(s).toContain('const UUID_RE =')
    expect(s.indexOf('UUID_RE.test(params.id)')).toBeGreaterThan(s.indexOf('getCmsRoleForAction(locals)'))
    expect(s.indexOf('UUID_RE.test(params.id)')).toBeLessThan(s.indexOf('createClient('))
  })

  const src = readFileSync('src/routes/api/cms/contracts/[id]/preview-pdf/+server.ts', 'utf8')
  it('메뉴 권한·CMS 직원 확인·속도 제한을 거치고 menuAccessMap에 등록돼 있다', () => {
    expect(src).toContain("requireMenuAccessApi(locals, 'rental.reservation')")
    expect(src).toContain('getCmsRoleForAction')
    expect(src).toContain('createRateLimiter(6, 60_000)')
    expect(readFileSync('src/lib/server/menuAccessMap.ts', 'utf8')).toContain("'src/routes/api/cms/contracts/[id]/preview-pdf'")
  })
  it('최종본이 있으면 최종본을 먼저 내려주고, 없을 때만 미리보기를 만든다', () => {
    expect(src.indexOf('loadLatestArchivedPdf')).toBeGreaterThan(-1)
    expect(src.indexOf('renderSignedContractPreview(admin')).toBeGreaterThan(src.indexOf('loadLatestArchivedPdf(admin'))
    expect(src).toContain("'x-pdf-kind': kind")
  })
  it('PDF 엔진 전용 함수로 분리(maxDuration)되고 미리보기는 저장하지 않는다', () => {
    expect(src).toContain('export const config = { maxDuration: 120 }')
    expect(src).not.toMatch(/\.upload\(|\.insert\(|\.upsert\(/)
  })
  it('관리자 뷰어는 서명 완료이고 최종본이 없으면 미리보기 URL을 쓰며 내려받기는 최종본에만 있다', () => {
    const v = readFileSync('src/lib/components/cms/RentalContractViewer.svelte', 'utf8')
    expect(v).toContain("`/api/cms/contracts/${contractId}/preview-pdf`")
    expect(v).toContain('{:else if contractPdfUrl || previewPdfUrl}')
    expect(v).toMatch(/<PdfViewer src=\{previewPdfUrl\} title=\{`전자계약서_미리보기_\$\{reservationId\}\.pdf`\} \/>/)
    expect(v).toContain('임시 미리보기이며 법적 증빙 최종본이 아닙니다')
  })

  it('서명 전(미서명·발송 전)에도 PDF 뷰어 영역이 빈 캔버스로 항상 열려 있다', () => {
    const v = readFileSync('src/lib/components/cms/RentalContractViewer.svelte', 'utf8')
    expect(v).toContain('{#if !customerSignedAt}')
    expect(v).toContain('<PdfViewer src={null}')
    expect(v).toContain('고객이 서명을 완료하면 이곳에 계약서 PDF가 표시됩니다.')
    // 빈 상태는 같은 자체 뷰어(도구줄 포함)를 쓰되 PDF 주소가 없어 요청하지 않는다
    const pv = readFileSync('src/lib/components/common/PdfViewer.svelte', 'utf8')
    expect(pv).toContain("if (!url) {")
    expect(pv).toContain("status = 'empty'")
  })
})
