// cmsChatInboxLeader.test.ts — 채팅 아이콘 상태: 탭 대표 1곳만 조회·구독 / 요청 합치기 / 세션 이중 갱신 제거 / 오래되지 않았으면 건너뜀
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const hoisted = vi.hoisted(() => ({
  msgHandlers: [] as Array<(m: unknown) => void>,
  sessHandlers: [] as Array<(s: unknown) => void>,
  unsubMsg: vi.fn(),
  unsubSess: vi.fn(),
}))

vi.mock('$lib/services/chatService', () => ({
  subscribeToAllMessages: (h: (m: unknown) => void) => { hoisted.msgHandlers.push(h); return hoisted.unsubMsg },
  subscribeToSessions: (h: (s: unknown) => void) => { hoisted.sessHandlers.push(h); return hoisted.unsubSess },
}))

import { createCmsChatInbox, INBOX_POLL_VISIBLE_MS } from '$lib/utils/cmsChatInbox.svelte'

type Cb = () => Promise<void> | void
/** 단일 프로세스용 간이 Web Locks — 배타 잠금 + 대기열 + abort */
function makeLocks() {
  const queue: Array<{ run: () => void; remove: () => void }> = []
  let held = false
  const next = () => { held = false; queue.shift()?.run() }
  return {
    request(_name: string, opts: { signal?: AbortSignal }, cb: Cb): Promise<void> {
      return new Promise((resolve, reject) => {
        const run = () => {
          held = true
          Promise.resolve(cb()).then(resolve, reject).finally(next)
        }
        if (!held) { run(); return }
        const entry = {
          run,
          remove: () => { const i = queue.indexOf(entry); if (i >= 0) queue.splice(i, 1) },
        }
        queue.push(entry)
        opts.signal?.addEventListener('abort', () => { entry.remove(); reject(new Error('aborted')) })
      })
    },
  }
}

let fetchCalls = 0
const realTick = () => new Promise<void>((r) => setImmediate(r)) // BroadcastChannel 전달은 실제 이벤트 루프가 필요 — setImmediate는 가짜로 만들지 않는다
const flush = async (ms = 0) => {
  await vi.advanceTimersByTimeAsync(ms)
  for (let i = 0; i < 3; i++) { await realTick(); await vi.advanceTimersByTimeAsync(0) }
}

function setupEnv(withLocks: boolean) {
  fetchCalls = 0
  const store: Record<string, string> = {}
  vi.stubGlobal('localStorage', { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v } })
  vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('window', { addEventListener: vi.fn(), removeEventListener: vi.fn() })
  vi.stubGlobal('navigator', withLocks ? { locks: makeLocks() } : {})
  vi.stubGlobal('fetch', vi.fn(async () => {
    fetchCalls++
    return { ok: true, json: async () => ({ count: 2, items: [{ session_id: 's1', message_id: 'm1', user_id: 'u', kind: 'reply', label: null, preview: 'x', created_at: '', name: '홍', handle: '', urgent: false }] }) }
  }))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  hoisted.msgHandlers.length = 0
  hoisted.sessHandlers.length = 0
  hoisted.unsubMsg.mockClear()
  hoisted.unsubSess.mockClear()
})
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

const userMsg = { id: 'a', session_id: 's1', sender_type: 'user', message_type: 'text', content: '문의', admin_only: false }

describe('탭 대표 선출', () => {
  it('두 탭 중 대표 1곳만 조회·구독하고, 다른 탭도 같은 결과를 받는다', async () => {
    setupEnv(true)
    const a = createCmsChatInbox(); const b = createCmsChatInbox()
    const stopA = a.start(); const stopB = b.start()
    await flush(50)
    expect(fetchCalls).toBe(1)
    expect(hoisted.msgHandlers).toHaveLength(1)
    expect(a.count).toBe(2)
    expect(b.count).toBe(2)
    expect(b.loaded).toBe(true)
    stopA(); stopB()
  })

  it('대표 탭이 닫히면 다른 탭이 이어받아 조회·구독한다', async () => {
    setupEnv(true)
    const a = createCmsChatInbox(); const b = createCmsChatInbox()
    const stopA = a.start(); const stopB = b.start()
    await flush(50)
    stopA()
    await flush(50)
    expect(hoisted.unsubMsg).toHaveBeenCalledTimes(1)
    expect(hoisted.msgHandlers).toHaveLength(2) // 두 번째 탭이 새로 구독
    expect(fetchCalls).toBe(2)
    stopB()
  })

  it('잠금을 지원하지 않는 환경에서는 각 탭이 직접 조회한다(이전 방식)', async () => {
    setupEnv(false)
    const a = createCmsChatInbox(); const b = createCmsChatInbox()
    const stopA = a.start(); const stopB = b.start()
    await flush(50)
    expect(fetchCalls).toBe(2)
    expect(hoisted.msgHandlers).toHaveLength(2)
    stopA(); stopB()
  })

  it('다른 탭에서 새 대화 알림 콜백도 받는다', async () => {
    setupEnv(true)
    const a = createCmsChatInbox(); const b = createCmsChatInbox()
    const onA = vi.fn(); const onB = vi.fn()
    const stopA = a.start(onA); const stopB = b.start(onB)
    await flush(50)
    hoisted.msgHandlers[0](userMsg)
    await flush(50)
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).toHaveBeenCalledTimes(1)
    stopA(); stopB()
  })
})

describe('갱신 합치기·완화', () => {
  it('알림 대상 메시지가 몰려도 진행 중 요청을 합쳐 조회 횟수가 폭증하지 않는다', async () => {
    setupEnv(true)
    const a = createCmsChatInbox()
    const stop = a.start()
    await flush(50)
    fetchCalls = 0
    for (let i = 0; i < 6; i++) hoisted.msgHandlers[0]({ ...userMsg, id: `m${i}` })
    await flush(50)
    expect(fetchCalls).toBeLessThanOrEqual(2)
    stop()
  })

  it('대화 변경은 종료일 때만 갱신한다(메시지 도착과 겹치는 이중 갱신 제거)', async () => {
    setupEnv(true)
    const a = createCmsChatInbox()
    const stop = a.start()
    await flush(50)
    fetchCalls = 0
    hoisted.sessHandlers[0]({ id: 's1', status: 'open' })
    await flush(500)
    expect(fetchCalls).toBe(0)
    hoisted.sessHandlers[0]({ id: 's1', status: 'closed' })
    await flush(500)
    expect(fetchCalls).toBe(1)
    stop()
  })

  it('마지막 조회가 10초 이내면 화면 이동 갱신을 건너뛴다', async () => {
    setupEnv(true)
    const a = createCmsChatInbox()
    const stop = a.start()
    await flush(50)
    fetchCalls = 0
    a.refreshIfStale()
    await flush(50)
    expect(fetchCalls).toBe(0)
    await flush(11_000)
    a.refreshIfStale()
    await flush(50)
    expect(fetchCalls).toBeGreaterThanOrEqual(1)
    stop()
  })

  it('안 보이는 탭은 주기 갱신 간격이 길다(보이는 탭 30초 → 숨김 120초)', async () => {
    setupEnv(true)
    ;(document as unknown as { visibilityState: string }).visibilityState = 'hidden'
    const a = createCmsChatInbox()
    const stop = a.start()
    await flush(50)
    fetchCalls = 0
    await flush(INBOX_POLL_VISIBLE_MS + 1000)
    expect(fetchCalls).toBe(0)
    await flush(100_000)
    expect(fetchCalls).toBe(1)
    stop()
  })
})
