import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * 본인증명·외국인증명 서류 스토리지 경로 헬퍼 (2026-10-03, 서류 비공개 전환 B1).
 *
 * 배경: 서류는 `user-documents` 버킷에 `{uid}/{identity|foreign}_{uuid}.{ext}`로 저장되고, DB 컬럼(identity_doc_url·
 * foreign_doc_url·foreign_doc_urls)에는 지금까지 getPublicUrl 전체 URL이 들어갔다. 버킷을 비공개로 전환하면서 컬럼 값을
 * "경로만 저장"으로 바꾸므로, 모든 읽기·정리 코드는 전환 전(공개 URL)·후(경로) 두 형식을 함께 받아야 한다.
 * 이 모듈이 그 양쪽 형식 해석의 단일 정본이다(과거 4곳의 `startsWith(prefix)` 복제를 대체).
 */

export const DOC_BUCKET = 'user-documents'

// 호스트와 무관하게 이 경로 표지 뒤가 버킷 내부 경로다(Stage·Production 프로젝트 ref가 달라도 동일하게 해석).
const PUBLIC_MARKER = `/storage/v1/object/public/${DOC_BUCKET}/`

/**
 * 공개 URL 또는 경로 → 버킷 내부 경로. 해석 불가·위험 입력이면 null.
 * ownerUid를 주면 `{ownerUid}/` 폴더 아래 경로만 허용한다(다른 사용자 파일 삭제·서명 방지).
 */
export function toDocPath(value: string | null | undefined, ownerUid?: string): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null

  let path: string
  const markerIdx = trimmed.indexOf(PUBLIC_MARKER)
  if (markerIdx >= 0) {
    path = trimmed.slice(markerIdx + PUBLIC_MARKER.length)
  } else if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || trimmed.startsWith('//')) {
    return null // 알 수 없는 스킴/호스트의 URL은 경로로 취급하지 않는다
  } else {
    path = trimmed
  }

  path = path.split('#')[0].split('?')[0]
  try {
    path = decodeURIComponent(path)
  } catch {
    return null
  }
  // 디코딩 후 제어문자(NUL 포함)·백슬래시가 있으면 거부 — 저장 경로는 항상 `uid/종류_uuid.확장자`라 정상 값에는 나오지 않는다
  if (/[\u0000-\u001f\u007f\\]/.test(path)) return null
  path = path.replace(/^\/+/, '')

  if (!path || path.split('/').some((seg) => seg === '..' || seg === '.' || seg === '')) return null
  if (ownerUid && !path.startsWith(`${ownerUid}/`)) return null
  return path
}

/** 여러 값 → 유효한 경로 목록(중복 제거). 해석 불가 값은 건너뛴다. */
export function toDocPaths(values: readonly (string | null | undefined)[], ownerUid?: string): string[] {
  const out = new Set<string>()
  for (const v of values) {
    const p = toDocPath(v, ownerUid)
    if (p) out.add(p)
  }
  return [...out]
}

export interface SignedDocUrl {
  url: string
  isPdf: boolean
  expiresIn: number
}

/** 경로의 확장자가 pdf인지 (뷰어가 iframe/img를 고를 때 사용 — 서명 URL 꼬리에 의존하지 않는다) */
export function isPdfPath(path: string): boolean {
  return path.toLowerCase().endsWith('.pdf')
}

/** 경로 확장자(없으면 빈 문자열) */
export function docExtension(path: string): string {
  const seg = path.split('/').pop() ?? ''
  const dot = seg.lastIndexOf('.')
  return dot >= 0 ? seg.slice(dot + 1).toLowerCase() : ''
}

/**
 * 짧은 만료 서명 URL 발급. download에 파일명을 주면 Content-Disposition: attachment로 내려온다.
 * 버킷이 공개든 비공개든 동일하게 동작한다(전환 전후 공통).
 */
export async function signDocPath(
  admin: SupabaseClient,
  path: string,
  options: { expiresIn?: number; download?: string } = {},
): Promise<SignedDocUrl | null> {
  const expiresIn = options.expiresIn ?? 60
  const { data, error } = await admin.storage
    .from(DOC_BUCKET)
    .createSignedUrl(path, expiresIn, options.download ? { download: options.download } : undefined)
  if (error || !data?.signedUrl) {
    console.error('[userDocs] createSignedUrl 실패:', error?.message)
    return null
  }
  return { url: data.signedUrl, isPdf: isPdfPath(path), expiresIn }
}
