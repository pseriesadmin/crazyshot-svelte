<script lang="ts">
  interface Props {
    value?: string
    onselect: (iso: string) => void
    disablePast?: boolean
  }

  let { value = '', onselect, disablePast = true }: Props = $props()

  const MONTHS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월']
  const DAYS = ['일','월','화','수','목','금','토']

  const today = new Date()
  let viewYear = $state(value ? parseInt(value.slice(0,4)) : today.getFullYear())
  let viewMonth = $state(value ? parseInt(value.slice(5,7)) - 1 : today.getMonth())

  // value prop 외부 변경 시 캘린더 표시 월/연도 동기화
  $effect(() => {
    if (value) {
      viewYear = parseInt(value.slice(0, 4))
      viewMonth = parseInt(value.slice(5, 7)) - 1
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
    if (!disablePast) return false
    return new Date(iso) < new Date(today.getFullYear(), today.getMonth(), today.getDate())
  }
</script>

<div class="cal-root">
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
        {@const sel = value === iso}
        {@const dow = new Date(iso).getDay()}
        <button
          class="cal-day"
          class:cal-day-sel={sel}
          class:cal-day-past={past}
          class:cal-day-sun={dow === 0}
          class:cal-day-sat={dow === 6}
          disabled={past}
          onclick={() => onselect(iso)}
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
  .cal-day-sun:not(.cal-day-past) { color: var(--cs-red-badge); }
  .cal-day-sat:not(.cal-day-past) { color: var(--cs-purple); }
</style>
