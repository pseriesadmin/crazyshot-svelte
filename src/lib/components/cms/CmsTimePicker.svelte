<script lang="ts">
  // CmsTimePicker — CMS 시각 선택(시·분 스크롤 휠 + 저장, 우측 상단 닫기 ✕), 2026-11-10
  // 구조 출처: Figma "Time picker" (시:분 휠 · 저장; 제목·취소 버튼은 빼고 CMS 표준 닫기 ✕ 사용). 색·반경·버튼은 CMS 표준 토큰으로 대체(보더 대신 면 채움).
  // 값 형식은 24시간 'HH:MM'. 팝업 배치는 CmsDatePicker 와 같은 방식(position:fixed + 트리거 측정 — 스크롤 조상에 클리핑되지 않음).
  interface Props {
    value?: string
    placeholder?: string
    title?: string
    disabled?: boolean
    ariaLabel?: string
    /** 즉시 반영 선택 — 시(없음·01~24)와 분(10분 단위) 목록을 나란히 두고, 고르는 즉시 'HH:MM'(없음은 '')을 돌려준다. 저장 버튼 없음. 기본(false)은 기존 시·분 휠 선택. */
    instant?: boolean
    onchange?: (hhmm: string) => void
  }

  let { value = '', placeholder = '시각 선택', title = '시간 설정', disabled = false, ariaLabel = '시각 선택', instant = false, onchange }: Props = $props()

  const ROW = 26 // 휠 한 줄 높이(px) — 아래 CSS --tp-row 와 같다
  const HOURS = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'))
  // instant 목록: '없음'(빈 값)은 시·분 목록 위 가로 바, 시 = 01 ~ 24, 분 = 10분 단위 — 고르는 즉시 반영(24시는 00분만)
  const INSTANT_HOURS = Array.from({ length: 24 }, (_, i) => String(i + 1).padStart(2, '0'))
  const INSTANT_MINUTES = ['00', '10', '20', '30', '40', '50']
  const curHour = $derived(value ? value.slice(0, 2) : '')
  const curMinute = $derived(value ? value.slice(3, 5) : '')
  const MINUTES = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'))

  let open = $state(false)
  let triggerEl = $state<HTMLButtonElement | null>(null)
  let hour = $state(0)
  let minute = $state(0)

  function openPopup(): void {
    if (disabled) return
    const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value)
    hour = m ? Number(m[1]) : 9
    minute = m ? Number(m[2]) : 0
    open = true
  }
  function close(): void {
    open = false
    triggerEl?.focus()
  }
  function commit(): void {
    const next = `${HOURS[hour]}:${MINUTES[minute]}`
    open = false
    triggerEl?.focus()
    onchange?.(next)
  }
  // 시·분 목록은 고르는 즉시 값을 돌려주고 팝업은 열어 둔다(시와 분을 이어서 고를 수 있게) — 닫기는 ✕·바깥 클릭
  function chooseHour(h: string): void {
    if (h === '') onchange?.('')
    else onchange?.(`${h}:${h === '24' ? '00' : curMinute || '00'}`)
  }
  function chooseMinute(m: string): void {
    if (!curHour || curHour === '24') return
    onchange?.(`${curHour}:${m}`)
  }
  // 목록이 열리면 선택된 값이 보이도록 스크롤
  function scrollToSelected(node: HTMLDivElement) {
    node.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: 'center' })
  }

  // 휠: 열릴 때 선택값이 가운데 줄에 오도록 스크롤하고, 스크롤이 멈추는 위치를 선택값으로 읽는다.
  function wheel(node: HTMLDivElement, opts: { count: number; get: () => number; set: (i: number) => void }) {
    node.scrollTop = opts.get() * ROW
    function onScroll(): void {
      const idx = Math.max(0, Math.min(opts.count - 1, Math.round(node.scrollTop / ROW)))
      if (idx !== opts.get()) opts.set(idx)
    }
    node.addEventListener('scroll', onScroll, { passive: true })
    return { destroy: () => node.removeEventListener('scroll', onScroll) }
  }
  function pick(node: HTMLElement | null, idx: number): void {
    node?.scrollTo({ top: idx * ROW, behavior: 'smooth' })
  }
  function onWheelKey(e: KeyboardEvent, current: number, count: number, set: (i: number) => void): void {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
    e.preventDefault()
    const next = Math.max(0, Math.min(count - 1, current + (e.key === 'ArrowDown' ? 1 : -1)))
    set(next)
    pick(e.currentTarget as HTMLElement, next)
  }
  function onKeydown(e: KeyboardEvent): void {
    if (!open) return
    if (e.key === 'Escape') close()
    else if (e.key === 'Enter' && !instant) {
      // 휠 모드 전용 — instant 는 고르는 즉시 반영되므로 Enter 로 낡은 휠 값을 저장하지 않는다(포커스된 목록 버튼은 기본 동작으로 선택된다)
      e.preventDefault()
      commit()
    }
  }

  function positionPopup(node: HTMLDivElement) {
    const trigger = triggerEl
    if (!trigger) return
    const margin = 2
    const viewportMargin = 8
    function reposition(): void {
      const rect = trigger!.getBoundingClientRect()
      const popupRect = node.getBoundingClientRect()
      const w = popupRect.width || 176
      const h = popupRect.height
      let top = rect.bottom + margin
      if (top + h > window.innerHeight - viewportMargin) {
        const above = rect.top - margin - h
        top = above >= viewportMargin ? above : Math.max(viewportMargin, window.innerHeight - viewportMargin - h)
      }
      let left = rect.left
      if (left + w > window.innerWidth - viewportMargin) left = window.innerWidth - viewportMargin - w
      node.style.top = `${top}px`
      node.style.left = `${Math.max(viewportMargin, left)}px`
      node.style.visibility = 'visible'
    }
    reposition()
    function onAncestorScroll(e: Event): void {
      if (node.contains(e.target as Node)) return // 휠 내부 스크롤은 재배치 대상이 아니다
      reposition()
    }
    function onOutside(e: PointerEvent): void {
      const t = e.target as Node
      if (node.contains(t) || trigger!.contains(t)) return
      open = false
    }
    window.addEventListener('scroll', onAncestorScroll, true)
    document.addEventListener('pointerdown', onOutside, true)
    return {
      destroy() {
        window.removeEventListener('scroll', onAncestorScroll, true)
        document.removeEventListener('pointerdown', onOutside, true)
      },
    }
  }

  let hourEl = $state<HTMLDivElement | null>(null)
  let minuteEl = $state<HTMLDivElement | null>(null)
