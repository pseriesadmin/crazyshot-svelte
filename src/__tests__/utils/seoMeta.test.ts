import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_OG_IMAGE,
  SITE_ORIGIN,
  STATIC_SITEMAP_PATHS,
  buildCanonicalUrl,
  buildSeoTags,
  buildSitemapXml,
  isNoindexPath,
  toAbsoluteUrl,
} from '$lib/utils/seoMeta'

// 검색·AI 추천용 head 보완 2단계 (2026-10-28) — canonical·og·twitter, robots.txt, sitemap.xml, 비공개 페이지 noindex.

const read = (p: string): string => readFileSync(p, 'utf-8')

describe('toAbsoluteUrl', () => {
  it('상대 경로는 사이트 주소를 붙이고, 절대 주소는 그대로 둔다', () => {
    expect(toAbsoluteUrl('/app-icons/icon-512.png')).toBe(`${SITE_ORIGIN}/app-icons/icon-512.png`)
    expect(toAbsoluteUrl('https://cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
    expect(toAbsoluteUrl('//cdn.example.com/a.png')).toBe('https://cdn.example.com/a.png')
  })
  it('비었거나 http(s)·상대 경로가 아니면 null (javascript:·data: 차단)', () => {
    for (const bad of ['', '   ', null, undefined, 'javascript:alert(1)', 'data:image/png;base64,AAA', 'ftp://x/a.png', 'a.png']) {
      expect(toAbsoluteUrl(bad as string | null | undefined)).toBeNull()
    }
  })
})

describe('buildCanonicalUrl', () => {
  it('사이트 주소 + 경로, 쿼리·해시는 제거', () => {
    expect(buildCanonicalUrl('/products?page=2#top')).toBe(`${SITE_ORIGIN}/products`)
  })
  it('홈은 루트, 끝 슬래시는 제거, 앞 슬래시가 없으면 붙인다', () => {
    expect(buildCanonicalUrl('/')).toBe(`${SITE_ORIGIN}/`)
    expect(buildCanonicalUrl('')).toBe(`${SITE_ORIGIN}/`)
    expect(buildCanonicalUrl('products/')).toBe(`${SITE_ORIGIN}/products`)
  })
  it('한글·특수문자는 주소로 인코딩한다', () => {
    expect(buildCanonicalUrl('/products/가 나')).toBe(`${SITE_ORIGIN}/products/%EA%B0%80%20%EB%82%98`)
  })
})

describe('buildSeoTags', () => {
  const tags = buildSeoTags({ title: '상품 전체보기 — CRAZYSHOT', description: '설명', path: '/products' })
  it('canonical과 og:url은 같은 주소', () => {
    expect(tags.canonical).toBe(`${SITE_ORIGIN}/products`)
    expect(tags.og['url']).toBe(tags.canonical)
  })
  it('og 기본값: 제목·설명·사이트 이름·한국어·타입', () => {
    expect(tags.og).toMatchObject({
      title: '상품 전체보기 — CRAZYSHOT',
      description: '설명',
      site_name: 'CRAZYSHOT',
      locale: 'ko_KR',
      type: 'website',
      image: DEFAULT_OG_IMAGE,
    })
  })
  it('이미지를 안 주면 기본 앱 로고 + 작은 카드(summary)', () => {
    expect(tags.twitter['card']).toBe('summary')
    expect(tags.twitter['image']).toBe(DEFAULT_OG_IMAGE)
  })
  it('상품 이미지를 주면 큰 카드(summary_large_image)이고 상대 주소는 절대 주소로', () => {
    const t = buildSeoTags({ title: 'T', description: 'D', path: '/products/x', image: '/sample/p.png' })
    expect(t.og['image']).toBe(`${SITE_ORIGIN}/sample/p.png`)
    expect(t.twitter['card']).toBe('summary_large_image')
    const abs = buildSeoTags({ title: 'T', description: 'D', path: '/p', image: 'https://img.example.com/a.webp' })
    expect(abs.og['image']).toBe('https://img.example.com/a.webp')
  })
  it('안전하지 않은 이미지 값은 기본 로고로 되돌린다', () => {
    const t = buildSeoTags({ title: 'T', description: 'D', path: '/p', image: 'javascript:alert(1)' })
    expect(t.og['image']).toBe(DEFAULT_OG_IMAGE)
    expect(t.twitter['card']).toBe('summary')
  })
  it('twitter는 제목·설명·이미지를 같은 값으로', () => {
    expect(tags.twitter).toMatchObject({ title: '상품 전체보기 — CRAZYSHOT', description: '설명' })
  })
})

describe('isNoindexPath — 비공개·거래·내부 페이지', () => {
  it('로그인·장바구니·마이페이지·결제·계약·구독·CMS·검색 결과 등은 색인 제외', () => {
    for (const p of [
      '/account', '/account/rental/12', '/auth/login', '/cart', '/chat', '/checkout/pay/1', '/payment/success',
      '/pay/late-fee/3', '/contract/abc', '/subscribe/plan1', '/qr/x', '/issue-report', '/cms/products', '/dev-e2e/editors',
      '/products/search', '/crazylog/new',
    ]) {
      expect(isNoindexPath(p), p).toBe(true)
    }
  })
  it('공개 페이지는 색인 대상', () => {
    for (const p of ['/', '/products', '/products/sony-np-f770-2609', '/hype-pack', '/hype-pack/theme/1', '/crazylog', '/crazylog/list', '/crazylog/view/abc', '/members', '/help']) {
      expect(isNoindexPath(p), p).toBe(false)
    }
  })
  it('접두어가 비슷한 다른 경로는 오인하지 않는다 (/pay ≠ /payments-info, /cart ≠ /carts-guide)', () => {
    expect(isNoindexPath('/payments-info')).toBe(false)
    expect(isNoindexPath('/carts-guide')).toBe(false)
    expect(isNoindexPath('/products/searching-guide')).toBe(false)
  })
  it('contract-verify는 자체 noindex가 있어 중복 지정하지 않는다', () => {
    expect(isNoindexPath('/contract-verify')).toBe(false)
  })
})

describe('buildSitemapXml', () => {
  it('urlset 헤더와 절대 주소 loc', () => {
    const xml = buildSitemapXml([{ path: '/' }, { path: '/products' }])
    expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true)
    expect(xml).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">')
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/</loc>`)
    expect(xml).toContain(`<loc>${SITE_ORIGIN}/products</loc>`)
  })
  it('주소의 &·< 같은 문자는 주소 인코딩(%26·%3C)되어 XML을 깨지 않는다', () => {
    const xml = buildSitemapXml([{ path: '/products/a&b<c' }])
    expect(xml).toContain('a%26b%3Cc')
    expect(xml).not.toMatch(/a&b|<c/)
  })
  it('lastmod는 유효한 날짜일 때만 YYYY-MM-DD로', () => {
    const xml = buildSitemapXml([
      { path: '/a', lastmod: '2026-10-27T09:30:00.000Z' },
      { path: '/b', lastmod: 'not a date' },
      { path: '/c', lastmod: null },
    ])
    expect(xml).toContain('<lastmod>2026-10-27</lastmod>')
    expect((xml.match(/<lastmod>/g) ?? []).length).toBe(1)
  })
  it('같은 주소는 한 번만, 5만 개 상한', () => {
    expect((buildSitemapXml([{ path: '/a' }, { path: '/a/' }, { path: '/a?x=1' }]).match(/<url>/g) ?? []).length).toBe(1)
    const many = Array.from({ length: 50_005 }, (_, i) => ({ path: `/p/${i}` }))
    expect((buildSitemapXml(many).match(/<url>/g) ?? []).length).toBe(50_000)
  })
  it('고정 페이지 목록은 공개 페이지만(로그인·장바구니 등 비공개 제외)', () => {
    expect(STATIC_SITEMAP_PATHS).toContain('/')
    expect(STATIC_SITEMAP_PATHS).toContain('/products')
    for (const p of STATIC_SITEMAP_PATHS) expect(isNoindexPath(p), p).toBe(false)
  })
})

describe('static/robots.txt', () => {
  const robots = read('static/robots.txt')
  it('모든 크롤러(AI 검색 포함)에게 공개 페이지는 허용 — 전체 차단(Disallow: /)이 아니다', () => {
    expect(robots).toMatch(/^User-agent: \*$/m)
    expect(robots).not.toMatch(/^Disallow:\s*\/\s*$/m)
    expect(robots).not.toMatch(/^Disallow:\s*\/products\/?\s*$/m)
  })
  it('비공개·거래·내부 경로는 차단', () => {
    for (const p of ['/cms/', '/api/', '/account/', '/auth/', '/cart', '/checkout', '/payment', '/pay/', '/contract/', '/chat', '/subscribe/', '/crazylog/new', '/dev-e2e/']) {
      expect(robots, p).toMatch(new RegExp(`^Disallow: ${p.replace(/[/]/g, '\\/')}\\s*$`, 'm'))
    }
  })
  describe('검색 결과 페이지(/products/search)만 정확히 차단 — slug가 search로 시작하는 상품은 막지 않는다', () => {
    // 구글식 규칙 해석(접두 일치, * 와일드카드, 끝의 $ 는 URL 끝 고정)으로 주소(경로+쿼리)가 Disallow에 걸리는지 판정
    const rules = Array.from(robots.matchAll(/^Disallow:\s*(\S+)\s*$/gm), (m) => m[1])
    const blocked = (url: string): boolean =>
      rules.some((rule) => {
        const anchored = rule.endsWith('$')
        const body = (anchored ? rule.slice(0, -1) : rule).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
        return new RegExp(`^${body}${anchored ? '$' : ''}`).test(url)
      })
    it('검색 결과 페이지는 차단 — 쿼리가 있어도·없어도·하위 경로도', () => {
      for (const u of ['/products/search', '/products/search?q=소니', '/products/search?q=a&page=2', '/products/search/x']) {
        expect(blocked(u), u).toBe(true)
      }
    })
    it('slug가 search로 시작하는 상품·비슷한 공개 경로는 차단하지 않는다', () => {
      for (const u of ['/products/search-lens-2610', '/products/searching-guide', '/products/sony-np-f770', '/products', '/products?category=1']) {
        expect(blocked(u), u).toBe(false)
      }
    })
    it('접두 일치로 넓게 막는 단독 `Disallow: /products/search` 줄이 없다', () => {
      expect(rules).not.toContain('/products/search')
    })
  })
  it('sitemap 주소를 알려준다', () => {
    expect(robots).toContain(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`)
  })
})

