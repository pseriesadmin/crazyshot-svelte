// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import { readFileSync } from 'node:fs'

// 상품 상세 모바일 히어로 — 좌우 스와이프 + 하단 점 연동 (2026-10-29)
// 모바일(≤640px)은 이미지를 한 줄로 나열해 한 장씩 멈추며 넘기고(cover·세로 800px 유지), 점이 스와이프를 따라가며 점을 누르면 해당 이미지로 이동한다.
// 실행: npm run test:component

vi.mock('$app/navigation', () => ({ goto: vi.fn() }))
vi.mock('$lib/components/common/SubGnb.svelte', () => ({ default: () => {} }))

import ProductHero, { slideIndexFromScroll } from '$lib/components/products/ProductHero.svelte'

const SRC = readFileSync('src/lib/components/products/ProductHero.svelte', 'utf-8')
const URLS = ['https://img.example.com/a.webp', 'https://img.example.com/b.webp', 'https://img.example.com/c.webp']
const WIDTH = 375

let cmp: Record<string, unknown> | null = null
let scrollTo: ReturnType<typeof vi.fn>

beforeEach(() => {
  scrollTo = vi.fn()
  // jsdom은 요소 scrollTo를 구현하지 않는다
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, writable: true, value: scrollTo })
})
afterEach(() => {
  if (cmp) unmount(cmp)
  cmp = null
  document.body.innerHTML = ''
})

function render(imageUrls: string[] = URLS) {
  cmp = mount(ProductHero, { target: document.body, props: { imageUrls, productName: '소니 FX3', category: 'camera', categoryLabel: '카메라', categories: [] } })
  flushSync()
  const track = document.body.querySelector<HTMLElement>('.hero-track')
  if (track) Object.defineProperty(track, 'clientWidth', { configurable: true, value: WIDTH })
  return track
}
const dots = (): HTMLButtonElement[] => Array.from(document.body.querySelectorAll<HTMLButtonElement>('.dots-mobile .dot'))
const activeDot = (): number => dots().findIndex((d) => d.classList.contains('dot-active'))

function scrollTrackTo(track: HTMLElement, left: number): void {
  track.scrollLeft = left
  track.dispatchEvent(new Event('scroll'))
  flushSync()
}

describe('slideIndexFromScroll — 스크롤 위치 → 이미지 번호', () => {
  it('한 장 폭 단위로 가장 가까운 이미지(반올림)', () => {
    expect(slideIndexFromScroll(0, 375, 3)).toBe(0)
    expect(slideIndexFromScroll(375, 375, 3)).toBe(1)
    expect(slideIndexFromScroll(180, 375, 3)).toBe(0)
    expect(slideIndexFromScroll(190, 375, 3)).toBe(1)
    expect(slideIndexFromScroll(750, 375, 3)).toBe(2)
  })
  it('범위를 넘으면 처음·끝 이미지로 고정', () => {
    expect(slideIndexFromScroll(9999, 375, 3)).toBe(2)
    expect(slideIndexFromScroll(-50, 375, 3)).toBe(0)
  })
  it('폭이 0이거나 이미지가 없거나 숫자가 아니면 0', () => {
    expect(slideIndexFromScroll(100, 0, 3)).toBe(0)
    expect(slideIndexFromScroll(100, 375, 0)).toBe(0)
    expect(slideIndexFromScroll(Number.NaN, 375, 3)).toBe(0)
    expect(slideIndexFromScroll(100, Number.NaN, 3)).toBe(0)
  })
})

