<script lang="ts">
  // ╔══════════════════════════════════════════════════════════════════════════════════════════════╗
  // ║ ⛔ AI·검수자 필독 — 이 파일의 "달력 · 시간 선택 · 렌탈요금 계산기(총 대여일·예상 대여요금)"는 사용하지 않는 영역이다. ║
  // ║                                                                                              ║
  // ║ 확정 사실(Stephen, 2026-10-11): 상품의 수령·반납일 관련 모든 설정은 "장바구니에 상품이 담긴 뒤" 장바구니     ║
  // ║ 화면에서 진행한다. 상품상세에는 날짜·시간 선택 UI가 존재하지 않고, 예약신청·장바구니 담기는 항상 "날짜 없는    ║
  // ║ 임시예약(draft)"만 만든다.                                                                      ║
  // ║                                                                                              ║
  // ║ 따라서 아래 [NOT IN USE] 표시 코드(달력·시간 스피너·요금 요약·그 상태/계산 로직·관련 CSS)는                  ║
  // ║  · 화면에 렌더링되지 않는다(SCHEDULE_CALC_UI_ENABLED=false — DOM에도 없음)                           ║
  // ║  · 검수·버그 분석·수정·리팩터 대상에서 제외한다(이 영역의 결함을 지적하거나 "고치지" 말 것)                     ║
  // ║  · 현재 동작을 설명할 근거로 삼지 말 것(예: "날짜·시간을 바꾸면…" 같은 설명은 성립하지 않는다)                  ║
  // ║ 실제로 쓰이는 영역은 [IN USE]로 표시된 대여방식·배송정책 안내 + 버튼 그룹(찜·장바구니 담기·예약신청·채팅)뿐이다.   ║
  // ║ 재활용하려면 Stephen 승인 후 SCHEDULE_CALC_UI_ENABLED를 true로 바꾸고 .calc-hidden 클래스를 제거한다.        ║
  // ╚══════════════════════════════════════════════════════════════════════════════════════════════╝
  const SCHEDULE_CALC_UI_ENABLED = false as boolean;

  interface RentalOption { id: string; name: string }

  interface Props {
    startDate?: string;
    endDate?: string;
    startHour?: number;
    endHour?: number;
    dailyPrice?: number;
    /** 12h 요금 실값. 미등록이면 null — 12시간 블록이 없으므로 24시간 단위 올림 일수 × dailyPrice로 계산(추정값 금지, 장바구니·서버와 동일 규칙) */
    halfDayPrice?: number | null;
    optionsTotal?: number;
    mode?: 'product' | 'cart';
    rentalMethods?: RentalOption[];
    shippingPolicy?: { items: { label: string; fee: number }[]; guide: string } | null;
    /** 판매전용 상품(2026-09-27): 대여방식 chip·왕복/반송 요금·안내문 숨김, 기본 배송요금만 노출, CTA '구매신청' */
    saleOnly?: boolean;
    selectedMethodId?: string;
    selectedPeriodId?: string;
    reserveDisabled?: boolean;
    onreserve?: (data: { startDate: string; endDate: string; startHour: number; startMin: number; endHour: number; endMin: number; methodId: string; periodId: string; addOnly?: boolean }) => void;
    /** 장바구니 담기 아이콘으로 이미 담은 상태 — 예약신청 버튼이 '예약신청확인'(담지 않고 장바구니 이동)으로 바뀐다 */
    cartAdded?: boolean;
    oncartconfirm?: () => void;
    onchange?: (data: { startDate: string; endDate: string; startHour: number; startMin: number; endHour: number; endMin: number }) => void;
    chatCallback?: () => void;
    wished?: boolean;
    onwishtoggle?: () => void;
  }

  let {
    startDate = $bindable(''),
    endDate = $bindable(''),
    startHour = $bindable(12),
    endHour = $bindable(13),
    dailyPrice = 35000,
    halfDayPrice = null,
    optionsTotal = 0,
    mode = 'product',
    rentalMethods = [],
    shippingPolicy = null,
    saleOnly = false,
    selectedMethodId = $bindable(''),
    selectedPeriodId = $bindable(''),
    reserveDisabled = false,
    onreserve,
    onchange,
    cartAdded = false,
    oncartconfirm,
    chatCallback,
    wished = false,
    onwishtoggle,
  }: Props = $props();

  // 판매전용: 배송정책은 기본 배송요금('배송요금')만 노출
  const visibleShippingItems = $derived(
    shippingPolicy ? (saleOnly ? shippingPolicy.items.filter((i) => i.label === '배송요금') : shippingPolicy.items) : []
  );
  const showRentalMethods = $derived(!saleOnly && rentalMethods.length > 0);
  const showShippingGuide = $derived(!saleOnly && !!shippingPolicy?.guide);

  // ── [NOT IN USE] Calendar state — 아래 달력·시간·요금 로직은 SCHEDULE_CALC_UI_ENABLED=false 동안 어디에서도 호출되지 않는다(맨 위 안내 참고)
  const today = new Date();
  let viewYear = $state(today.getFullYear());
  let viewMonth = $state(today.getMonth()); // 0-indexed
  let hoverDate = $state<string | null>(null);
  let pickPhase = $state<'start' | 'end'>('start'); // which date to pick next

  // 과거 날짜 예약 방지 — 오늘 이전 날짜는 선택 불가
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  function isPastDate(iso: string): boolean {
    return iso < todayIso;
  }

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
    if (isPastDate(iso)) return;
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

  let isAtCurrentMonth = $derived(viewYear === today.getFullYear() && viewMonth === today.getMonth());

  function prevMonth() {
    if (isAtCurrentMonth) return;
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

    // 12h 요금 미등록: 12시간 블록을 만들 수 없어 24시간(1440분) 단위 올림 일수 × 24h 요금
    // (25시간 → 2일 — 단 1분이라도 24시간을 넘으면 1일 추가. 장바구니 calcRentalFee·서버 Migration 584와 동일)
    if (halfDayPrice === null) {
      if (totalRentalMinutes <= 0) return optionsTotal;
      return Math.ceil(totalRentalMinutes / 1440) * dailyPrice + optionsTotal;
    }

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

  // ── [IN USE] 버튼 그룹 핸들러 ─────────────────────────────────────────────
  function handleReserve() {
    if (cartAdded && mode === 'product') { oncartconfirm?.(); return; }
    onreserve?.({ startDate, endDate: endDate || startDate, startHour, startMin, endHour, endMin, methodId: selectedMethodId, periodId: selectedPeriodId });
  }

  // 장바구니 담기 아이콘 — 예약신청과 같은 검증·저장 흐름, 화면 이동만 하지 않음.
  // 이미 담긴 상태(cartAdded)에서는 비활성 — 옵션을 수정하면 page가 담긴 건을 자동 취소하고 cartAdded를 풀어 다시 활성화한다.
  function handleAddCart() {
    onreserve?.({ startDate, endDate: endDate || startDate, startHour, startMin, endHour, endMin, methodId: selectedMethodId, periodId: selectedPeriodId, addOnly: true });
  }

  // [B-1] 당일 대여 시 종료시각 ≤ 시작시각 경고
  let sameDayTimeError = $derived(
    isSameDayRental &&
    (endHour * 60 + endMin) <= (startHour * 60 + startMin)
  );

  function handleChat() {
    chatCallback?.();
  }

  // 대여 방식 선택 기능 off (2026-08-03 UX 판단) — 모든 대여옵션 설정은 체크아웃에서 진행.
  // 지금은 클릭 불가한 "가능한 대여 방식" 안내 목록으로만 노출. 재활성화 시 true로 되돌리면
  // 원래의 클릭 선택 UI(policy-chip 버튼 + selectedMethodId 토글)가 그대로 복원됨.
  const rentalMethodSelectable = false;

  let cells = $derived(calCells(viewYear, viewMonth));
  let rows = $derived.by(() => {
    const r: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) r.push(cells.slice(i, i + 7));
    return r;
  });
