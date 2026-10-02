import { describe, it, expect } from 'vitest'
import { validateChatAttachmentInput } from '$lib/server/chatAttachmentValidation'

/**
 * 고객 채팅 첨부 입력 서버 검증 — TDD (2026-10-02)
 * 클라이언트 검증만 있던 첨부 URL·파일명·이미지 여부를 서버가 강제한다. file_url은 이 세션의 chat-attachments 업로드 경로만 허용
 * (임의 URL을 is_image=true로 보내 CMS 화면의 img src·링크로 쓰이게 하는 경로 차단). content는 "파일명\nURL" 형식이라
 * 파일명에 줄바꿈이 있으면 형식 자체가 깨지므로 거부한다.
 */

const BASE = 'https://proj.supabase.co'
const SID = '11111111-2222-3333-4444-555555555555'
const GOOD_URL = `${BASE}/storage/v1/object/public/chat-attachments/${SID}/1700000000000.png`

function ok(over: Record<string, unknown> = {}) {
  return validateChatAttachmentInput(
    { session_id: SID, file_name: 'a.png', file_url: GOOD_URL, is_image: true, ...over },
    BASE,
  )
}

describe('validateChatAttachmentInput', () => {
  it('정상 입력은 통과', () => {
    expect(ok()).toEqual({ ok: true, value: { session_id: SID, file_name: 'a.png', file_url: GOOD_URL, is_image: true } })
  })
  it('is_image 누락은 false로 취급', () => {
    const r = validateChatAttachmentInput({ session_id: SID, file_name: 'a.pdf', file_url: GOOD_URL }, BASE)
    expect(r.ok && r.value.is_image).toBe(false)
  })
  it('다른 도메인 URL 거부', () => {
    expect(ok({ file_url: 'https://evil.example.com/x.png' }).ok).toBe(false)
  })
  it('같은 프로젝트라도 다른 버킷·다른 세션 폴더 거부', () => {
    expect(ok({ file_url: `${BASE}/storage/v1/object/public/product-images/${SID}/a.png` }).ok).toBe(false)
    expect(ok({ file_url: `${BASE}/storage/v1/object/public/chat-attachments/other-session/a.png` }).ok).toBe(false)
  })
  it('경로 우회(..)·인코딩 우회 거부', () => {
    expect(ok({ file_url: `${BASE}/storage/v1/object/public/chat-attachments/${SID}/../x/a.png` }).ok).toBe(false)
    expect(ok({ file_url: `${BASE}/storage/v1/object/public/chat-attachments/${SID}/%2e%2e/a.png` }).ok).toBe(false)
  })
  it('URL 줄바꿈·공백·과도한 길이 거부', () => {
    expect(ok({ file_url: `${GOOD_URL}\nhttps://evil.example.com` }).ok).toBe(false)
    expect(ok({ file_url: `${GOOD_URL}${'a'.repeat(2100)}` }).ok).toBe(false)
  })
  it('파일명: 빈 값·줄바꿈·255자 초과·문자열 아님 거부', () => {
    expect(ok({ file_name: '' }).ok).toBe(false)
    expect(ok({ file_name: 'a\nb.png' }).ok).toBe(false)
    expect(ok({ file_name: 'a'.repeat(256) }).ok).toBe(false)
    expect(ok({ file_name: 123 }).ok).toBe(false)
  })
  it('타입이 다른 값(비문자열 session_id·file_url, 비불리언 is_image) 거부', () => {
    expect(ok({ file_url: 5 }).ok).toBe(false)
    expect(ok({ session_id: {} }).ok).toBe(false)
    expect(ok({ is_image: 'true' }).ok).toBe(false)
  })
  it('서버 Supabase URL 설정이 비어 있으면 상대경로 URL도 거부(fail-closed)', () => {
    expect(validateChatAttachmentInput({ session_id: SID, file_name: 'a.png', file_url: `/storage/v1/object/public/chat-attachments/${SID}/1.png`, is_image: true }, '').ok).toBe(false)
  })
  it('body가 객체가 아니면 거부', () => {
    expect(validateChatAttachmentInput(null, BASE).ok).toBe(false)
    expect(validateChatAttachmentInput('x', BASE).ok).toBe(false)
  })
})
