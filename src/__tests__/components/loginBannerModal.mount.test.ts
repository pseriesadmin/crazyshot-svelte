// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'

/**
 * 로그인 배너 관리 모달 — 모바일 배너 노출 설정(콤보) 연동 (2026-10-02)
 * 열 때 저장된 설정(cms_settings.login_banner_mode)을 읽어 콤보에 반영하고, 저장 시 mobile_visible 을 함께 저장한다.
 * 실행: npm run test:component
 */

let settingsValue: unknown = null
let hasSession = true
let settingsRpcError: string | null = null
const rpcCalls: Array<{ name: string; params: Record<string, unknown> }> = []
const fromCalls: string[] = []
const eqCalls: Array<{ table: string; column: string; value: unknown }> = []

vi.mock('$lib/services/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: hasSession ? { user: { id: 'admin' } } : null } }) },
    from: (table: string) => {
      fromCalls.push(table)
      const chain: Record<string, unknown> = {}
      chain.select = () => chain
      chain.eq = (column: string, value: unknown) => { eqCalls.push({ table, column, value }); return chain }
      chain.is = () => chain
      chain.order = () => chain
      chain.maybeSingle = () => Promise.resolve({ data: table === 'cms_settings' ? (settingsValue === null ? null : { value: settingsValue }) : null, error: null })
      chain.then = (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res)
      return chain
    },
    rpc: (name: string, params: Record<string, unknown>) => {
      rpcCalls.push({ name, params })
      if (name === 'upsert_product_page_setting' && settingsRpcError) return Promise.resolve({ data: null, error: { message: settingsRpcError } })
      return Promise.resolve({ data: null, error: null })
    },
  },
}))

const { default: LoginBannerModal } = await import('$lib/components/auth/LoginBannerModal.svelte')

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
const tick = async (ms = 0) => { await new Promise((r) => setTimeout(r, ms)); flushSync() }
const comboButtons = () => [...target.querySelectorAll('[aria-label="모바일 배너 노출 설정"] .combo-btn')] as HTMLButtonElement[]

const pcComboButtons = () => [...target.querySelectorAll('[aria-label="PC 배너 노출 설정"] .combo-btn')] as HTMLButtonElement[]

async function open(onclose = () => {}) {
  app = mount(LoginBannerModal, { target, props: { onclose } })
  await tick(20)
}

beforeEach(() => {
  settingsValue = null
  hasSession = true
  settingsRpcError = null
  rpcCalls.length = 0
  fromCalls.length = 0
  eqCalls.length = 0
  target = document.createElement('div')
  document.body.appendChild(target)
})
afterEach(() => { if (app) unmount(app); app = null; target.remove() })

