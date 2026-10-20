// cmsChatInbox.svelte.ts — CMS 플로팅 채팅 아이콘 상태(개수·목록) + 실시간 갱신 (2026-10-19, Stephen 확정 A안)
// 부하 설계(2026-10-19 부하 검증 후 개선):
//   · 탭 대표 한 곳만 조회 — Web Locks로 열린 CMS 탭 중 1개를 대표로 뽑고, 대표만 서버 조회·실시간 구독·주기 갱신을 한다.
//     결과(스냅샷)와 "새 대화 도착"은 BroadcastChannel로 다른 탭에 전달한다. 대표 탭이 닫히면 다른 탭이 자동으로 이어받는다.
//     (Web Locks/BroadcastChannel을 지원하지 않는 환경에서는 모든 탭이 각자 조회하는 이전 방식으로 동작)
//   · 갱신 요청 합치기 — 조회가 진행 중이면 끝난 뒤 한 번만 더 실행(메시지가 몰려도 요청 폭증 없음)
//   · 대화 변경(세션) 실시간은 "종료"일 때만 반영(메시지 도착과 겹치는 이중 갱신 제거)
//   · 주기 갱신은 대표 탭만: 화면이 보이면 30초, 숨겨져 있으면 120초 / 화면 이동·탭 복귀는 마지막 조회 후 10초 이내면 건너뜀
// 이벤트 카드(전자계약 서명 완료 등)의 "확인" 처리는 이 브라우저(localStorage)에만 저장된다 — 읽음 기록 컬럼이 없는 A안의 한계.
import { subscribeToAllMessages, subscribeToSessions } from '$lib/services/chatService'
import { CHAT_INBOX_EVENT_CARD_TYPES, isWaitNoticeMessage } from '$lib/utils/chatInbox'
import type { ChatMessage } from '$lib/types/chat'

export interface ChatInboxItem {
  session_id: string
  user_id: string
  message_id: string
  kind: 'reply' | 'event'
  label: string | null
  preview: string
  created_at: string
  name: string
  handle: string
  urgent: boolean
}

const DISMISS_KEY = 'cms-chat-inbox-dismissed'
const DISMISS_MAX = 100
const LAZY_DEBOUNCE_MS = 250
export const INBOX_POLL_VISIBLE_MS = 30_000
export const INBOX_POLL_HIDDEN_MS = 120_000
export const INBOX_STALE_MS = 10_000
const FETCH_TIMEOUT_MS = 15_000
const LOCK_NAME = 'cms-chat-inbox-leader'
const SYNC_CHANNEL = 'cms-chat-inbox-sync'

type SyncMessage =
  | { t: 'snap'; count: number; items: ChatInboxItem[] }
  | { t: 'hello' }
  | { t: 'refresh'; maxAgeMs: number }
  | { t: 'new'; found: ChatInboxItem | null }

function readDismissed(): string[] {
  try {
    const raw = localStorage.getItem(DISMISS_KEY)
    const arr = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(arr) ? arr.filter((v): v is string => typeof v === 'string').slice(-DISMISS_MAX) : []
  } catch {
    return []
  }
}

function writeDismissed(ids: string[]): void {
  try {
    localStorage.setItem(DISMISS_KEY, JSON.stringify(ids.slice(-DISMISS_MAX)))
  } catch {
    // 저장소 차단 환경에서는 이번 세션 메모리 상태만 유지
  }
}

/** 새로 도착한 메시지 중 관리자가 알아야 할 것(고객 발신 / 담당자 대기 안내 / 고객 행동 이벤트 카드)인지 */
export function isInboxRelevantMessage(m: ChatMessage): boolean {
  if (m.admin_only === true) return false
  if (m.sender_type === 'user') return true
  if (isWaitNoticeMessage(m)) return true // 담당자 연결 대기 안내 — 고객이 사람의 답변을 기다리는 중
  const type = (m.action_payload as { type?: string } | null | undefined)?.type
  return m.sender_type === 'admin' && m.message_type === 'action_card' && !!type && (CHAT_INBOX_EVENT_CARD_TYPES as readonly string[]).includes(type)
}

