<script lang="ts">
  interface RentalOption { id: string; name: string }

  interface Props {
    startDate?: string;
    endDate?: string;
    startHour?: number;
    endHour?: number;
    dailyPrice?: number;
    halfDayPrice?: number;
    optionsTotal?: number;
    mode?: 'product' | 'cart';
    rentalMethods?: RentalOption[];
    rentalPeriods?: RentalOption[];
    selectedMethodId?: string;
    selectedPeriodId?: string;
    reserveDisabled?: boolean;
    onreserve?: (data: { startDate: string; endDate: string; startHour: number; startMin: number; endHour: number; endMin: number; methodId: string; periodId: string }) => void;
    onchange?: (data: { startDate: string; endDate: string; startHour: number; startMin: number; endHour: number; endMin: number }) => void;
    chatCallback?: () => void;
  }

  let {
    startDate = $bindable(''),
    endDate = $bindable(''),
    startHour = $bindable(12),
    endHour = $bindable(13),
    dailyPrice = 35000,
    halfDayPrice = 25000,
    optionsTotal = 0,
    mode = 'product',
    rentalMethods = [],
    rentalPeriods = [],
    selectedMethodId = $bindable(''),
    selectedPeriodId = $bindable(''),
    reserveDisabled = false,
    onreserve,
    onchange,
    chatCallback,
  }: Props = $props();

  // ── Calendar state
  const today = new Date();
  let viewYear = $state(today.getFullYear());
  let viewMonth = $state(today.getMonth()); // 0-indexed
  let hoverDate = $state<string | null>(null);
  let pickPhase = $state<'start' | 'end'>('start'); // which date to pick next

  const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
  const DAY_LABELS = ['S','M','T','W','T','F','S'];

  function calCells(year: number, month: number): (number | null)[] {
    const firstDow = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: (number | null)[] = Array(firstDow).fill(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);
    return cells;
  }

  function toIso(year: number, month: number, day: number): string {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  function isSameDay(a: string, b: string) { return a === b; }

  function inRange(iso: string): boolean {
    const rangeEnd = endDate || hoverDate;
    if (!startDate || !rangeEnd) return false;
    return iso > startDate && iso < rangeEnd;
  }

  function isStart(iso: string) { return !!startDate && isSameDay(iso, startDate); }
  function isEnd(iso: string)   { return !!endDate && isSameDay(iso, endDate); }

  function handleDateClick(day: number) {
    const iso = toIso(viewYear, viewMonth, day);
    if (pickPhase === 'start' || (startDate && iso < startDate)) {
      startDate = iso;
      endDate = '';
      pickPhase = 'end';
    } else if (iso === startDate) {
      // 당일 대여: 반출·반납 같은 날
      endDate = iso;
      pickPhase = 'start';
      emit();
    } else {
      endDate = iso;
      pickPhase = 'start';
      emit();
    }
  }

  function handleDateHover(day: number | null) {
    hoverDate = day ? toIso(viewYear, viewMonth, day) : null;
  }

  function prevMonth() {
    if (viewMonth === 0) { viewMonth = 11; viewYear--; }
    else viewMonth--;
  }
  function nextMonth() {
    if (viewMonth === 11) { viewMonth = 0; viewYear++; }
    else viewMonth++;
  }

  // ── Time spinners
  let startMin = $state(0);
  let endMin = $state(0);

  function incrStartH() { startHour = (startHour + 1) % 24; emit(); }
  function decrStartH() { startHour = (startHour - 1 + 24) % 24; emit(); }
  function incrEndH()   { endHour = (endHour + 1) % 24; emit(); }
  function decrEndH()   { endHour = (endHour - 1 + 24) % 24; emit(); }
  function incrStartMin() { startMin = (startMin + 1) % 60; emit(); }
  function decrStartMin() { startMin = (startMin - 1 + 60) % 60; emit(); }
  function incrEndMin()   { endMin = (endMin + 1) % 60; emit(); }
  function decrEndMin()   { endMin = (endMin - 1 + 60) % 60; emit(); }

  function pad(n: number) { return String(n).padStart(2, '0'); }

  // ── Derived values
  let totalDays = $derived.by(() => {
    if (!startDate || !endDate) return 0;
    const ms = new Date(endDate).getTime() - new Date(startDate).getTime();
    return Math.max(0, Math.floor(ms / 86400000));
  });

  // 당일 대여 여부 (startDate === endDate)
  let isSameDayRental = $derived(!!startDate && !!endDate && startDate === endDate);

  // 시간 차이: 당일 대여는 단순 시각 차이, 다일 대여는 날짜 오프셋 + 시각 차이
  let remainHours = $derived.by(() => {
    if (!startDate || !endDate) return 0;
    if (isSameDayRental) {
      // 당일: 순수 시각 차이 (음수 방지)
      return Math.max(0, endHour - startHour);
    }
    const hourDiff = endHour - startHour;
    return ((hourDiff % 24) + 24) % 24;
  });

  let remainMins = $derived.by(() => {
    if (!startDate || !endDate) return 0;
    if (isSameDayRental) {
      return Math.max(0, endMin - startMin);
    }
    const minDiff = endMin - startMin;
    return ((minDiff % 60) + 60) % 60;
  });

  // 총 대여시간(분) — 요금 계산 기준
  let totalRentalMinutes = $derived.by(() => {
    if (!startDate || !endDate) return 0;
    const dayMins = totalDays * 24 * 60;
    const hourMins = (endHour - startHour) * 60;
    const minDiff = endMin - startMin;
    return Math.max(0, dayMins + hourMins + minDiff);
  });

  let estimatedFee = $derived.by(() => {
    if (!startDate || !endDate) return optionsTotal;

    if (isSameDayRental) {
      // 당일 대여: 시간 기준
      const mins = (endHour * 60 + endMin) - (startHour * 60 + startMin);
      if (mins <= 0) return optionsTotal;
      const hours = mins / 60;
      if (hours <= 12) return halfDayPrice + optionsTotal;
      return dailyPrice + optionsTotal;
    }

    // 다일 대여: 기존 로직 (일수 × 일요금 + 잔여시간 12시간 이상 시 반일 추가)
    if (totalDays === 0) return optionsTotal;
    let fee = totalDays * dailyPrice;
    if (remainHours >= 12) fee += halfDayPrice;
    return fee + optionsTotal;
  });

  // [A-3] startMin/endMin 포함 emit
  function emit() {
    if (startDate) {
      onchange?.({ startDate, endDate: endDate || startDate, startHour, startMin, endHour, endMin });
    }
  }

  function handleReserve() {
    if (!startDate) return;
    onreserve?.({ startDate, endDate: endDate || startDate, startHour, startMin, endHour, endMin, methodId: selectedMethodId, periodId: selectedPeriodId });
  }

  // [B-1] 당일 대여 시 종료시각 ≤ 시작시각 경고
  let sameDayTimeError = $derived(
    isSameDayRental &&
    (endHour * 60 + endMin) <= (startHour * 60 + startMin)
  );

  function handleChat() {
    chatCallback?.();
  }

  let cells = $derived(calCells(viewYear, viewMonth));
  let rows = $derived.by(() => {
    const r: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) r.push(cells.slice(i, i + 7));
    return r;
  });
