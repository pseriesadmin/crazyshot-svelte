import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'

/**
 * 찜 상태 화면 간 공유 (2026-11-25)
 * 한 화면에서 하트를 누르면 목록·상세·마이페이지 등 모든 화면의 하트가 서버가 준 옛 값(미리 받아 둔 데이터 포함)보다
 * 방금 누른 결과를 따라야 한다.
 */
vi.mock('$app/environment', () => ({ browser: true }))
vi.mock('$lib/stores/wishMdSheet.svelte', () => ({ openWishMdSheet: vi.fn() }))

import { resolveWished, setWishOverride } from '$lib/stores/wishState.svelte'
import { toggleWish } from '$lib/utils/wishlist'

let seq = 0
const pid = (): string => `p-${Date.now()}-${seq++}`

describe('resolveWished — 서버 값보다 방금 누른 결과가 우선', () => {
  it('기록이 없으면 서버 값을 그대로 쓴다', () => {
    const id = pid()
    expect(resolveWished(id, true)).toBe(true)
    expect(resolveWished(id, false)).toBe(false)
  })
  it('찜 기록이 있으면 서버가 "찜 아님"이어도 찜으로 보인다(hover 미리 받은 옛 데이터)', () => {
    const id = pid()
    setWishOverride(id, true)
    expect(resolveWished(id, false)).toBe(true)
  })
  it('해제 기록이 있으면 서버가 "찜"이어도 해제로 보인다', () => {
    const id = pid()
    setWishOverride(id, false)
    expect(resolveWished(id, true)).toBe(false)
  })
  it('id가 없으면 서버 값을 돌려준다', () => {
    expect(resolveWished(undefined, true)).toBe(true)
    expect(resolveWished(null, false)).toBe(false)
  })
})

describe('toggleWish — 서버 반영에 성공했을 때만 공유 상태를 바꾼다', () => {
  beforeEach(() => { vi.restoreAllMocks() })
  const mockFetch = (res: { ok: boolean; body: unknown }): void => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: res.ok, json: async () => res.body })))
  }
  it('added → 찜으로 기록', async () => {
    const id = pid()
    mockFetch({ ok: true, body: { ok: true, action: 'added' } })
    expect(await toggleWish(id)).toBe('added')
    expect(resolveWished(id, false)).toBe(true)
  })
  it('removed → 해제로 기록', async () => {
    const id = pid()
    mockFetch({ ok: true, body: { ok: true, action: 'removed' } })
    expect(await toggleWish(id)).toBe('removed')
    expect(resolveWished(id, true)).toBe(false)
  })
  it('서버 실패(401 등)는 기록하지 않는다', async () => {
    const id = pid()
    mockFetch({ ok: false, body: {} })
    expect(await toggleWish(id)).toBeNull()
    expect(resolveWished(id, false)).toBe(false)
    expect(resolveWished(id, true)).toBe(true)
  })
})

describe('하트를 그리는 화면이 모두 공유 상태를 거친다(소스 점검)', () => {
  const files = [
    'src/routes/+page.svelte',
    'src/routes/products/+page.svelte',
    'src/routes/products/[id]/+page.svelte',
    'src/routes/hype-pack/theme/[id]/+page.svelte',
    'src/lib/components/common/WishMdSheet.svelte',
    'src/lib/components/products/SearchProductGrid.svelte',
    'src/lib/components/account/WishlistScroll.svelte',
  ]
  for (const f of files) {
    it(`${f} 는 resolveWished 를 쓴다`, () => {
      const src = readFileSync(f, 'utf-8')
      expect(src).toContain("from '$lib/stores/wishState.svelte'")
      expect(src).toContain('resolveWished(')
    })
  }
  it('wished={wishedSet.has(...)} 로 서버 값만 직접 넘기는 곳이 남아 있지 않다', () => {
    for (const f of files) {
      expect(readFileSync(f, 'utf-8')).not.toMatch(/wished=\{wishedSet\.has\(/)
    }
  })
})

describe('찜 아이콘 그라데이션 id 는 컴포넌트마다 고유하다(소스 점검)', () => {
  // 상세 화면은 CalendarTimePicker 를 PC용·모바일용으로 두 번 그리고 한쪽은 display:none 이다 —
  // 같은 id 를 쓰면 하트가 숨겨진 쪽 그라데이션을 참조해 찜 원이 투명해져 "찜이 반영 안 된 것처럼" 보인다.
  for (const f of ['src/lib/components/products/CalendarTimePicker.svelte', 'src/lib/components/products/ProductDPCard.svelte']) {
    it(`${f}: 고정 id 가 없고 $props.id() 기반 id 를 쓴다`, () => {
      const src = readFileSync(f, 'utf-8')
      expect(src).toContain('$props.id()')
      expect(src).not.toMatch(/id="cs-wish-on-grad(-detail)?"/)
      expect(src).not.toMatch(/url\(#cs-wish-on-grad(-detail)?\)/)
      expect(src).toMatch(/id="cs-wish-on-grad(-detail)?-\{uid\}"/)
      expect(src).toMatch(/url\(#cs-wish-on-grad(-detail)?-\{uid\}\)/)
    })
  }
})