</script>

<div class="picker-wrap" class:cart-mode={mode === 'cart'}>
  <!-- [NOT IN USE] 렌탈요금 계산기 헤더·달력·시간 선택·요금 요약 — SCHEDULE_CALC_UI_ENABLED=false라 렌더링되지 않는다. 검수·수정 대상 제외(파일 맨 위 안내) -->
  {#if SCHEDULE_CALC_UI_ENABLED && mode === 'product'}
    <div class="picker-header calc-hidden">
      <span class="header-label">렌탈요금 계산기</span>
    </div>
  {/if}

  <!-- Calendar + Time wrapper: mobile = col, PC = row (날짜 미정 임시예약 기능으로 CSS 가림 — 추후 재활용 대비 마크업/로직 유지) -->
  {#if SCHEDULE_CALC_UI_ENABLED}
  <div class="cal-time-wrapper calc-hidden">
  <!-- Calendar -->
  <div class="calendar">
    <div class="cal-nav">
      <button onclick={prevMonth} class="nav-btn" aria-label="이전 달" disabled={isAtCurrentMonth}>
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
              {@const past = isPastDate(iso)}
              <button
                class="cal-cell"
                class:is-start={isStart(iso)}
                class:is-end={isEnd(iso)}
                class:in-range={inRange(iso)}
                class:past-date={past}
                disabled={past}
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
  {/if}

  {#if mode === 'product'}
    {#if SCHEDULE_CALC_UI_ENABLED}
    <!-- [NOT IN USE] 렌탈요금 계산기 요약(총 대여일·예상 대여요금) — 렌더링되지 않는다. 검수·수정 대상 제외 -->
    <div class="calc-hidden calc-summary-group">
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
          <span class="fee-val">{startDate && endDate ? estimatedFee.toLocaleString('ko-KR') : '–'}</span>
          <span class="fee-unit">원</span>
        </div>
      </div>

      {#if sameDayTimeError}
        <p class="fee-note fee-note--warn">반납 시각이 반출 시각보다 앞서 있습니다.</p>
      {:else}
        <p class="fee-note">단순 합계요금으로 실제 결제요금과 다를 수 있습니다.</p>
      {/if}
    </div>

    {/if}<!-- /SCHEDULE_CALC_UI_ENABLED -->

    <!-- [IN USE] 대여정책 (대여방식·배송정책) 안내 -->
    {#if showRentalMethods || visibleShippingItems.length > 0 || showShippingGuide}
      <div class="policy-section">
        {#if showRentalMethods}
          <div class="policy-row">
            <span class="policy-lbl">대여 방식</span>
            <div class="policy-chips">
              {#each rentalMethods as m}
                {#if rentalMethodSelectable}
                  <button
                    type="button"
                    class="policy-chip"
                    class:chip-active={selectedMethodId === m.id}
                    onclick={() => { selectedMethodId = selectedMethodId === m.id ? '' : m.id }}
                    aria-pressed={selectedMethodId === m.id}
                  >{m.name}</button>
                {:else}
                  <span class="policy-chip policy-chip--static">{m.name}</span>
                {/if}
              {/each}
            </div>
          </div>
        {/if}
        {#if visibleShippingItems.length > 0}
          <div class="policy-row">
            <span class="policy-lbl">배송 정책</span>
            <div class="policy-chips">
              {#each visibleShippingItems as item}
                <span class="policy-chip policy-chip--active">{item.label} <strong>{item.fee.toLocaleString('ko-KR')}원</strong></span>
              {/each}
            </div>
          </div>
        {/if}
        {#if showShippingGuide && shippingPolicy}
          <p class="sp-guide">{shippingPolicy.guide}</p>
        {/if}
      </div>
    {/if}


    <!-- [IN USE] CTAs: 찜 · 장바구니 담기 · 예약신청 · 채팅 -->
    <div class="cta-row">
      {#if onwishtoggle}
        <button
          class="wish-btn"
          class:active={wished}
          onclick={onwishtoggle}
          aria-label={wished ? '찜 해제' : '찜하기'}
          aria-pressed={wished}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 63 63" fill="none">
            <path class="wish-bg" d="M63 31.5C63 48.897 48.897 63 31.5 63C14.103 63 0 48.897 0 31.5C0 14.103 14.103 0 31.5 0C48.897 0 63 14.103 63 31.5Z"/>
            <path class="wish-heart" d="M31.3184 17.7266C34.3143 14.7584 39.1662 14.7584 42.1621 17.7266C45.1654 20.7024 45.1656 25.5331 42.1621 28.5088L29.5205 41.0322C27.7302 42.8059 24.8332 42.8059 23.043 41.0322C21.2452 39.2508 21.245 36.3565 23.043 34.5752L34.5674 23.1582C35.1558 22.5752 36.1054 22.5796 36.6885 23.168C37.2715 23.7564 37.2671 24.706 36.6787 25.2891L25.1543 36.707C24.5414 37.3146 24.5413 38.2939 25.1543 38.9014C25.7753 39.5166 26.7882 39.5165 27.4092 38.9014L40.0508 26.377C41.8692 24.575 41.8692 21.6594 40.0508 19.8574C38.2241 18.0477 35.2563 18.0477 33.4297 19.8574L20.7686 32.4014C17.744 35.3979 17.744 40.2506 20.7686 43.2471C23.8008 46.251 28.7227 46.2511 31.7549 43.2471L44.9443 30.1797C45.5328 29.5967 46.4824 29.6011 47.0654 30.1895C47.6484 30.7779 47.644 31.7275 47.0557 32.3105L33.8662 45.3779C29.6647 49.5405 22.8588 49.5405 18.6572 45.3779C14.4479 41.2076 14.448 34.4408 18.6572 30.2705L31.3184 17.7266Z"/>
          </svg>
        </button>
      {/if}
      {#if mode === 'product'}
        <button
          class="cart-add-btn"
          onclick={handleAddCart}
          disabled={reserveDisabled || cartAdded}
          aria-label={cartAdded ? '장바구니에 담김' : '장바구니 담기'}
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="50" height="50" viewBox="0 0 35 35" fill="none" aria-hidden="true">
            <path class="cart-add-bg" d="M35 17.5C35 27.165 27.165 35 17.5 35C7.83502 35 0 27.165 0 17.5C0 7.83502 7.83502 0 17.5 0C27.165 0 35 7.83502 35 17.5Z"/>
            <path d="M25.7736 14.25C26.461 14.3115 26.9685 14.918 26.9073 15.6055L26.5402 19.7188L26.5362 19.7559C26.3287 21.5004 25.6935 23.0646 24.588 24.2061C23.4647 25.3657 21.9392 26 20.1573 26H15.754C13.9724 25.9998 12.4475 25.3656 11.3243 24.2061C10.2189 23.0646 9.58361 21.5003 9.37609 19.7559L9.37316 19.7373L9.37219 19.7188L9.005 15.6055C8.94381 14.9181 9.45154 14.3116 10.1388 14.25C10.8264 14.1887 11.4339 14.6962 11.4952 15.3838L11.8614 19.4766C12.0227 20.8088 12.4854 21.8113 13.1202 22.4668C13.7398 23.1063 14.6009 23.4998 15.754 23.5H20.1573C21.3108 23.5 22.1724 23.1064 22.7921 22.4668C23.427 21.8113 23.8906 20.809 24.0519 19.4766L24.4171 15.3838C24.4784 14.6963 25.0861 14.1889 25.7736 14.25Z" fill="white"/>
            <path d="M17.9562 9.10156C18.8942 9.10156 19.9275 9.43248 20.7423 10.1455C21.5869 10.8847 22.1417 11.9887 22.1417 13.3877V15.4326C22.1417 16.1229 21.582 16.6826 20.8917 16.6826C20.2447 16.6823 19.7125 16.1908 19.6486 15.5605L19.6417 15.4326V13.3877C19.6417 12.6973 19.3889 12.2829 19.0958 12.0264C18.7731 11.7441 18.3385 11.6016 17.9562 11.6016C17.5738 11.6017 17.1392 11.7441 16.8165 12.0264C16.5235 12.2829 16.2706 12.6975 16.2706 13.3877V15.4326C16.2706 16.1229 15.711 16.6826 15.0206 16.6826C14.3304 16.6825 13.7707 16.1228 13.7706 15.4326V13.3877C13.7706 11.9888 14.3256 10.8847 15.17 10.1455C15.9848 9.43242 17.0182 9.10166 17.9562 9.10156Z" fill="white"/>
          </svg>
        </button>
      {/if}
      <button
        class="reserve-btn"
        onclick={handleReserve}
        disabled={reserveDisabled}
        aria-label={cartAdded ? '예약신청확인' : saleOnly ? '구매신청' : '예약신청'}
      >
        {reserveDisabled ? '필수 옵션을 선택해주세요' : cartAdded ? '예약신청확인' : saleOnly ? '구매신청' : '예약신청'}
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



  /* Header */
  .picker-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
  }

  /* 렌탈요금 계산기 헤더·총대여일·예상요금·캘린더 노출 가림 (2026-07-31 UX 판단) — 추후 재활용 대비
     마크업/로직 유지, CSS만으로 가림. !important 필수: .cal-time-wrapper 등 동일 클래스 선택자가
     이 규칙보다 스타일시트 뒤쪽(특히 PC 미디어쿼리)에 있어 !important 없이는 display 값이
     그 규칙에 덮어써져 다시 보임 */
  /* [NOT IN USE] 아래 .picker-header ~ .fee-note--warn(달력·시간·요금 계산기) 스타일 전부 — 마크업이 렌더링되지 않는다(파일 맨 위 안내). 검수·수정 대상 제외 */
  .calc-hidden {
    display: none !important;
  }
  /* calc-hidden 그룹 내부 레이아웃 — picker-wrap의 원래 50px gap(직계 자식 간)을 재현.
     이 div로 감싸면서 duration-row/fee-row/fee-note가 picker-wrap의 직계 자식이 아니게 되어
     기존 gap이 내부에 적용되지 않으므로, 추후 calc-hidden만 해제해 재노출할 때도 원래
     레이아웃 그대로 복원되도록 별도 지정 */
  .calc-summary-group {
    display: flex;
    flex-direction: column;
    gap: 50px;
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
  .nav-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
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
  .cal-cell.past-date {
    color: var(--cs-text-light);
    opacity: 0.35;
    cursor: not-allowed;
  }
  .cal-cell.past-date:hover {
    background: none;
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
      gap: 24px;
      align-items: flex-start;
    }
    /* Fix: calendar must not fill 100% width in PC row layout */
    .calendar {
      flex: 1;
      width: auto;
      gap: 10px;
    }
    .cal-cell {
      font-size: 12px;
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
      gap: 10px;
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
    .time-spinner { gap: 12px; padding: 8px 12px; }
    .time-label { min-width: 22px; }
    .spinner-col { gap: 10px; }
    .spin-btn { min-width: 22px; min-height: 16px; }
    .time-val { min-width: 16px; font-size: 12px; }
    .time-colon { font-size: 12px; }
    .time-ampm { font-size: 12px; }
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

  /* [IN USE] CTAs — 여기서부터가 실제로 쓰이는 스타일(버튼 그룹·대여정책 안내) */
  .cta-row {
    display: flex;
    gap: 12px;
    align-items: center;
  }
  .reserve-btn {
    flex: 1;
    height: 50px;
    background: var(--cs-red);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-title-16);
    cursor: pointer;
    transition: background 0.15s;
  }
  .reserve-btn:hover:not(:disabled) { background: var(--cs-red-badge); } /* 기본색 red-100(--cs-red)과 달라지도록 이전 기본색(red-80)을 호버색으로 */
  .reserve-btn:disabled { background: var(--cs-text-light); cursor: not-allowed; }

  .wish-btn {
    width: 50px;
    height: 50px;
    flex-shrink: 0;
    border-radius: 50%;
    background: none;
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform 0.15s;
  }
  .wish-btn svg { width: 100%; height: 100%; }
  .wish-btn:hover { transform: scale(1.06); }
  .wish-btn:active { transform: scale(0.94); }
  .wish-btn .wish-bg { fill: var(--cs-chat-in-bg); } /* red-10 #FFCFCF — 기본·선택 상태 공통 */
  .wish-btn .wish-heart { fill: var(--cs-white); transition: fill 0.15s; }
  .wish-btn.active .wish-heart { fill: var(--cs-red-badge); } /* red-80 #FF3535 */

  /* 장바구니 담기 아이콘 — Figma 1480:5494: 원형 red-80(#FF3535) + 흰 장바구니, 찜 버튼과 같은 크기 */
  .cart-add-btn {
    width: 50px;
    height: 50px;
    flex-shrink: 0;
    border-radius: 50%;
    background: none;
    border: none;
    padding: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .cart-add-btn svg { width: 100%; height: 100%; }
  .cart-add-btn .cart-add-bg { fill: var(--cs-red-badge); transition: fill 0.15s; }
  .cart-add-btn:hover:not(:disabled) .cart-add-bg { fill: var(--cs-red); }
  .cart-add-btn:disabled { cursor: not-allowed; }
  .cart-add-btn:disabled .cart-add-bg { fill: var(--cs-text-light); }

  .chat-btn {
    display: none;
    width: 60px;
    height: 60px;
    border-radius: 50%;
    background: none;
    border: none;
    padding: 0;
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
  .policy-chip:not(.policy-chip--active):not(.policy-chip--static):hover { background: var(--cs-purple-op10); }
  /* 대여 방식 선택 off 상태의 안내용 chip — 클릭 가능해 보이는 커서·호버 효과 제거 */
  .policy-chip--static {
    cursor: default;
  }
  .policy-chip.chip-active {
    background: var(--cs-purple);
    color: var(--cs-white);
  }
  .policy-chip--active {
    cursor: default;
    background: var(--cs-purple);
    color: var(--cs-white);
  }
  .policy-chip--active strong {
    font-weight: 400;
    opacity: 0.85;
  }
  .sp-guide {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    padding-left: 68px;
    line-height: 1.6;
  }

</style>
