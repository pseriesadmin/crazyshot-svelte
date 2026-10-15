// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, unmount, flushSync } from 'svelte'
import ContractImportModal from '$lib/components/cms/contract-editor/ContractImportModal.svelte'

/** '다시 선택'·'다른 파일 선택' — 모달을 닫고 호출부의 파일 선택창을 다시 여는 흐름 (2026-10-14) */
let app: ReturnType<typeof mount> | null = null
afterEach(() => {
  if (app) unmount(app)
  app = null
  document.body.innerHTML = ''
})

function mountModal(props: Record<string, unknown>) {
  const target = document.createElement('div')
  document.body.appendChild(target)
  app = mount(ContractImportModal, {
    target,
    props: { initialFile: new File([new Uint8Array([1])], 'a.hwp'), onclose: () => {}, onImport: () => {}, ...props },
  })
  flushSync()
  return target
}

describe('ContractImportModal — 다시 선택', () => {
  it('"다른 파일 선택"을 누르면 닫고(onclose) 선택창 재호출(onreselect)을 같은 클릭에서 호출한다', () => {
    const onclose = vi.fn()
    const onreselect = vi.fn()
    const target = mountModal({ onclose, onreselect })
    const btn = Array.from(target.querySelectorAll<HTMLButtonElement>('button.btn-cancel')).find((b) => b.textContent?.includes('다른 파일 선택'))
    expect(btn, '다른 파일 선택 버튼').toBeTruthy()
    btn!.click()
    expect(onclose).toHaveBeenCalledTimes(1)
    expect(onreselect).toHaveBeenCalledTimes(1)
  })

  it('onreselect 가 없으면 그냥 닫기만 한다(기존 동작)', () => {
    const onclose = vi.fn()
    const target = mountModal({ onclose })
    ;(Array.from(target.querySelectorAll<HTMLButtonElement>('button.btn-cancel')).find((b) => b.textContent?.includes('다른 파일 선택')))!.click()
    expect(onclose).toHaveBeenCalledTimes(1)
  })

  it('✕ 닫기는 선택창을 다시 열지 않는다', () => {
    const onreselect = vi.fn()
    const target = mountModal({ onreselect })
    target.querySelector<HTMLButtonElement>('button.close-btn')!.click()
    expect(onreselect).not.toHaveBeenCalled()
  })
})
