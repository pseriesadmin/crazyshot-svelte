/**
 * imageFile.ts — 이미지 파일 기본 검증 (doc-editor 자체 구현, 호스트 유틸 비의존)
 *
 * 허용: PNG·JPEG·WebP·HEIF/HEIC, 개별 10MB 이하. 호스트가 더 엄격한 검증이 필요하면
 * uploadImage 주입 지점에서 추가로 거절하면 된다.
 */
export const ALLOWED_IMAGE_MIME = ['image/png', 'image/jpeg', 'image/webp', 'image/heif', 'image/heic']
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024

export interface ImageFileCheck {
  ok: boolean
  error?: string
}

export function validateImageFile(file: { type: string; size: number }): ImageFileCheck {
  if (!ALLOWED_IMAGE_MIME.includes(file.type)) {
    return { ok: false, error: 'PNG, JPEG, WebP, HEIF 이미지만 삽입할 수 있어요.' }
  }
  if (file.size > MAX_IMAGE_BYTES) {
    return { ok: false, error: '이미지는 10MB 이하만 삽입할 수 있어요.' }
  }
  return { ok: true }
}
