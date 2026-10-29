import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  HOME_META_DESCRIPTION,
  PRODUCT_FALLBACK_DESCRIPTION,
  PRODUCTS_META_DESCRIPTION,
  buildPageTitle,
  buildProductMetaDescription,
  truncateMeta,
} from '$lib/utils/pageMeta'

// 검색·AI 추천용 페이지 head 보완 1단계 (2026-10-27) — app.html의 고정 title·description 제거(중복·전 페이지 동일 문제),
// lang=ko, 홈·상품목록·상품상세 페이지별 description, title이 없던 페이지 title 보강.

const read = (p: string): string => readFileSync(p, 'utf-8')
const count = (src: string, re: RegExp): number => (src.match(re) ?? []).length

describe('truncateMeta', () => {
  it('공백·줄바꿈을 한 칸으로 정리하고 앞뒤를 자른다', () => {
    expect(truncateMeta('  a\n b\t c  ', 100)).toBe('a b c')
  })
  it('길면 max 글자 안에서 … 로 줄인다', () => {
    const out = truncateMeta('가'.repeat(200), 155)
    expect(out.length).toBe(155)
    expect(out.endsWith('…')).toBe(true)
  })
  it('짧으면 그대로', () => {
    expect(truncateMeta('짧은 문장', 155)).toBe('짧은 문장')
  })
  it('이모지(서로게이트 쌍)를 경계에서 쪼개지 않는다 — 글자 수는 문자(코드포인트) 기준', () => {
    const lone = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
    for (const max of [10, 11, 12, 155]) {
      const out = truncateMeta('😀'.repeat(200), max)
      expect(lone.test(out), `max=${max}`).toBe(false)
      expect(Array.from(out).length).toBeLessThanOrEqual(max)
      expect(out.endsWith('…')).toBe(true)
    }
    // 이모지가 섞인 문장도 마찬가지
    const mixed = truncateMeta(`가나다${'😀'.repeat(100)}`, 8)
    expect(lone.test(mixed)).toBe(false)
    expect(mixed).toBe('가나다😀😀😀😀…')
  })
  it('이모지만 있어도 max 안에 들어오면 자르지 않는다', () => {
    expect(truncateMeta('😀😀😀', 3)).toBe('😀😀😀')
  })
})

describe('buildPageTitle', () => {
  it('"이름 — CRAZYSHOT" 형식', () => {
    expect(buildPageTitle('하입팩')).toBe('하입팩 — CRAZYSHOT')
    expect(buildPageTitle('테마', '하입팩')).toBe('테마 — 하입팩 — CRAZYSHOT')
  })
  it('이름이 비어 있으면 사이트 이름만', () => {
    expect(buildPageTitle('   ')).toBe('CRAZYSHOT')
    expect(buildPageTitle(null)).toBe('CRAZYSHOT')
  })
})

describe('고정 description', () => {
  it('홈·상품목록 문구는 검색에 보이기 좋은 길이(50~160자)다', () => {
    for (const d of [HOME_META_DESCRIPTION, PRODUCTS_META_DESCRIPTION, PRODUCT_FALLBACK_DESCRIPTION]) {
      expect(d.length).toBeGreaterThanOrEqual(30)
      expect(d.length).toBeLessThanOrEqual(160)
    }
    expect(HOME_META_DESCRIPTION).not.toBe(PRODUCTS_META_DESCRIPTION)
  })
  it("검증하기 어려운 최상급 표현('국내 최초' 등)을 검색 결과에 노출되는 설명에 쓰지 않는다", () => {
    for (const d of [HOME_META_DESCRIPTION, PRODUCTS_META_DESCRIPTION, PRODUCT_FALLBACK_DESCRIPTION]) {
      expect(d).not.toMatch(/국내\s*최초|업계\s*최초|세계\s*최초|최고|1위/)
    }
  })
})