</script>

<svelte:window onkeydown={onKeydown} />

<div class="tp-wrap" class:tp-open={open} class:tp-instant={instant}>
  <button
    type="button"
    class="tp-trigger"
    bind:this={triggerEl}
    {disabled}
    aria-label={ariaLabel}
    aria-haspopup="dialog"
    aria-expanded={open}
    onclick={() => (open ? (open = false) : openPopup())}
  >
    <span class="tp-value" class:tp-placeholder={!value}>{value || placeholder}</span>
    <svg class="tp-clock" width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="5.75" stroke="currentColor" stroke-width="1.5" />
      <path d="M7 4v3.2l2.1 1.3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </button>

  {#if open}
    <div class="tp-popup" role="dialog" aria-label={title} use:positionPopup>
      {#if !instant}
        <button type="button" class="tp-close" aria-label="패널 닫기" onclick={close}>✕</button>
      {/if}

      {#if instant}
      <button type="button" class="tp-opt tp-none" class:tp-opt-sel={value === ''} aria-pressed={value === ''} {disabled} onclick={() => chooseHour('')}>없음</button>
      <div class="tp-lists">
        <div class="tp-list" role="listbox" aria-label="시" use:scrollToSelected>
          {#each INSTANT_HOURS as h (h)}
            <button type="button" class="tp-opt" class:tp-opt-sel={h === curHour} role="option" aria-selected={h === curHour} {disabled} onclick={() => chooseHour(h)}>{h}</button>
          {/each}
        </div>
        <span class="tp-colon" aria-hidden="true">:</span>
        <div class="tp-list" role="listbox" aria-label="분" use:scrollToSelected>
          {#each INSTANT_MINUTES as m (m)}
            <button type="button" class="tp-opt" class:tp-opt-sel={!!curHour && m === curMinute} role="option" aria-selected={!!curHour && m === curMinute} disabled={disabled || !curHour || curHour === '24'} onclick={() => chooseMinute(m)}>{m}</button>
          {/each}
        </div>
      </div>
      {:else}
      <div class="tp-wheels">
        <div class="tp-band" aria-hidden="true"></div>

        <div
          class="tp-col"
          role="listbox"
          tabindex="0"
          aria-label="시"
          bind:this={hourEl}
          use:wheel={{ count: 24, get: () => hour, set: (i) => (hour = i) }}
          onkeydown={(e) => onWheelKey(e, hour, 24, (i) => (hour = i))}
        >
          {#each HOURS as h, i (h)}
            <button type="button" class="tp-item" class:tp-item-sel={i === hour} role="option" aria-selected={i === hour} tabindex="-1" onclick={() => { hour = i; pick(hourEl, i) }}>{h}</button>
          {/each}
        </div>

        <span class="tp-colon" aria-hidden="true">:</span>

        <div
          class="tp-col"
          role="listbox"
          tabindex="0"
          aria-label="분"
          bind:this={minuteEl}
          use:wheel={{ count: 60, get: () => minute, set: (i) => (minute = i) }}
          onkeydown={(e) => onWheelKey(e, minute, 60, (i) => (minute = i))}
        >
          {#each MINUTES as m, i (m)}
            <button type="button" class="tp-item" class:tp-item-sel={i === minute} role="option" aria-selected={i === minute} tabindex="-1" onclick={() => { minute = i; pick(minuteEl, i) }}>{m}</button>
          {/each}
        </div>
      </div>

      <div class="tp-actions">
        <button type="button" class="tp-btn" onclick={commit}>저장</button>
      </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .tp-wrap {
    position: relative;
    display: inline-block;
    width: 100%;
  }

  /* 트리거 — CmsDatePicker 와 같은 면(fill) 입력 스타일 */
  .tp-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    min-height: 40px;
    padding: 8px 14px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    cursor: pointer;
    text-align: left;
  }
  .tp-trigger:focus-visible,
  .tp-open .tp-trigger {
    outline: 2px solid var(--cs-focus-ring);
    outline-offset: -2px;
  }
  .tp-trigger:disabled {
    opacity: 0.5;
    cursor: default;
  }
  .tp-value {
    flex: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }
  .tp-placeholder {
    color: var(--cs-text-placeholder);
  }
  .tp-clock {
    flex-shrink: 0;
    color: var(--cs-text-mid);
  }

  .tp-popup {
    --tp-row: 26px;
    position: fixed;
    visibility: hidden;
    z-index: 50;
    width: 176px;
    box-sizing: border-box;
    padding: 32px 12px 10px; /* 위쪽은 우측 상단 닫기 버튼 자리 */
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    box-shadow: 0 8px 24px rgba(16, 11, 50, 0.12);
  }
  /* 닫기 — CMS 표준 close-red(§0-10-A) 절대배치 변형: ✕ 문자, hover 레드 */
  .tp-close {
    position: absolute;
    top: 4px;
    right: 8px;
    z-index: 2;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-text-light);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .tp-close:hover {
    background: rgba(255, 53, 53, 0.08);
    color: var(--cs-red-badge);
  }

  /* 휠 영역: 3줄(위·가운데·아래)이 보이고 가운데 줄이 선택값 — 선 대신 면(fill) 띠로 표시 */
  .tp-wheels {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: calc(var(--tp-row) * 3);
    margin-bottom: 8px;
  }
  .tp-band {
    position: absolute;
    left: 0;
    right: 0;
    top: var(--tp-row);
    height: var(--tp-row);
    border-radius: var(--cms-radius-sm);
    background: var(--cs-lilac);
    pointer-events: none;
  }
  .tp-col {
    position: relative;
    z-index: 1;
    width: 56px;
    height: calc(var(--tp-row) * 3);
    overflow-y: auto;
    scroll-snap-type: y mandatory;
    padding: var(--tp-row) 0; /* 처음·끝 값도 가운데 줄에 올 수 있게 */
    box-sizing: border-box;
    scrollbar-width: none;
    outline: none;
  }
  .tp-col::-webkit-scrollbar {
    display: none;
  }
  .tp-col:focus-visible {
    border-radius: var(--cms-radius-sm);
    outline: 2px solid var(--cs-focus-ring);
    outline-offset: -2px;
  }
  .tp-item {
    display: block;
    width: 100%;
    height: var(--tp-row);
    padding: 0;
    border: none;
    background: transparent;
    scroll-snap-align: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-light);
    cursor: pointer;
    text-align: center;
  }
  .tp-item:hover:not(.tp-item-sel) {
    color: var(--cs-text-mid);
  }
  .tp-item-sel {
    color: var(--cs-text);
  }
  .tp-colon {
    position: relative;
    z-index: 1;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
  }

  /* instant 선택기의 숫자 — 숫자 전용 폰트(D-DIN Exp, app.css --font-en-d-din 과 같은 폰트). 크기·굵기는 기존 토큰 그대로, 한글('없음')은 한글 폰트로 대체 */
  /* instant 선택기 레이어 가로폭 축소(176px → 124px): 시·분 두 목록만 담으므로 목록 폭 44px */
  .tp-instant .tp-popup {
    width: 124px;
    padding: 10px; /* 닫기 ✕ 없음 — 바깥 클릭·Esc 로 닫는다 */
  }
  .tp-instant .tp-list {
    width: 44px;
  }
  /* '없음' — 시·분 목록 위 전체 가로폭 바 */
  .tp-none {
    margin-bottom: 4px;
  }
  .tp-instant .tp-value {
    letter-spacing: 0.12em; /* '시 : 분' 자간 확대 — 22:10 이 붙어 보이지 않게 */
  }
  .tp-instant .tp-value,
  .tp-instant .tp-opt,
  .tp-instant .tp-colon {
    font-family: 'D-DIN Exp', var(--font-kr);
  }

  /* instant 목록 — 시·분을 나란히 두고 고르는 즉시 반영. 선택값은 면(fill) 표시, 호버는 배경색만 변경 */
  .tp-lists {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
  }
  .tp-list {
    width: 56px;
    max-height: calc(var(--tp-row) * 3.4); /* 세로폭 30% 축소(레이어 228px → 약 160px) — 3줄 + 다음 줄 일부가 보여 스크롤 가능함을 알려준다 */
    overflow-y: auto;
    scroll-snap-type: y mandatory; /* 자석 모션 — 스크롤하면 한 줄 단위로 딱 달라붙는다 */
    overscroll-behavior: contain; /* 목록 끝에서 페이지가 같이 스크롤되지 않게 */
    scrollbar-width: none;
  }
  .tp-list::-webkit-scrollbar {
    display: none;
  }
  .tp-opt {
    display: block;
    width: 100%;
    scroll-snap-align: start;
    height: var(--tp-row);
    padding: 0;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: transparent;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    text-align: center;
    cursor: pointer;
  }
  .tp-opt-sel {
    background: var(--cs-lilac);
    color: var(--cs-text);
  }
  .tp-opt:disabled {
    opacity: 0.4;
    cursor: default;
  }
  @media (hover: hover) {
    .tp-opt:hover:not(.tp-opt-sel) {
      background: var(--cs-surface-gray);
    }
  }

  /* 저장 — 소형 실행 버튼 크기·반경(cms-uiux §0-10-F)에 버튼 아웃라인 회피 원칙(§0-10 공통)을 적용: 아웃라인 없이 면 색만 쓰고, 호버·터치는 배경 토큰 변경으로 표현 (팝업 안에서는 가운데 정렬 — Stephen 지시) */
  .tp-actions {
    display: flex;
    justify-content: center;
  }
  .tp-btn {
    min-width: 78px;
    text-align: center;
    flex-shrink: 0;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.4;
    padding: 8px 14px;
    border: none;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-lilac);
    color: var(--cs-text-mid);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  @media (hover: hover) {
    .tp-btn:hover {
      background: var(--cs-text-mid);
      color: var(--cs-white);
    }
  }
  .tp-btn:active {
    background: var(--cs-text-mid);
    color: var(--cs-white);
  }
</style>
