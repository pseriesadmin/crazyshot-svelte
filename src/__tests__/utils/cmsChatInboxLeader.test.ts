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

import { createCmsChatInbox, INBOX_POLL_VISIBLE_MS, AUTO_REPLY_SETTLE_MS } from '$lib/utils/cmsChatInbox.svelte'

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

const userMsg = { id: 'm1', session_id: 's1', sender_type: 'user', message_type: 'text', content: '문의', admin_only: false }

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
    await flush(AUTO_REPLY_SETTLE_MS + 50)
    expect(onA).toHaveBeenCalledTimes(1)
    expect(onB).toHaveBeenCalledTimes(1)
    stopA(); stopB()
  })
})

describe('정상 매칭 자동답변 대기(AUTO_REPLY_SETTLE_MS)', () => {
  it('대기 시간 안에는 알리지 않고, 지난 뒤 아직 사람의 답이 필요한 메시지만 알린다', async () => {
    setupEnv(true)
    const a = createCmsChatInbox()
    const on = vi.fn()
    const stop = a.start(on)
    await flush(50)
    fetchCalls = 0
    hoisted.msgHandlers[0](userMsg)
    await flush(AUTO_REPLY_SETTLE_MS - 200)
    expect(on).not.toHaveBeenCalled()
    expect(fetchCalls).toBe(0) // 숫자도 대기 시간 뒤에 갱신
    await flush(400)
    expect(on).toHaveBeenCalledTimes(1)
    expect(fetchCalls).toBe(1)
    stop()
  })

  it('자동답변으로 해결돼 목록에 남지 않은 메시지는 알리지 않는다(소리·토스트 없음)', async () => {
    setupEnv(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ count: 0, items: [] }) })))
    const a = createCmsChatInbox()
    const on = vi.fn()
    const stop = a.start(on)
    await flush(50)
    hoisted.msgHandlers[0](userMsg)
    await flush(AUTO_REPLY_SETTLE_MS + 100)
    expect(on).not.toHaveBeenCalled()
    stop()
  })

  it('소리는 자동답변으로 해결되는 건도 메시지가 오는 즉시 낸다(숫자·토스트와 별개, 2026-10-23)', async () => {
    setupEnv(true)
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ count: 0, items: [] }) })))
    const a = createCmsChatInbox()
    const on = vi.fn(); const chime = vi.fn()
    const stop = a.start(on, chime)
    await flush(50)
    hoisted.msgHandlers[0](userMsg)
    await flush(0)
    expect(chime).toHaveBeenCalledTimes(1) // 대기 시간 전에 즉시
    await flush(AUTO_REPLY_SETTLE_MS + 100)
    expect(on).not.toHaveBeenCalled() // 토스트·숫자 알림은 자동답변으로 해결돼 없음
    expect(chime).toHaveBeenCalledTimes(1)
    stop()
  })

  it('다른 탭에도 소리 신호가 전달된다', async () => {
    setupEnv(true)
    const a = createCmsChatInbox(); const b = createCmsChatInbox()
    const chimeA = vi.fn(); const chimeB = vi.fn()
    const stopA = a.start(undefined, chimeA); const stopB = b.start(undefined, chimeB)
    await flush(50)
    hoisted.msgHandlers[0](userMsg)
    await flush(AUTO_REPLY_SETTLE_MS + 50)
    expect(chimeA).toHaveBeenCalledTimes(1)
    expect(chimeB).toHaveBeenCalledTimes(1)
    stopA(); stopB()
  })

  it('기본 자동응답(대기 안내)만 나간 문의는 남아 있으므로 알린다', async () => {
    setupEnv(true)
    const a = createCmsChatInbox()
    const on = vi.fn()
    const stop = a.start(on)
    await flush(50)
    hoisted.msgHandlers[0](userMsg)
    hoisted.msgHandlers[0]({ id: 'w1', session_id: 's1', sender_type: 'ai', message_type: 'text', content: '정확한 답변을 위해 담당자가 확인 후 안내드릴게요. 잠시만', admin_only: false })
    await flush(AUTO_REPLY_SETTLE_MS + 100)
    expect(on).toHaveBeenCalledTimes(1) // 대기 안내가 별도로 한 번 더 알리지 않는다
    stop()
  })

  it('대기 뒤 조회가 한 번 실패해도 다시 시도해서 알린다(소리·토스트 누락 방지)', async () => {
    setupEnv(true)
    const a = createCmsChatInbox()
    const on = vi.fn()
    const stop = a.start(on)
    await flush(50)
    let calls = 0
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls++
      if (calls === 1) throw new Error('network down')
      return { ok: true, json: async () => ({ count: 1, items: [{ session_id: 's1', message_id: 'm1', user_id: 'u', kind: 'reply', label: null, preview: 'x', created_at: '', name: '홍', handle: '', urgent: false }] }) }
    }))
    hoisted.msgHandlers[0](userMsg)
    await flush(AUTO_REPLY_SETTLE_MS + 1100)
    expect(calls).toBe(2)
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0]).toMatchObject({ session_id: 's1', message_id: 'm1' })
    stop()
  })

  it('조회가 계속 실패하면 일반 알림 1건을 보낸다(알림 누락보다 중복이 낫다)', async () => {
    setupEnv(true)
    const a = createCmsChatInbox()
    const on = vi.fn()
    const stop = a.start(on)
    await flush(50)
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down') }))
    hoisted.msgHandlers[0](userMsg)
    await flush(AUTO_REPLY_SETTLE_MS + 3500)
    expect(on).toHaveBeenCalledTimes(1)
    expect(on.mock.calls[0][0]).toBeUndefined()
    stop()
  })

  it('같은 세션에서 연속으로 온 메시지는 마지막 메시지 기준으로 한 번만 알린다', async () => {
    setupEnv(true)
    const a = createCmsChatInbox()
    const on = vi.fn()
    const stop = a.start(on)
    await flush(50)
    hoisted.msgHandlers[0]({ ...userMsg, id: 'm0' })
    hoisted.msgHandlers[0](userMsg) // 마지막 = m1 (서버 목록의 message_id)
    await flush(AUTO_REPLY_SETTLE_MS + 100)
    expect(on).toHaveBeenCalledTimes(1)
    stop()
  })

  it('종료하면 대기 중인 타이머를 정리한다(종료 뒤 알림 없음)', async () => {
    setupEnv(true)
    const a = createCmsChatInbox()
    const on = vi.fn()
    const stop = a.start(on)
    await flush(50)
    hoisted.msgHandlers[0](userMsg)
    stop()
    await flush(AUTO_REPLY_SETTLE_MS + 100)
    expect(on).not.toHaveBeenCalled()
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
    await flush(AUTO_REPLY_SETTLE_MS + 50)
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
