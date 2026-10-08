/**
 * fileHash.ts — 브라우저에서 파일의 SHA-256 지문 계산
 * 계약서 PDF에는 개인정보가 들어 있어 서버로 보내지 않는다 — 지문(64자 hex)만 계산해 진위 확인 API에 보낸다.
 */
export const MAX_VERIFY_FILE_BYTES = 20 * 1024 * 1024 // 보관 버킷 상한(20MB)과 같다

export async function sha256HexOfFile(file: Blob): Promise<string> {
  if (file.size > MAX_VERIFY_FILE_BYTES) throw new Error('file_too_large')
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer())
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}
