/**
 * previewPdf.ts — 최종본 PDF가 아직 없는 서명 완료 계약서의 "임시 미리보기 PDF"를 즉석에서 만든다 (2026-10-08, Stephen 지시)
 *
 * 목적: 관리자 계약서 탭의 자체 PDF 뷰어를 최종본 생성 전(서명 직후 대기·서명 증적 도입 전 서명 건)에도 열어 둔다.
 * 원칙:
 *   - 저장하지 않는다 — 증적 행·보관본·감사 표식 어느 것도 만들지 않는다(추가 전용 기록을 조회만으로 늘리지 않기 위함). 요청 때마다 새로 만든다.
 *   - 내용은 서명 시점 스냅샷 + 저장된 서명 이미지(재생성 방식, generateArchive.resolveSourceDocument와 같은 로직)이며 증적 요약·약관 부록은 넣지 않는다.
 *   - 법적 증빙(최종본)이 아니다. 화면에는 "임시 미리보기"로 표시한다. 최종본이 생기면 호출부가 최종본을 먼저 돌려준다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseUrl } from '$lib/env/supabasePublic'
import { buildPreviewHtml } from './archiveHtml'
import { ARCHIVE_FONT_CSS } from './fontCss'
import { resolveSourceDocument, type EvidenceRecord } from './generateArchive'
import { inlineStorageImages, type ImageFetcher } from './inlineImages'
import { renderHtmlToPdf } from './renderPdf'
import { sanitizeArchiveHtml } from './sanitizeArchiveHtml'

export type PreviewResult =
  | { ok: true; pdf: Uint8Array }
  | { ok: false; status: 404 | 409 | 422 | 500; reason: string; message: string }

export interface PreviewDeps {
  render?: (html: string) => Promise<{ pdf: Uint8Array }>
  fetchImage?: ImageFetcher
}

const UNSUPPORTED_REASONS = ['unsupported_authoring_mode', 'signature_data_missing']

/** 응답에 실어도 되는 사유 코드 — 그 외(내부 오류 메시지 등)는 로그에만 남기고 응답에는 일반 코드(preview_failed)만 낸다 */
export const PREVIEW_PUBLIC_REASONS = ['not_signed', 'contract_not_found', 'unsupported_authoring_mode', 'signature_data_missing', 'invalid_pdf_output', 'preview_failed'] as const

export async function renderSignedContractPreview(admin: SupabaseClient, contractId: string, deps: PreviewDeps = {}): Promise<PreviewResult> {
  try {
    const { data: signing } = await admin
      .from('contract_signings')
      .select('id, signed_at')
      .eq('contract_id', contractId)
      .not('signed_at', 'is', null)
      .order('sent_at', { ascending: false })
      .limit(1)
      .maybeSingle()
    const s = signing as { id: string; signed_at: string } | null
    if (!s) return { ok: false, status: 409, reason: 'not_signed', message: '서명이 완료된 계약서만 미리볼 수 있습니다.' }

    // 증적 없이 스냅샷 재생성 경로를 쓰도록 소급 증적과 같은 모양의 임시 값을 만든다(DB에는 저장하지 않는다)
    const ev: EvidenceRecord = {
      id: 'preview', contract_id: contractId, signing_id: s.id, reservation_id: null, signed_at: s.signed_at,
      ip_address: null, user_agent: null, consent_log: [], final_html_sha256: null,
      terms_text: null, refund_text: null, privacy_text: null, terms_sha256: null, refund_sha256: null, privacy_sha256: null,
    }
    let html: string
    try {
      html = (await resolveSourceDocument(admin, ev)).html
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      if (reason === 'contract_not_found') return { ok: false, status: 404, reason, message: '계약서를 찾을 수 없습니다.' }
      if (UNSUPPORTED_REASONS.includes(reason)) {
        return { ok: false, status: 422, reason, message: "이 계약서는 PDF 미리보기를 만들 수 없습니다(이전 작성 방식이거나 서명 이미지가 없음). '보기' 버튼으로 확인해 주세요." }
      }
      console.error('[previewPdf] 스냅샷 확정 실패:', reason)
      return { ok: false, status: 500, reason: 'preview_failed', message: '미리보기 PDF를 만들지 못했습니다.' }
    }

    const inlined = await inlineStorageImages(sanitizeArchiveHtml(html), {
      allowedBase: `${getSupabaseUrl()}/storage/v1/object/public/`,
      fetchImage: deps.fetchImage,
    })
    const render = deps.render ?? ((h: string) => renderHtmlToPdf(h))
    const { pdf } = await render(buildPreviewHtml({ contractHtml: inlined.html, fontCss: ARCHIVE_FONT_CSS }))
    if (!pdf || pdf.byteLength < 1000 || Buffer.from(pdf.subarray(0, 5)).toString() !== '%PDF-') {
      return { ok: false, status: 500, reason: 'invalid_pdf_output', message: '미리보기 PDF를 만들지 못했습니다.' }
    }
    return { ok: true, pdf }
  } catch (e) {
    console.error('[previewPdf] 미리보기 생성 실패:', e instanceof Error ? e.message : String(e))
    return { ok: false, status: 500, reason: 'preview_failed', message: '미리보기 PDF를 만들지 못했습니다.' }
  }
}