</script>

<div class="picker-wrap" class:cart-mode={mode === 'cart'}>
  {#if mode === 'product'}
    <div class="picker-header">
      <span class="header-label">렌탈요금 계산기</span>
    </div>
  {/if}

  <!-- Calendar + Time wrapper: mobile = col, PC = row -->
  <div class="cal-time-wrapper">
  <!-- Calendar -->
  <div class="calendar">
    <div class="cal-nav">
      <button onclick={prevMonth} class="nav-btn" aria-label="이전 달">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
          <path d="M7 1L1 7L7 13" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="cal-month">{MONTH_NAMES[viewMonth]} {viewYear}</span>
      <button onclick={nextMonth} class="nav-btn" aria-label="다음 달">
        <svg width="8" height="14" viewBox="0 0 8 14" fill="none">
          <path d="M1 1L7 7L1 13" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>

    <div class="cal-days-row">
      {#each DAY_LABELS as d}
        <div class="day-label">{d}</div>
      {/each}
    </div>

    <div class="cal-grid">
      {#each rows as row}
        <div class="cal-row">
          {#each row as day}
            {#if day === null}
              <div class="cal-cell empty"></div>
            {:else}
              {@const iso = toIso(viewYear, viewMonth, day)}
              <button
                class="cal-cell"
                class:is-start={isStart(iso)}
                class:is-end={isEnd(iso)}
                class:in-range={inRange(iso)}
                onclick={() => handleDateClick(day)}
                onmouseenter={() => handleDateHover(day)}
                onmouseleave={() => handleDateHover(null)}
                aria-label="{viewYear}년 {viewMonth+1}월 {day}일"
              >
                {day}
              </button>
            {/if}
          {/each}
        </div>
      {/each}
    </div>
  </div>

  <!-- Time Spinners: always stacked (Start on top, End below) -->
  <div class="time-col">
    <div class="time-spinner">
      <span class="time-label">Start</span>
      <div class="spinner-col">
        <button onclick={incrStartH} class="spin-btn" aria-label="시작 시간 증가">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 5L5 1L9 5" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <span class="time-val">{pad(startHour)}</span>
        <button onclick={decrStartH} class="spin-btn" aria-label="시작 시간 감소">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 1L5 5L9 1" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <span class="time-colon">:</span>
      <div class="spinner-col">
        <button onclick={incrStartMin} class="spin-btn" aria-label="시작 분 증가">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 5L5 1L9 5" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <span class="time-val">{pad(startMin)}</span>
        <button onclick={decrStartMin} class="spin-btn" aria-label="시작 분 감소">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 1L5 5L9 1" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <span class="time-ampm">{startHour >= 12 ? 'PM' : 'AM'}</span>
    </div>

    <div class="time-spinner">
      <span class="time-label">End</span>
      <div class="spinner-col">
        <button onclick={incrEndH} class="spin-btn" aria-label="종료 시간 증가">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 5L5 1L9 5" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <span class="time-val">{pad(endHour)}</span>
        <button onclick={decrEndH} class="spin-btn" aria-label="종료 시간 감소">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 1L5 5L9 1" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <span class="time-colon">:</span>
      <div class="spinner-col">
        <button onclick={incrEndMin} class="spin-btn" aria-label="종료 분 증가">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 5L5 1L9 5" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
        <span class="time-val">{pad(endMin)}</span>
        <button onclick={decrEndMin} class="spin-btn" aria-label="종료 분 감소">
          <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
            <path d="M1 1L5 5L9 1" stroke="var(--cs-text-light)" stroke-width="2" stroke-linecap="round"/>
          </svg>
        </button>
      </div>
      <span class="time-ampm">{endHour >= 12 ? 'PM' : 'AM'}</span>
    </div>
  </div>
  </div><!-- /cal-time-wrapper -->

  {#if mode === 'product'}
    <!-- Duration summary -->
    <div class="duration-row">
      <span class="duration-label">총 대여일</span>
      <div class="duration-vals">
        <div class="dur-group">
          <div class="dur-badge">{startDate && endDate ? totalDays : '–'}</div>
          <span class="dur-unit">일</span>
        </div>
        <div class="dur-group">
          <div class="dur-badge">{startDate && endDate ? `${pad(remainHours)}:${pad(remainMins)}` : '–:––'}</div>
          <span class="dur-unit">시간</span>
        </div>
      </div>
    </div>

    <!-- Estimated fee -->
    <div class="fee-row">
      <span class="fee-label">예상 대여요금</span>
      <div class="fee-val-wrap">
        <span class="fee-val">{startDate ? estimatedFee.toLocaleString('ko-KR') : '–'}</span>
        <span class="fee-unit">원</span>
      </div>
    </div>

    {#if sameDayTimeError}
      <p class="fee-note fee-note--warn">반납 시각이 반출 시각보다 앞서 있습니다.</p>
    {:else}
      <p class="fee-note">단순 합계요금으로 실제 결제요금과 다를 수 있습니다.</p>
    {/if}

    <!-- 대여정책 (대여기간·방식) -->
    {#if rentalPeriods.length > 0 || rentalMethods.length > 0}
      <div class="policy-section">
        {#if rentalPeriods.length > 0}
          <div class="policy-row">
            <span class="policy-lbl">대여 기간</span>
            <div class="policy-chips">
              {#each rentalPeriods as p}
                <button
                  type="button"
                  class="policy-chip"
                  class:chip-active={selectedPeriodId === p.id}
                  onclick={() => { selectedPeriodId = selectedPeriodId === p.id ? '' : p.id }}
                  aria-pressed={selectedPeriodId === p.id}
                >{p.name}</button>
              {/each}
            </div>
          </div>
        {/if}
        {#if rentalMethods.length > 0}
          <div class="policy-row">
            <span class="policy-lbl">대여 방식</span>
            <div class="policy-chips">
              {#each rentalMethods as m}
                <button
                  type="button"
                  class="policy-chip"
                  class:chip-active={selectedMethodId === m.id}
                  onclick={() => { selectedMethodId = selectedMethodId === m.id ? '' : m.id }}
                  aria-pressed={selectedMethodId === m.id}
                >{m.name}</button>
              {/each}
            </div>
          </div>
        {/if}
      </div>
    {/if}


    <!-- CTAs -->
    <div class="cta-row">
      <button
        class="reserve-btn"
        onclick={handleReserve}
        disabled={!startDate || reserveDisabled}
        aria-label="예약신청"
      >
        {reserveDisabled ? '필수 옵션을 선택해주세요' : '예약신청'}
      </button>
      <button class="chat-btn" onclick={handleChat} aria-label="채팅 문의">
        <svg xmlns="http://www.w3.org/2000/svg" width="60" height="60" viewBox="0 0 60 60" fill="none">
          <path d="M60 30C60 46.5685 46.5685 60 30 60C13.4315 60 0 46.5685 0 30C0 13.4315 13.4315 0 30 0C46.5685 0 60 13.4315 60 30Z" fill="#201857"/>
          <path d="M12 33.0277C12 39.1748 19.8518 46.4744 25.4898 46.4744C28.7711 46.4744 21.6001 43.4865 25.1252 42.2483C27.212 41.5153 32.417 39.1748 32.417 33.0277C32.417 26.8807 27.6773 22.6546 22.2085 22.6546C16.7397 22.6546 12 26.8807 12 33.0277Z" fill="#C494FE"/>
          <path d="M48.5806 26.6293C48.5806 34.1134 38.5431 43.0007 31.3356 43.0007C27.1409 43.0007 36.3081 39.3629 31.8017 37.8554C29.134 36.963 22.48 34.1134 22.48 26.6293C22.48 19.1453 28.5391 14 35.5303 14C42.5216 14 48.5806 19.1453 48.5806 26.6293Z" fill="#FFDD00"/>
        </svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .picker-wrap {
    background: #e1def3;
    border-radius: var(--radius-xl);
    padding: 40px 20px;
    display: flex;
    flex-direction: column;
    gap: 50px;
    overflow: hidden;
  }

  .picker-wrap.cart-mode {
    background: transparent;
    border-radius: 0;
    padding: 0;
  }

  @media (min-width: 641px) {
    .picker-wrap { border-radius: var(--radius-2xl); }
  }

  /* Header */
  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .header-label {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
  }
  .header-more {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .header-more-text {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
  }

  /* Calendar */
  .calendar {
    display: flex;
    flex-direction: column;
    gap: 16px;
    width: 100%;
    flex-shrink: 0;
  }

  .cal-nav {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .nav-btn {
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
  }
  .cal-month {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
  }

  .cal-days-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .day-label {
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
  }

  .cal-grid {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cal-row {
    display: grid;
    grid-template-columns: repeat(7, 1fr);
    gap: 4px;
  }
  .cal-cell {
    width: 100%;
    aspect-ratio: 1;
    height: auto;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    border: none;
    background: none;
    cursor: pointer;
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
    transition: background 0.12s;
  }
  .cal-cell.empty {
    cursor: default;
  }
  .cal-cell:not(.empty):hover {
    background: var(--cs-lilac);
  }
  .cal-cell.is-start,
  .cal-cell.is-end {
    background: var(--cs-purple-light);
    color: var(--cs-white);
  }
  .cal-cell.in-range {
    background: var(--cs-text-light);
    color: var(--cs-white);
    border-radius: 0;
  }

  /* Cal + Time wrapper: col on mobile, row on PC */
  .cal-time-wrapper {
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: stretch;
    width: 100%;
  }
  @media (min-width: 641px) {
    .cal-time-wrapper {
      flex-direction: row;
      gap: 40px;
      align-items: flex-start;
    }
    /* Fix: calendar must not fill 100% width in PC row layout */
    .calendar {
      flex: 1;
      width: auto;
    }
  }

  /* Time spinners */
  .time-col {
    display: flex;
    flex-direction: column;
    gap: 20px;
    width: 100%;
    min-width: 0;
  }
  @media (min-width: 641px) {
    .time-col {
      flex: 1;
      width: auto;
    }
  }
  .time-spinner {
    width: 100%;
    background: var(--cs-lilac);
    border-radius: var(--radius-md);
    padding: 10px 16px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 16px;
    box-sizing: border-box;
    min-width: 0;
  }
  @media (min-width: 641px) {
    .time-spinner { gap: 24px; padding: 10px 20px; }
  }
  .time-label {
    font: var(--text-m-script-12);
    color: var(--cs-text-dark);
    flex-shrink: 0;
    min-width: 28px;
  }
  .spinner-col {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 20px;
  }
  .spin-btn {
    min-width: 30px;
    min-height: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    cursor: pointer;
  }
  .spin-btn:disabled { opacity: 0.3; cursor: default; }
  .time-val {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
    min-width: 20px;
    text-align: center;
  }
  .time-colon {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
  }
  .time-ampm {
    font-size: 14px;
    color: var(--cs-text-dark);
    flex-shrink: 0;
  }

  /* Duration & fee */
  .duration-row,
  .fee-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 0;
    border-top: 1px solid var(--cs-border);
    flex-wrap: wrap;
    gap: 8px;
  }
  .duration-label,
  .fee-label {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
  }
  /* Duration badge groups */
  .duration-vals {
    display: flex;
    gap: 12px;
    align-items: center;
    flex-shrink: 0;
  }
  .dur-group {
    display: flex;
    gap: 6px;
    align-items: center;
  }
  .dur-badge {
    background: var(--cs-lilac);
    border-radius: 10px;
    padding: 4px 12px;
    font: var(--text-m-script-14B);
    color: var(--cs-text);
    white-space: nowrap;
  }
  .dur-unit {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
    white-space: nowrap;
  }
  .fee-val-wrap {
    display: flex;
    align-items: baseline;
    gap: 6px;
    flex-shrink: 0;
  }
  .fee-val {
    font: var(--text-m-title-18B);
    color: var(--cs-text);
  }
  .fee-unit {
    font: var(--text-m-script-14);
    color: var(--cs-text-dark);
  }

  .fee-note {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    margin: -8px 0;
  }
  .fee-note--warn {
    color: var(--cs-error, #d32f2f);
    font-weight: 600;
  }

  /* CTAs */
  .cta-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .reserve-btn {
    flex: 1;
    height: 60px;
    background: #201857;
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .reserve-btn:hover { background: #2e2470; }
  .reserve-btn:disabled { background: var(--cs-text-light); cursor: not-allowed; }

  .chat-btn {
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: none;
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    flex-shrink: 0;
    transition: opacity 0.15s;
    overflow: hidden;
  }
  .chat-btn:hover { opacity: 0.85; }

  /* ── 대여정책 */
  .policy-section {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding-top: 20px;
    border-top: 1px solid rgba(59, 47, 138, 0.12);
  }
  .policy-row {
    display: flex;
    align-items: flex-start;
    gap: 10px;
  }
  .policy-lbl {
    font: var(--text-m-script-14B);
    color: var(--cs-text-dark);
    min-width: 58px;
    flex-shrink: 0;
    padding-top: 5px;
  }
  .policy-chips {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }
  .policy-chip {
    font: var(--text-m-script-12);
    font-weight: 700;
    color: var(--cs-purple);
    background: var(--cs-lilac);
    border: none;
    border-radius: var(--radius-full);
    padding: 6px 14px;
    min-height: 30px;
    cursor: pointer;
    line-height: 1.4;
    transition: background 0.15s, color 0.15s;
  }
  .policy-chip:hover { background: var(--cs-purple-op10); }
  .policy-chip.chip-active {
    background: var(--cs-purple);
    color: var(--cs-white);
  }

</style>
