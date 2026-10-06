/**
 * inlineImages.ts — 최종본 PDF 생성 시점에 계약서 HTML의 Storage 이미지(발행자 직인 등)를 data URI로 내장
 *
 * 배경: 발행자 직인은 계약서 HTML에 `<img src="https://<project>.supabase.co/storage/v1/object/public/…">`
 * 외부 URL로 박혀 있다. PDF 렌더러는 외부 요청을 전부 차단하므로(추적 픽셀·SSRF 방지) 그대로면 직인이 PDF에서
 * 빠진다. 또 URL만 남기면 나중에 그 이미지 파일이 바뀌거나 지워질 때 "서명 당시 문서"가 달라진다 — 생성 시점의
 * 이미지 바이트를 PDF에 내장하고 SHA-256을 남겨 자체 완결된 사본으로 만든다.
 *
 * 보안: 허용 주소(allowedBase, 같은 프로젝트의 Storage 공개 경로)로 판정된 URL만 가져온다(isAllowedStorageUrl —
 * URL 파싱 기반) — 계약서 HTML에 다른 주소(내부망·메타데이터 서버 등)가 섞여 있어도 서버가 대신 요청하지 않는다.
 */

export interface FetchedImage {
  bytes: Uint8Array
  contentType: string
}
export type ImageFetcher = (url: string) => Promise<FetchedImage>

export interface InlineResult {
  html: string
  inlined: { url: string; sha256: string; bytes: number }[]
  failed: { url: string; reason: string }[]
}

const IMG_SRC = /(<img\b[^>]*?\bsrc=)(["'])(https?:\/\/[^"']+)\2/gi
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('')
}

function toBase64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64')
}

/** 기본 가져오기: https만, 리다이렉트 금지, 10초 제한. */
export const defaultImageFetcher: ImageFetcher = async (url) => {
  if (!url.startsWith('https://')) throw new Error('https만 허용')
  const res = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return {
    bytes: new Uint8Array(await res.arrayBuffer()),
    contentType: (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase(),
  }
}

/**
 * 허용 주소 판정 — 문자열 접두사 비교가 아니라 URL을 파싱해 비교한다(sp3 MINOR-2).
 *   - https만, userinfo(@) 금지, origin(호스트·포트) 정확히 일치
 *   - 경로가 허용 접두사로 시작하되, 점 세그먼트(..)·퍼센트 인코딩된 점/슬래시·백슬래시가 없어야 한다
 *     (정규화되어 허용 경로 밖의 같은 호스트 다른 API로 빠지는 것을 막는다)
 * 대소문자만 다른 스킴·호스트는 URL이 정규화해 정상 이미지로 인식한다.
 */
export function isAllowedStorageUrl(url: string, allowedBase: string): boolean {
  let target: URL
  let base: URL
  try {
    target = new URL(url)
    base = new URL(allowedBase)
  } catch {
    return false
  }
  if (target.protocol !== 'https:') return false
  if (target.username || target.password) return false
  if (target.origin !== base.origin) return false
  if (!target.pathname.startsWith(base.pathname)) return false
  // 파서가 정규화하기 전의 원문 경로에서도 우회 흔적을 거른다
  const rawPath = url.replace(/^[a-z]+:\/\/[^/]*/i, '').split(/[?#]/)[0]
  if (/\\|%2e|%2f|%5c/i.test(rawPath)) return false
  if (rawPath.split('/').some((seg) => seg === '..' || seg === '.')) return false
  return true
}

export async function inlineStorageImages(
  html: string,
  opts: { allowedBase: string; fetchImage?: ImageFetcher; maxBytes?: number },
): Promise<InlineResult> {
  const fetchImage = opts.fetchImage ?? defaultImageFetcher
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES

  const urls = new Set<string>()
  for (const m of html.matchAll(IMG_SRC)) {
    if (isAllowedStorageUrl(m[3], opts.allowedBase)) urls.add(m[3])
  }

  const dataUris = new Map<string, string>()
  const inlined: InlineResult['inlined'] = []
  const failed: InlineResult['failed'] = []

  for (const url of urls) {
    try {
      const img = await fetchImage(url)
      if (!ALLOWED_TYPES.includes(img.contentType)) throw new Error(`허용되지 않는 content-type: ${img.contentType || '없음'}`)
      if (img.bytes.byteLength > maxBytes) throw new Error(`허용 크기 초과: ${img.bytes.byteLength}바이트`)
      dataUris.set(url, `data:${img.contentType};base64,${toBase64(img.bytes)}`)
      inlined.push({ url, sha256: await sha256Hex(img.bytes), bytes: img.bytes.byteLength })
    } catch (e) {
      failed.push({ url, reason: e instanceof Error ? e.message : String(e) })
    }
  }

  const out = html.replace(IMG_SRC, (whole, head: string, quote: string, url: string) => {
    const uri = dataUris.get(url)
    return uri ? `${head}${quote}${uri}${quote}` : whole
  })
  return { html: out, inlined, failed }
}