describe('모바일 슬라이드 트랙 — 렌더', () => {
  it('이미지마다 한 칸씩, alt에 상품명과 번호, 둘째 장부터는 지연 로딩', () => {
    const track = render()
    expect(track).not.toBeNull()
    const imgs = Array.from(track!.querySelectorAll<HTMLImageElement>('.hero-slide img'))
    expect(imgs).toHaveLength(3)
    expect(imgs[0].getAttribute('alt')).toBe('소니 FX3 이미지 1')
    expect(imgs[2].getAttribute('alt')).toBe('소니 FX3 이미지 3')
    expect(imgs[1].getAttribute('src')).toBe(URLS[1])
    expect(imgs[2].getAttribute('src')).toBe(URLS[2])
    expect(imgs[1].getAttribute('loading')).toBe('lazy')
    expect(imgs[2].getAttribute('loading')).toBe('lazy')
  })
  it('첫 장은 모바일(≤640px)에서만 이미지를 요청한다 — PC는 숨겨진 트랙이 같은 이미지를 한 번 더 받지 않도록 <picture> 조건부 소스 + 투명 대체 이미지', () => {
    const track = render()!
    const first = track.querySelector('.hero-slide')!
    const source = first.querySelector('picture > source')
    expect(source).not.toBeNull()
    expect(source!.getAttribute('media')).toBe('(max-width: 640px)')
    expect(source!.getAttribute('srcset')).toBe(URLS[0])
    const img = first.querySelector<HTMLImageElement>('picture > img')!
    expect(img.getAttribute('src')).toMatch(/^data:image\/gif;base64,/)
    expect(img.getAttribute('src')).not.toContain(URLS[0])
    expect(img.getAttribute('alt')).toBe('소니 FX3 이미지 1')
    // 둘째 장부터는 <picture> 없이 지연 로딩 <img>
    expect(track.querySelectorAll('.hero-slide picture')).toHaveLength(1)
  })
  it('이미지가 없으면 슬라이드·점이 없다', () => {
    const track = render([])
    expect(track?.querySelectorAll('.hero-slide').length ?? 0).toBe(0)
    expect(dots()).toHaveLength(0)
  })
  it('점은 이미지 수만큼, 처음엔 첫 번째가 활성', () => {
    render()
    expect(dots()).toHaveLength(3)
    expect(activeDot()).toBe(0)
  })
})

describe('스와이프 → 점 연동', () => {
  it('스크롤하면 해당 번호의 점이 활성', () => {
    const track = render()!
    scrollTrackTo(track, WIDTH)
    expect(activeDot()).toBe(1)
    scrollTrackTo(track, WIDTH * 2)
    expect(activeDot()).toBe(2)
    scrollTrackTo(track, 0)
    expect(activeDot()).toBe(0)
  })
  it('반쯤 넘어가기 전에는 점이 바뀌지 않는다', () => {
    const track = render()!
    scrollTrackTo(track, 100)
    expect(activeDot()).toBe(0)
  })
})

describe('점 → 이미지 이동', () => {
  it('점을 누르면 그 이미지 위치로 부드럽게 이동하고 점이 활성', () => {
    render()
    dots()[2].click()
    flushSync()
    expect(activeDot()).toBe(2)
    expect(scrollTo).toHaveBeenCalledTimes(1)
    expect(scrollTo).toHaveBeenCalledWith({ left: WIDTH * 2, behavior: 'smooth' })
  })
  it('이동 중 지나가는 칸 때문에 점이 깜빡이지 않고, 도착하면 다시 스와이프를 따라간다', () => {
    const track = render()!
    dots()[2].click()
    flushSync()
    scrollTrackTo(track, WIDTH)
    expect(activeDot()).toBe(2)
    scrollTrackTo(track, WIDTH * 2)
    expect(activeDot()).toBe(2)
    scrollTrackTo(track, WIDTH)
    expect(activeDot()).toBe(1)
  })
  it('이동 중이라도 사용자가 손으로 잡으면 즉시 스와이프를 따라간다', () => {
    const track = render()!
    dots()[2].click()
    flushSync()
    track.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    scrollTrackTo(track, WIDTH)
    expect(activeDot()).toBe(1)
  })
  it('이미 보고 있는 이미지의 점을 눌러도 불필요하게 스크롤하지 않는다', () => {
    const track = render()!
    scrollTrackTo(track, WIDTH)
    scrollTo.mockClear()
    dots()[1].click()
    flushSync()
    expect(scrollTo).not.toHaveBeenCalled()
  })
})

