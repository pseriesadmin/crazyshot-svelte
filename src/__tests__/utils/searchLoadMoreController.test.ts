import { beforeEach, describe, expect, it, vi } from 'vitest'
import { runLoadMore, type LoadMoreIo, type LoadMoreState } from '$lib/utils/searchLoadMore'

// 검색 결과 '더보기' 클릭 처리(runLoadMore) 동작 테스트 (2026-10-27, sp3 MAJOR-1) —
// 이전 검색 응답 폐기·로딩 상태 복구·연타 방지·검색 중 무시·실패 시 받아둔 항목 노출을 고정한다.

type Item = { id: string }
const items = (from: number, to: number): Item[] => Array.from({ length: to - from + 1 }, (_, i) => ({ id: `p${from + i}` }))

interface Harness {
  state: LoadMoreState<Item>
  seq: { value: number }
  io: LoadMoreIo<Item>
  fetchPage: ReturnType<typeof vi.fn>
  onError: ReturnType<typeof vi.fn>
}

function make(overrides: Partial<LoadMoreState<Item>> = {}): Harness {
  const state: LoadMoreState<Item> = {
    query: '카메라',
    results: items(1, 50),
    visibleCount: 12,
    resultsPage: 1,
    total: null,
    hasMoreRemote: true,
    isLoadingMore: false,
    isSearching: false,
    ...overrides,
  }
  const seq = { value: 1 }
  const fetchPage = vi.fn()
  const onError = vi.fn()
  const io: LoadMoreIo<Item> = {
    getSeq: () => seq.value,
    read: () => ({ ...state }),
    write: (patch) => { Object.assign(state, patch) },
    fetchPage,
    onError,
  }
  return { state, seq, io, fetchPage, onError }
}

function deferred<T>() {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}

let h: Harness
beforeEach(() => { h = make() })

describe('runLoadMore — 받아둔 결과로 충분할 때', () => {
  it('서버에 묻지 않고 12개만 더 보여준다', async () => {
    await runLoadMore(h.io)
    expect(h.fetchPage).not.toHaveBeenCalled()
    expect(h.state.visibleCount).toBe(24)
  })

  it('서버에 더 없으면 불러온 개수를 넘지 않는다', async () => {
    h = make({ results: items(1, 30), visibleCount: 24, hasMoreRemote: false })
    await runLoadMore(h.io)
    expect(h.state.visibleCount).toBe(30)
    expect(h.fetchPage).not.toHaveBeenCalled()
  })
})

describe('runLoadMore — 다음 페이지 요청', () => {
  it('받아둔 50개를 거의 다 보여줬으면 page=2를 받아 이어 붙이고 12개 더 보여준다', async () => {
    h = make({ visibleCount: 48 })
    h.fetchPage.mockResolvedValue({ items: items(51, 100), rawCount: 50 })
    await runLoadMore(h.io)
    expect(h.fetchPage).toHaveBeenCalledWith('카메라', 2)
    expect(h.state.results).toHaveLength(100)
    expect(h.state.resultsPage).toBe(2)
    expect(h.state.hasMoreRemote).toBe(true)
    expect(h.state.visibleCount).toBe(60)
    expect(h.state.isLoadingMore).toBe(false)
  })

  it('정확히 50건이라 다음 페이지가 0건이면 더보기를 끝낸다(버튼이 사라지는 상태)', async () => {
    h = make({ visibleCount: 50 })
    h.fetchPage.mockResolvedValue({ items: [], rawCount: 0 })
    await runLoadMore(h.io)
    expect(h.state.hasMoreRemote).toBe(false)
    expect(h.state.results).toHaveLength(50)
    expect(h.state.isLoadingMore).toBe(false)
  })

  it('다음 페이지가 앞 페이지와 전부 중복이면(폴백 반복) 더 없다고 보고 끝낸다', async () => {
    h = make({ visibleCount: 48 })
    h.fetchPage.mockResolvedValue({ items: items(1, 50), rawCount: 50 })
    await runLoadMore(h.io)
    expect(h.state.hasMoreRemote).toBe(false)
    expect(h.state.results).toHaveLength(50)
  })
})

describe('runLoadMore — 연타·검색 중·빈 검색어', () => {
  it('요청이 진행 중일 때 다시 눌러도 서버 요청은 1회뿐이다', async () => {
    h = make({ visibleCount: 48 })
    const d = deferred<{ items: Item[]; rawCount: number }>()
    h.fetchPage.mockReturnValue(d.promise)
    const first = runLoadMore(h.io)
    const second = runLoadMore(h.io)
    d.resolve({ items: items(51, 100), rawCount: 50 })
    await Promise.all([first, second])
    expect(h.fetchPage).toHaveBeenCalledTimes(1)
    expect(h.state.visibleCount).toBe(60)
  })

  it('새 검색이 진행 중(isSearching)이면 아무 것도 하지 않는다', async () => {
    h = make({ visibleCount: 48, isSearching: true })
    await runLoadMore(h.io)
    expect(h.fetchPage).not.toHaveBeenCalled()
    expect(h.state.visibleCount).toBe(48)
    expect(h.state.isLoadingMore).toBe(false)
  })

  it('검색어가 비어 있으면 아무 것도 하지 않는다', async () => {
    h = make({ query: '', visibleCount: 48 })
    await runLoadMore(h.io)
    expect(h.fetchPage).not.toHaveBeenCalled()
    expect(h.state.visibleCount).toBe(48)
  })
})

