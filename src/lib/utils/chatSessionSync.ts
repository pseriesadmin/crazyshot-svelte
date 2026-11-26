// 상담 세션 목록 동기화 규칙 — 실시간(Realtime) 이벤트와 서버 목록 응답을 합칠 때의 판단 기준(순수 함수).
//
// 배경(2026-11-26 오류): ①서버 목록은 최근 100건만 주는데, 실시간 UPDATE 가 온 '목록에 없던 옛 세션'을 그대로
// 맨 앞에 끼워 넣어 과거 대화카드가 튀어나왔다(고객 이름·마지막 대화 없이). ②서버 목록 응답이 실시간으로 방금
// 들어온 새 세션보다 먼저 계산돼 있으면, 응답으로 목록을 통째로 교체할 때 새 세션이 사라져 배지에만 남았다.

import type { ChatSession } from '$lib/types/chat'

/** 이 시간 안에 만들어진 세션만 '신규 세션'으로 보고 목록에 바로 끼워 넣는다 */
export const NEW_SESSION_WINDOW_MS = 2 * 60 * 1000

/** 응답 교체 때 로컬 최신 세션을 보호하는 여유 시간(서버·브라우저 시계 차이 흡수) */
export const FETCH_GRACE_MS = 5 * 1000

function ms(iso: string | null | undefined): number {
  if (!iso) return 0
  const t = Date.parse(iso)
  return Number.isNaN(t) ? 0 : t
}

/**
 * 목록에 없는 세션의 실시간 이벤트를 목록에 직접 넣어도 되는지.
 * - 새로 만들어진 세션(created_at 이 최근)만 true.
 * - 옛 세션이 되살아난 경우(새 메시지로 재개 등)는 false — 서버 목록을 다시 받아 이름·미리보기까지 채운 완전한 카드로 보여준다.
 */
export function isFreshNewSession(session: Pick<ChatSession, 'created_at'>, now: number = Date.now()): boolean {
  const created = ms(session.created_at)
  return created > 0 && now - created <= NEW_SESSION_WINDOW_MS
}

export interface MergeOptions {
  /** 세션 id → 이 브라우저가 실시간 이벤트를 받은 시각(ms). 있으면 서버 시각(updated_at) 대신 이 값으로 '최근 여부'를 판단해 시계 차이를 피한다 */
  arrivedAt?: ReadonlyMap<string, number>
  /** 이 화면에서 삭제한 세션 id — 삭제 직전에 요청된 응답에 남아 있어도 되살리지 않는다 */
  excludeIds?: ReadonlySet<string>
}

/**
 * 서버 목록 응답(fetched)으로 현재 목록(current)을 교체하되, 응답을 요청한 시각(fetchStartedAt) 무렵 이후에
 * 실시간으로 들어온 세션이 응답에 없으면 보존한다(요청과 실시간 이벤트의 경합으로 새 세션이 사라지지 않도록).
 * 응답에도 없고 요청 이전에 들어온 로컬 세션(옛 세션 잔재)은 버린다.
 */
export function mergeFetchedSessions(
  current: ChatSession[],
  fetched: ChatSession[],
  fetchStartedAt: number,
  options: MergeOptions = {}
): ChatSession[] {
  const { arrivedAt, excludeIds } = options
  const base = excludeIds && excludeIds.size > 0 ? fetched.filter((s) => !excludeIds.has(s.id)) : fetched
  const fetchedIds = new Set(base.map((s) => s.id))
  const threshold = fetchStartedAt - FETCH_GRACE_MS
  const keep = current.filter((s) => {
    if (fetchedIds.has(s.id)) return false
    if (excludeIds?.has(s.id)) return false
    const arrived = arrivedAt?.get(s.id)
    const recent = arrived !== undefined ? arrived : Math.max(ms(s.updated_at), ms(s.created_at))
    return recent >= threshold
  })
  return keep.length > 0 ? [...keep, ...base] : base
}

/**
 * 목록 재조회 예약기. 여러 곳에서 서로 다른 지연으로 요청해도
 *  - 더 빨리 실행될 예약이 있으면 그대로 두고(먼저 예약된 짧은 재조회를 늦추지 않음),
 *  - 더 늦은 요청이 있었다면 앞선 실행 뒤에 한 번 더 실행한다(늦은 요청이 흡수돼 사라지지 않음).
 */
export function createRefetchScheduler(run: () => void): { schedule: (delayMs?: number) => void; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null
  let earliestDue = 0
  let latestDue = 0

  function fire(): void {
    timer = null
    const remaining = latestDue - Date.now()
    run()
    if (remaining > 5) {
      earliestDue = latestDue
      timer = setTimeout(fire, remaining)
    }
  }

  function schedule(delayMs: number = 3000): void {
    const dueAt = Date.now() + delayMs
    if (dueAt > latestDue) latestDue = dueAt
    if (timer && earliestDue <= dueAt) return
    if (timer) clearTimeout(timer)
    earliestDue = dueAt
    timer = setTimeout(fire, delayMs)
  }

  function cancel(): void {
    if (timer) clearTimeout(timer)
    timer = null
    latestDue = 0
  }

  return { schedule, cancel }
}