describe('PC 동작 유지 — 썸네일 선택은 큰 이미지 배경을 바꾼다', () => {
  it('썸네일을 누르면 hero-bg 배경이 해당 이미지로', () => {
    render()
    const bg = document.body.querySelector<HTMLElement>('.hero-bg')!
    expect(bg.getAttribute('style')).toContain(URLS[0])
    document.body.querySelectorAll<HTMLButtonElement>('.thumbs-pc .thumb')[1].click()
    flushSync()
    expect(bg.getAttribute('style')).toContain(URLS[1])
  })
})

describe('CSS 고정 (소스)', () => {
  it('세로 800px·PC 1000px·cover·기준점은 그대로', () => {
    expect(SRC).toMatch(/\.hero-wrap\s*\{[^}]*height:\s*800px/)
    expect(SRC).toMatch(/\.hero-wrap\s*\{\s*height:\s*1000px/)
    expect(SRC).toMatch(/\.hero-bg\s*\{[^}]*background-size:\s*cover/)
    expect(SRC).toMatch(/\.hero-bg\s*\{[^}]*background-position:\s*center 20%/)
  })
  it('트랙은 한 장씩 멈추는 가로 스크롤(스냅)이고 이미지는 cover', () => {
    expect(SRC).toMatch(/\.hero-track\s*\{[^}]*overflow-x:\s*auto/)
    expect(SRC).toMatch(/\.hero-track\s*\{[^}]*scroll-snap-type:\s*x mandatory/)
    expect(SRC).toMatch(/\.hero-slide\s*\{[^}]*flex:\s*0 0 100%/)
    expect(SRC).toMatch(/\.hero-slide\s*\{[^}]*scroll-snap-align:\s*center/)
    expect(SRC).toMatch(/\.hero-slide img\s*\{[^}]*object-fit:\s*cover/)
    expect(SRC).toMatch(/\.hero-slide img\s*\{[^}]*object-position:\s*center 20%/)
  })
  it('트랙은 모바일(≤640px)에서만 보이고 PC(≥641px)에서는 숨긴다', () => {
    expect(SRC).toMatch(/\.hero-track\s*\{[^}]*display:\s*none/)
    expect(SRC).toMatch(/@media \(max-width: 640px\)\s*\{[\s\S]*?\.hero-track\s*\{\s*display:\s*flex/)
    // 모바일은 트랙이 이미지를 그리므로 단일 배경(hero-bg)은 숨긴다
    expect(SRC).toMatch(/@media \(max-width: 640px\)\s*\{[\s\S]*?\.hero-bg\s*\{\s*display:\s*none/)
  })
  it('하단 영역이 스와이프를 막지 않는다 — 모바일에서 점 버튼만 눌림', () => {
    expect(SRC).toMatch(/@media \(max-width: 640px\)\s*\{[\s\S]*?\.hero-bottom\s*\{\s*pointer-events:\s*none/)
    expect(SRC).toMatch(/\.dot\s*\{[^}]*pointer-events:\s*auto/)
  })
  it('점 터치 영역 44px·하드코딩 색 신규 추가 없음(슬라이드 배경은 토큰)', () => {
    expect(SRC).toMatch(/\.dot\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
    expect(SRC).toMatch(/\.hero-slide\s*\{[^}]*background:\s*var\(--cs-purple-op10\)/)
  })
})

// '이미지 전체 보기' 전환 버튼 (2026-10-29) — 기본은 cover(꽉 채움), 누르면 세로 800px는 유지한 채 이미지를 줄여 전체를 보여준다.
// 아이콘·버튼 모양은 이미지 뷰어(MediaViewer.svelte)의 '크기 맞춤' 버튼(.mv-btn)을 그대로 응용한다.
// 버튼 아이콘은 "누르면 일어날 일"을 보여준다 — 꽉 찬(확대) 상태에서는 줄이는 아이콘(화살촉 안쪽), 줄어든(축소) 상태에서는 이미지 뷰어 '크기 맞춤' 아이콘(화살촉 바깥쪽)
const VIEWER_FIT_ICON_PATH = 'M10.5 3H15v4.5M7.5 15H3v-4.5M15 3l-4.8 4.8M3 15l4.8-4.8'
const INVERTED_ICON_PATH = 'M15 7.5h-4.5V3M3 10.5h4.5V15M10.5 7.5L15 3M7.5 10.5L3 15'
const iconPath = (): string | null | undefined => toggle()?.querySelector('svg path')?.getAttribute('d')
const toggle = (): HTMLButtonElement | null => document.body.querySelector<HTMLButtonElement>('.fit-toggle')

describe('이미지 전체 보기 전환 버튼', () => {
  it('처음(확대·꽉 찬 상태)에는 줄이는 아이콘(화살촉 안쪽), 이름표는 "이미지 전체 보기"', () => {
    render()
    const btn = toggle()!
    expect(btn).not.toBeNull()
    expect(btn.getAttribute('aria-label')).toBe('이미지 전체 보기')
    expect(btn.getAttribute('title')).toBe('이미지 전체 보기')
    expect(iconPath()).toBe(INVERTED_ICON_PATH)
    expect(btn.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true')
  })
  it('켜면(축소 상태) 이미지 뷰어 크기 맞춤과 같은 늘리는 아이콘(화살촉 바깥쪽)과 이름표 "이미지 꽉 채워 보기"로 바뀌고, 끄면 원래대로 돌아온다', () => {
    render()
    toggle()!.click()
    flushSync()
    expect(iconPath()).toBe(VIEWER_FIT_ICON_PATH)
    expect(toggle()!.getAttribute('aria-label')).toBe('이미지 꽉 채워 보기')
    expect(toggle()!.getAttribute('title')).toBe('이미지 꽉 채워 보기')
    toggle()!.click()
    flushSync()
    expect(iconPath()).toBe(INVERTED_ICON_PATH)
    expect(toggle()!.getAttribute('aria-label')).toBe('이미지 전체 보기')
  })
  it('이름표가 상태에 따라 바뀌므로 aria-pressed는 쓰지 않는다(이중 안내 방지)', () => {
    render()
    expect(toggle()!.hasAttribute('aria-pressed')).toBe(false)
    toggle()!.click()
    flushSync()
    expect(toggle()!.hasAttribute('aria-pressed')).toBe(false)
  })
  it('이미지가 없으면 버튼도 없다', () => {
    render([])
    expect(toggle()).toBeNull()
  })
  it('처음에는 꽉 채움(cover) 상태', () => {
    const track = render()!
    expect(track.classList.contains('fit-all')).toBe(false)
    expect(toggle()!.classList.contains('active')).toBe(false)
  })
  it('누르면 전체 보기 상태, 다시 누르면 꽉 채움으로 돌아온다', () => {
    const track = render()!
    toggle()!.click()
    flushSync()
    expect(track.classList.contains('fit-all')).toBe(true)
    expect(toggle()!.classList.contains('active')).toBe(true)
    toggle()!.click()
    flushSync()
    expect(track.classList.contains('fit-all')).toBe(false)
    expect(toggle()!.classList.contains('active')).toBe(false)
  })
  it('전체 보기 상태에서도 스와이프와 점 연동은 그대로', () => {
    const track = render()!
    toggle()!.click()
    flushSync()
    scrollTrackTo(track, WIDTH * 2)
    expect(activeDot()).toBe(2)
    dots()[0].click()
    flushSync()
    expect(scrollTo).toHaveBeenCalledWith({ left: 0, behavior: 'smooth' })
  })
  it('모든 이미지에 공통 적용 — 슬라이드는 같은 트랙 안에 있다', () => {
    const track = render()!
    toggle()!.click()
    flushSync()
    expect(track.querySelectorAll('.hero-slide img')).toHaveLength(3)
    expect(track.classList.contains('fit-all')).toBe(true)
  })
})

describe('전환 버튼 CSS 고정 (소스)', () => {
  it('44px 원형, 옅은 그레이 면(--cs-text-light 30%)은 켜짐에서도 그대로 — 평소·켜짐 모두 흰 아이콘', () => {
    expect(SRC).toMatch(/\.fit-toggle\s*\{[^}]*width:\s*44px[^}]*height:\s*44px/s)
    expect(SRC).toMatch(/\.fit-toggle\s*\{[^}]*border-radius:\s*50%/)
    expect(SRC).toMatch(/\.fit-toggle\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--cs-text-light\)\s*30%,\s*transparent\)/)
    expect(SRC).toMatch(/\.fit-toggle\s*\{[^}]*color:\s*var\(--cs-white\)/)
    expect(SRC).toMatch(/\.fit-toggle\.active\s*\{[^}]*color:\s*var\(--cs-white\)/)
    // 켜짐 상태도 배경은 같은 옅은 그레이 — 흰색(0.9 등)으로 바꾸지 않고, 켜짐에서도 호버 배경이 먹도록 배경을 덮어쓰지 않는다
    const active = SRC.slice(SRC.indexOf('.fit-toggle.active {'), SRC.indexOf('}', SRC.indexOf('.fit-toggle.active {')))
    expect(active).not.toMatch(/background/)
    expect(SRC).not.toMatch(/\.fit-toggle[^{]*\{[^}]*rgba\(255,\s*255,\s*255,\s*0\.9\)/)
  })
  it('호버는 배경색만 바꾼다 — 테두리·outline·그림자 없음', () => {
    expect(SRC).toMatch(/\.fit-toggle:hover\s*\{[^}]*background:\s*color-mix\(in srgb,\s*var\(--cs-text-light\)\s*50%,\s*transparent\)/)
    const block = SRC.slice(SRC.indexOf('.fit-toggle {'), SRC.indexOf('.fit-toggle.active'))
    expect(block).not.toMatch(/box-shadow|outline\s*:\s*(?!none)\S|border\s*:\s*(?!none)\S/)
    expect(block).toMatch(/border:\s*none/)
  })
  it('모바일 전용(PC에서는 숨김), 하단 영역이 막혀 있어도 눌린다, 왼쪽 아래 배치', () => {
    expect(SRC).toMatch(/\.fit-toggle\s*\{[^}]*pointer-events:\s*auto/)
    expect(SRC).toMatch(/\.fit-toggle\s*\{[^}]*position:\s*absolute[^}]*left:\s*25px/s)
    expect(SRC).toMatch(/@media \(min-width: 641px\)\s*\{[^}]*\.fit-toggle\s*\{\s*display:\s*none/)
  })
  it('전체 보기 상태에서 이미지는 contain(가운데), 세로 800px는 그대로', () => {
    expect(SRC).toMatch(/\.hero-track\.fit-all \.hero-slide img\s*\{[^}]*object-fit:\s*contain/)
    expect(SRC).toMatch(/\.hero-track\.fit-all \.hero-slide img\s*\{[^}]*object-position:\s*center/)
    expect(SRC).toMatch(/\.hero-wrap\s*\{[^}]*height:\s*800px/)
  })
})

describe('첫 장 <picture> CSS 고정 (소스)', () => {
  it('picture는 레이아웃에 끼지 않아 img가 슬라이드를 그대로 채운다', () => {
    expect(SRC).toMatch(/\.hero-slide picture\s*\{[^}]*display:\s*contents/)
  })
})