describe('runLoadMore — 늦게 도착한 이전 검색 응답', () => {
  it('요청 중 새 검색이 시작되면(seq 변경) 응답을 버리고 상태를 건드리지 않는다', async () => {
    h = make({ visibleCount: 48 })
    const d = deferred<{ items: Item[]; rawCount: number }>()
    h.fetchPage.mockReturnValue(d.promise)
    const pending = runLoadMore(h.io)
    // 새 검색 시작 — doSearch가 seq를 올리고 결과를 새로 채운다
    h.seq.value = 2
    Object.assign(h.state, { results: items(201, 205), resultsPage: 1, hasMoreRemote: false, visibleCount: 12, isLoadingMore: false })
    d.resolve({ items: items(51, 100), rawCount: 50 })
    await pending
    expect(h.state.results.map((x) => x.id)).toEqual(['p201', 'p202', 'p203', 'p204', 'p205'])
    expect(h.state.resultsPage).toBe(1)
    expect(h.state.visibleCount).toBe(12)
    expect(h.onError).not.toHaveBeenCalled()
  })

  it('이전 검색의 실패 응답도 새 검색 상태를 건드리지 않고 오류 안내도 띄우지 않는다', async () => {
    h = make({ visibleCount: 48 })
    const d = deferred<{ items: Item[]; rawCount: number }>()
    h.fetchPage.mockReturnValue(d.promise)
    const pending = runLoadMore(h.io)
    h.seq.value = 2
    Object.assign(h.state, { isLoadingMore: true }) // 새 검색 쪽 요청이 진행 중이라고 가정
    d.reject(new Error('network'))
    await pending
    expect(h.onError).not.toHaveBeenCalled()
    expect(h.state.isLoadingMore).toBe(true)
  })
})

describe('runLoadMore — 요청 실패', () => {
  it('실패하면 로딩을 풀고 오류를 알리며, 이미 받아둔 항목은 12개 한도 안에서 보여준다', async () => {
    h = make({ visibleCount: 48 })
    h.fetchPage.mockRejectedValue(new Error('network'))
    await runLoadMore(h.io)
    expect(h.state.isLoadingMore).toBe(false)
    expect(h.onError).toHaveBeenCalledTimes(1)
    expect(h.state.visibleCount).toBe(50) // 49~50번째 상품이 보인다
    expect(h.state.results).toHaveLength(50)
    expect(h.state.resultsPage).toBe(1)
    expect(h.state.hasMoreRemote).toBe(true) // 다시 누르면 재시도할 수 있다
  })

  it('실패 후 다시 눌러 성공하면 이어서 받는다', async () => {
    h = make({ visibleCount: 48 })
    h.fetchPage.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ items: items(51, 100), rawCount: 50 })
    await runLoadMore(h.io)
    await runLoadMore(h.io)
    expect(h.state.results).toHaveLength(100)
    expect(h.state.resultsPage).toBe(2)
    expect(h.state.visibleCount).toBe(62)
  })
})

describe('runLoadMore — 서버가 준 전체 건수(total_count)', () => {
  it('전체 건수를 알면 마지막 페이지를 받은 뒤 더 없다고 판정한다(한 번 더 눌러 확인할 필요 없음)', async () => {
    h = make({ visibleCount: 48, total: 92 })
    h.fetchPage.mockResolvedValue({ items: items(51, 92), rawCount: 42, total: 92 })
    await runLoadMore(h.io)
    expect(h.state.results).toHaveLength(92)
    expect(h.state.total).toBe(92)
    expect(h.state.hasMoreRemote).toBe(false)
    expect(h.state.visibleCount).toBe(60)
  })

  it('정확히 50건(total 50, 더 없음)이면 서버에 묻지 않고 받아둔 것만 끝까지 보여준다', async () => {
    h = make({ visibleCount: 48, total: 50, hasMoreRemote: false })
    await runLoadMore(h.io)
    expect(h.fetchPage).not.toHaveBeenCalled()
    expect(h.state.visibleCount).toBe(50)
  })

  it('다음 페이지 응답에 total이 없으면(폴백이 섞임) 앞서 알던 전체 건수를 유지한다', async () => {
    h = make({ visibleCount: 48, total: 92 })
    h.fetchPage.mockResolvedValue({ items: items(51, 100), rawCount: 50, total: null })
    await runLoadMore(h.io)
    expect(h.state.total).toBe(92)
    expect(h.state.hasMoreRemote).toBe(false) // 100개를 받았으니 92를 넘었다
  })

  it('다음 페이지 응답에 total이 있으면 최신 값으로 갱신한다', async () => {
    h = make({ visibleCount: 48, total: 92 })
    h.fetchPage.mockResolvedValue({ items: items(51, 90), rawCount: 40, total: 120 })
    await runLoadMore(h.io)
    expect(h.state.total).toBe(120)
    expect(h.state.hasMoreRemote).toBe(true) // 90 < 120
  })

  it('실패해도 알던 전체 건수는 그대로다', async () => {
    h = make({ visibleCount: 48, total: 92 })
    h.fetchPage.mockRejectedValue(new Error('network'))
    await runLoadMore(h.io)
    expect(h.state.total).toBe(92)
    expect(h.state.hasMoreRemote).toBe(true)
  })
})

