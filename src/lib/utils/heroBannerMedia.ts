// 홈 히어로 배너 매체 종류 — 별도 DB 컬럼 없이 등록된 주소의 확장자로 구분한다.
// 이미지는 기존 product-images, HTML·MP4는 home-hero-media 버킷(Migration #800)에 저장된다.

export type HeroBannerMediaKind = 'image' | 'video' | 'html'

export const HERO_MEDIA_ACCEPT =
  'image/png,image/jpeg,image/webp,image/heif,image/heic,video/mp4,text/html,.html,.htm,.mp4'

export const HERO_MEDIA_MAX_BYTES = 10 * 1024 * 1024 // 10MB (버킷 한도와 동일)

export function heroBannerMediaKind(url: string): HeroBannerMediaKind {
  const clean = url.split('?')[0].split('#')[0].toLowerCase()
  if (clean.endsWith('.mp4')) return 'video'
  if (clean.endsWith('.html') || clean.endsWith('.htm')) return 'html'
  return 'image'
}

// HTML·MP4 는 "이 프로젝트의" 전용 저장소(home-hero-media) 주소일 때만 재생한다 — 배너 주소 칸에 외부 사이트·다른
// Supabase 프로젝트 주소를 넣어 업로드 제한을 우회하는 것을 화면에서도 막는다(DB 트리거 #802 와 같은 규칙).
// supabaseUrl 은 이 앱의 Supabase 주소(getSupabaseUrl()) — Stage·Production 이 다르므로 환경에서 받는다.
export function isTrustedHeroMediaUrl(url: string, supabaseUrl: string): boolean {
  try {
    if (url.includes('..') || url.includes('\\') || /%(2e|25|5c)/i.test(url)) return false   // DB 트리거 #803 과 같은 거절 목록
    const u = new URL(url)
    const base = new URL(supabaseUrl)
    return (
      u.protocol === 'https:' &&
      u.host === base.host &&
      !u.username &&
      !u.password &&
      u.pathname.startsWith('/storage/v1/object/public/home-hero-media/')
    )
  } catch {
    return false
  }
}

// 업로드 HTML 앞에 CSP <meta> 를 붙인다. 문서 형식 선언(<!DOCTYPE>)이 있으면 그 바로 뒤에 넣어 표준 모드를 유지하고,
// 없으면 선언을 붙여 표준 모드로 만든다(선언보다 앞에 요소가 오면 구형 호환 모드가 되어 레이아웃이 틀어짐).
export function injectCsp(html: string, csp: string): string {
  const meta = `<meta http-equiv="Content-Security-Policy" content="${csp}">`
  const body = html.replace(/^\uFEFF/, '')
  const m = body.match(/^\s*<!doctype[^>]*>/i)
  return m ? m[0] + meta + body.slice(m[0].length) : `<!DOCTYPE html>${meta}${body}`
}

// 업로드 전 사전 점검(보조 수단 — 자기 창을 다른 주소로 바꾸는 <meta http-equiv="refresh"> 를 거른다. 스크립트 이동까지 막지는 못함)
export function hasMetaRefresh(html: string): boolean {
  return /<meta[^>]+http-equiv\s*=\s*["']?refresh/i.test(html)
}
