// front-uiux.md §15-3 표준 정의 — 강제 적용
// 이미지 업로드 시 클라이언트·서버 양쪽에서 반드시 validateUploadFile() 호출

export const UPLOAD_ACCEPTED_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/heif',
  'image/heic',
  'application/pdf',
] as const

export type UploadMimeType = (typeof UPLOAD_ACCEPTED_TYPES)[number]

export function validateUploadFile(file: File): { ok: boolean; error?: string } {
  if (!UPLOAD_ACCEPTED_TYPES.includes(file.type as UploadMimeType)) {
    return { ok: false, error: 'PNG, JPEG, WebP, HEIF, PDF 파일만 업로드할 수 있어요.' }
  }
  return { ok: true }
}

export function getMimeExtension(mimeType: string): string {
  const map: Record<string, string> = {
    'image/png':      'png',
    'image/jpeg':     'jpg',
    'image/webp':     'webp',
    'image/heif':     'heif',
    'image/heic':     'heic',
    'application/pdf': 'pdf',
  }
  return map[mimeType] ?? 'bin'
}
