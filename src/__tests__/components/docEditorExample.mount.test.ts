// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import MinimalHost from '$lib/modules/doc-editor/examples/MinimalHost.svelte'

/**
 * examples/MinimalHost — README 이식 체크리스트의 "마운트 확인" 자동화 (P5)
 * 모듈 폴더 안의 것만으로 편집기·패널·저장 흐름이 동작해야 한다.
 */

let target: HTMLElement
let app: ReturnType<typeof mount> | null = null
async function wait(ms = 0) { await new Promise((r) => setTimeout(r, ms)); flushSync() }

const EMPTY_RECT = { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect
const EMPTY_RECTS = Object.assign([], { item: () => null }) as unknown as DOMRectList
Range.prototype.getClientRects = () => EMPTY_RECTS
Range.prototype.getBoundingClientRect = () => EMPTY_RECT
Element.prototype.getClientRects = () => EMPTY_RECTS

beforeEach(() => { target = document.createElement('div'); document.body.appendChild(target) })
afterEach(() => { if (app) unmount(app); app = null; target.remove() })

describe('MinimalHost 예제', () => {
  it('마운트 → 칩 클릭 삽입 → 저장 시 doc_templates.content 형식으로 전달', async () => {
    const onSave = vi.fn()
    app = mount(MinimalHost, { target, props: { onSave } })
    for (let i = 0; i < 50 && !target.querySelector('.ProseMirror'); i++) await wait(20)
    expect(target.querySelector('.ProseMirror')).toBeTruthy()

    const save = target.querySelector<HTMLButtonElement>('.mh-save')!
    expect(save.disabled).toBe(true) // 변경 전에는 저장 비활성

    target.querySelector<HTMLButtonElement>('.dvp-chip')!.click()
    await wait(10)
    expect(save.disabled).toBe(false)

    save.click()
    await wait(10)
    expect(onSave).toHaveBeenCalledTimes(1)
    const content = onSave.mock.calls[0][0]
    expect(content).toHaveLength(1)
    expect(content[0].type).toBe('tiptap-doc')
    expect(JSON.stringify(content[0].doc)).toContain('"variable":"이름"')
    expect(save.disabled).toBe(true) // 저장 후 다시 비활성
  })
})
