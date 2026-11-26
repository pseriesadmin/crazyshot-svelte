import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { isFreshNewSession, mergeFetchedSessions, createRefetchScheduler, NEW_SESSION_WINDOW_MS } from '$lib/utils/chatSessionSync'
import type { ChatSession } from '$lib/types/chat'

const NOW = Date.parse('2026-11-26T03:00:00Z')
const iso = (offsetMs: number): string => new Date(NOW + offsetMs).toISOString()

function session(id: string, createdOffset: number, updatedOffset: number): ChatSession {
  return {
    id, user_id: 'u', admin_id: null, status: 'open', context_type: 'general', context_id: null,
    context_reservation_id: null, created_at: iso(createdOffset), updated_at: iso(updatedOffset),
    last_message_at: null, closed_at: null,
  }
}

describe('isFreshNewSession — 목록에 없는 세션 이벤트를 바로 끼워 넣어도 되는지', () => {
  it('방금 만들어진 세션은 true', () => {
    expect(isFreshNewSession(session('a', -1000, 0), NOW)).toBe(true)
  })
  it('오래전에 만들어진 세션(옛 카드 되살아남)은 false', () => {
    expect(isFreshNewSession(session('a', -30 * 24 * 3600 * 1000, 0), NOW)).toBe(false)
  })
  it('경계: 허용 시간 직후는 false', () => {
    expect(isFreshNewSession(session('a', -(NEW_SESSION_WINDOW_MS + 1), 0), NOW)).toBe(false)
  })
  it('created_at 이 없거나 깨지면 false', () => {
    expect(isFreshNewSession({ created_at: '' }, NOW)).toBe(false)
    expect(isFreshNewSession({ created_at: 'x' }, NOW)).toBe(false)
  })
})

describe('mergeFetchedSessions — 서버 목록으로 교체할 때 새 세션 보존·옛 잔재 제거', () => {
  const fetchStart = NOW
  it('요청 직전·직후에 실시간으로 들어온 새 세션은 응답에 없어도 보존한다', () => {
    const fresh = session('new', -1000, -500)
    const fetched = [session('f1', -9999999, -9999999)]
    const merged = mergeFetchedSessions([fresh, ...fetched], fetched, fetchStart)
    expect(merged.map((s) => s.id)).toEqual(['new', 'f1'])
  })
  it('응답에 없고 요청보다 한참 전에 들어온 로컬 세션(옛 카드 잔재)은 버린다', () => {
    const stale = session('old', -90 * 24 * 3600 * 1000, -80 * 24 * 3600 * 1000)
    const fetched = [session('f1', -1000, -1000)]
    const merged = mergeFetchedSessions([stale, ...fetched], fetched, fetchStart)
    expect(merged.map((s) => s.id)).toEqual(['f1'])
  })
  it('응답에 이미 있는 세션은 응답 값을 쓴다(중복 없음)', () => {
    const local = { ...session('a', -1000, -500), user_name: '' }
    const fromServer = { ...session('a', -1000, -500), user_name: '홍길동' }
    const merged = mergeFetchedSessions([local], [fromServer], fetchStart)
    expect(merged).toHaveLength(1)
    expect(merged[0].user_name).toBe('홍길동')
  })
})

