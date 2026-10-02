/**
 * 고객 채팅 첨부 입력 서버 검증 (POST /api/chat/attachment)
 *
 * 클라이언트(ChatWindow)는 `chat-attachments/{세션id}/{timestamp}.{ext}` 경로로 업로드한 뒤 공개 URL을 서버로 보낸다.
 * 서버가 그 URL이 실제로 이 세션의 업로드 경로인지 확인하지 않으면 임의 URL이 이미지·링크로 렌더링된다(관리자 화면 포함).
 */

export interface ChatAttachmentInput {
  session_id: string
  file_name: string
  file_url: string
  is_image: boolean
}

export type ChatAttachmentValidation =
  | { ok: true; value: ChatAttachmentInput }
  | { ok: false; error: string }

const MAX_FILE_NAME = 255
const MAX_URL = 2048

export function validateChatAttachmentInput(body: unknown, supabaseUrl: string): ChatAttachmentValidation {
  if (!body || typeof body !== 'object') return { ok: false, error: '잘못된 요청입니다.' }
  const b = body as Record<string, unknown>

  if (typeof b.session_id !== 'string' || !b.session_id) return { ok: false, error: 'session_id, file_url 필수입니다.' }
  if (typeof b.file_url !== 'string' || !b.file_url) return { ok: false, error: 'session_id, file_url 필수입니다.' }
  if (b.is_image !== undefined && typeof b.is_image !== 'boolean') return { ok: false, error: '잘못된 요청입니다.' }

  const fileName = b.file_name
  if (typeof fileName !== 'string' || !fileName.trim() || fileName.length > MAX_FILE_NAME || /[\r\n]/.test(fileName)) {
    return { ok: false, error: '파일 이름이 올바르지 않습니다.' }
  }

  if (!supabaseUrl) return { ok: false, error: '서버 설정 오류입니다.' }

  const url = b.file_url
  if (url.length > MAX_URL || /[\s\r\n]/.test(url)) return { ok: false, error: '파일 주소가 올바르지 않습니다.' }
  const prefix = `${supabaseUrl.replace(/\/+$/, '')}/storage/v1/object/public/chat-attachments/${b.session_id}/`
  if (!url.startsWith(prefix)) return { ok: false, error: '허용되지 않는 파일 주소입니다.' }
  const rest = url.slice(prefix.length)
  // 세션 폴더 바로 아래 파일 1개만 허용 — 하위 경로·경로 우회(.., 인코딩된 점/슬래시) 차단
  if (!rest || /[/\\]/.test(rest) || rest.includes('..') || /%2e|%2f|%5c/i.test(rest)) {
    return { ok: false, error: '허용되지 않는 파일 주소입니다.' }
  }

  return {
    ok: true,
    value: { session_id: b.session_id, file_name: fileName, file_url: url, is_image: b.is_image === true },
  }
}