export function createCmsChatInbox() {
  let count = $state(0)
  let items = $state<ChatInboxItem[]>([])
  let loaded = $state(false)

  let isLeader = false
  let channel: BroadcastChannel | null = null
  let onNew: ((found: ChatInboxItem | undefined) => void) | undefined
  let lastFetchStart = 0
  let inFlight: Promise<void> | null = null
  let pendingAgain = false
  let lazyTimer: ReturnType<typeof setTimeout> | null = null

  function applySnapshot(c: number, its: ChatInboxItem[]): void {
    count = c
    items = its
    loaded = true
  }

  async function fetchOnce(): Promise<void> {
    try {
      const dismissed = readDismissed()
      const qs = dismissed.length > 0 ? `?exclude=${encodeURIComponent(dismissed.join(','))}` : ''
      const res = await fetch(`/api/cms/chat/inbox${qs}`, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) }) // 응답이 멈춰도 합치기 상태(inFlight)가 영구히 걸리지 않게 제한
      if (!res.ok) return
      const body = (await res.json()) as { count?: number; items?: ChatInboxItem[] }
      const c = typeof body.count === 'number' ? body.count : 0
      const its = Array.isArray(body.items) ? body.items : []
      applySnapshot(c, its)
      channel?.postMessage({ t: 'snap', count: c, items: its } satisfies SyncMessage)
    } catch {
      // 네트워크 오류는 다음 주기에 재시도(표시는 직전 값 유지)
    }
  }

  /** 대표 탭에서만 실제 조회. 진행 중이면 끝난 뒤 한 번만 더 실행(합치기). */
  function refreshNow(): Promise<void> {
    if (!isLeader) return Promise.resolve()
    if (inFlight) {
      pendingAgain = true
      return inFlight
    }
    inFlight = (async () => {
      do {
        pendingAgain = false
        lastFetchStart = Date.now()
        await fetchOnce()
      } while (pendingAgain && isLeader)
    })().finally(() => { inFlight = null })
    return inFlight
  }

  /** 급하지 않은 변화(관리자 답장·대화 종료 등) — 짧게 모아서 한 번만 */
  function scheduleRefresh(): void {
    if (lazyTimer) clearTimeout(lazyTimer)
    lazyTimer = setTimeout(() => { lazyTimer = null; void refreshNow() }, LAZY_DEBOUNCE_MS)
  }

  /** 마지막 조회가 maxAgeMs 이내면 건너뛴다. 대표 탭이 아니면 대표 탭에 요청한다. */
  function refreshIfStale(maxAgeMs: number = INBOX_STALE_MS): void {
    if (isLeader) {
      if (Date.now() - lastFetchStart >= maxAgeMs) void refreshNow()
    } else {
      channel?.postMessage({ t: 'refresh', maxAgeMs } satisfies SyncMessage)
    }
  }

  /** 이벤트 카드를 이 브라우저에서 "확인" 처리 — 응답 대기 건은 영향 없음(전 탭 공통 저장소) */
  function dismissEvent(messageId: string): void {
    const dismissed = readDismissed()
    if (!dismissed.includes(messageId)) writeDismissed([...dismissed, messageId])
    // 즉시 화면 반영 후 서버 기준으로 다시 맞춘다
    const before = items.length
    items = items.filter((i) => i.message_id !== messageId)
    if (items.length < before) count = Math.max(0, count - 1)
    if (isLeader) void refreshNow()
    else channel?.postMessage({ t: 'refresh', maxAgeMs: 0 } satisfies SyncMessage)
  }

  /**
   * 시작. onNewMessage는 "관리자가 알아야 할 새 메시지"가 도착해 목록이 갱신된 뒤(모든 탭에서) 호출된다.
   * 반환 함수로 정리한다.
   */
  function start(onNewMessage?: (found: ChatInboxItem | undefined) => void): () => void {
    onNew = onNewMessage
    const cleanups: Array<() => void> = []
    let stopped = false

    const canElect =
      typeof navigator !== 'undefined' && 'locks' in navigator && typeof BroadcastChannel !== 'undefined'

    if (canElect) {
      channel = new BroadcastChannel(SYNC_CHANNEL)
      channel.onmessage = (e: MessageEvent<SyncMessage>) => {
        const m = e.data
        if (m.t === 'snap') applySnapshot(m.count, m.items)
        else if (m.t === 'new') onNew?.(m.found ?? undefined)
        else if (m.t === 'hello' && isLeader && loaded) channel?.postMessage({ t: 'snap', count, items: $state.snapshot(items) } satisfies SyncMessage) // 반응형 값은 그대로 보낼 수 없어(복제 오류) 일반 값으로 변환
        else if (m.t === 'refresh' && isLeader) refreshIfStale(m.maxAgeMs)
      }
      cleanups.push(() => { channel?.close(); channel = null })
    }

    // 화면이 다시 보이면(탭 복귀·창 포커스) 오래된 경우에만 갱신
    const onVisible = () => { if (document.visibilityState === 'visible') refreshIfStale(INBOX_STALE_MS) }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    cleanups.push(() => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    })

    // ── 대표 탭 전용 작업: 실시간 구독 + 주기 갱신 ──
    function becomeLeader(): () => void {
      isLeader = true
      const unsubMessages = subscribeToAllMessages((m) => {
        if (!isInboxRelevantMessage(m)) {
          scheduleRefresh() // 관리자 답장·자동응답 등 — 목록에서 빠지는 변화
          return
        }
        // 알림 대상 새 메시지는 지연 없이 갱신(진행 중이면 합침) → 해당 대화 정보를 모든 탭에 알린다
        void refreshNow().then(() => {
          const found = items.find((i) => i.session_id === m.session_id)
          // items는 반응형 값이라 BroadcastChannel로 그대로 보내면 DataCloneError — 일반 값으로 변환해 보낸다
          const plain = found ? $state.snapshot(found) : undefined
          onNew?.(plain)
          try { channel?.postMessage({ t: 'new', found: plain ?? null } satisfies SyncMessage) } catch { /* 다른 탭 알림 실패는 이 탭 동작에 영향 없음 */ }
        })
      })
      // 대화 종료만 반영(메시지 도착과 겹치는 갱신 제거). 재개는 새 메시지·주기 갱신·화면 이동으로 따라잡는다.
      const unsubSessions = subscribeToSessions((s) => { if (s.status === 'closed') scheduleRefresh() })

      let pollTimer: ReturnType<typeof setTimeout> | null = null
      const tick = () => {
        void refreshNow()
        pollTimer = setTimeout(tick, document.visibilityState === 'hidden' ? INBOX_POLL_HIDDEN_MS : INBOX_POLL_VISIBLE_MS)
      }
      void refreshNow()
      pollTimer = setTimeout(tick, document.visibilityState === 'hidden' ? INBOX_POLL_HIDDEN_MS : INBOX_POLL_VISIBLE_MS)

      return () => {
        isLeader = false
        unsubMessages()
        unsubSessions()
        if (pollTimer) clearTimeout(pollTimer)
        if (lazyTimer) clearTimeout(lazyTimer)
      }
    }

    if (canElect) {
      const abort = new AbortController()
      let releaseLock: (() => void) | null = null
      let teardownLeader: (() => void) | null = null
      navigator.locks
        .request(LOCK_NAME, { signal: abort.signal }, () =>
          new Promise<void>((resolve) => {
            if (stopped) { resolve(); return }
            releaseLock = resolve
            teardownLeader = becomeLeader()
          }),
        )
        .catch(() => { /* 정리 중 대기 취소 */ })
      channel?.postMessage({ t: 'hello' } satisfies SyncMessage) // 이미 대표가 있으면 현재 상태를 바로 받는다
      cleanups.push(() => {
        stopped = true
        teardownLeader?.()
        releaseLock?.()
        abort.abort()
      })
    } else {
      // 대표 선출을 지원하지 않는 환경 — 이 탭이 직접 조회한다
      cleanups.push(becomeLeader())
    }

    return () => { for (const c of cleanups) c() }
  }

  return {
    get count() { return count },
    get items() { return items },
    get loaded() { return loaded },
    refreshIfStale,
    dismissEvent,
    start,
  }
}
