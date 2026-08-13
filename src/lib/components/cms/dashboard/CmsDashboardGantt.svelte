<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { fly } from 'svelte/transition'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import type { RentalListRow } from '../../../../routes/cms/reservation/+page.server'

  interface Props {
    initial: { from: string; to: string; rows: RentalListRow[] }
  }

  let { initial }: Props = $props()

  // ── 레이아웃 상수 ─────────────────────────────────────────────────────────
  const COL_W      = 100  // px — 1일 컬럼 너비
  const LABEL_W    = 220  // px — 좌측 고정 라벨 컬럼 너비
  const ROW_H      = 52   // px — 데이터 행 높이
  const BAR_H      = 28   // px — 막대 높이
  const BAR_TOP    = Math.round((ROW_H - BAR_H) / 2)  // 막대 수직 중앙
  const TRIGGER_D  = 3    // 끝에서 이 일수 이내로 오면 다음 청크 로드
  const HEADER_H   = 66   // px — 헤더 2단 높이(월 행 26 + 일자 행 40)
  const DEFAULT_ROWS = 15 // 예약이 이보다 적어도 기본으로 항상 보여줄 빈 셀 라인 수

  // ── State ─────────────────────────────────────────────────────────────────
  // untrack(): SSR 초기값을 의도적으로 1회만 캡처 — prop 변경 추적 불필요
  // (initial은 서버에서 한 번 전달되는 불변 시드 데이터, 이후 클라이언트가 독립 관리)
  let loadedFrom    = $state(untrack(() => initial.from))
  let loadedTo      = $state(untrack(() => initial.to))
  // reservation_id(number) 기준 dedup — 동일 예약이 두 청크 경계에 있을 때 중복 방지
  let rowsMap       = $state(new Map<number, RentalListRow>(
    untrack(() => initial.rows.map(r => [r.reservation_id, r]))
  ))
  let selectedRow   = $state<RentalListRow | null>(null)
  // 클릭한 지점(라벨셀 또는 막대) 근처에 상세 팝오버를 띄우기 위한 앵커 좌표
  // (뷰포트 기준 fixed 포지셔닝 — 우측 고정 드로어 대신 "선택한 위치에 노출" 요구 반영,
  // 2026-08-13 Stephen "선택한 위치에 노출해" 피드백)
  let anchorRect    = $state<{ top: number; bottom: number; left: number; right: number } | null>(null)
  let isLoadingMore = $state(false)
  let ganttEl: HTMLDivElement | null = null
  let rafPending    = false

  // ── Derived ───────────────────────────────────────────────────────────────
  // toISOString()(UTC) 대신 로컬 date getter로 직접 포맷 — KST 등에서 "오늘" 하이라이트가
  // 하루 밀리는 것 방지(addDays와 동일한 타임존 버그 계열, 2026-08-12 함께 수정)
  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`

  let days = $derived(getDaysArray(loadedFrom, loadedTo))

  // 월 단위 그룹핑(2단 헤더 — 상위: 월, 하위: 일자) — days가 무한스크롤로 늘어나도 자동 재계산
  interface MonthGroup { key: string; label: string; count: number }
  let monthGroups = $derived(groupDaysByMonth(days))

  let sortedRows = $derived(
    [...rowsMap.values()].sort(
      (a, b) =>
        a.product_name.localeCompare(b.product_name) ||
        a.rental_start.localeCompare(b.rental_start)
    )
  )

  // 오늘 컬럼 X 좌표 (로드된 범위 안에 있을 때만)
  let todayX = $derived(
    todayStr >= loadedFrom && todayStr <= loadedTo
      ? dayIndex(todayStr, loadedFrom) * COL_W
      : null
  )

  // 예약이 15건보다 적어도 항상 15개 라인 셀(그리드 행)을 기본으로 채워서 보여준다 —
  // 실제 예약이 있으면 그 행에 막대가 그려지고, 없는 나머지 행은 빈 그리드 라인만 표시(흰
  // 빈 화면 방지). 15건을 넘으면 실제 건수만큼 전부 표시(자르지 않음).
  let visibleRowSlots = $derived(Math.max(sortedRows.length, DEFAULT_ROWS))
  let scrollAreaHeight = $derived(HEADER_H + visibleRowSlots * ROW_H)
  // {#each}는 배열/이터러블이 필요 — {length:N} 같은 평범한 객체는 런타임에 순회 불가하므로
  // Array.from으로 실제 배열을 만들어 전달
  let emptyRowIndexes = $derived(
    Array.from({ length: Math.max(0, visibleRowSlots - sortedRows.length) }, (_, i) => i)
  )

  // ── 날짜 유틸 ────────────────────────────────────────────────────────────
  // ⛔ 로컬시간 Date(getDate/setDate) + toISOString()(항상 UTC) 혼용 금지 —
  // UTC+9(KST) 등에서 addDays('YYYY-MM-DD', 1)이 같은 날짜를 무한 반환해
  // getDaysArray()의 while 루프가 종료되지 않는 치명적 버그를 유발함(2026-08-12 실사용 중
  // 발견 — dev 서버가 이 무한루프로 메모리 폭증 후 OOM 크래시, /cms 접속 불가 원인).
  // Date.UTC()로 순수 UTC 산술만 사용해 로컬 타임존과 완전히 무관하게 계산.
  function addDays(dateStr: string, n: number): string {
    const [y, m, d] = dateStr.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
  }

  function getDaysArray(from: string, to: string): string[] {
    const result: string[] = []
    let cur = from
    while (cur <= to) {
      result.push(cur)
      cur = addDays(cur, 1)
    }
    return result
  }

  function dayIndex(dateStr: string, from: string): number {
    const ms = new Date(dateStr + 'T00:00:00').getTime()
           - new Date(from + 'T00:00:00').getTime()
    return Math.round(ms / 86_400_000)
  }

  const DOW = ['일', '월', '화', '수', '목', '금', '토']

  // 월은 상위 .gantt-month-row에서 이미 표시되므로 일자 행에서는 "일(요일)"만 표시
  function formatDayHeader(dateStr: string): string {
    const d = new Date(dateStr + 'T00:00:00')
    return `${d.getDate()}(${DOW[d.getDay()]})`
  }

  // 'YYYY-MM-DD' 문자열 그대로 슬라이싱 — Date 객체 로컬/UTC 혼용 없이 월 라벨 계산
  // (addDays와 동일 원칙, 이 세션에서 이미 겪은 타임존 버그 재발 방지)
  function groupDaysByMonth(dayList: string[]): MonthGroup[] {
    const groups: MonthGroup[] = []
    for (const day of dayList) {
      const key = day.slice(0, 7) // 'YYYY-MM'
      const last = groups[groups.length - 1]
      if (last && last.key === key) {
        last.count++
      } else {
        const [y, m] = day.split('-')
        groups.push({ key, label: `${y}년 ${Number(m)}월`, count: 1 })
      }
    }
    return groups
  }

  // ── 상태 라벨 / 색상 ─────────────────────────────────────────────────────
  // reservation/+page.svelte:25-49 원문 그대로 복사
  const STATUS_LABEL: Record<string, string> = {
    pending: '접수', hold: '신청대기', confirmed: '승인완료', shipped: '배송중',
    in_use: '대여중', return_requested: '반납요청', returned: '반납완료',
    completed: '완료', cancelled: '취소', damage_claimed: '파손신고',
  }

  const STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    pending:          { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    hold:             { bg: 'rgba(245,158,11,0.12)',  color: 'var(--cs-warning)' },
    confirmed:        { bg: 'rgba(16,185,129,0.12)',  color: 'var(--cs-success-light)' },
    shipped:          { bg: 'rgba(14,165,233,0.12)',  color: 'var(--cs-info)' },
    in_use:           { bg: 'rgba(59,47,138,0.12)',   color: 'var(--cs-purple)' },
    return_requested: { bg: 'rgba(255,69,0,0.12)',    color: 'var(--cs-orange)' },
    returned:         { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    completed:        { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
    cancelled:        { bg: 'rgba(255,53,53,0.10)',   color: 'var(--cs-red-badge)' },
    damage_claimed:   { bg: 'rgba(255,53,53,0.10)',   color: 'var(--cs-red-badge)' },
  }

  // ── 연체 판정 ────────────────────────────────────────────────────────────
  // 반납 기한(rental_end)이 지났는데도 아직 반출중 계열 상태(confirmed/shipped/in_use —
  // rental-lifecycle.md "반출중" 정의와 동일)면 연체로 간주. return_requested부터는 이미
  // 반납 절차가 시작된 상태라 연체 표시 대상에서 제외. 이 프로젝트에는 반납기한 초과를 자동
  // 감지하는 cron/트리거가 없어(2026-08-13 조사 확인 — hold_expiration_cleanup/
  // monthly_credit_score_boost/subscription_expiry_check 3개뿐) 순수 화면 표시 로직으로만 판정.
  const OVERDUE_STATUSES = new Set(['confirmed', 'shipped', 'in_use'])
  function isOverdue(row: RentalListRow): boolean {
    return row.rental_end < todayStr && OVERDUE_STATUSES.has(row.status)
  }

  // ── 상세 패널 오픈 — 클릭 지점(라벨셀 또는 막대) 옆에 앵커 ────────────────
  const POPOVER_W = 440
  function openDetail(row: RentalListRow, e: MouseEvent) {
    selectedRow = row
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    anchorRect = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
  }

  // 클릭 지점 우측에 기본 노출, 화면 밖으로 넘치면 좌측으로 뒤집고, 상하좌우 뷰포트 안으로 클램프
  // ⚠️ QA 지적(2026-08-13, GATE E 2차 [이슈A]): 세로 클램핑이 top만 고정값(vh-120)으로
  // 방어해 패널 실제 높이(콘텐츠에 따라 가변, max-height:80vh)를 고려하지 못해 뷰포트 하단을
  // 넘칠 수 있었음(기본 15줄 패딩으로 화면 하단부 행 클릭이 흔해진 상황과 맞물려 실사용
  // 리스크 있음) — 클릭 지점이 화면 하단 절반이면 위로 펼치는 방향으로 뒤집고, 각 방향의
  // "실제 남은 공간"을 max-height로 명시해 넘침 자체를 구조적으로 차단
  let popoverStyle = $derived.by(() => {
    if (!anchorRect) return ''
    const vw = window.innerWidth
    const vh = window.innerHeight
    const MARGIN = 16

    let left = anchorRect.right + 12
    if (left + POPOVER_W > vw - MARGIN) left = anchorRect.left - POPOVER_W - 12
    left = Math.max(MARGIN, Math.min(left, vw - POPOVER_W - MARGIN))

    const openUpward = anchorRect.top > vh / 2
    if (openUpward) {
      const bottom = Math.max(MARGIN, vh - anchorRect.bottom)
      const maxHeight = Math.max(200, anchorRect.bottom - MARGIN)
      return `left:${left}px; bottom:${bottom}px; width:${POPOVER_W}px; max-height:${maxHeight}px;`
    }
    const top = Math.max(MARGIN, anchorRect.top)
    const maxHeight = Math.max(200, vh - top - MARGIN)
    return `left:${left}px; top:${top}px; width:${POPOVER_W}px; max-height:${maxHeight}px;`
  })

  // ── 막대 스타일 계산 ──────────────────────────────────────────────────────
  function getBarStyle(row: RentalListRow): string | null {
    // 로드 범위 완전 벗어남 → 렌더 안 함
    if (row.rental_end < loadedFrom || row.rental_start > loadedTo) return null

    // 범위 내로 클램핑
    const cs = row.rental_start < loadedFrom ? loadedFrom : row.rental_start
    const ce = row.rental_end   > loadedTo   ? loadedTo   : row.rental_end

    const si = dayIndex(cs, loadedFrom)
    const ei = dayIndex(ce, loadedFrom)
    if (si > ei) return null

    const left  = si * COL_W + 4
    const width = (ei - si + 1) * COL_W - 8
    if (width <= 0) return null

    const s = STATUS_STYLE[row.status] ?? { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' }
    return `left:${left}px;width:${width}px;top:${BAR_TOP}px;height:${BAR_H}px;background:${s.bg};color:${s.color};`
  }

  // ── 무한스크롤 — 청크 로드 ───────────────────────────────────────────────
  async function loadMore(direction: 'past' | 'future') {
    if (isLoadingMore) return
    isLoadingMore = true
    try {
      const from = direction === 'future' ? addDays(loadedTo, 1)   : addDays(loadedFrom, -14)
      const to   = direction === 'future' ? addDays(loadedTo, 14)  : addDays(loadedFrom, -1)

      const res = await fetch(`/api/cms/dashboard/gantt-window?from=${from}&to=${to}`)
      if (!res.ok) return

      const { rows: newRows } = await res.json() as { rows: RentalListRow[] }

      // 과거 방향 로드 시: 스크롤 위치 보정용 사전 기록
      const prevLeft  = ganttEl?.scrollLeft ?? 0
      const prevWidth = ganttEl?.scrollWidth ?? 0

      for (const r of newRows) rowsMap.set(r.reservation_id, r)

      if (direction === 'future') {
        loadedTo = to
      } else {
        loadedFrom = from
      }

      // 과거 방향 — DOM 업데이트 후 스크롤 위치 복원
      // (새 날짜가 왼쪽에 추가되면 기존 내용이 오른쪽으로 밀려 UX가 깨짐)
      if (direction === 'past' && ganttEl) {
        await tick()
        const newWidth = ganttEl.scrollWidth
        ganttEl.scrollLeft = prevLeft + (newWidth - prevWidth)
      }
    } finally {
      isLoadingMore = false
    }
  }

  // ── 구간 한정 재조회 (RentalDetailPanel.onrefresh) ───────────────────────
  // invalidateAll() 아님 — 무한스크롤로 확장된 다른 구간 데이터 보존
  async function refetchCurrentWindow() {
    const res = await fetch(
      `/api/cms/dashboard/gantt-window?from=${loadedFrom}&to=${loadedTo}`
    )
    if (!res.ok) return
    const { rows: newRows } = await res.json() as { rows: RentalListRow[] }

    // rental_start가 현재 구간 내 항목 제거 후 최신 데이터로 교체
    // (취소 등 상태 변경으로 숨겨진 예약 제거 포함)
    for (const [id, r] of rowsMap) {
      if (r.rental_start >= loadedFrom && r.rental_start <= loadedTo) {
        rowsMap.delete(id)
      }
    }
    for (const r of newRows) rowsMap.set(r.reservation_id, r)
  }

  // ── 스크롤 핸들러 (RAF 쓰로틀 + isLoadingMore 중복 방지) ─────────────────
  function handleScroll() {
    if (rafPending || isLoadingMore) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      if (!ganttEl) return
      const { scrollLeft, clientWidth, scrollWidth } = ganttEl
      const TRIGGER = COL_W * TRIGGER_D

      if (scrollLeft < TRIGGER) {
        void loadMore('past')
      } else if (scrollLeft + clientWidth > scrollWidth - TRIGGER) {
        void loadMore('future')
      }
    })
  }
</script>

<div class="gantt-outer">
  <!-- 로딩 인디케이터 -->
  {#if isLoadingMore}
    <div class="gantt-loading-badge" aria-live="polite">불러오는 중...</div>
  {/if}

  <div
    class="gantt-scroll"
    style="height:{scrollAreaHeight}px"
    bind:this={ganttEl}
    onscroll={handleScroll}
    role="region"
    aria-label="예약 및 대여 일정 간트"
  >
    <!-- ── 헤더 (sticky top, 2단: 월 그룹 행 + 일자 행) ────────────────────── -->
    <div class="gantt-header-wrap">
      <!-- 1단: 월 단위 그룹 행 -->
      <div class="gantt-month-row">
        <div class="gantt-label-col gantt-label-header-spacer" style="width:{LABEL_W}px;min-width:{LABEL_W}px"></div>
        <div class="gantt-month-headers">
          {#each monthGroups as group (group.key)}
            <div class="gantt-month-header" style="width:{group.count * COL_W}px">
              {group.label}
            </div>
          {/each}
        </div>
      </div>
      <!-- 2단: 일자 행 -->
      <div class="gantt-day-row">
        <!-- 헤더 코너: sticky-x + sticky-y 교차점 -->
        <div class="gantt-label-col gantt-label-header" style="width:{LABEL_W}px;min-width:{LABEL_W}px">
          상품 / 고객
        </div>
        <!-- 날짜 헤더 -->
        <div class="gantt-day-headers" style="min-width:{days.length * COL_W}px">
          {#each days as day (day)}
            <div
              class="gantt-day-header"
              class:gantt-today={day === todayStr}
              style="width:{COL_W}px"
            >
              {formatDayHeader(day)}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- ── 데이터 행 ──────────────────────────────────────────────────────── -->
    {#each sortedRows as row (row.reservation_id)}
      {@const barStyle = getBarStyle(row)}
      <div class="gantt-row" style="height:{ROW_H}px">
        <!-- 좌측 고정 라벨 (position: sticky; left: 0) — 클릭 시 막대와 동일하게 상세 패널 오픈 -->
        <button
          type="button"
          class="gantt-label-col gantt-label-body"
          style="width:{LABEL_W}px;min-width:{LABEL_W}px"
          onclick={(e) => openDetail(row, e)}
        >
          <span class="gantt-product-name" title={row.product_name}>{row.product_name}</span>
          <span class="gantt-customer-name">{row.customer_name}</span>
        </button>

        <!-- 날짜 그리드 트랙 (relative + CSS 배경으로 격자 표현) -->
        <div
          class="gantt-grid-track"
          style="min-width:{days.length * COL_W}px;height:{ROW_H}px;
                 background-image: repeating-linear-gradient(to right, var(--cs-lilac) 0, var(--cs-lilac) 1px, transparent 1px, transparent {COL_W}px);"
        >
          <!-- 오늘 컬럼 강조 -->
          {#if todayX !== null}
            <div
              class="gantt-today-col"
              style="left:{todayX}px;width:{COL_W}px;height:{ROW_H}px"
            ></div>
          {/if}

          <!-- 예약 막대 -->
          {#if barStyle}
            {@const overdue = isOverdue(row)}
            <button
              class="gantt-bar"
              class:gantt-bar-overdue={overdue}
              style={barStyle}
              onclick={(e) => openDetail(row, e)}
              title="{row.product_name} — {row.customer_name} ({STATUS_LABEL[row.status] ?? row.status}){overdue ? ' — 반납 연체' : ''}"
              aria-label="{row.product_name} {row.customer_name} {STATUS_LABEL[row.status] ?? row.status}{overdue ? ' 반납 연체' : ''}"
            >
              {#if overdue}<span class="gantt-bar-overdue-dot" aria-hidden="true"></span>{/if}
              <span class="gantt-bar-code">{row.reservation_code ?? ''}</span>
              <span class="gantt-bar-label">{STATUS_LABEL[row.status] ?? row.status}</span>
            </button>
          {/if}
        </div>
      </div>
    {/each}

    <!-- 기본 15줄 채움 — 예약이 부족한 만큼 빈 그리드 라인으로 패딩(흰 빈 화면 방지) -->
    {#each emptyRowIndexes as i (i)}
      <div class="gantt-row gantt-row-empty" style="height:{ROW_H}px">
        <div class="gantt-label-col gantt-label-body" style="width:{LABEL_W}px;min-width:{LABEL_W}px"></div>
        <div
          class="gantt-grid-track"
          style="min-width:{days.length * COL_W}px;height:{ROW_H}px;
                 background-image: repeating-linear-gradient(to right, var(--cs-lilac) 0, var(--cs-lilac) 1px, transparent 1px, transparent {COL_W}px);"
        >
          {#if todayX !== null}
            <div
              class="gantt-today-col"
              style="left:{todayX}px;width:{COL_W}px;height:{ROW_H}px"
            ></div>
          {/if}
        </div>
      </div>
    {/each}
  </div>
</div>

<!-- RentalDetailPanel — 기존 절대경로 폼 액션 그대로 재사용 (새 서버 액션 불필요).
     /cms/reservation·/cms/rentals는 리스트+디테일 flex 분할 레이아웃(.detail-panel-wrap{flex:6})
     안에 끼워넣는 전제라 자체 포지셔닝이 없음 — 간트 탭은 그런 분할 뷰가 없어 감싸는 컨테이너가
     필요(2026-08-13 Stephen 스크린샷 발견). 처음엔 우측 고정 드로어로 구현했으나 Stephen이
     "선택한 위치에 노출해 — 현재 구현은 잘못된 UIUX"라고 재피드백 — 클릭한 라벨셀/막대 바로
     옆에 뜨는 앵커 팝오버로 교체(openDetail()이 클릭 지점 좌표를 캡처해 popoverStyle로 위치
     계산, 화면 밖으로 넘치면 반대쪽으로 뒤집고 뷰포트 안으로 클램프). -->
{#if selectedRow}
  <div class="gantt-detail-overlay" style={popoverStyle} transition:fly={{ y: 8, duration: 160 }}>
    <RentalDetailPanel
      row={selectedRow}
      onclose={() => { selectedRow = null; anchorRect = null }}
      onrefresh={refetchCurrentWindow}
      isRentalView={selectedRow.status !== 'hold'}
    />
  </div>
{/if}

<style>
  /* ── 외부 래퍼 ──────────────────────────────────────────────────────── */
  .gantt-outer {
    /* flex:1로 부모(.dashboard-wrap) 남은 공간을 전부 채우면 예약이 적을 때 그 아래가
       흰 배경으로 크게 남아 보임 — 내부 .gantt-scroll(inline height)에 맞춰 딱 그만큼만
       차지하도록 shrink-wrap(2026-08-13 수정) */
    position: relative;
    flex: 0 0 auto;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    overflow: hidden;
  }

  /* ── 로딩 배지 ──────────────────────────────────────────────────────── */
  .gantt-loading-badge {
    position: absolute;
    top: 8px;
    right: 16px;
    z-index: 10;
    background: var(--cs-purple);
    color: var(--cs-white);
    padding: 3px 10px;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    pointer-events: none;
  }

  /* ── 스크롤 컨테이너 ────────────────────────────────────────────────── */
  /* overflow: auto → 세로/가로 모두 스크롤 허용 (CMS 관례: 스크롤바 숨기지 않음) */
  /* 실제 높이(height)는 inline style로 예약 건수에 맞춰 계산해서 지정(스크립트의
     scrollAreaHeight 참고 — 데이터가 적을 때 아래쪽에 큰 흰 여백이 남지 않도록 함).
     max-height는 뷰포트가 작을 때를 대비한 안전 상한만 담당 */
  .gantt-scroll {
    overflow: auto;
    max-height: calc(100vh - 220px);
  }

  /* ── 헤더 (2단: 월 그룹 행 + 일자 행) — 전체 sticky top ─────────────── */
  .gantt-header-wrap {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--cs-white);
  }

  /* 1단: 월 그룹 행 */
  .gantt-month-row {
    display: flex;
    border-bottom: 1px solid var(--cs-lilac);
  }

  .gantt-label-header-spacer {
    /* 월 행의 라벨 자리 — 텍스트 없이 sticky-left 정렬만 맞춤 */
    z-index: 4 !important;
    height: 26px;
  }

  .gantt-month-headers {
    display: flex;
    flex-shrink: 0;
  }

  .gantt-month-header {
    flex-shrink: 0;
    height: 26px;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    border-left: 1px solid var(--cs-lilac);
    box-sizing: border-box;
  }

  /* 2단: 일자 행 */
  .gantt-day-row {
    display: flex;
    border-bottom: 2px solid var(--cs-lilac);
  }

  .gantt-label-header {
    /* 헤더 코너: sticky-x + sticky-y 교차 — z-index는 데이터 라벨보다 높여야 함 */
    z-index: 4 !important;
    height: 40px;
    display: flex;
    align-items: center;
    padding: 0 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    font-weight: 600;
  }

  .gantt-day-headers {
    display: flex;
    flex-shrink: 0;
  }

  .gantt-day-header {
    flex-shrink: 0;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    border-left: 1px solid var(--cs-lilac);
    box-sizing: border-box;
    white-space: nowrap;
    padding: 0 4px;
  }

  .gantt-day-header.gantt-today {
    background: rgba(59, 47, 138, 0.06);
    color: var(--cs-purple);
    font-weight: 700;
  }

  /* ── 라벨 컬럼 (frozen left — position: sticky; left: 0) ────────────── */
  /* overflow-x: auto 컨테이너 내에서도 sticky left는 최신 브라우저에서 동작 */
  .gantt-label-col {
    position: sticky;
    left: 0;
    z-index: 2;
    background: var(--cs-white);
    box-sizing: border-box;
    border-right: 1px solid var(--cs-lilac);
    flex-shrink: 0;
  }

  .gantt-label-body {
    height: 52px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    padding: 0 12px;
    gap: 2px;
    background: var(--cs-surface-gray);
    /* div → button 전환에 따른 브라우저 기본 버튼 스타일 리셋(막대 클릭과 동일하게
       예약 상세 패널을 여는 트리거로 확장, 2026-08-13) */
    border: none;
    width: 100%;
    text-align: left;
    cursor: pointer;
    font: inherit;
  }

  .gantt-product-name {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gantt-customer-name {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ── 데이터 행 ──────────────────────────────────────────────────────── */
  .gantt-row {
    display: flex;
    border-bottom: 1px solid rgba(236, 235, 244, 0.5);
  }

  .gantt-row:hover > .gantt-label-col {
    background: var(--cs-lilac);
  }

  /* ── 날짜 그리드 트랙 ───────────────────────────────────────────────── */
  /* DOM 요소 대신 CSS repeating-linear-gradient로 격자 표현 (성능 최적화) */
  .gantt-grid-track {
    position: relative;
    flex-shrink: 0;
    background-size: 100px 100%;
    background-repeat: repeat-x;
  }

  /* ── 오늘 컬럼 강조 ─────────────────────────────────────────────────── */
  .gantt-today-col {
    position: absolute;
    top: 0;
    background: rgba(59, 47, 138, 0.05);
    pointer-events: none;
  }

  /* ── 예약 막대 ──────────────────────────────────────────────────────── */
  .gantt-bar {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 8px;
    border-radius: 6px;
    border: none;
    cursor: pointer;
    overflow: hidden;
    font: var(--text-pc-script-12);
    white-space: nowrap;
    transition: filter 0.15s, transform 0.12s;
    text-align: left;
    min-height: 28px;
  }

  .gantt-bar:hover {
    filter: brightness(0.88);
    transform: scaleY(1.06);
  }

  /* ── 반납 연체(rental_end 경과 + 아직 반출중 계열 상태) ─────────────────── */
  .gantt-bar.gantt-bar-overdue {
    border: 2px solid var(--cs-red-badge);
    box-sizing: border-box;
  }

  .gantt-bar-overdue-dot {
    flex-shrink: 0;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--cs-red-badge);
  }

  .gantt-bar:active {
    transform: scaleY(0.96);
  }

  .gantt-bar-code {
    opacity: 0.65;
    font-weight: 400;
    font-size: 10px;
  }

  .gantt-bar-label {
    font-weight: 700;
  }

  /* ── 상세 패널 오버레이 — 우측 고정 드로어 ─────────────────────────────── */
  /* RentalDetailPanel 자체는 포지셔닝이 없는(height:100%) 순수 콘텐츠 박스라
     감싸는 컨테이너가 반드시 필요(§위 주석 참고) */
  /* left/top/width는 popoverStyle(script)에서 클릭 지점 기준으로 인라인 계산해 지정 */
  .gantt-detail-overlay {
    position: fixed;
    max-height: 80vh;
    overflow-y: auto;
    z-index: 200;
    border-radius: var(--cms-radius-md);
    box-shadow: 0 8px 32px rgba(16, 11, 50, 0.18);
  }
</style>
