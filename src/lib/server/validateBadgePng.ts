// 배지 PNG 이미지 확인 — 업로드된 파일이 진짜 PNG 인지(시그니처·IHDR)와 가로·세로 크기를 서버에서 확인한다.
// SVG 와 달리 PNG 는 스크립트를 담을 수 없어 정화 없이 그대로 저장하지만, 확장자만 바꾼 다른 파일은 걸러 낸다.
// 저장된 파일은 <img> 로만 렌더한다.
export const MAX_BADGE_PNG_PIXELS = 1024
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** 파일 머리 8바이트가 PNG 시그니처인가 — 업로드 종류(SVG/PNG) 판별에 쓴다 */
export function isPngBytes(buf: Uint8Array): boolean {
  return buf.length >= SIGNATURE.length && SIGNATURE.every((b, i) => buf[i] === b)
}

export type BadgePngCheck = { ok: true; width: number; height: number } | { ok: false; error: string }

export function validateBadgePng(buf: Uint8Array): BadgePngCheck {
  // 시그니처 8 + IHDR 청크(길이 4 + 이름 4 + 데이터 13) 최소 29바이트
  if (!isPngBytes(buf) || buf.length < 29) return { ok: false, error: 'PNG 파일이 올바르지 않아요' }
  const name = String.fromCharCode(buf[12], buf[13], buf[14], buf[15])
  if (name !== 'IHDR') return { ok: false, error: 'PNG 파일이 올바르지 않아요' }
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const width = view.getUint32(16)
  const height = view.getUint32(20)
  if (width < 1 || height < 1) return { ok: false, error: 'PNG 파일이 올바르지 않아요' }
  if (width > MAX_BADGE_PNG_PIXELS || height > MAX_BADGE_PNG_PIXELS) {
    return { ok: false, error: `PNG 는 가로·세로 ${MAX_BADGE_PNG_PIXELS}px 이하여야 해요` }
  }
  return { ok: true, width, height }
}