describe('배선 (소스 고정)', () => {
  it('홈·상품목록·상품상세는 SeoHead(canonical·og·twitter)를 쓴다', () => {
    for (const f of ['src/routes/+page.svelte', 'src/routes/products/+page.svelte', 'src/routes/products/[id]/+page.svelte']) {
      const src = read(f)
      expect(src, f).toContain("import SeoHead from '$lib/components/common/SeoHead.svelte'")
      expect(src, f).toMatch(/<SeoHead\b/)
    }
    const detail = read('src/routes/products/[id]/+page.svelte')
    expect(detail).toContain('path={`/products/${product.slug ?? product.id}`}')
    expect(detail).toMatch(/<SeoHead[^>]*image=\{imageUrls\[0\]/)
  })
  it('SeoHead는 canonical·og:*·twitter:*를 head에 그린다', () => {
    const c = read('src/lib/components/common/SeoHead.svelte')
    expect(c).toContain('<svelte:head>')
    expect(c).toContain('rel="canonical"')
    expect(c).toContain('property={`og:${')
    expect(c).toContain('name={`twitter:${')
  })
  it('루트 레이아웃은 비공개 경로에 robots noindex를 넣는다', () => {
    const layout = read('src/routes/+layout.svelte')
    expect(layout).toContain("import { isNoindexPath } from '$lib/utils/seoMeta'")
    expect(layout).toContain('<meta name="robots" content="noindex, nofollow" />')
    expect(layout).toContain('isNoindexPath(page.url.pathname)')
  })
})
