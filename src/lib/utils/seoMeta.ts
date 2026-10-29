/**
 * seoMeta.ts — 검색·AI 검색용 head 정보(canonical·og·twitter), 비공개 페이지 판정, sitemap.xml 생성 (2026-10-28)
 *
 * 순수 함수만 담는다. 화면은 SeoHead.svelte가 이 값을 그리고, 루트 레이아웃은 isNoindexPath로 noindex를 넣으며,
 * /sitemap.xml 라우트는 buildSitemapXml로 응답을 만든다.
 */

import { SITE_NAME } from './pageMeta'

/** 정식 사이트 주소 — 미리보기 배포 주소가 canonical·sitemap에 새지 않도록 고정값을 쓴다 */
export const SITE_ORIGIN = 'https://crazyshot.kr'

/** 공유 카드 기본 이미지(전용 1200×630 이미지가 생기면 이 값만 바꾼다) */
export const DEFAULT_OG_IMAGE = `${SITE_ORIGIN}/app-icons/icon-512.png`

/** sitemap에 항상 넣는 공개 페이지 */
export const STATIC_SITEMAP_PATHS = ['/', '/products', '/hype-pack', '/crazylog', '/crazylog/list', '/members', '/help'] as const

/** 상대 경로·http(s) 주소만 절대 주소로. 그 밖(javascript:·data: 등)은 null */
export function toAbsoluteUrl(value: string | null | undefined): string | null {
  const v = (value ?? '').trim()
  if (!v) return null
  if (v.startsWith('//')) return `https:${v}`
  if (/^https?:\/\//i.test(v)) return v
  if (v.startsWith('/')) return `${SITE_ORIGIN}${v}`
  return null
}

/** canonical 주소 — 사이트 주소 + 경로(쿼리·해시·끝 슬래시 제거, 한글 등은 인코딩) */
export function buildCanonicalUrl(path: string): string {
  const clean = (path ?? '').split('#')[0].split('?')[0].trim()
  const withSlash = clean.startsWith('/') ? clean : `/${clean}`
  const trimmed = withSlash.length > 1 ? withSlash.replace(/\/+$/, '') : withSlash
  const encoded = trimmed
    .split('/')
    .map((seg) => {
      try {
        return encodeURIComponent(decodeURIComponent(seg))
      } catch {
        return encodeURIComponent(seg)
      }
    })
    .join('/')
  return `${SITE_ORIGIN}${encoded === '' ? '/' : encoded}`
}

export interface SeoTagsInput {
  title: string
  description: string
  path: string
  /** 공유 카드 이미지 — 없거나 안전하지 않으면 기본 앱 로고 */
  image?: string | null
  type?: string
}

export interface SeoTags {
  canonical: string
  og: Record<string, string>
  twitter: Record<string, string>
}

export function buildSeoTags(input: SeoTagsInput): SeoTags {
  const canonical = buildCanonicalUrl(input.path)
  const own = toAbsoluteUrl(input.image)
  const image = own ?? DEFAULT_OG_IMAGE
  return {
    canonical,
    og: {
      title: input.title,
      description: input.description,
      type: input.type ?? 'website',
      url: canonical,
      site_name: SITE_NAME,
      locale: 'ko_KR',
      image,
    },
    twitter: {
      card: own ? 'summary_large_image' : 'summary',
      title: input.title,
      description: input.description,
      image,
    },
  }
}

/** 검색 결과에 나오면 안 되는 비공개·거래·내부 경로(첫 구간 또는 두 구간 접두어) */
const NOINDEX_PREFIXES = [
  '/account', '/auth', '/cart', '/chat', '/checkout', '/payment', '/pay', '/contract', '/subscribe', '/qr',
  '/issue-report', '/cms', '/dev-e2e', '/products/search', '/crazylog/new',
] as const

/** 경로 구간 단위로 비교 — '/pay'가 '/payments-info'를 잡지 않는다. /contract-verify는 자체 noindex가 있어 제외 */
export function isNoindexPath(pathname: string): boolean {
  const p = (pathname ?? '').split('?')[0].replace(/\/+$/, '') || '/'
  return NOINDEX_PREFIXES.some((prefix) => p === prefix || p.startsWith(`${prefix}/`))
}

export interface SitemapEntry {
  path: string
  lastmod?: string | null
}

const SITEMAP_MAX_URLS = 50_000

function xmlEscape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function toLastmod(value: string | null | undefined): string | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** sitemap.xml 본문 — 같은 주소는 한 번만, 5만 개 상한(프로토콜 한도) */
export function buildSitemapXml(entries: readonly SitemapEntry[]): string {
  const seen = new Set<string>()
  const urls: string[] = []
  for (const e of entries) {
    if (urls.length >= SITEMAP_MAX_URLS) break
    const loc = buildCanonicalUrl(e.path)
    if (seen.has(loc)) continue
    seen.add(loc)
    const lastmod = toLastmod(e.lastmod)
    urls.push(`  <url><loc>${xmlEscape(loc)}</loc>${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`)
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`
}
