// cmsChatTabBridge.ts — 다른 CMS 화면(플로팅 채팅 아이콘의 간추림 바)에서 "채팅 대화 화면이 이미 열린 브라우저 탭"으로 대화를 열어 주는 탭 간 통신 (2026-10-19, Stephen 지시)
// 동작: 요청 탭이 BroadcastChannel로 열기 요청을 보내고, 채팅 화면이 열린 탭이 있으면 ACK를 돌려준다 → 그 탭에서 해당 대화를 선택하고 앞으로 가져오려 시도한다.
//       ACK가 제한 시간 안에 없으면(열린 채팅 화면 없음) 호출 쪽이 새 창으로 연다.
// 한계: 브라우저 보안상 다른 탭을 강제로 앞에 띄울 수는 없다 — 받은 탭은 window.focus()를 시도하고, 실패해도 그 탭에서 대화는 이미 선택돼 있다.
const CHANNEL_NAME = 'cms-chat-tabs'
const ACK_WAIT_MS = 350

/** 채팅 화면이 열린 탭의 창 이름 — 새 창으로 열 때도 같은 이름을 써서 이후 요청이 그 창을 재사용하게 한다 */
export const CHAT_WINDOW_NAME = 'cms-chat-window'

type Message = { type: 'open'; id: string; sessionId: string } | { type: 'ack'; id: string }

function hasBroadcastChannel(): boolean {
  return typeof BroadcastChannel !== 'undefined'
}

/** 채팅 화면이 열린 다른 탭에 대화 열기를 요청한다. 받은 탭이 있으면 true, 없으면 false(호출 쪽이 새 창으로 연다). */
export function requestOpenInChatTab(sessionId: string, waitMs: number = ACK_WAIT_MS): Promise<boolean> {
  if (!hasBroadcastChannel()) return Promise.resolve(false)
  return new Promise((resolve) => {
    const channel = new BroadcastChannel(CHANNEL_NAME)
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true
      clearTimeout(timer)
      channel.close()
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), waitMs)
    channel.onmessage = (e: MessageEvent<Message>) => {
      if (e.data?.type === 'ack' && e.data.id === id) finish(true)
    }
    channel.postMessage({ type: 'open', id, sessionId } satisfies Message)
  })
}

/**
 * 채팅 화면이 열려 있는 동안 열기 요청을 받는다. 요청을 받으면 즉시 ACK를 보내고 onOpen(sessionId)을 호출한 뒤 창 앞으로 가져오기를 시도한다.
 * 반환 함수로 해제한다.
 */
export function listenChatTab(onOpen: (sessionId: string) => void): () => void {
  if (!hasBroadcastChannel()) return () => {}
  const channel = new BroadcastChannel(CHANNEL_NAME)
  channel.onmessage = (e: MessageEvent<Message>) => {
    const m = e.data
    if (m?.type !== 'open' || typeof m.sessionId !== 'string') return
    channel.postMessage({ type: 'ack', id: m.id } satisfies Message)
    onOpen(m.sessionId)
    try { window.focus() } catch { /* 일부 브라우저는 다른 탭의 포커스 이동을 막는다 */ }
  }
  return () => channel.close()
}