describe.skipIf(!process.env.CS_COMPONENT_TEST)('LoginBannerModal 모바일 배너 노출 설정', () => {
  it('존재하지 않는 promotion_banners·page_settings 를 조회하지 않고 banners·cms_settings 를 읽는다', async () => {
    await open()
    expect(fromCalls).not.toContain('promotion_banners')
    expect(fromCalls).not.toContain('page_settings')
    expect(fromCalls.filter((t) => t === 'banners').length).toBe(2)
    expect(fromCalls).toContain('cms_settings')
  })

  it("배너는 banners 의 slot_key 컬럼으로 조회한다(placement 컬럼은 banners 에 없다)", async () => {
    await open()
    const bannerEq = eqCalls.filter((c) => c.table === 'banners')
    expect(bannerEq.map((c) => `${c.column}=${c.value}`).sort()).toEqual(['slot_key=login_mobile', 'slot_key=login_pc'])
    expect(eqCalls.some((c) => c.column === 'placement')).toBe(false)
    expect(eqCalls.find((c) => c.table === 'cms_settings')).toMatchObject({ column: 'key', value: 'login_banner_mode' })
  })

  it('설정이 없으면 "순서대로 노출"이 선택되어 있다', async () => {
    await open()
    const [fixed, random, hidden] = comboButtons()
    expect(comboButtons().length).toBe(3)
    expect(fixed.classList.contains('combo-btn-active')).toBe(true)
    expect(random.classList.contains('combo-btn-active')).toBe(false)
    expect(hidden.classList.contains('combo-btn-active')).toBe(false)
  })

  it('모바일 노출 설정은 단일 콤보 하나뿐 — 별도 라벨·안내문·라디오가 없다', async () => {
    await open()
    expect(target.querySelector('input[name="mobile-mode"]')).toBeNull()
    expect(target.textContent).not.toContain('노출 설정')
    expect(target.textContent).not.toContain('숨김으로 저장하면')
    // 섹션 제목 옆 안내문·빈 목록 안내문 제거
    expect(target.textContent).not.toContain('PC 배경·콘텐츠 영역')
    expect(target.textContent).not.toContain('모바일 배경·콘텐츠 영역')
    expect(target.textContent).not.toContain('배너를 추가하면 로그인 화면')
  })

  it('저장된 mobile_visible=false 를 열 때 "숨김"으로 반영한다', async () => {
    settingsValue = { pc_mode: 'fixed', mobile_mode: 'random', mobile_visible: false }
    await open()
    const [fixed, random, hidden] = comboButtons()
    expect(hidden.classList.contains('combo-btn-active')).toBe(true)
    expect(fixed.classList.contains('combo-btn-active')).toBe(false)
    expect(random.classList.contains('combo-btn-active')).toBe(false)
  })

  it('저장된 mobile_mode=random 을 열 때 "랜덤 노출"로 반영한다', async () => {
    settingsValue = { pc_mode: 'fixed', mobile_mode: 'random', mobile_visible: true }
    await open()
    expect(comboButtons()[1].classList.contains('combo-btn-active')).toBe(true)
  })

  async function saveAndGetValue() {
    ;(target.querySelector('.btn-save') as HTMLButtonElement).click()
    await tick(30)
    const call = rpcCalls.find((c) => c.name === 'upsert_product_page_setting')
    expect(call?.params.p_key).toBe('login_banner_mode')
    return call?.params.p_value as { pc_mode: string; mobile_mode: string; mobile_visible: boolean }
  }

  it('"숨김" 선택 후 저장하면 mobile_visible=false 가 저장되고 모달이 닫힌다', async () => {
    const onclose = vi.fn()
    await open(onclose)
    comboButtons()[2].click()
    flushSync()
    expect(await saveAndGetValue()).toEqual({ pc_mode: 'fixed', mobile_mode: 'fixed', mobile_visible: false })
    expect(onclose).toHaveBeenCalled()
  })

  it('"랜덤 노출" 선택 후 저장하면 mobile_mode=random·mobile_visible=true', async () => {
    await open()
    comboButtons()[1].click()
    flushSync()
    expect(await saveAndGetValue()).toEqual({ pc_mode: 'fixed', mobile_mode: 'random', mobile_visible: true })
  })

  it('숨김 상태에서 "순서대로 노출"을 고르면 다시 노출(visible=true)·fixed', async () => {
    settingsValue = { mobile_visible: false, mobile_mode: 'random' }
    await open()
    comboButtons()[0].click()
    flushSync()
    expect(await saveAndGetValue()).toMatchObject({ mobile_mode: 'fixed', mobile_visible: true })
  })

  it('숨김을 고른 뒤 노출 방식(랜덤)은 보존된다 — 숨김 해제 시 이전 방식으로 복귀 가능하도록 mobile_mode 유지', async () => {
    settingsValue = { mobile_mode: 'random', mobile_visible: true }
    await open()
    comboButtons()[2].click()
    flushSync()
    expect(await saveAndGetValue()).toMatchObject({ mobile_mode: 'random', mobile_visible: false })
  })

  it('PC 노출 설정도 콤보(순서대로/랜덤) 2버튼이며 라디오 입력이 없다', async () => {
    await open()
    expect(pcComboButtons().length).toBe(2)
    expect(target.querySelectorAll('input[type="radio"]').length).toBe(0)
    expect(pcComboButtons()[0].classList.contains('combo-btn-active')).toBe(true)
  })

  it('저장된 pc_mode=random 을 열 때 PC "랜덤 노출"로 반영하고, 선택 후 저장하면 pc_mode 가 바뀐다', async () => {
    settingsValue = { pc_mode: 'random', mobile_mode: 'fixed', mobile_visible: true }
    await open()
    expect(pcComboButtons()[1].classList.contains('combo-btn-active')).toBe(true)
    pcComboButtons()[0].click()
    flushSync()
    expect(await saveAndGetValue()).toEqual({ pc_mode: 'fixed', mobile_mode: 'fixed', mobile_visible: true })
  })

  it('로그인 세션이 없으면 저장을 시도하지 않고 만료 안내를 보여 준다(permission denied 원문 노출 방지)', async () => {
    hasSession = false
    const onclose = vi.fn()
    await open(onclose)
    ;(target.querySelector('.btn-save') as HTMLButtonElement).click()
    await tick(30)
    expect(rpcCalls.length).toBe(0)
    expect(target.textContent).toContain('로그인이 만료되었어요')
    expect(onclose).not.toHaveBeenCalled()
    expect((target.querySelector('.btn-save') as HTMLButtonElement).disabled).toBe(false)
  })

  it('DB가 permission denied 를 돌려줘도 원문 대신 만료 안내로 바꿔 보여 준다', async () => {
    settingsRpcError = 'permission denied for function upsert_product_page_setting'
    await open()
    ;(target.querySelector('.btn-save') as HTMLButtonElement).click()
    await tick(30)
    expect(target.textContent).toContain('로그인이 만료되었어요')
    expect(target.textContent).not.toContain('permission denied')
  })
})
