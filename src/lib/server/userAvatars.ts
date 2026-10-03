/**
 * 프로필 아바타 스토리지 헬퍼 (2026-10-03, 서류 비공개 전환 B3a).
 * 아바타는 <img src>로 직접 노출되는 공개 이미지라 서류(비공개 전환 대상)와 분리해 전용 공개 버킷 `user-avatars`에 둔다.
 * 전환 이전에 올린 아바타는 `user-documents` 공개 URL로 남아 있으므로 이전 아바타 정리는 두 버킷을 모두 해석한다.
 */
export const AVATAR_BUCKET = 'user-avatars'
export const LEGACY_AVATAR_BUCKET = 'user-documents'

export interface AvatarLocation {
  bucket: typeof AVATAR_BUCKET | typeof LEGACY_AVATAR_BUCKET
  path: string
}

/**
 * 아바타 공개 URL → { 버킷, 경로 }. 해석 불가·타 사용자 폴더·아바타가 아닌 파일(서류 등)이면 null.
 * 이전 아바타 삭제 시 서류 파일을 잘못 지우지 않도록 `{uid}/avatar_` 접두를 요구한다.
 */
export function toAvatarLocation(url: string | null | undefined, ownerUid: string): AvatarLocation | null {
  if (typeof url !== 'string' || !url) return null
  for (const bucket of [AVATAR_BUCKET, LEGACY_AVATAR_BUCKET] as const) {
    const marker = `/storage/v1/object/public/${bucket}/`
    const idx = url.indexOf(marker)
    if (idx < 0) continue
    let path = url.slice(idx + marker.length).split('#')[0].split('?')[0]
    try {
      path = decodeURIComponent(path)
    } catch {
      return null
    }
    if (!path.startsWith(`${ownerUid}/avatar_`)) return null
    if (path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return null
    if (/[\u0000-\u001f\u007f\\]/.test(path)) return null
    return { bucket, path }
  }
  return null
}
