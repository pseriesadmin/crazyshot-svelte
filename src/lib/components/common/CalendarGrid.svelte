<script lang="ts">
  interface Props {
    value?: string
    onselect: (iso: string) => void
    disablePast?: boolean
    // 지정 시 이 날짜보다 이전(미포함)은 선택 불가 — 예: 반납일 캘린더에서 수령일 이전 선택
    // 방지. minDate 당일은 선택 가능(당일 대여/반납 케이스 허용)
    minDate?: string
    // 대여 기간 범위 시각화(2026-08-17, 수령·반납 달력 공통 표시) — 지정 시 rangeStart~rangeEnd
    // 구간을 하나의 연속된 배경 밴드로 강조. 이 컴포넌트의 단일값 선택(value/onselect) 동작
    // 자체는 변경 없음 — 순수 시각적 오버레이만 추가
    rangeStart?: string
    rangeEnd?: string
    // 범위 요약 핀 레이블(2026-08-18) — rangeStart 지정 시에만 상단에 시작/종료 요약 핀
    // 노출(Airbnb류 "체크인·체크아웃" 패턴). 호출부마다 의미가 다를 수 있어(수령일/반납일
    // 등) 라벨을 주입받음 — 기본값은 범용 시작일/종료일
    rangeStartLabel?: string
    rangeEndLabel?: string
    // 휴무일 등 임의 날짜 비활성화(2026-08-24) — past/minDate 조건에 추가로 결합되는 판정
    // 함수. 미전달 시(기존 모든 호출부) 동작 100% 동일 — 하위호환 유지
    isDateDisabled?: (iso: string) => boolean
    // isDateDisabled로 막힌 날짜를 클릭 시도했을 때 호출(2026-08-25) — past 날짜 클릭은
    // 대상 아님(기존 그대로 완전 비활성). 미전달 시 막힌 날짜는 기존처럼 순수 disabled만 유지
    onDisabledClick?: (iso: string) => void
    // 휴무일 포함 배송 자동연장 미리보기 하이라이트(2026-09-12) — 선택 불가(disabled) 판정과
    // 완전히 분리된 순수 시각 표시 전용. 미전달 시(기존 모든 호출부) 동작 100% 동일 —
    // 하위호환 유지. 클릭·선택 가능 여부에는 전혀 관여하지 않는다(isDateDisabled와 무관).
    highlightDates?: Set<string>
  }

  let {
    value = '',
    onselect,
    disablePast = true,
    minDate = '',
    rangeStart = '',
    rangeEnd = '',
    rangeStartLabel = '시작일',
    rangeEndLabel = '종료일',
    isDateDisabled,
    onDisabledClick,
    highlightDates,
  }: Props = $props()

  // 종료일 대기 중(rangeStart는 있고 rangeEnd는 아직 없음) hover한 날짜를 임시 종료일처럼
  // 미리보기 — PC에서는 마우스로 드래그하듯 범위가 실시간으로 자라는 것처럼 보이고,
  // 터치 기기는 hover 자체가 없어 자연스럽게 일반 2탭 선택으로 동작(2026-08-17)
  let hoverIso = $state<string | null>(null)

  // 범위 요약 핀 표시용 포맷 — "8월 18일(화)" 형태(2026-08-18)
  const DOW_SHORT = ['일','월','화','수','목','금','토']
  function fmtRangeLabel(iso: string): string {
    if (!iso) return ''
    const d = new Date(iso)
    return `${d.getMonth() + 1}월 ${d.getDate()}일(${DOW_SHORT[d.getDay()]})`
  }
  function nightsBetween(a: string, b: string): number {
    return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000)
  }

  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  const DAYS = ['일','월','화','수','목','금','토']

  const today = new Date()
  let viewYear = $state(value ? parseInt(value.slice(0,4)) : (minDate ? parseInt(minDate.slice(0,4)) : today.getFullYear()))
  let viewMonth = $state(value ? parseInt(value.slice(5,7)) - 1 : (minDate ? parseInt(minDate.slice(5,7)) - 1 : today.getMonth()))

  // value/minDate prop 외부 변경 시 캘린더 표시 월/연도 동기화
  // (value 미선택 상태로 minDate만 바뀐 경우 — 예: 수령일 선택 직후 반납일 달력을 처음 열 때 —
  //  오늘 날짜가 아닌 minDate 기준 월로 자동 이동해 매번 월을 직접 넘겨보지 않도록 함)
  $effect(() => {
    if (value) {
      viewYear = parseInt(value.slice(0, 4))
      viewMonth = parseInt(value.slice(5, 7)) - 1
    } else if (minDate) {
      viewYear = parseInt(minDate.slice(0, 4))
      viewMonth = parseInt(minDate.slice(5, 7)) - 1
    }
  })

  function calDays(year: number, month: number): (number | null)[] {
    const firstDay = new Date(year, month, 1).getDay()
    const daysInMonth = new Date(year, month + 1, 0).getDate()
    const cells: (number | null)[] = Array(firstDay).fill(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(d)
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }

  function fmtDate(year: number, month: number, day: number): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  function prevMonth() {
    showYearPicker = false; showMonthPicker = false
    if (viewMonth === 0) { viewMonth = 11; viewYear -= 1 }
    else viewMonth -= 1
  }

  function nextMonth() {
    showYearPicker = false; showMonthPicker = false
    if (viewMonth === 11) { viewMonth = 0; viewYear += 1 }
    else viewMonth += 1
  }

  function isPastDay(iso: string): boolean {
    const beforeToday = disablePast && new Date(iso) < new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const beforeMin = minDate ? iso < minDate : false
    return beforeToday || beforeMin
  }

  // ── 연/월 빠른 이동(항목 6, 순수 추가) ─────────────────────────────────────────
  // 헤더의 "{viewYear}년 {MONTHS[viewMonth]}" 단일 span을 "년"/"월" 두 버튼으로 분리해
  // 각각 클릭 시 연도·월 목록 팝오버를 노출한다. 기존 prevMonth()/nextMonth() 및
  // value/minDate/rangeStart/rangeEnd/onselect 등 날짜 선택 계약은 전혀 변경하지 않음.
  let showYearPicker = $state(false)
  let showMonthPicker = $state(false)

  const todayIso = fmtDate(today.getFullYear(), today.getMonth(), today.getDate())
  // disablePast/minDate 중 더 제한적인 쪽을 유효 최소일로 취급 — 연/월 목록의 과거 항목
  // 비활성 판정에 재사용(캘린더 그리드의 day-level 판정과 동일한 두 조건을 그대로 반영)
  const effectiveMinIso = $derived(
    disablePast
      ? (minDate && minDate > todayIso ? minDate : todayIso)
      : minDate
  )

  function isYearDisabled(y: number): boolean {
    if (!effectiveMinIso) return false
    return y < parseInt(effectiveMinIso.slice(0, 4))
  }

  function isMonthDisabled(y: number, m: number): boolean {
    if (!effectiveMinIso) return false
    const minY = parseInt(effectiveMinIso.slice(0, 4))
    const minM = parseInt(effectiveMinIso.slice(5, 7)) - 1
    return y < minY || (y === minY && m < minM)
  }

  // 연도 목록 — MUI 스타일 참고(2026-09-15, Stephen 첨부 이미지): 4행 그리드에 today
  // 기준 -100년~+30년을 채워 넣고, 팝업 폭 안에서 좌우로 스크롤해 더 먼 연도를 탐색한다.
  // 선택된 연도만 채워진 원으로 강조 — 나머지는 평범한 텍스트(거리별 색상 단계는 두지
  // 않고, 스크롤 컨테이너 자체의 좌우 mask-image 페이드로 "더 있음"을 암시).
  const YEAR_LIST_PAST = 100
  const YEAR_LIST_FUTURE = 30
  const allYears = Array.from(
    { length: YEAR_LIST_PAST + YEAR_LIST_FUTURE + 1 },
    (_, i) => today.getFullYear() - YEAR_LIST_PAST + i,
  )

  let yearScrollEl = $state<HTMLDivElement | null>(null)
  // 좌우로 슬라이드(스크롤)하는 동안에만 옅은 화살표를 부드럽게 노출 — 평소엔 숨겨뒀다가
  // 스크롤 이벤트가 발생하는 즉시 나타나고, 150ms 이상 스크롤이 없으면 다시 사라짐
  let isYearScrolling = $state(false)
  let yearScrollIdleTimer: ReturnType<typeof setTimeout> | null = null

  function onYearScroll() {
    isYearScrolling = true
    if (yearScrollIdleTimer) clearTimeout(yearScrollIdleTimer)
    yearScrollIdleTimer = setTimeout(() => { isYearScrolling = false }, 150)
  }

  function toggleYearPicker() {
    showMonthPicker = false
    showYearPicker = !showYearPicker
    if (showYearPicker) {
      requestAnimationFrame(() => {
        yearScrollEl?.querySelector('.cal-quick-item-active')
          ?.scrollIntoView({ inline: 'center', block: 'nearest' })
      })
    }
  }
  function toggleMonthPicker() { showYearPicker = false; showMonthPicker = !showMonthPicker }

  function pickYear(y: number) {
    if (isYearDisabled(y)) return
    viewYear = y
    showYearPicker = false
  }

  function pickMonth(m: number) {
    if (isMonthDisabled(viewYear, m)) return
    viewMonth = m
    showMonthPicker = false
  }
  // ────────────────────────────────────────────────────────────────────────────
</script>

<div class="cal-root">
  {#if rangeStart}
    <div class="cal-range-summary">
      <div class="cal-range-pill">
        <span class="cal-range-pill-label">{rangeStartLabel}</span>
        <span class="cal-range-pill-value">{fmtRangeLabel(rangeStart)}</span>
      </div>
      <span class="cal-range-arrow">→</span>
      <div class="cal-range-pill" class:cal-range-pill-active={!rangeEnd}>
        <span class="cal-range-pill-label">{rangeEndLabel}</span>
        <span class="cal-range-pill-value">{rangeEnd ? fmtRangeLabel(rangeEnd) : '날짜를 선택해주세요'}</span>
      </div>
    </div>
    {#if rangeEnd}
      <p class="cal-range-nights">총 {nightsBetween(rangeStart, rangeEnd)}박 {nightsBetween(rangeStart, rangeEnd) + 1}일</p>
    {/if}
  {/if}
  <div class="cal-header">
    <button class="cal-nav" onclick={prevMonth} aria-label="이전 달">
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M7 1L1 7L7 13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
    </button>
    <div class="cal-title-group">
      <button type="button" class="cal-title-btn" onclick={toggleYearPicker}>{viewYear}년</button>
      <button type="button" class="cal-title-btn" onclick={toggleMonthPicker}>{MONTHS[viewMonth]}</button>
    </div>
    <button class="cal-nav" onclick={nextMonth} aria-label="다음 달">
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
    </button>
  </div>

  <!-- 연도 레이어 전환 시 달력 모달 높이가 줄어들지 않도록 이 바깥 래퍼에만 min-height를
       둔다 — .cal-grid(그리드 컨테이너) 자체에 min-height를 주면 auto 행이 늘어난 공간만큼
       늘어나 stretch되고, aspect-ratio:1인 .cal-day가 그 늘어난 높이를 따라 폭까지 함께
       커져 그리드 밖으로 넘치는 결함이 있었다(2026-09-15 실측으로 원인 확인·수정 —
       .cal-grid의 grid-template-columns/gap 등 기존 로직은 전혀 변경하지 않음). -->
  <div class="cal-date-area">
  {#if showYearPicker}
    <div class="cal-year-panel">
      <div
        class="cal-year-scroll-h"
        role="listbox"
        tabindex="-1"
        aria-label="연도 선택 — 좌우로 스크롤하면 다른 연도로 이동합니다"
        bind:this={yearScrollEl}
        onscroll={onYearScroll}
      >
        {#each allYears as y (y)}
          <button type="button" class="cal-quick-item cal-year-item" class:cal-quick-item-active={y === viewYear}
            disabled={isYearDisabled(y)} onclick={() => pickYear(y)}>{y}</button>
        {/each}
      </div>
      <div class="cal-scroll-edge cal-scroll-edge-left" class:cal-scroll-edge-visible={isYearScrolling} aria-hidden="true">‹</div>
      <div class="cal-scroll-edge cal-scroll-edge-right" class:cal-scroll-edge-visible={isYearScrolling} aria-hidden="true">›</div>
    </div>
  {:else if showMonthPicker}
    <div class="cal-month-grid" role="listbox" aria-label="월 선택">
      {#each MONTHS as label, m (m)}
        <button type="button" class="cal-quick-item cal-month-item" class:cal-quick-item-active={m === viewMonth}
          disabled={isMonthDisabled(viewYear, m)} onclick={() => pickMonth(m)}>{label}</button>
      {/each}
    </div>
  {:else}
    <div class="cal-grid">
      {#each DAYS as d, i}
        <span class="cal-dow" class:cal-dow-sun={i===0} class:cal-dow-sat={i===6}>{d}</span>
      {/each}
      {#each calDays(viewYear, viewMonth) as day}
        {#if day === null}
          <span></span>
        {:else}
          {@const iso = fmtDate(viewYear, viewMonth, day)}
          {@const past = isPastDay(iso)}
          {@const holidayDisabled = !past && (isDateDisabled?.(iso) ?? false)}
          {@const sel = value === iso}
          {@const dow = new Date(iso).getDay()}
          {@const previewEnd = rangeEnd || (rangeStart && hoverIso && hoverIso >= rangeStart ? hoverIso : '')}
          {@const isRangeStart = rangeStart !== '' && rangeStart === iso}
          {@const isRangeEnd = previewEnd !== '' && previewEnd === iso}
          {@const isInRange = rangeStart !== '' && previewEnd !== '' && iso > rangeStart && iso < previewEnd}
          {@const adjHoliday = !sel && (highlightDates?.has(iso) ?? false)}
          <button
            class="cal-day"
            class:cal-day-sel={sel}
            class:cal-day-past={past}
            class:cal-day-holiday={holidayDisabled}
            class:cal-day-adj-holiday={adjHoliday}
            class:cal-day-sun={dow === 0}
            class:cal-day-sat={dow === 6}
            class:cal-day-range-start={isRangeStart}
            class:cal-day-range-end={isRangeEnd}
            class:cal-day-in-range={isInRange}
            disabled={past}
            aria-disabled={holidayDisabled}
            title={holidayDisabled ? '선택할 수 없는 날짜입니다' : (adjHoliday ? '휴무일 — 무료로 대여기간에 포함됩니다' : undefined)}
            onclick={() => holidayDisabled ? onDisabledClick?.(iso) : onselect(iso)}
            onmouseenter={() => { hoverIso = iso }}
            onmouseleave={() => { hoverIso = null }}
          >{day}</button>
        {/if}
      {/each}
    </div>
  {/if}
  </div>
</div>

<style>
  .cal-root { width: 100%; }

  /* 날짜 그리드(.cal-grid) ↔ 연도 레이어(.cal-year-panel) 전환 시 달력 모달 높이가 흔들리지
     않도록 하는 순수 블록 래퍼. 292px는 이 컴포넌트가 실제로 그리는 날짜 그리드 최대
     케이스(6주 표기 달, 7행×7열=49셀) 실측값 — .cal-grid 자체에는 절대 높이 제약을 주지
     않는다(그리드 컨테이너에 직접 주면 auto 행이 stretch되어 aspect-ratio:1인 .cal-day
     폭까지 함께 커지는 결함이 있었음, 2026-09-15). */
  .cal-date-area { min-height: 292px; }

  .cal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 12px;
  }

  .cal-nav {
    background: none;
    border: none;
    cursor: pointer;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--cs-text);
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .cal-nav:hover { background: var(--cs-lilac); }

  /* 연/월 빠른 이동(항목 6) — 기존 .cal-title(단일 span, 현재 마크업에서 제거됨) 스타일을
     그대로 물려받는 두 버튼 */
  .cal-title-group {
    position: relative;
    display: flex;
    gap: 4px;
  }
  .cal-title-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 2px 4px;
    border-radius: 6px;
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    transition: background 0.15s;
  }
  .cal-title-btn:hover { background: var(--cs-lilac); }

  .cal-quick-item {
    background: none;
    border: none;
    cursor: pointer;
    padding: 8px 10px;
    border-radius: 6px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    white-space: nowrap;
    transition: background 0.12s;
  }
  .cal-quick-item:hover:not(:disabled) { background: var(--cs-lilac); }
  .cal-quick-item-active { background: var(--cs-purple); color: var(--cs-white); font-weight: 700; }
  .cal-quick-item:disabled { color: var(--cs-text-placeholder); cursor: not-allowed; }

  /* 연도 목록 — MUI 연도선택 참고(2026-09-15 첨부 이미지) + 날짜 그리드(.cal-grid)와 같은
     자리·크기를 차지하도록 확대(2026-09-15 후속: "작아서 모바일에서 쓰기 힘들다" 피드백).
     팝업으로 띄우지 않고 .cal-grid와 형제 요소로 조건부 렌더링해 정확히 같은 폭을 차지한다.
     높이(292px)는 이 컴포넌트가 실제로 그리는 날짜 그리드의 최대 케이스(6주 표기 달,
     7행×7열=49셀 실측값)에 맞춘 값 — 어떤 달에서 열든 연도 레이어 전환 시 달력 모달의
     상하 크기가 줄어들지 않도록 날짜 그리드 쪽 높이를 절대 초과하지 않는 하한선으로 고정
     (2026-09-15 "달력 상하폭을 줄이지 말라" 피드백 대응). */
  .cal-year-panel {
    position: relative;
    overflow: hidden;
  }
  .cal-year-scroll-h {
    display: grid;
    grid-auto-flow: column;
    /* 4열×3행(월 레이어와 동일 비율, 2026-09-15) — 한 화면에 4열이 온전히 보이도록
       grid-auto-columns도 월 레이어 컬럼 폭에 맞춰 재계산, 나머지는 좌우 스크롤로 탐색 */
    grid-template-rows: repeat(3, 1fr);
    grid-auto-columns: 52px;
    height: 292px;
    gap: 14px;
    overflow-x: auto;
    padding: 20px 24px;
    scrollbar-width: none;
    /* 좌우 끝이 배경으로 옅게 사라지도록 마스킹 — "더 스크롤할 수 있다"는 암시 */
    -webkit-mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
    mask-image: linear-gradient(to right, transparent, black 10%, black 90%, transparent);
  }
  .cal-year-scroll-h::-webkit-scrollbar { display: none; }

  /* 연도 항목은 날짜 영역만큼 커진 자리에 맞춰 터치 타겟을 44px 이상으로 확대, 4x4 배열에
     상하좌우 여백(위 gap·padding)을 넉넉히 둠. 기본 굵기는 날짜 그리드(.cal-day, 500)와
     맞춰 가볍게 — 선택값(cal-quick-item-active)만 굵게+원형으로 강조(첨부 이미지 스타일).
     이전에는 본문용 --text-pc-body-14(무게 700)를 그대로 써서 큰 원형 버튼 안 숫자가
     불필요하게 두꺼워 보였음(2026-09-15 "폰트가 촌스럽다" 피드백 — font-family 자체는
     앱 전역 토큰(--font-kr, Noto Sans KR)과 동일함을 실측 확인, 무게만 조정) */
  .cal-year-item {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    min-height: 44px;
    font-size: 16px;
    font-weight: 500;
    line-height: 1;
  }
  /* 선택되지 않은 연도만 그레이 톤으로 — 선택된 연도(.cal-quick-item-active)는 원형 보라
     배경 위 흰 글자를 그대로 유지해야 하므로 :not()으로 분리(클래스 2개 특이성으로 순서와
     무관하게 항상 이 규칙이 이김) */
  .cal-year-item:not(.cal-quick-item-active) { color: var(--cs-text-mid); }
  .cal-year-scroll-h .cal-quick-item-active {
    border-radius: 50%;
    width: 58px;
    height: 58px;
    justify-self: center;
    align-self: center;
    /* 첨부 이미지 피드백(2026-09-15) — 진한 --cs-purple 대신 한 단계 옅은 purple-60%
       토큰으로 원 배경을 교체(흰 글자 대비는 유지). 월 목록의 사각형 강조(.cal-quick-item-
       active 기본값)는 그대로 --cs-purple 유지 — 이 선택자로만 연도 원형에 한정 적용 */
    background: var(--cs-purple-light);
  }

  /* 좌우 슬라이드(스크롤) 중에만 부드럽게 나타나는 옅은 화살표(2026-09-15) — 평소엔
     opacity:0으로 숨어있다가 스크롤 이벤트가 발생하는 동안 fade-in, 스크롤이 멈추고
     150ms 지나면 다시 fade-out(onYearScroll 참고) */
  .cal-scroll-edge {
    position: absolute;
    top: 0;
    bottom: 0;
    width: 30px;
    display: flex;
    align-items: center;
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-text-mid);
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.3s ease;
  }
  .cal-scroll-edge-visible { opacity: 1; }
  .cal-scroll-edge-left {
    left: 0;
    justify-content: flex-start;
    padding-left: 6px;
    background: linear-gradient(to right, var(--cs-white) 45%, rgba(255, 255, 255, 0));
  }
  .cal-scroll-edge-right {
    right: 0;
    justify-content: flex-end;
    padding-right: 6px;
    background: linear-gradient(to left, var(--cs-white) 45%, rgba(255, 255, 255, 0));
  }

  /* 월 선택 — 연도 레이어와 동일한 언어로 통일(2026-09-15): 날짜 그리드(.cal-grid)와 같은
     자리를 차지(.cal-date-area가 292px 하한선을 공유), 4열×3행 고정 12개라 스크롤은 필요
     없음. 선택값은 연도와 동일한 크기·색의 원형(purple-light) 강조, 나머지는 그레이 톤. */
  .cal-month-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    grid-template-rows: repeat(3, 1fr);
    height: 292px;
    gap: 14px;
    padding: 20px 24px;
  }
  .cal-month-item {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    min-height: 44px;
    font-size: 16px;
    font-weight: 500;
    line-height: 1;
  }
  .cal-month-item:not(.cal-quick-item-active) { color: var(--cs-text-mid); }
  .cal-month-grid .cal-quick-item-active {
    border-radius: 50%;
    width: 58px;
    height: 58px;
    justify-self: center;
    align-self: center;
    background: var(--cs-purple-light);
  }

  /* 범위 요약 핀(2026-08-18) — Airbnb류 "체크인/체크아웃" 헤더 패턴. 종료일 미확정 구간은
     핀을 강조색으로 채워 "지금 이 값을 고르는 중"임을 명시적으로 안내 */
  .cal-range-summary {
    display: flex;
    align-items: stretch;
    gap: 8px;
    margin-bottom: 10px;
  }
  .cal-range-pill {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 12px;
    border-radius: 14px;
    background: var(--cs-lilac);
    transition: background 0.2s ease;
  }
  .cal-range-pill-active {
    background: var(--cs-purple);
    animation: cal-pill-pulse 1.6s ease-in-out infinite;
  }
  @keyframes cal-pill-pulse {
    0%, 100% { box-shadow: 0 0 0 0 var(--cs-purple-op10); }
    50% { box-shadow: 0 0 0 4px var(--cs-purple-op10); }
  }
  .cal-range-pill-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    white-space: nowrap;
  }
  .cal-range-pill-active .cal-range-pill-label { color: rgba(255,255,255,0.7); }
  .cal-range-pill-value {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cal-range-pill-active .cal-range-pill-value { color: var(--cs-white); }
  .cal-range-arrow {
    flex-shrink: 0;
    align-self: center;
    color: var(--cs-text-light);
    font-weight: 700;
  }
  .cal-range-nights {
    text-align: center;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-purple);
    margin: -2px 0 10px;
  }

  .cal-grid {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 2px;
  }

  .cal-dow {
    text-align: center;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    padding: 4px 0 8px;
  }
  .cal-dow-sun { color: var(--cs-red-badge); }
  .cal-dow-sat { color: var(--cs-purple); }

  .cal-day {
    position: relative;
    z-index: 1;
    background: none;
    border: none;
    cursor: pointer;
    width: 100%;
    aspect-ratio: 1;
    border-radius: 50%;
    font: var(--text-pc-body-14);
    font-weight: 500;
    color: var(--cs-text-dark);
    transition: background 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 32px;
  }
  .cal-day:hover:not(:disabled):not(.cal-day-holiday) { background: var(--cs-lilac); }
  .cal-day-sel { background: var(--cs-purple) !important; color: var(--cs-white) !important; font-weight: 700; }
  .cal-day-past { color: var(--cs-text-placeholder); cursor: not-allowed; }
  /* 택배 휴무일 비활성(2026-08-24) — 과거 날짜와 같은 톤이되 취소선으로 구분 */
  .cal-day-holiday { color: var(--cs-text-placeholder); cursor: not-allowed; text-decoration: line-through; }
  .cal-day-sun:not(.cal-day-past) { color: var(--cs-red-badge); }
  .cal-day-sat:not(.cal-day-past) { color: var(--cs-purple); }

  /* 휴무일 포함 배송 자동연장 미리보기 하이라이트(2026-09-12) — 선택 불가(cal-day-holiday)와
     완전히 다른 개념: 차단이 아니라 "현재 선택한 날짜 때문에 무료로 대여기간에 포함되는
     휴무일"을 원형 배경으로 안내. cal-day-sel(!important)이 있으면 항상 그쪽이 우선하도록
     class 자체를 !sel일 때만 부여함(above 마크업) — 여기서는 단순 배경색만 정의. */
  .cal-day-adj-holiday {
    background: var(--cs-purple-light);
    color: var(--cs-white);
    font-weight: 700;
  }
  .cal-day-adj-holiday:hover:not(:disabled) { background: var(--cs-purple-light); }

  /* 대여~반납 기간 범위 밴드(2026-08-17, 2026-08-18 전면 재작업)
     — 시작·끝은 채워진 원, 사이 날짜는 연속된 배경 밴드.
     최종 구조: 밴드(::before, 가장 뒤) → 원 채움(::after, 그 위) → 날짜 숫자(일반 콘텐츠,
     맨 위). 밴드가 원 뒤로 길게 이어져 들어가도록(요청사항: "원형 레이아웃 뒤로 길게
     배치") 시작·종료일 칸의 절반이 아니라 칸 전체 폭(0~100%)을 덮게 하고, 원 채움은
     반드시 밴드보다 위에 오도록 별도 레이어(::after)로 분리 — 버튼 자신의 background로
     채우면 CSS 스택 순서상(자기 자신의 background는 항상 스태킹 컨텍스트 최하단이라
     음수 z-index 자식도 그 위에 그려짐) 밴드가 오히려 원 위에 덮이는 결함이 있었음
     (직접 실측으로 확인된 원인 — "정확히 절반 가림" 증상과 일치) */
  .cal-day-in-range::before,
  .cal-day-range-start::before,
  .cal-day-range-end::before {
    content: '';
    position: absolute;
    top: 3px;
    bottom: 3px;
    background: var(--cs-purple-op10);
    z-index: -2;
    /* 2026-08-18: hover로 밴드가 매 셀마다 즉시 나타나던 것을 부드럽게 페이드 — 마우스로
       구간을 훑을 때 끊기지 않고 이어지는 느낌으로 개선(외부 캘린더 기간선택 UX 참고) */
    animation: cal-band-fade-in 0.12s ease-out;
  }
  @keyframes cal-band-fade-in {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .cal-day-in-range::before { left: -3px; right: -3px; }
  /* 시작·종료일 칸은 절반이 아니라 칸 전체(0~100%)를 밴드가 덮음 — 원 채움(::after)이
     이제 확실히 그 위에 그려지므로, 밴드가 원 "뒤로 길게" 이어져 들어가는 자연스러운
     모양이 됨(요청한 완성도 개선) */
  .cal-day-range-start::before { left: 0; right: -3px; }
  .cal-day-range-end::before { left: -3px; right: 0; }
  /* 2026-08-18: 전체 밴드(시작~종료) 양 끝에만 라운드 적용 — 셀 사이 이어지는 경계는
     계속 각지게 유지해 끊김 없이 연결되고, 시작일 왼쪽 끝·종료일 오른쪽 끝(구간
     전체의 진짜 바깥쪽 끝)만 pill 형태로 둥글게 마무리 */
  .cal-day-range-start::before {
    border-top-left-radius: 999px;
    border-bottom-left-radius: 999px;
  }
  .cal-day-range-end::before {
    border-top-right-radius: 999px;
    border-bottom-right-radius: 999px;
  }
  /* 당일 대여·반납(수령일=반납일)은 원 하나로 충분 — 밴드 불필요 */
  .cal-day-range-start.cal-day-range-end::before { content: none; }
  .cal-day-range-start,
  .cal-day-range-end {
    /* 2026-08-18: 인접 날짜(뒤쪽 날짜, DOM 순서상 나중에 그려짐)의 밴드가 형제 셀
       경계를 넘어 이 시작·종료일 버튼을 덮어버리던 결함 방지 — DOM 순서와 무관하게
       항상 이기도록 z-index를 형제 셀(1)보다 높게 고정 */
    position: relative;
    z-index: 2;
    /* 원 채움을 ::after로 분리했으므로 버튼 자신의 background는 비움(!important로
       .cal-day-sel과 동시 적용될 때도 무조건 투명 유지 — 원은 ::after가 전담) */
    background: none !important;
    color: var(--cs-white) !important;
    font-weight: 700;
    transition: transform 0.15s ease;
  }
  .cal-day-range-start::after,
  .cal-day-range-end::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 50%;
    background: var(--cs-purple);
    z-index: -1;
  }
  .cal-day-range-start:hover,
  .cal-day-range-end:hover {
    transform: scale(1.08);
  }
</style>
