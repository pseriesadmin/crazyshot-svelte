// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * SubGnb 뒤로가기 — backHref 지정 시 history가 아니라 지정 주소로 이동 (2026-10-02)
 *
 * 회귀 배경: 상담톡 카드로 새 탭에서 연 /account/rental의 "마이페이지"(goto 푸시)와 /account의 뒤로가기(history.back)가
 * 서로를 가리켜 홈으로 나갈 수 없는 무한 순환이 생겼다. 허브·목록 화면은 backHref로 명시 이동한다.
 * 실행: npm run test:component
 */

const gotoMock = vi.fn()
vi.mock('$app/navigation', () => ({ goto: (...a: unknown[]) => gotoMock(...a) }))
vi.mock('$lib/components/common/MobileMoreMenu.svelte', () => ({ default: () => {} }))

const { default: SubGnb } = await import('$lib/components/common/SubGnb.svelte')

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null

beforeEach(() => {
  gotoMock.mockReset()
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(() => { if (app) unmount(app); app = null; target.remove(); vi.restoreAllMocks() })

function click(selector: string) {
  ;(target.querySelector(selector) as HTMLElement).click()
  flushSync()
}

describe.skipIf(!process.env.CS_COMPONENT_TEST)('SubGnb 뒤로가기', () => {
  it('backHref+backReplace: PC 알약 → goto(주소, { replaceState: true })', () => {
    app = mount(SubGnb, { target, props: { title: '대여', noGnbOffset: true, backHref: '/account', backReplace: true } })
    click('.pc-pill')
    expect(gotoMock).toHaveBeenCalledWith('/account', { replaceState: true })
  })

  it('backHref+backReplace: 모바일 뒤로가기 버튼도 같은 동작', () => {
    app = mount(SubGnb, { target, props: { title: '대여', backHref: '/account', backReplace: true } })
    click('.back-btn')
    expect(gotoMock).toHaveBeenCalledWith('/account', { replaceState: true })
  })

  it('backHref만 지정: 기록 교체 없이 이동(replaceState false)', () => {
    app = mount(SubGnb, { target, props: { title: '내정보', backHref: '/' } })
    click('.pc-pill')
    expect(gotoMock).toHaveBeenCalledWith('/', { replaceState: false })
  })

  it('backHref 없음: 기존 동작 유지 — 기록이 있으면 history.back, 없으면 /products', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => {})
    app = mount(SubGnb, { target, props: { title: '상품' } })
    vi.spyOn(window.history, 'length', 'get').mockReturnValue(3)
    click('.pc-pill')
    expect(back).toHaveBeenCalledTimes(1)
    expect(gotoMock).not.toHaveBeenCalled()

    vi.spyOn(window.history, 'length', 'get').mockReturnValue(1)
    click('.pc-pill')
    expect(gotoMock).toHaveBeenCalledWith('/products')
  })
})
