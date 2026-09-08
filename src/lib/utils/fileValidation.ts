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

// front-uiux.md §15-1a 표준 정의(2026-09-08 명문화) — 개별 파일 업로드 용량 상한.
// 프로젝트 전역에서 이미 10MB가 사실상 표준으로 쓰이고 있었으나(CustomerDetailPanel.svelte
// 신분증, ContractTemplatePanel.svelte 계약서 가져오기, ProfileTabContent.svelte 신분증) 공용
// 검증 유틸이나 uiux 문서 어디에도 명문화돼 있지 않았다 — 이 상수가 그 표준을 고정한다.
// 호출부는 validateUploadFile()과 별도로 file.size를 직접 비교해야 한다(기존 5개 호출부의
// 동작을 바꾸지 않기 위해 이 함수 시그니처에는 포함하지 않음).
export const MAX_UPLOAD_FILE_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
export const MAX_UPLOAD_FILE_SIZE_LABEL = '10MB'

export function validateUploadFile(file: File): { ok: boolean; error?: string } {
  if (!UPLOAD_ACCEPTED_TYPES.includes(file.type as UploadMimeType)) {
    return { ok: false, error: 'PNG, JPEG, WebP, HEIF, PDF 파일만 업로드할 수 있어요.' }
  }
  return { ok: true }
}

export function validateUploadFileSize(
  file: File,
  maxBytes: number = MAX_UPLOAD_FILE_SIZE_BYTES,
): { ok: boolean; error?: string } {
  if (file.size > maxBytes) {
    return { ok: false, error: `파일 크기는 ${MAX_UPLOAD_FILE_SIZE_LABEL} 이하여야 합니다.` }
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
