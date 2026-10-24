/* eslint-disable @typescript-eslint/no-explicit-any */
// @vitest-environment jsdom
/**
 * 정책관리 '팀 정책' 편집기 동기화 통합 확인 (2026-10-24, sp3 재검수 M1 — 검수자의 마운트 시험을 저장소로 이전)
 * 실제 +page.svelte 를 jsdom 에 마운트하고 문서 편집기(RichContentEditor)만 같은 규약의 스텁으로 바꾼다:
 *   같은 화면의 다른 저장으로 서버 값이 다시 와도 쓰던 내용 유지 / 다른 관리자가 먼저 저장해도 입력 유지 /
 *   저장 중 추가 입력 보존 / 저장 실패 시 유지 / 디바운스 대기 중 입력 보존.
 * 실행: npm run test:component
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import { registry } from './teamPolicyEditor/registry'
import { store } from './teamPolicyEditor/store.svelte'

const fetchState: { calls: number; result: any; hook?: () => void } = { calls: 0, result: { type: 'success', status: 200 } }
vi.mock('$app/forms', () => ({ enhance: () => ({ destroy() {} }), deserialize: (t: string) => JSON.parse(t), applyAction: async () => {} }))
vi.mock('$app/navigation', () => ({ invalidateAll: vi.fn(async () => { await Promise.resolve(); (globalThis as any).__invalidate?.() }), goto: vi.fn() }))
vi.mock('$lib/utils/toast', () => ({ csToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() } }))
vi.mock('$lib/components/editor/RichContentEditor.svelte', async () => await import('./teamPolicyEditor/StubEditor.svelte'))

import Page from '../../routes/cms/set/policy/+page.svelte'

const A = [{ type: 'text', html: '<p>A</p>' }]
const B = [{ type: 'text', html: '<p>B</p>' }]
function mk(teamBlocks: unknown[]) {
  return { guideText: '', policySettings: { privacy_text: '', terms_text: '', refund_text: '' }, serviceInfo: {}, consents: [], policyItems: [], teamBlocks }
}
const tick = async () => { for (let i = 0; i < 5; i++) { await Promise.resolve(); flushSync() } }
const saveBtn = () => Array.from(document.querySelectorAll('button.btn-save-inline')).find((b) => /저장/.test(b.textContent ?? '') && b.closest('.subsection')?.querySelector('.team-hint')) as HTMLButtonElement
let cmp: any
async function boot(tb: unknown[]) {
  registry.mounts = 0
  store.data = mk(tb)
  cmp = mount(Page, { target: document.body, props: { get data() { return store.data } } })
  await tick()
}
beforeEach(() => { if (cmp) unmount(cmp); cmp = null; document.body.innerHTML = ''; ;(globalThis as any).__invalidate = undefined
  globalThis.fetch = vi.fn(async () => { fetchState.calls++; fetchState.hook?.(); return { text: async () => JSON.stringify(fetchState.result) } as any }) as any })

describe('팀 정책 편집기 동기화(실제 +page.svelte 마운트, 편집기는 스텁)', () => {
  it('첫 마운트: 서버 값으로 편집기가 채워지고 저장 버튼은 비활성', async () => {
    await boot(A)
    expect(registry.current?.get()).toEqual(A)
    expect(saveBtn().disabled).toBe(true)
  })
  it('다른 섹션 저장 등으로 같은 값이 다시 와도 쓰던 내용·편집기 유지', async () => {
    await boot(A)
    const m = registry.mounts
    registry.current!.type([{ type: 'text', html: '<p>typed</p>' }]); await tick()
    expect(saveBtn().disabled).toBe(false)
    store.data = mk(JSON.parse(JSON.stringify(A))); await tick()
    expect(registry.mounts).toBe(m)
    expect(registry.current!.get()).toEqual([{ type: 'text', html: '<p>typed</p>' }])
    expect(saveBtn().disabled).toBe(false)
  })
  it('미저장 입력이 있는데 다른 관리자가 먼저 저장(서버 값 변경): 입력 유지, 저장하면 덮어씀', async () => {
    await boot(A)
    const m = registry.mounts
    registry.current!.type([{ type: 'text', html: '<p>mine</p>' }]); await tick()
    store.data = mk(B); await tick()
    expect(registry.mounts).toBe(m)
    expect(registry.current!.get()).toEqual([{ type: 'text', html: '<p>mine</p>' }])
    expect(saveBtn().disabled).toBe(false)
  })
  it('입력이 없을 때 서버 값이 바뀌면 새 값으로 편집기 재생성', async () => {
    await boot(A)
    const m = registry.mounts
    store.data = mk(B); await tick()
    expect(registry.mounts).toBe(m + 1)
    expect(registry.current!.get()).toEqual(B)
  })
  it('저장 성공(추가 입력 없음): 재조회 후 저장값으로 편집기, 저장 버튼 비활성', async () => {
    await boot(A)
    const typed = [{ type: 'text', html: '<p>new</p>' }]
    registry.current!.type(typed); await tick()
    ;(globalThis as any).__invalidate = () => { store.data = mk(typed) }
    fetchState.result = { type: 'success', status: 200 }; fetchState.hook = undefined
    saveBtn().click(); await tick(); await tick()
    expect(fetchState.calls).toBeGreaterThan(0)
    expect(registry.current!.get()).toEqual(typed)
    expect(saveBtn().disabled).toBe(true)
  })
  it('저장 중 추가 입력(디바운스 후 onchange 도달): 미저장 상태·입력 유지', async () => {
    await boot(A)
    const typed = [{ type: 'text', html: '<p>one</p>' }]
    const more = [{ type: 'text', html: '<p>one two</p>' }]
    registry.current!.type(typed); await tick()
    ;(globalThis as any).__invalidate = () => { store.data = mk(typed) }
    fetchState.hook = () => { registry.current!.type(more) }
    saveBtn().click(); await tick(); await tick()
    expect(registry.current!.get()).toEqual(more)
    expect(saveBtn().disabled).toBe(false)
  })
  it('저장 실패: 입력·미저장 상태 유지', async () => {
    await boot(A)
    registry.current!.type(B); await tick()
    fetchState.result = { type: 'failure', status: 400, data: { error: 'x' } }; fetchState.hook = undefined
    saveBtn().click(); await tick(); await tick()
    expect(saveBtn().disabled).toBe(false)
    expect(registry.current!.get()).toEqual(B)
  })
})

describe('디바운스(250ms) 대기 중 입력 + 서버 값 변경', () => {
  it('첫 입력 후 아직 onchange 전에 재조회가 와도(편집기 정리 시 마지막 입력 반영 가정) 입력이 보존된다', async () => {
    await boot(A)
    const X = [{ type: 'text', html: '<p>typing</p>' }]
    ;(registry.current as any).typePending(X)
    store.data = mk(B); await tick()
    expect(registry.current!.get()).toEqual(X)
    expect(saveBtn().disabled).toBe(false)
  })
})