describe('mergeFetchedSessions — 시계 차이·삭제 경합 보강', () => {
  const fetchStart = NOW
  it('서버 시각이 브라우저보다 한참 뒤처져 있어도, 이 브라우저가 방금 받은 세션은 도착 시각 기준으로 보존한다', () => {
    const skewed = session('new', -10 * 60 * 1000, -10 * 60 * 1000)
    const arrivedAt = new Map([['new', NOW - 1000]])
    const merged = mergeFetchedSessions([skewed], [], fetchStart, { arrivedAt })
    expect(merged.map((s) => s.id)).toEqual(['new'])
  })
  it('도착 시각이 오래된 세션은 서버 시각이 최근이어도 버린다(도착 기록이 우선)', () => {
    const s1 = session('old', -1000, -500)
    const arrivedAt = new Map([['old', NOW - 60 * 1000]])
    expect(mergeFetchedSessions([s1], [], fetchStart, { arrivedAt })).toEqual([])
  })
  it('도착 기록이 없는 세션은 기존처럼 서버 시각으로 판단한다', () => {
    const recent = session('r', -1000, -500)
    expect(mergeFetchedSessions([recent], [], fetchStart, { arrivedAt: new Map() }).map((s) => s.id)).toEqual(['r'])
  })
  it('삭제한 세션은 응답에 남아 있어도, 로컬에 있어도 되살리지 않는다', () => {
    const del = session('del', -1000, -500)
    const keepOne = session('k', -1000, -500)
    const excludeIds = new Set(['del'])
    const merged = mergeFetchedSessions([del, keepOne], [del, session('f', -2000, -2000)], fetchStart, { excludeIds })
    expect(merged.map((s) => s.id)).toEqual(['k', 'f'])
  })
})

describe('createRefetchScheduler — 재조회 예약', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('단독 요청은 지연 뒤 한 번 실행한다', () => {
    const run = vi.fn()
    const sch = createRefetchScheduler(run)
    sch.schedule(500)
    vi.advanceTimersByTime(499)
    expect(run).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(run).toHaveBeenCalledTimes(1)
  })
  it('짧은 예약 뒤 긴 요청이 와도 짧은 예약은 늦춰지지 않고, 긴 요청도 사라지지 않는다', () => {
    const run = vi.fn()
    const sch = createRefetchScheduler(run)
    sch.schedule(500)
    vi.advanceTimersByTime(100)
    sch.schedule(3000)
    vi.advanceTimersByTime(400)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2600)
    expect(run).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(10000)
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('긴 예약 뒤 짧은 요청이 오면 짧은 쪽으로 앞당기고, 긴 요청은 뒤이어 한 번 더 실행한다', () => {
    const run = vi.fn()
    const sch = createRefetchScheduler(run)
    sch.schedule(3000)
    vi.advanceTimersByTime(1000)
    sch.schedule(500)
    vi.advanceTimersByTime(500)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(1500)
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('같은 지연의 요청이 연달아 와도 중복 실행이 폭주하지 않는다', () => {
    const run = vi.fn()
    const sch = createRefetchScheduler(run)
    sch.schedule(3000)
    vi.advanceTimersByTime(1000)
    sch.schedule(3000)
    vi.advanceTimersByTime(2000)
    expect(run).toHaveBeenCalledTimes(1)
    vi.advanceTimersByTime(2000)
    expect(run).toHaveBeenCalledTimes(2)
    vi.advanceTimersByTime(20000)
    expect(run).toHaveBeenCalledTimes(2)
  })
  it('cancel 하면 예약된 실행이 모두 사라진다', () => {
    const run = vi.fn()
    const sch = createRefetchScheduler(run)
    sch.schedule(500)
    sch.schedule(3000)
    sch.cancel()
    vi.advanceTimersByTime(10000)
    expect(run).not.toHaveBeenCalled()
  })
})

describe('AdminChatPanel 배선 — 소스 점검(핵심 연결만)', () => {
  const src = readFileSync('src/lib/components/chat/AdminChatPanel.svelte', 'utf8')
  it('옛 세션 실시간 이벤트는 직접 삽입하지 않고 목록 재조회로 처리한다', () => {
    expect(src).toContain('!isFreshNewSession(session)')
  })
  it('서버 목록 교체(자동·수동)는 mergeFetchedSessions 를 거치고, 삭제·도착 기록을 넘긴다', () => {
    expect(src.match(/mergeFetchedSessions\(/g)?.length).toBeGreaterThanOrEqual(2)
    expect(src).toContain('excludeIds: deletedSessionIds')
    expect(src).toContain('arrivedAt: sessionArrivedAt')
  })
  it('재조회 예약은 예약기(createRefetchScheduler)로만 한다', () => {
    expect(src).toContain('createRefetchScheduler(')
    expect(src).not.toContain('scheduleSessionsRefetch')
  })
})
