// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import ChatInput from '$lib/components/chat/ChatInput.svelte'

/**
 * 관리자 상담 입력창 빠른답변('/')·상품 멘션('@') 드롭다운 — 선택·닫기·필터·키보드·무한루프 없음 검증 (2026-10-02)
 *
 * 회귀 배경: '/' effect가 방금 쓴 dropdownItems를 같은 effect에서 다시 읽고, '@' effect가 $state 타이머를 읽고 쓰는 바람에
 * effect_update_depth_exceeded로 effect가 멈춰 드롭다운이 눌리지도 닫히지도 않았다.
 * 실행: npm run test:component (= vitest run --config vitest.component.config.ts). 기본 설정에서는 mount가 불가해 건너뜀.
 */

interface Canned {
  id: string
  title: string
  content: string
  category: string | null
  shortcut: string | null
  match_keywords: string[]
  usage_count: number
}

function canned(id: string, over: Partial<Canned> = {}): Canned {
  return { id, title: `제목${id}`, content: `본문${id}`, category: 'etc', shortcut: null, match_keywords: [], usage_count: 0, ...over }
}

const BASE: Canned[] = [
  canned('c1', { title: '미보유 장비 요청 안내', content: '찾는 장비가 없다면 제안해 주세요!' }),
  canned('c2', { title: '반납 안내 기본', content: '반납은 택배 또는 직접 방문으로 가능합니다.', category: 'return' }),
]

const CANNED_URL = '/api/cms/canned-responses'
const PRODUCT_URL_PART = '/api/cms/products/search-suggestions'
const PRODUCTS = [{ id: 'p1', name: 'SONY FX3', image_url: null, slug: 's', price_24h: 1000 }]

/** 호출 경로를 정확히 구분하고, 모르는 경로는 즉시 오류로 알려 실패 원인이 가려지지 않게 한다 */
function stubFetch(list: Canned[]) {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    if (u === CANNED_URL) return { ok: true, json: async () => list }
    if (u.startsWith(PRODUCT_URL_PART)) return { ok: true, json: async () => PRODUCTS }
    throw new Error(`예상하지 못한 fetch 경로: ${u}`)
  }))
}

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null

async function tick(ms = 0) { await new Promise((r) => setTimeout(r, ms)); flushSync() }
const ta = () => target.querySelector('textarea') as HTMLTextAreaElement
const titles = () => [...target.querySelectorAll('.canned-item .ci-title')].map((e) => e.textContent?.trim())

async function open(list: Canned[] = BASE) {
  stubFetch(list)
  app = mount(ChatInput, { target, props: { isAdmin: true } })
  await tick(10)
}
async function type(value: string) {
  ta().value = value
  ta().dispatchEvent(new Event('input', { bubbles: true }))
  await tick(10)
}
async function key(k: string) {
  ta().dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }))
  await tick(10)
}

beforeEach(() => {
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(() => { if (app) unmount(app); app = null; target.remove(); vi.unstubAllGlobals() })

describe.skipIf(!process.env.CS_COMPONENT_TEST)('ChatInput(관리자) 빠른답변 드롭다운', () => {
  it("'/' 입력 → 목록 표시 → 항목 mousedown → 본문이 입력창에 채워지고 목록 닫힘", async () => {
    await open()
    await type('/')
    const items = target.querySelectorAll('.canned-item')
    expect(items.length).toBe(2)
    items[0].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    await tick(10)
    expect(target.querySelector('.canned-dropdown')).toBeNull()
    expect(ta().value).toBe(BASE[0].content)
  })

  it("'/' 입력 → 바깥 mousedown → 목록 닫히고 '/' 비워짐", async () => {
    await open()
    await type('/')
    expect(target.querySelector('.canned-dropdown')).not.toBeNull()
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await tick(10)
    expect(target.querySelector('.canned-dropdown')).toBeNull()
    expect(ta().value).toBe('')
  })

  it("'/' 입력 → Escape → 닫힘", async () => {
    await open()
    await type('/')
    await key('Escape')
    expect(target.querySelector('.canned-dropdown')).toBeNull()
  })

  it("빈 쿼리('/')는 사용 순 상위 8개만 보여주고 첫 항목이 하이라이트된다", async () => {
    await open(Array.from({ length: 10 }, (_, i) => canned(String(i + 1))))
    await type('/')
    expect(titles()).toEqual(['제목1', '제목2', '제목3', '제목4', '제목5', '제목6', '제목7', '제목8'])
    expect(target.querySelector('.canned-item.selected .ci-title')?.textContent?.trim()).toBe('제목1')
  })

  it('필터 우선순위: 전용 키워드 → 단축키 → 제목 부분일치, 본문 속 단어는 매칭하지 않는다', async () => {
    await open([
      canned('t', { title: '반납 안내' }),                                         // 제목 일치
      canned('s', { title: '단축키 항목', shortcut: '/반납' }),                      // 단축키 일치
      canned('k', { title: '키워드 항목', match_keywords: ['반납연장'] }),            // 전용 키워드 일치
      canned('b', { title: '무관한 항목', content: '반납이라는 단어가 본문에만 있음' }), // 본문만 일치 → 제외
    ])
    await type('/반납')
    expect(titles()).toEqual(['키워드 항목', '단축키 항목', '반납 안내'])
  })

  it('ArrowDown으로 이동 후 Enter → 하이라이트한 항목 본문이 채워지고 목록 닫힘', async () => {
    await open()
    await type('/')
    await key('ArrowDown')
    expect(target.querySelector('.canned-item.selected .ci-title')?.textContent?.trim()).toBe('반납 안내 기본')
    await key('Enter')
    expect(target.querySelector('.canned-dropdown')).toBeNull()
    expect(ta().value).toBe(BASE[1].content)
  })

  it("화살표 없이 바로 Enter → 첫 항목이 선택된다('/검색어' 원문이 전송되지 않음)", async () => {
    await open()
    await type('/')
    await key('Enter')
    expect(ta().value).toBe(BASE[0].content)
  })

  it("'@상품' 입력 → 상품 검색 후 드롭다운 표시(디바운스 대기), 무한 루프 없음", async () => {
    await open()
    await type('@소니')
    await vi.waitFor(() => expect(target.querySelector('.product-dropdown')).not.toBeNull(), { timeout: 3000, interval: 50 })
  })
})