describe('buildProductMetaDescription', () => {
  it('이름·분류·캡션·1일 요금을 담은 대여 설명', () => {
    expect(
      buildProductMetaDescription({ name: 'Sony NP-F770', brand: 'Sony', categoryLabel: '액세서리', caption: '5인치 모니터 배터리', priceDay: 3000 }),
    ).toBe('Sony NP-F770 — 액세서리 대여. 5인치 모니터 배터리. 1일 3,000원부터. 크레이지샷에서 비대면으로 예약하세요.')
  })

  it('이름에 브랜드가 없으면 괄호로 덧붙인다', () => {
    const d = buildProductMetaDescription({ name: 'R6 Mark III', brand: 'Canon', categoryLabel: '카메라', caption: null, priceDay: 90000 })
    expect(d).toContain('R6 Mark III (Canon) — 카메라 대여.')
  })

  it('분류·캡션·요금이 없으면 있는 정보만으로 문장을 만든다', () => {
    expect(buildProductMetaDescription({ name: 'Sony NP-F770' })).toBe('Sony NP-F770 대여. 크레이지샷에서 비대면으로 예약하세요.')
  })

  it('요금 0·음수·비숫자는 요금 문장을 넣지 않는다', () => {
    for (const priceDay of [0, -5, Number.NaN, null, undefined]) {
      expect(buildProductMetaDescription({ name: 'A', priceDay })).not.toContain('원')
    }
  })

  it('판매전용 상품은 구매 문구와 판매가를 쓴다', () => {
    expect(buildProductMetaDescription({ name: 'Instax Film', categoryLabel: 'SHOP', saleOnly: true, salePrice: 12000, priceDay: 3000 })).toBe(
      'Instax Film — SHOP 구매. 판매가 12,000원. 크레이지샷에서 구매하세요.',
    )
  })

  it('캡션의 줄바꿈·HTML 꺾쇠 문자·연속 공백은 정리하고, 전체는 155자 이내', () => {
    const d = buildProductMetaDescription({ name: 'X', caption: `줄1\n줄2   ${'가'.repeat(300)}`, priceDay: 1000 })
    expect(d).not.toMatch(/[\n\r\t]/)
    expect(d.length).toBeLessThanOrEqual(155)
    expect(d.endsWith('…')).toBe(true)
    const withTag = buildProductMetaDescription({ name: 'X', caption: '<b>굵게</b> 소개' })
    expect(withTag).not.toMatch(/[<>]/)
  })

  it('이름이 없으면 기본 문구', () => {
    expect(buildProductMetaDescription({ name: '' })).toBe(PRODUCT_FALLBACK_DESCRIPTION)
    expect(buildProductMetaDescription({ name: null })).toBe(PRODUCT_FALLBACK_DESCRIPTION)
  })
})

describe('app.html — 고정 title·description 제거, 한국어 선언', () => {
  const html = read('src/app.html')
  it('lang="ko"', () => {
    expect(html).toMatch(/<html lang="ko">/)
  })
  it('고정 <title>·description이 없다(페이지가 각자 넣는다 — 둘 다 있으면 title이 2개가 된다)', () => {
    expect(html).not.toMatch(/<title>/)
    expect(html).not.toMatch(/name="description"/)
  })
  it('나머지 head 요소(manifest·아이콘·theme-color)는 유지', () => {
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('name="theme-color"')
    expect(html).toContain('%sveltekit.head%')
  })
})

describe('페이지별 title·description 배선 (소스 고정)', () => {
  const home = read('src/routes/+page.svelte')
  const products = read('src/routes/products/+page.svelte')
  const detail = read('src/routes/products/[id]/+page.svelte')

  it('홈: title 1개 + description(HOME_META_DESCRIPTION)', () => {
    expect(count(home, /<title>/g)).toBe(1)
    expect(home).toContain('name="description" content={HOME_META_DESCRIPTION}')
  })
  it('상품 전체보기: title 1개 + description(PRODUCTS_META_DESCRIPTION)', () => {
    expect(count(products, /<title>/g)).toBe(1)
    expect(products).toContain('name="description" content={PRODUCTS_META_DESCRIPTION}')
  })
  it('상품상세: title 1개 + 상품별 description(buildProductMetaDescription)', () => {
    expect(count(detail, /<title>/g)).toBe(1)
    // product는 이미 타입이 있는 값이라 ProductRow로 억지 캐스팅하지 않는다(타입 가드 원칙)
    const block = detail.slice(detail.indexOf('const pageDescription'), detail.indexOf('</script>'))
    expect(block).not.toMatch(/as ProductRow/)
    expect(detail).toContain('name="description" content={pageDescription}')
    expect(detail).toContain('buildProductMetaDescription(')
  })

  // 대여 상세(/account/rental/[id])는 제외 — 로그인 후 비공개 화면(noindex 대상)이라 검색·AI 노출과 무관하고, 이 파일은 두발히어로 작업 커밋이 이미 반영해 title 줄이 없다
  it('title이 없던 페이지에 title을 넣는다 — 크레이지로그 상세·쓰기, 하입팩 테마 (members/profile은 영구 리다이렉트라 제외)', () => {
    const view = read('src/routes/crazylog/view/[slug]/+page.svelte')
    const write = read('src/routes/crazylog/[slug]/+page.svelte')
    const theme = read('src/routes/hype-pack/theme/[id]/+page.svelte')
    for (const src of [view, write, theme]) expect(count(src, /<title>/g)).toBe(1)
    // 쓰기→수정 화면 전환처럼 같은 컴포넌트가 재사용돼도 제목이 따라가도록 비반응 const(ep)가 아니라 data를 head에서 직접 읽는다
    expect(write).toContain("buildPageTitle(data.existingPost ? '크레이지로그 수정' : '크레이지로그 쓰기')")
    expect(write).not.toContain('buildPageTitle(ep ?')
    expect(view).toContain("buildPageTitle(post?.title, '크레이지로그')")
    expect(theme).toContain("buildPageTitle(data.group.title, '하입팩')")
  })
})
