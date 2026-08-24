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
    if (viewMonth === 0) { viewMonth = 11; viewYear -= 1 }
    else viewMonth -= 1
  }

  function nextMonth() {
    if (viewMonth === 11) { viewMonth = 0; viewYear += 1 }
    else viewMonth += 1
  }

  function isPastDay(iso: string): boolean {
    const beforeToday = disablePast && new Date(iso) < new Date(today.getFullYear(), today.getMonth(), today.getDate())
    const beforeMin = minDate ? iso < minDate : false
    return beforeToday || beforeMin
  }
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
    <span class="cal-title">{viewYear}년 {MONTHS[viewMonth]}</span>
    <button class="cal-nav" onclick={nextMonth} aria-label="다음 달">
      <svg width="8" height="14" viewBox="0 0 8 14" fill="none"><path d="M1 1L7 7L1 13" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"/></svg>
    </button>
  </div>

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
        <button
          class="cal-day"
          class:cal-day-sel={sel}
          class:cal-day-past={past}
          class:cal-day-holiday={holidayDisabled}
          class:cal-day-sun={dow === 0}
          class:cal-day-sat={dow === 6}
          class:cal-day-range-start={isRangeStart}
          class:cal-day-range-end={isRangeEnd}
          class:cal-day-in-range={isInRange}
          disabled={past || holidayDisabled}
          title={holidayDisabled ? '택배 휴무일' : undefined}
          onclick={() => onselect(iso)}
          onmouseenter={() => { hoverIso = iso }}
          onmouseleave={() => { hoverIso = null }}
        >{day}</button>
      {/if}
    {/each}
  </div>
</div>

<style>
  .cal-root { width: 100%; }

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

  .cal-title {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
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
  .cal-day:hover:not(:disabled) { background: var(--cs-lilac); }
  .cal-day-sel { background: var(--cs-purple) !important; color: var(--cs-white) !important; font-weight: 700; }
  .cal-day-past { color: var(--cs-text-placeholder); cursor: not-allowed; }
  /* 택배 휴무일 비활성(2026-08-24) — 과거 날짜와 같은 톤이되 취소선으로 구분 */
  .cal-day-holiday { color: var(--cs-text-placeholder); cursor: not-allowed; text-decoration: line-through; }
  .cal-day-sun:not(.cal-day-past) { color: var(--cs-red-badge); }
  .cal-day-sat:not(.cal-day-past) { color: var(--cs-purple); }

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
