// cmsChatTabBridge.test.ts — 채팅 화면이 열린 탭이 있으면 ACK + 열기 콜백, 없으면 false(호출 쪽이 새 창으로 연다)
import { describe, it, expect, vi, afterEach } from 'vitest'
import { requestOpenInChatTab, listenChatTab } from '$lib/utils/cmsChatTabBridge'

const cleanups: Array<() => void> = []
afterEach(() => { while (cleanups.length) cleanups.pop()?.() })

describe('cmsChatTabBridge', () => {
  it('채팅 화면이 열린 탭이 있으면 true를 돌려주고 그 탭에서 세션 열기가 호출된다', async () => {
    vi.stubGlobal('window', { focus: vi.fn() })
    const onOpen = vi.fn()
    cleanups.push(listenChatTab(onOpen))
    expect(await requestOpenInChatTab('s-123', 500)).toBe(true)
    expect(onOpen).toHaveBeenCalledWith('s-123')
    vi.unstubAllGlobals()
  })

  it('열린 채팅 화면이 없으면 제한 시간 뒤 false', async () => {
    expect(await requestOpenInChatTab('s-123', 60)).toBe(false)
  })

  it('BroadcastChannel을 지원하지 않는 환경이면 즉시 false', async () => {
    const orig = globalThis.BroadcastChannel
    // @ts-expect-error 지원하지 않는 환경 흉내
    globalThis.BroadcastChannel = undefined
    expect(await requestOpenInChatTab('s-1', 60)).toBe(false)
    globalThis.BroadcastChannel = orig
  })
})
