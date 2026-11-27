<script lang="ts">
  import { tick, untrack } from 'svelte'
  import { fly } from 'svelte/transition'
  import { SvelteMap } from 'svelte/reactivity'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import type { RentalListRow } from '../../../../routes/cms/reservation/+page.server'
  import { assignLanes } from '$lib/utils/ganttLanes'
  import SuggestPicker from '$lib/components/common/SuggestPicker.svelte'
  import type { SuggestPickerOption } from '$lib/types/suggest-picker'

  interface Props {
    initial: { from: string; to: string; rows: RentalListRow[] }
    cmsRole?: string | null
  }

  let { initial, cmsRole = null }: Props = $props()

  // ── 레이아웃 상수 ─────────────────────────────────────────────────────────
  const COL_W      = 100  // px — 1일 컬럼 너비
  const BADGE_MIN_W = 150 // 막대 폭이 이 값 이상일 때만 왼쪽 상태 배지를 둔다(1일 막대 92px 에서는 배지가 글자 자리를 거의 다 차지해 둘째 줄 '고객 · 상태'로 대신한다)
  const TODAY_COL_FACTOR = 2 // 오늘 컬럼은 일반 컬럼의 이 배수로 넓힌다(2026-11-27, Stephen) — 오늘 일정 막대가 가장 많이 읽히는 칸이라 글자 여유를 준다
  const TODAY_EXTRA = COL_W * (TODAY_COL_FACTOR - 1) // 오늘 컬럼이 추가로 차지하는 너비
  const ROW_H      = 52   // px — 데이터 행 높이
  const BAR_H      = 40   // px — 막대 높이(2줄: 상품명 / 고객·상태)
  const BAR_TOP    = Math.round((ROW_H - BAR_H) / 2)  // 막대 수직 중앙
  const TRIGGER_D  = 10   // 끝에서 이 일수 이내로 오면 다음 청크를 미리 로드(가장자리에 닿기 전에 불러와 빈 화면 대기를 없앤다)
  const MAX_SPAN_D = 365  // 오늘 기준 과거·미래로 불러올 수 있는 최대 일수(끝없는 로드·행 증가 방지)
  const REFETCH_PAD = 14  // 상세 처리 뒤 재조회 범위 = 선택한 예약 기간 앞뒤 이 일수(전체 범위 재조회 → 200건 절단 방지)
  const MONTH_H    = 52   // px — 월 헤더 높이(기존 26px 의 2배, 2026-11-27 Stephen). 아래 .gantt-month-header height 와 같은 값
  const HEADER_H   = MONTH_H + 40 // px — 헤더 2단 높이(월 행 MONTH_H + 일자 행 40 = 92)
  const MIN_LANE_ROWS = 8 // 예약이 적어도 기본으로 항상 보여줄 레인(빈 줄 포함) 수

  // ── State ─────────────────────────────────────────────────────────────────
  // untrack(): SSR 초기값을 의도적으로 1회만 캡처 — prop 변경 추적 불필요
  // (initial은 서버에서 한 번 전달되는 불변 시드 데이터, 이후 클라이언트가 독립 관리)
  let loadedFrom    = $state(untrack(() => initial.from))
  let loadedTo      = $state(untrack(() => initial.to))
  // reservation_id(number) 기준 dedup — 동일 예약이 두 청크 경계에 있을 때 중복 방지
  // ⛔ $state(new Map())은 반응형이 아니다(Svelte 5는 Map·Set 을 프록시하지 않음) — set/delete 가 lanes(파생 값)에 반영되지 않아
  //   스크롤로 불러온 과거·미래 예약과 재조회 결과가 화면에 안 나왔다(2026-11-27). 반드시 SvelteMap 을 쓴다.
  const rowsMap     = new SvelteMap<number, RentalListRow>(
    untrack(() => initial.rows.map((r): [number, RentalListRow] => [r.reservation_id, r]))
  )
  // $state.raw: 프록시로 감싸지 않아야 아래 재동기화 $effect의 `latest !== selectedRow` 비교가 같은 원본 객체끼리 이뤄진다
  // (프록시와 원본은 항상 !== 라 효과가 무한 반복되어 effect_update_depth_exceeded로 상세 모달이 닫히지 않던 결함, 2026-10-02)
  let selectedRow   = $state.raw<RentalListRow | null>(null)
  // 클릭한 지점(라벨셀 또는 막대) 근처에 상세 팝오버를 띄우기 위한 앵커 좌표
  // (뷰포트 기준 fixed 포지셔닝 — 우측 고정 드로어 대신 "선택한 위치에 노출" 요구 반영,
  // 2026-08-13 Stephen "선택한 위치에 노출해" 피드백)
  let anchorRect    = $state<{ top: number; bottom: number; left: number; right: number } | null>(null)
  let isLoadingMore = $state(false)
  let ganttEl: HTMLDivElement | null = null
  // 브라우저 창 높이에 맞춘 간트 영역 높이(px) — 0이면 아직 측정 전(SSR·첫 렌더)이라 예약 건수 기준 높이를 쓴다.
  // 창을 키우면 빈 그리드 줄이 더 채워지고, 줄이면 영역 안 세로 스크롤로 전환된다.
  let availH = $state(0)
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

  // 레인 배치(2026-11-27, Stephen 확정 — 좌측 목록·정렬 제거, 일정 확인용): 겹치지 않는 예약은 같은 줄에 모은다(ganttLanes.ts).
  // 줄 수 = 동시에 진행되는 최대 예약 수. 불러온 구간(loadedFrom~loadedTo)과 겹치는 예약만 배치한다.
  // 상태(배지)별 보기 선택에 맞는 예약만 배치한다 — 걸러진 예약은 줄 배치에서도 빠져 빈 줄 없이 다시 모인다.
  let lanes = $derived(assignLanes([...rowsMap.values()].filter(matchesStatusFilter), loadedFrom, loadedTo))

  // 오늘 컬럼 위치·가로폭 배율 — 오늘이 불러온 범위 안에 있을 때만 넓힌다.
  // colX(i) = i번째 날짜 칸의 왼쪽 X. 오늘보다 뒤 칸은 오늘 컬럼이 넓어진 만큼(TODAY_EXTRA) 밀린다.
  let todayIdx = $derived(todayStr >= loadedFrom && todayStr <= loadedTo ? dayIndex(todayStr, loadedFrom) : null)
  function colX(i: number): number {
    return i * COL_W + (todayIdx !== null && i > todayIdx ? TODAY_EXTRA : 0)
  }
  // 오늘 컬럼 X 좌표 (로드된 범위 안에 있을 때만)
  let todayX = $derived(todayIdx !== null ? colX(todayIdx) : null)
  // 격자 트랙 전체 너비(오늘 컬럼이 있으면 그만큼 더 넓다)
  let trackW = $derived(days.length * COL_W + (todayIdx !== null ? TODAY_EXTRA : 0))
  // 격자 세로선: 오늘 컬럼 앞·뒤를 따로 그려 넓어진 오늘 칸에서도 100px 격자가 어긋나지 않게 한다
  const GRID_LINES = `repeating-linear-gradient(to right, var(--cs-lilac) 0, var(--cs-lilac) 1px, transparent 1px, transparent ${COL_W}px)`
  let gridStyle = $derived(
    todayX === null
      ? `background-image:${GRID_LINES};`
      : `background-image:${GRID_LINES},${GRID_LINES};background-repeat:no-repeat,no-repeat;` +
        `background-size:${todayX}px 100%,${Math.max(0, trackW - todayX - COL_W * TODAY_COL_FACTOR)}px 100%;` +
        `background-position:0 0,${todayX + COL_W * TODAY_COL_FACTOR}px 0;`
  )

  // 레인이 적어도 최소 MIN_LANE_ROWS 줄은 격자 라인으로 채워 흰 빈 화면을 막고, 창 높이가 크면 그 높이를 채울 만큼 빈 줄을 더 둔다(availH 측정 전에는 0)
  let viewportRowSlots = $derived(availH > HEADER_H ? Math.ceil((availH - HEADER_H) / ROW_H) : 0)
  let visibleRowSlots = $derived(Math.max(lanes.length, MIN_LANE_ROWS, viewportRowSlots))
  let scrollAreaHeight = $derived(availH > 0 ? availH : HEADER_H + visibleRowSlots * ROW_H)

  // 간트 영역 상단 위치 ~ 창 하단(대시보드 하단 여백 32px 제외)까지를 영역 높이로 삼는다
  // 하단 여백 0 — 간트가 창 맨 아래까지 채운다(2026-11-27, Stephen). 부모(.dashboard-wrap)의 아래 패딩 32px 은 .gantt-outer 의 음수 margin-bottom 으로 상쇄해 페이지 스크롤이 생기지 않게 한다.
  const BOTTOM_GAP = 0
  const MIN_AVAIL_H = 320
  function measureAvailHeight(): void {
    if (!ganttEl) return
    const top = ganttEl.getBoundingClientRect().top
    availH = Math.max(Math.floor(window.innerHeight - top - BOTTOM_GAP), MIN_AVAIL_H)
  }

  $effect(() => {
    measureAvailHeight()
    const raf = requestAnimationFrame(measureAvailHeight)
    window.addEventListener('resize', measureAvailHeight)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', measureAvailHeight)
    }
  })
  // {#each}는 배열/이터러블이 필요 — {length:N} 같은 평범한 객체는 런타임에 순회 불가하므로
  // Array.from으로 실제 배열을 만들어 전달
  let emptyRowIndexes = $derived(
    Array.from({ length: Math.max(0, visibleRowSlots - lanes.length) }, (_, i) => i)
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
  // expired(만료됨)는 rental-lifecycle.md 2026-08-31 추가분 — reservation/+page.svelte:38,52와
  // 동일 라벨·색상으로 맞춤(2026-09-15 발견: 이 파일만 이 상태를 몰라 영어 원문 "expired"가
  // 그대로 노출되고 있었음 — get_rental_list 제외목록(p_exclude_statuses)에 없어 실제로
  // 화면에 뜨는 상태값인데 매핑만 누락돼 있었음).
  const STATUS_LABEL: Record<string, string> = {
    pending: '접수', hold: '신청대기', confirmed: '계약완료', shipped: '배송중',
    in_use: '대여중', return_requested: '반납요청', returned: '반납완료',
    completed: '완료', cancelled: '취소', damage_claimed: '파손신고', expired: '만료됨',
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
    expired:          { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' },
  }

  // ── 상태(배지)별 보기 — 월 헤더 오른쪽 드롭다운(SuggestPicker 공통 컴포넌트, cms-uiux §12: 기본 select 태그 금지) ──
  // 'all'(기본)=전체. 'overdue'는 상태가 아니라 '반납 연체' 판정(아래 isOverdue)과 같은 기준.
  const STATUS_FILTER_OPTIONS: SuggestPickerOption[] = [
    { id: 'all', label: '전체 보기' },
    ...(['hold', 'confirmed', 'shipped', 'in_use', 'return_requested', 'returned', 'completed'] as const)
      .map((st): SuggestPickerOption => ({ id: st, label: STATUS_LABEL[st] })),
    { id: 'overdue', label: '반납 연체' },
    { id: 'damage_claimed', label: STATUS_LABEL.damage_claimed },
    { id: 'expired', label: STATUS_LABEL.expired },
  ]
  // null(입력을 지우거나 목록에 없는 글자를 쳤을 때)은 전체로 본다
  let statusFilter = $state<string | null>('all')
  function matchesStatusFilter(row: RentalListRow): boolean {
    if (!statusFilter || statusFilter === 'all') return true
    if (statusFilter === 'overdue') return isOverdue(row)
    return row.status === statusFilter
  }

  // 보기 선택을 바꿔 지금 상세 카드가 열려 있는 예약이 가려지면 카드도 함께 닫는다(막대는 사라졌는데 카드만 남는 것 방지).
  // 선택(statusFilter) 변경에만 반응한다 — selectedRow 는 untrack 이라, 카드 안에서 처리를 해 상태가 바뀌어도 카드가 갑자기 닫히지 않는다.
  $effect(() => {
    void statusFilter
    const open = untrack(() => selectedRow)
    if (open && !matchesStatusFilter(open)) {
      selectedRow = null
      anchorRect = null
    }
  })

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

  // 진행·대기·예정 막대(종료일이 오늘 이후이면서 종료·취소 상태가 아닌 예약)에만 미세한 입체감을 준다(2026-11-27, Stephen).
  // 이미 지난 막대(회색)와 연체 막대는 평평하게 두어 '지금 봐야 할 일정'과 구분한다.
  const ENDED_STATUSES = new Set(['completed', 'returned', 'expired', 'cancelled', 'damage_claimed'])
  function isLive(row: RentalListRow): boolean {
    return row.rental_end >= todayStr && !ENDED_STATUSES.has(row.status)
  }

  // ── 상세 패널 오픈 — 클릭 지점(라벨셀 또는 막대) 옆에 앵커 ────────────────
  const POPOVER_W = 440
  function openDetail(row: RentalListRow, e: MouseEvent) {
    selectedRow = row
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    anchorRect = { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }
  }

  // 열려 있는 상세 패널을 rowsMap 최신 데이터로 재동기화 — /cms/reservation·/cms/rentals
  // +page.svelte의 "selectedRow를 data.rentals에서 재조회" $effect와 동일 목적(2026-09-15
  // 발견: 이 파일만 그 재동기화가 빠져 있었음). onrefresh(refetchCurrentWindow)가
  // rowsMap.set()으로 새 객체를 넣어도 selectedRow는 클릭 시점의 옛 객체 참조를 그대로 들고
  // 있어, 패널 안에서 승인·취소·운송장 등록 등을 하고 나면 배경 막대는 갱신되는데 열려 있는
  // 패널 자체는 닫았다 다시 열기 전까지 이전 상태를 계속 보여주는 결함이 있었음.
  $effect(() => {
    if (!selectedRow) return
    const latest = rowsMap.get(selectedRow.reservation_id)
    if (latest && latest !== selectedRow) selectedRow = latest
  })

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
  // 막대의 가로 위치·폭 — 로드 범위 안으로 잘라 계산한다(범위 밖이면 null)
  function barGeom(row: RentalListRow): { left: number; width: number } | null {
    // 로드 범위 완전 벗어남 → 렌더 안 함
    if (row.rental_end < loadedFrom || row.rental_start > loadedTo) return null

    // 범위 내로 클램핑
    const cs = row.rental_start < loadedFrom ? loadedFrom : row.rental_start
    const ce = row.rental_end   > loadedTo   ? loadedTo   : row.rental_end

    const si = dayIndex(cs, loadedFrom)
    const ei = dayIndex(ce, loadedFrom)
    if (si > ei) return null

    const left  = colX(si) + 4
    const width = colX(ei + 1) - colX(si) - 8
    if (width <= 0) return null
    return { left, width }
  }

  function getBarStyle(row: RentalListRow): string | null {
    const geom = barGeom(row)
    if (!geom) return null
    const { left, width } = geom

    // 이미 지난 예약(종료일 < 오늘)은 상태와 무관하게 회색 톤으로 차별화한다(2026-11-27, Stephen 제안).
    // 기존 완료·반납완료 막대와 같은 회색 토큰을 재사용하고, 반납 연체(미반납)의 빨간 테두리·점은 그대로 둬 경고가 묻히지 않게 한다.
    const isPast = row.rental_end < todayStr
    const s = isPast
      ? { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' }
      : (STATUS_STYLE[row.status] ?? { bg: 'rgba(102,102,102,0.10)', color: 'var(--cs-text-mid)' })
    return `left:${left}px;width:${width}px;top:${BAR_TOP}px;height:${BAR_H}px;background:${s.bg};color:${s.color};`
  }

  // ── 무한스크롤 — 청크 로드 ───────────────────────────────────────────────
  // 서버 응답: { rows, truncated } — truncated 는 건수 상한(페이지 3장)에도 다 못 받았다는 표시
  async function fetchWindow(from: string, to: string): Promise<{ rows: RentalListRow[]; truncated: boolean } | null> {
    const res = await fetch(`/api/cms/dashboard/gantt-window?from=${from}&to=${to}`)
    if (!res.ok) return null
    const body = await res.json() as { rows: RentalListRow[]; truncated?: boolean }
    return { rows: body.rows ?? [], truncated: body.truncated === true }
  }

  async function loadMore(direction: 'past' | 'future') {
    if (isLoadingMore) return
    // 오늘 기준 한도(±MAX_SPAN_D)를 넘는 구간은 불러오지 않는다
    if (direction === 'past' && loadedFrom <= addDays(todayStr, -MAX_SPAN_D)) return
    if (direction === 'future' && loadedTo >= addDays(todayStr, MAX_SPAN_D)) return
    isLoadingMore = true
    try {
      const from = direction === 'future' ? addDays(loadedTo, 1)   : addDays(loadedFrom, -14)
      const to   = direction === 'future' ? addDays(loadedTo, 14)  : addDays(loadedFrom, -1)

      const got = await fetchWindow(from, to)
      if (!got) return // 실패하면 범위를 늘리지 않는다 — 다음 스크롤에서 다시 시도

      // 과거 방향 로드 시: 스크롤 위치 보정용 사전 기록
      const prevLeft  = ganttEl?.scrollLeft ?? 0
      const prevWidth = ganttEl?.scrollWidth ?? 0

      for (const r of got.rows) rowsMap.set(r.reservation_id, r)

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
    // 불러온 뒤에도 여전히 가장자리 근처면(빠르게 끝까지 끌었을 때) 한 번 더 미리 불러온다
    checkEdges()
  }

  // ── 구간 한정 재조회 (RentalDetailPanel.onrefresh) ───────────────────────
  // invalidateAll() 아님 — 무한스크롤로 확장된 다른 구간 데이터 보존.
  // ⛔ 불러온 전체 범위를 한 번에 다시 받지 않는다: 서버 조회 상한(200건)에 걸려 일부 막대가 사라진다.
  //    선택한 예약 기간 앞뒤 REFETCH_PAD 일만 다시 받고, 서버가 상한 때문에 다 못 줬다면(truncated) 지우지 않고 갱신만 한다.
  async function refetchCurrentWindow() {
    const target = selectedRow
    let from = target ? addDays(target.rental_start, -REFETCH_PAD) : addDays(todayStr, -3)
    let to   = target ? addDays(target.rental_end, REFETCH_PAD)    : addDays(todayStr, 10)
    if (from < loadedFrom) from = loadedFrom
    if (to > loadedTo) to = loadedTo
    if (from > to) return
    const got = await fetchWindow(from, to)
    if (!got) return

    if (!got.truncated) {
      // 이 구간과 겹치는 항목(경계에 걸친 예약 포함)을 제거한 뒤 최신 데이터로 교체
      // (취소 등 상태 변경으로 숨겨진 예약 제거 포함 — 서버가 겹침 기준으로 내려주므로 같은 기준으로 지운다)
      const staleIds = [...rowsMap.values()]
        .filter((r) => r.rental_end >= from && r.rental_start <= to)
        .map((r) => r.reservation_id)
      for (const id of staleIds) rowsMap.delete(id)
    }
    for (const r of got.rows) rowsMap.set(r.reservation_id, r)
  }

  // ── 스크롤 핸들러 (RAF 쓰로틀 + isLoadingMore 중복 방지) ─────────────────
  function checkEdges() {
    if (!ganttEl || isLoadingMore) return
    const { scrollLeft, clientWidth, scrollWidth } = ganttEl
    const TRIGGER = COL_W * TRIGGER_D

    if (scrollLeft < TRIGGER) {
      void loadMore('past')
    } else if (scrollLeft + clientWidth > scrollWidth - TRIGGER) {
      void loadMore('future')
    }
  }

  function handleScroll() {
    if (rafPending || isLoadingMore) return
    rafPending = true
    requestAnimationFrame(() => {
      rafPending = false
      checkEdges()
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
        <div class="gantt-month-headers">
          {#each monthGroups as group (group.key)}
            <div class="gantt-month-header" style="width:{group.count * COL_W + (todayIdx !== null && group.key === todayStr.slice(0, 7) ? TODAY_EXTRA : 0)}px">
              <span class="gantt-month-label">{group.label}</span>
            </div>
          {/each}
        </div>
        <!-- 상태(배지)별 보기 드롭다운 — 월 행 오른쪽에 화면 폭 기준으로 고정(폭 0 래퍼라 격자 폭을 늘리지 않는다) -->
        <div class="gantt-month-filter-wrap">
          <div class="gantt-month-filter" style="--gantt-scroll-h:{scrollAreaHeight}px">
            <SuggestPicker
              id="gantt-status-filter"
              listLabel="상태별 보기"
              bind:selectedId={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              placeholder="전체 보기"
            >
              {#snippet field(c)}
                <input
                  type="text"
                  class="f-input"
                  id={c.id}
                  placeholder={c.placeholder}
                  value={c.value}
                  oninput={c.oninput}
                  onkeydown={c.onkeydown}
                  onfocus={c.onfocus}
                  onblur={c.onblur}
                  aria-autocomplete={c.ariaAutocomplete}
                  aria-expanded={c.ariaExpanded}
                  aria-controls={c.ariaControls}
                  aria-label="상태별 보기"
                  autocomplete="off"
                />
              {/snippet}
            </SuggestPicker>
          </div>
        </div>
      </div>
      <!-- 2단: 일자 행 -->
      <div class="gantt-day-row">
        <!-- 날짜 헤더 -->
        <div class="gantt-day-headers" style="min-width:{trackW}px">
          {#each days as day (day)}
            <div
              class="gantt-day-header"
              class:gantt-today={day === todayStr}
              style="width:{day === todayStr ? COL_W * TODAY_COL_FACTOR : COL_W}px"
            >
              {formatDayHeader(day)}
            </div>
          {/each}
        </div>
      </div>
    </div>

    <!-- ── 레인(줄) — 겹치지 않는 예약을 한 줄에 모아 그린다 ─────────────────────────── -->
    {#each lanes as lane, li (li)}
      <div class="gantt-row" style="height:{ROW_H}px">
        <!-- 날짜 그리드 트랙 (relative + CSS 배경으로 격자 표현) -->
        <div
          class="gantt-grid-track"
          style="min-width:{trackW}px;height:{ROW_H}px;{gridStyle}"
        >
          <!-- 오늘 컬럼 강조 -->
          {#if todayX !== null}
            <div
              class="gantt-today-col"
              style="left:{todayX}px;width:{COL_W * TODAY_COL_FACTOR}px;height:{ROW_H}px"
            ></div>
          {/if}

          <!-- 예약 막대 -->
          {#each lane as row (row.reservation_id)}
            {@const barStyle = getBarStyle(row)}
            {#if barStyle}
              {@const overdue = isOverdue(row)}
              {@const statusLabel = STATUS_LABEL[row.status] ?? row.status}
              {@const showBadge = (barGeom(row)?.width ?? 0) >= BADGE_MIN_W}
              <button
                class="gantt-bar"
                class:gantt-bar-overdue={overdue}
                class:gantt-bar-live={isLive(row)}
                class:gantt-bar-selected={selectedRow?.reservation_id === row.reservation_id}
                aria-current={selectedRow?.reservation_id === row.reservation_id ? 'true' : undefined}
                style={barStyle}
                data-reservation-code={row.reservation_code ?? ''}
                onclick={(e) => openDetail(row, e)}
                title="{row.reservation_code ?? ''} · {row.product_name} — {row.customer_name || '이름없음'} ({statusLabel}){overdue ? ' — 반납 연체' : ''}"
                aria-label="{row.reservation_code ?? ''} {row.product_name} {row.customer_name || '이름없음'} {statusLabel}{overdue ? ' 반납 연체' : ''}"
              >
                {#if overdue}<span class="gantt-bar-overdue-dot" aria-hidden="true"></span>{/if}
                {#if showBadge}<span class="gantt-bar-badge">{statusLabel}</span>{/if}
                <span class="gantt-bar-text">
                  <span class="gantt-bar-product">{row.product_name}</span>
                  <span class="gantt-bar-sub">{showBadge ? (row.customer_name || '이름없음') : `${row.customer_name || '이름없음'} · ${statusLabel}`}</span>
                </span>
              </button>
            {/if}
          {/each}
        </div>
      </div>
    {/each}

    <!-- 최소 줄 수 채움 — 레인이 부족한 만큼 빈 그리드 라인으로 패딩(흰 빈 화면 방지) -->
    {#each emptyRowIndexes as i (i)}
      <div class="gantt-row gantt-row-empty" style="height:{ROW_H}px">
        <div
          class="gantt-grid-track"
          style="min-width:{trackW}px;height:{ROW_H}px;{gridStyle}"
        >
          {#if todayX !== null}
            <div
              class="gantt-today-col"
              style="left:{todayX}px;width:{COL_W * TODAY_COL_FACTOR}px;height:{ROW_H}px"
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
    <!-- cmsRole 미전달 시 패널이 매니저 이상 전용 조회(두발히어로 배송정보 등)를 건너뛰어 운송장이 반영되지 않았다(2026-11-27). 예약 전환 시 이전 카드 상태가 남지 않도록 {#key} -->
    {#key selectedRow.reservation_id}
      <RentalDetailPanel
        row={selectedRow}
        {cmsRole}
        onclose={() => { selectedRow = null; anchorRect = null }}
        onrefresh={refetchCurrentWindow}
        isRentalView={selectedRow.status !== 'hold'}
      />
    {/key}
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
    border-radius: var(--cms-radius-md) var(--cms-radius-md) 0 0;
    overflow: hidden;
    margin-bottom: -32px; /* .dashboard-wrap 의 아래 패딩(32px)만큼 아래로 확장 — 창 하단까지 채움 */
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
  /* 실제 높이(height)는 inline style로 지정 — 스크립트의 availH(브라우저 창 높이에서 영역 상단 위치·하단 여백을 뺀 값)로
     창 크기에 맞춰 늘어나고 줄어든다(예약이 적으면 빈 그리드 줄로 채움, 많으면 영역 안 세로 스크롤).
     측정 전(SSR)에만 예약 건수 기준 높이를 쓰며, 그때는 이 안전 상한이 넘침을 막는다 */
  .gantt-scroll {
    overflow: auto;
    max-height: 100vh;
  }

  /* ── 헤더 (2단: 월 그룹 행 + 일자 행) — 전체 sticky top ─────────────── */
  .gantt-header-wrap {
    position: sticky;
    top: 0;
    z-index: 3;
    background: var(--cs-white);
    /* 래퍼 폭이 화면 폭까지만이면 가로로 넘친 날짜 칸 쪽은 배경이 없어 세로 스크롤 때 아래 막대가 비쳐 겹쳐 보였다(2026-11-27).
       전체 격자 폭까지 늘려 흰 배경이 헤더 전체를 덮게 한다 */
    width: max-content;
    min-width: 100%;
  }

  /* 1단: 월 그룹 행 */
  .gantt-month-row {
    display: flex;
    border-bottom: 1px solid var(--cs-lilac);
  }

  .gantt-month-headers {
    display: flex;
    flex-shrink: 0;
  }

  .gantt-month-header {
    flex-shrink: 0;
    height: 52px; /* = MONTH_H */
    display: flex;
    align-items: center;
    justify-content: flex-start;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    background: var(--cs-surface-gray);
    border-left: 1px solid var(--cs-lilac);
    box-sizing: border-box;
  }

  /* 월 라벨은 가로 스크롤을 따라 흐르지 않고 화면 왼쪽에 고정되며, 다음 달 경계에 닿으면 다음 달 이름으로 바뀐다(2026-11-27, Stephen).
     각 월 칸(.gantt-month-header) 안에서만 sticky 라 칸이 끝나는 경계에서 라벨이 밀려 나가고 다음 달 라벨이 이어서 고정된다 */
  .gantt-month-label {
    position: sticky;
    left: 0;
    padding: 0 16px;
    white-space: nowrap;
  }

  /* 상태별 보기 드롭다운 — 폭 0 의 sticky 래퍼(오른쪽 12px 에 고정)에서 왼쪽으로 펼친다 */
  .gantt-month-filter-wrap {
    position: sticky;
    right: 12px;
    flex: 0 0 0;
    width: 0;
    height: 52px;
    z-index: 2;
  }

  .gantt-month-filter {
    position: absolute;
    right: 0;
    top: 50%;
    transform: translateY(-50%);
    width: 150px;
  }

  /* 목록 레이어는 간트 스크롤 영역 안에서 펼쳐지므로, 낮은 창에서 아래가 잘리지 않게 영역 높이에서 헤더 위쪽(약 56px)을 뺀 값 이하로 제한한다 */
  .gantt-month-filter :global(.suggest-picker-layer) {
    max-height: min(280px, max(120px, calc(var(--gantt-scroll-h) - 56px))); /* 극단적으로 낮은 창에서도 목록이 0 이 되지 않게 하한 120px */
  }

  .gantt-month-filter .f-input {
    width: 100%;
    height: 32px;
    box-sizing: border-box;
    padding: 0 12px;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    cursor: pointer;
  }

  .gantt-month-filter .f-input:focus {
    outline: 2px solid var(--cs-focus-ring);
    outline-offset: -2px;
  }

  /* 2단: 일자 행 */
  .gantt-day-row {
    display: flex;
    border-bottom: 2px solid var(--cs-lilac);
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

  /* ── 데이터 행 ──────────────────────────────────────────────────────── */
  .gantt-row {
    display: flex;
    border-bottom: 1px solid rgba(236, 235, 244, 0.5);
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
    border-left: 1px solid var(--cs-lilac);
    box-sizing: border-box;
    pointer-events: none;
  }

  /* ── 예약 막대 ──────────────────────────────────────────────────────── */
  .gantt-bar {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 4px 12px; /* 막대 안쪽 여백 — 좌우 8→12px, 위아래 4px 추가(2026-11-27, Stephen). 2줄 글자(약 29px)가 높이 40px 안에 들어가는 값 */
    box-sizing: border-box; /* 인라인 width/height 가 여백·테두리를 포함하도록 고정 */
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

  /* 진행·대기·예정 막대의 미세한 2차원 입체감 — 위쪽 얇은 하이라이트 + 아래쪽 옅은 그림자(색은 상태색 위에 얹히는 반투명 흰색·남색뿐) */
  .gantt-bar.gantt-bar-live {
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.6),
      0 1px 2px rgba(16, 11, 50, 0.14),
      0 2px 5px rgba(16, 11, 50, 0.06);
  }

  /* 지금 상세 카드가 열려 있는(선택된) 막대 — 밝은 아웃라인(Stephen 직접 지시, 2026-11-27).
     ⚠ 일반 버튼 '아웃라인 금지' 원칙의 예외 — 막대 면 색은 바꾸지 않고 바깥쪽 링(outline)만 둔다. 색은 모든 상태에 공통인 밝은 브랜드 보라(--cs-purple-light) */
  .gantt-bar.gantt-bar-selected {
    z-index: 1;
    outline: 2px solid var(--cs-purple-light);
    outline-offset: 1px;
    box-shadow:
      0 3px 8px rgba(16, 11, 50, 0.13),
      0 1px 2px rgba(16, 11, 50, 0.12);
  }

  .gantt-bar.gantt-bar-live:active {
    box-shadow:
      inset 0 1px 2px rgba(16, 11, 50, 0.12),
      0 1px 1px rgba(16, 11, 50, 0.08);
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

  /* 막대 안 2줄: 상품명(굵게) / 고객 · 상태 */
  .gantt-bar-text {
    display: flex;
    flex-direction: column;
    gap: 1px;
    min-width: 0;
    flex: 1;
    line-height: 1.25;
  }

  /* 막대 왼쪽 상태 배지 — 막대 글자색을 그대로 쓰고 바탕만 옅은 흰색(새 색을 만들지 않는다) */
  .gantt-bar-badge {
    flex-shrink: 0;
    padding: 2px 8px;
    border-radius: var(--radius-full);
    background: rgba(255, 255, 255, 0.7);
    font-size: 10px;
    font-weight: 700;
    line-height: 1.3;
    white-space: nowrap;
  }

  .gantt-bar-product {
    font-weight: 700;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .gantt-bar-sub {
    font-size: 10px;
    font-weight: 400;
    opacity: 0.8;
    overflow: hidden;
    text-overflow: ellipsis;
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

  /* 홈 간트 상세 카드 헤더 최소 구성(2026-11-27, Stephen): '대여' 라벨은 불필요, 상태 배지는 바로 아래 여정 스텝퍼가 같은 상태를 이미 보여주므로 숨긴다.
     (좁은 카드에서 배지 글자가 세로로 꺾여 100px 높이로 늘어나던 문제 해소 — 공용 패널은 다른 화면에서 그대로 노출) */
  .gantt-detail-overlay :global(.panel-label),
  .gantt-detail-overlay :global(.panel-status) {
    display: none;
  }
</style>
