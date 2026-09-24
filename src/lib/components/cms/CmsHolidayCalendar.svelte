<script lang="ts">
  import { onDestroy } from 'svelte'
  import ChevronIcon from '$lib/components/common/ChevronIcon.svelte'
  import CmsDeleteButton from '$lib/components/cms/CmsDeleteButton.svelte'

  // 휴무일 달력형 표시(2026-09-24, Stephen 지시 — 기존 법정공휴일 목록형 대체).
  // PC 전용 화면 전제로 3개월을 좌우로 나란히 노출하고, 좌우 드래그 또는 화살표로 한 달씩 이동.
  // 법정공휴일(national)은 빨간 숫자, 임시 휴무일(manual)은 숫자에 극연한 레드 원형 배경.
  // 날짜 셀 더블클릭(또는 포커스 후 Enter) → 임시 휴무일 등록·편집·삭제 레이어(onsave 전달 시).
  interface HolidayItem {
    id: string
    date: string // YYYY-MM-DD
    name: string
    is_active: boolean
    type: 'national' | 'manual'
  }
  interface Props {
    holidays: HolidayItem[]
    /** 등록(id=null)·수정 저장 — 실패 시 사용자에게 보일 오류 문구, 성공 시 null 반환 */
    onsave?: (p: { id: string | null; date: string; note: string }) => Promise<string | null>
  }
  let { holidays, onsave }: Props = $props()

  const VISIBLE = 3
  const MAX_MONTHS = 36
  const NOTE_MAX = 20
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

  const holidayMap = $derived(new Map(holidays.map((h) => [h.date, h])))

  // 시작 달·오늘은 KST 기준으로 고정 계산 — 서버(UTC)와 브라우저의 로컬 시각이 월 경계 시간대에
  // 서로 달라 SSR 하이드레이션 불일치가 나지 않도록 양쪽에서 동일한 값이 나오게 한다.
  const kst = new Date(Date.now() + 9 * 60 * 60 * 1000)
  const startYear = kst.getUTCFullYear()
  const startMonth = kst.getUTCMonth() // 0-based
  const todayIso = kst.toISOString().slice(0, 10)

  interface MonthModel {
    key: string
    label: string
    cells: ({ day: number; iso: string; holiday: HolidayItem | undefined; sunday: boolean } | null)[]
  }

  function pad(n: number): string {
    return String(n).padStart(2, '0')
  }

  const monthCount = $derived.by(() => {
    let last = 0
    for (const h of holidays) {
      const y = Number(h.date.slice(0, 4))
      const m = Number(h.date.slice(5, 7)) - 1
      last = Math.max(last, (y - startYear) * 12 + (m - startMonth))
    }
    return Math.min(MAX_MONTHS, Math.max(VISIBLE, last + 1))
  })

  const months = $derived.by<MonthModel[]>(() => {
    const out: MonthModel[] = []
    for (let i = 0; i < monthCount; i++) {
      const y = startYear + Math.floor((startMonth + i) / 12)
      const m = (startMonth + i) % 12
      const first = new Date(y, m, 1).getDay()
      const days = new Date(y, m + 1, 0).getDate()
      const cells: MonthModel['cells'] = Array.from({ length: first }, () => null)
      for (let d = 1; d <= days; d++) {
        const iso = `${y}-${pad(m + 1)}-${pad(d)}`
        cells.push({ day: d, iso, holiday: holidayMap.get(iso), sunday: (first + d - 1) % 7 === 0 })
      }
      out.push({ key: `${y}-${pad(m + 1)}`, label: `${y}년 ${m + 1}월`, cells })
    }
    return out
  })

  let viewIndex = $state(0)
  const maxIndex = $derived(Math.max(0, monthCount - VISIBLE))
  const rangeLabel = $derived.by(() => {
    const a = months[viewIndex]
    const b = months[Math.min(monthCount - 1, viewIndex + VISIBLE - 1)]
    return a && b ? `${a.label} ~ ${b.label}` : ''
  })

  function go(delta: number) {
    closeLayer()
    viewIndex = Math.min(maxIndex, Math.max(0, viewIndex + delta))
  }

  // ─── 좌우 드래그(슬라이드) ───
  let viewportEl = $state<HTMLDivElement | null>(null)
  let dragging = $state(false)
  let dragOffset = $state(0)
  let dragMoved = false
  let startX = 0

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return
    startX = e.clientX
    dragMoved = false
    dragOffset = 0
    dragging = true
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp, { once: true })
    // 브라우저가 제스처를 가져가는 등 pointerup 없이 끝나는 경우도 같은 종료 처리(QA L-1)
    window.addEventListener('pointercancel', onPointerUp, { once: true })
  }

  function onPointerMove(e: PointerEvent) {
    const dx = e.clientX - startX
    if (Math.abs(dx) > 5) dragMoved = true
    // 양 끝에서는 저항감만 주고 더 이동하지 못하게 제한
    if ((viewIndex === 0 && dx > 0) || (viewIndex === maxIndex && dx < 0)) dragOffset = dx * 0.25
    else dragOffset = dx
  }

  function detachDragListeners() {
    // onDestroy는 SSR 렌더 종료 시에도 호출되므로 서버(window 없음)에서는 건너뜀 — 이 가드가 없으면
    // 페이지 전체가 500(2026-09-24 QA L-1 수정 직후 실제 발생)
    if (typeof window === 'undefined') return
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
  }

  // 드래그 중 언마운트 시 window 리스너 누수 방지(QA L-1)
  onDestroy(detachDragListeners)

  function onPointerUp() {
    detachDragListeners()
    const width = viewportEl?.clientWidth ?? 0
    const threshold = Math.min(80, (width / VISIBLE) * 0.2)
    if (dragMoved) {
      closeLayer()
      if (dragOffset <= -threshold) viewIndex = Math.min(maxIndex, viewIndex + 1)
      else if (dragOffset >= threshold) viewIndex = Math.max(0, viewIndex - 1)
    }
    dragging = false
    dragOffset = 0
  }

  // ─── 레이어(정보 보기 / 임시 휴무일 등록·편집) ───
  interface LayerState {
    mode: 'view' | 'edit'
    date: string
    holiday: HolidayItem | undefined
    left: number
    top: number
  }
  const LAYER_HALF = { view: 140, edit: 170 } // 레이어 폭(280/340px)의 절반 — 좌우 가장자리 밖 이탈 방지

  let rootEl = $state<HTMLDivElement | null>(null)
  let layer = $state<LayerState | null>(null)
  let draftNote = $state('')
  let saving = $state(false)
  let errorMsg = $state('')

  function closeLayer() {
    layer = null
    saving = false
    errorMsg = ''
  }

  function anchorFor(el: HTMLElement, mode: 'view' | 'edit') {
    const cell = el.getBoundingClientRect()
    const root = rootEl?.getBoundingClientRect()
    if (!root) return null
    const half = LAYER_HALF[mode]
    const center = cell.left - root.left + cell.width / 2
    return {
      left: Math.min(root.width - half, Math.max(half, center)),
      top: cell.bottom - root.top + 6,
    }
  }

  function showLayer(el: HTMLElement, mode: 'view' | 'edit', date: string, holiday: HolidayItem | undefined) {
    const pos = anchorFor(el, mode)
    if (!pos) return
    draftNote = mode === 'edit' && holiday?.type === 'manual' ? holiday.name : ''
    errorMsg = ''
    saving = false
    layer = { mode, date, holiday, ...pos }
  }

  // 단일 클릭 — 공휴일 셀의 정보(이름 전체·유형·비활성 사유) 보기 레이어
  function onHolidayClick(e: MouseEvent, holiday: HolidayItem) {
    if (dragMoved) return
    if (layer?.mode === 'view' && layer.holiday?.id === holiday.id) {
      closeLayer()
      return
    }
    showLayer(e.currentTarget as HTMLElement, 'view', holiday.date, holiday)
  }

  // 더블클릭 / Enter — 임시 휴무일 등록·편집 레이어. 법정공휴일 날짜는 등록 불가라 정보 레이어로 대체.
  function onCellActivate(el: HTMLElement, date: string, holiday: HolidayItem | undefined) {
    if (dragMoved) return
    if (holiday?.type === 'national') {
      showLayer(el, 'view', date, holiday)
      return
    }
    if (!onsave) return
    showLayer(el, 'edit', date, holiday)
  }

  function startEditFromView() {
    if (!layer) return
    // 정보 레이어 위치를 그대로 두고 모드만 전환
    draftNote = layer.holiday?.type === 'manual' ? layer.holiday.name : ''
    errorMsg = ''
    layer = { ...layer, mode: 'edit', left: Math.min(layer.left, (rootEl?.clientWidth ?? 0) - LAYER_HALF.edit) }
  }

  async function submitLayer() {
    if (!layer || layer.mode !== 'edit' || !onsave || saving) return
    saving = true
    errorMsg = ''
    const err = await onsave({
      id: layer.holiday?.type === 'manual' ? layer.holiday.id : null,
      date: layer.date,
      note: draftNote.trim(),
    })
    saving = false
    if (err) errorMsg = err
    else closeLayer()
  }

  function formatDateKo(iso: string): string {
    const y = Number(iso.slice(0, 4))
    const m = Number(iso.slice(5, 7))
    const d = Number(iso.slice(8, 10))
    return `${y}년 ${m}월 ${d}일 (${WEEKDAYS[new Date(y, m - 1, d).getDay()]})`
  }

  function focusOnMount(node: HTMLElement) {
    node.focus()
  }

  function onWindowClick(e: MouseEvent) {
    if (layer && rootEl && !rootEl.contains(e.target as Node)) closeLayer()
  }

  function onKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') closeLayer()
  }
</script>

<svelte:window onclick={onWindowClick} onkeydown={onKeydown} />

<div class="hc-root" bind:this={rootEl}>
  <div class="hc-nav">
    <button type="button" class="hc-nav-btn" aria-label="이전 달" disabled={viewIndex === 0} onclick={() => go(-1)}>
      <ChevronIcon direction="left" size={9} color="currentColor" />
    </button>
    <span class="hc-range">{rangeLabel}</span>
    <button type="button" class="hc-nav-btn" aria-label="다음 달" disabled={viewIndex >= maxIndex} onclick={() => go(1)}>
      <ChevronIcon direction="right" size={9} color="currentColor" />
    </button>
    <span class="hc-legend" aria-hidden="true">
      <i class="hc-legend-dot"></i>임시 휴무일{#if onsave}<span class="hc-legend-hint">· 날짜 더블클릭으로 등록</span>{/if}
    </span>
  </div>

  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="hc-viewport" bind:this={viewportEl} onpointerdown={onPointerDown}>
    <div
      class="hc-track"
      class:hc-track--dragging={dragging}
      style="width: {(monthCount / VISIBLE) * 100}%; transform: translateX(calc({(-viewIndex / monthCount) * 100}% + {dragOffset}px));"
    >
      {#each months as month (month.key)}
        <div class="hc-panel" style="flex: 0 0 {100 / monthCount}%;">
          <div class="hc-month">
            <div class="hc-month-title">{month.label}</div>
            <div class="hc-grid hc-grid--head">
              {#each WEEKDAYS as w, i}
                <span class="hc-weekday" class:hc-weekday--sun={i === 0}>{w}</span>
              {/each}
            </div>
            <div class="hc-grid">
              {#each month.cells as cell}
                {#if cell === null}
                  <span class="hc-cell hc-cell--empty"></span>
                {:else if cell.holiday}
                  <button
                    type="button"
                    class="hc-cell hc-cell--holiday"
                    class:hc-cell--manual={cell.holiday.type === 'manual'}
                    class:hc-cell--inactive={!cell.holiday.is_active}
                    class:hc-cell--open={layer?.date === cell.iso}
                    onclick={(e) => onHolidayClick(e, cell.holiday!)}
                    ondblclick={(e) => onCellActivate(e.currentTarget, cell.iso, cell.holiday)}
                    aria-label="{cell.iso} {cell.holiday.name}"
                  >
                    <span class="hc-day">{cell.day}</span>
                    <span class="hc-name">{cell.holiday.name}</span>
                  </button>
                {:else if onsave && cell.iso >= todayIso}
                  <button
                    type="button"
                    class="hc-cell hc-cell--pick"
                    class:hc-cell--sun={cell.sunday}
                    class:hc-cell--open={layer?.date === cell.iso}
                    ondblclick={(e) => onCellActivate(e.currentTarget, cell.iso, undefined)}
                    onkeydown={(e) => {
                      if (e.key === 'Enter') {
                        dragMoved = false // 마지막 드래그의 잔재가 키보드 등록을 무시하지 않도록(QA L-2)
                        onCellActivate(e.currentTarget, cell.iso, undefined)
                      }
                    }}
                    aria-label="{cell.iso} 임시 휴무일 등록(더블클릭 또는 Enter)"
                  >
                    <span class="hc-day">{cell.day}</span>
                  </button>
                {:else}
                  <span class="hc-cell" class:hc-cell--sun={cell.sunday}>
                    <span class="hc-day">{cell.day}</span>
                  </span>
                {/if}
              {/each}
            </div>
          </div>
        </div>
      {/each}
    </div>
  </div>

  {#if layer?.mode === 'view' && layer.holiday}
    {@const h = layer.holiday}
    <div class="hc-layer" role="dialog" aria-label="공휴일 설명" style="left: {layer.left}px; top: {layer.top}px;">
      <div class="hc-layer-head">
        <span class="hc-layer-date">{h.date} · {h.type === 'manual' ? '임시 휴무일' : '법정공휴일'}</span>
        {#if h.type === 'manual' && onsave}
          <button
            type="button"
            class="hc-icon-btn hc-icon-btn--soft"
            aria-label="편집"
            title="편집"
            onclick={startEditFromView}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
            </svg>
          </button>
        {/if}
      </div>
      <strong class="hc-layer-name">{h.name}</strong>
      {#if !h.is_active}
        <span class="hc-layer-note">동기화 정정으로 비활성화됨 — /cart 휴무일 판정에서 제외됩니다</span>
      {/if}
    </div>
  {:else if layer?.mode === 'edit'}
    {@const existing = layer.holiday?.type === 'manual' ? layer.holiday : undefined}
    <div class="hc-layer hc-layer--edit" role="dialog" aria-label="임시 휴무일 {existing ? '수정' : '등록'}" style="left: {layer.left}px; top: {layer.top}px;">
      <div class="hc-layer-head">
        <strong class="hc-layer-title">{formatDateKo(layer.date)}</strong>
        <span class="hc-layer-tag">임시 휴무일 {existing ? '수정' : '등록'}</span>
      </div>
      <!-- CmsDeleteButton이 자체 <form>을 가지므로 폼 중첩을 피해 입력폼과 삭제 버튼을 같은 행의 형제로 배치 -->
      <div class="hc-edit-row">
      <form
        class="hc-edit-form"
        onsubmit={(e) => {
          e.preventDefault()
          void submitLayer()
        }}
      >
        <input
          type="text"
          class="hc-input"
          bind:value={draftNote}
          maxlength={NOTE_MAX}
          placeholder="사유 입력 (예: 명절 연휴)"
          aria-label="임시 휴무일 사유"
          disabled={saving}
          use:focusOnMount
        />
        <button
          type="submit"
          class="hc-icon-btn hc-icon-btn--primary"
          aria-label={existing ? '수정 저장' : '등록'}
          title={existing ? '수정 저장' : '등록'}
          disabled={saving}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M12 20h9" />
            <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
          </svg>
        </button>
      </form>
        {#if existing}
          <CmsDeleteButton
            action="?/deleteManualHoliday"
            id={existing.id}
            successMessage="임시 휴무일이 삭제되었습니다."
            onsuccess={closeLayer}
          />
        {/if}
      </div>
      <div class="hc-edit-foot">
        {#if errorMsg}
          <span class="hc-error" role="alert">{errorMsg}</span>
        {:else}
          <span></span>
        {/if}
        <span class="hc-count">{draftNote.length} / {NOTE_MAX}</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .hc-root {
    position: relative;
    user-select: none;
  }

  .hc-nav {
    display: flex;
    align-items: center;
    gap: 12px;
    margin-bottom: 12px;
  }

  .hc-range {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    min-width: 190px;
    text-align: center;
  }

  .hc-nav-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: none;
    border-radius: var(--radius-full);
    background: transparent;
    color: var(--cs-text-mid);
    cursor: pointer;
  }
  .hc-nav-btn:hover:not(:disabled) {
    background: var(--cs-surface-gray);
  }
  .hc-nav-btn:disabled {
    color: var(--cs-text-light);
    opacity: 0.4;
    cursor: not-allowed;
  }

  .hc-viewport {
    overflow: hidden;
    touch-action: pan-y;
    cursor: grab;
  }
  .hc-viewport:active {
    cursor: grabbing;
  }

  .hc-track {
    display: flex;
    transition: transform 0.3s ease;
  }
  .hc-track--dragging {
    transition: none;
  }

  .hc-panel {
    box-sizing: border-box;
    padding: 0 8px;
    min-width: 0;
  }
  .hc-panel:first-child {
    padding-left: 0;
  }

  .hc-month {
    box-sizing: border-box;
    height: 100%; /* 5주/6주 달이 섞여도 카드 높이를 같은 줄에서 통일 */
    border: 1px solid #F3F4F6; /* neutral-gray-250 — CSS 변수 미정의(이 화면 그룹핑 박스와 동일 톤) */
    border-radius: var(--cms-radius-sm);
    padding: 14px 14px 12px;
  }

  .hc-month-title {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    margin-bottom: 10px;
  }

  .hc-grid {
    display: grid;
    grid-template-columns: repeat(7, minmax(0, 1fr));
    gap: 2px;
  }
  .hc-grid--head {
    margin-bottom: 4px;
  }

  .hc-weekday {
    text-align: center;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
  .hc-weekday--sun {
    color: var(--cs-red-badge);
  }

  .hc-cell {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 2px;
    min-height: 66px; /* 기존 44px의 +50% — 공휴일명 2줄 줄바꿈 공간 확보(2026-09-24, Stephen 지시) */
    padding: 4px 2px;
    min-width: 0;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    font: inherit;
    color: var(--cs-text);
  }
  .hc-cell--empty {
    pointer-events: none;
  }

  .hc-day {
    font: var(--text-pc-body-14);
  }
  .hc-cell--sun .hc-day {
    color: var(--cs-red-badge);
  }

  /* 더블클릭으로 임시 휴무일을 등록할 수 있는 빈 날짜(오늘 이후) */
  .hc-cell--pick {
    cursor: pointer;
  }
  .hc-cell--pick:hover,
  .hc-cell--pick:focus-visible {
    background: var(--cs-surface-gray);
  }

  .hc-cell--holiday {
    cursor: pointer;
  }
  .hc-cell--holiday .hc-day {
    color: var(--cs-red-badge);
    font-weight: 700;
  }
  .hc-cell--holiday:hover,
  .hc-cell--open {
    background: var(--cs-surface-gray);
  }

  /* 이름은 셀 폭 안에서 글자 단위로 자동 줄바꿈해 최대 2줄까지 노출, 그 이상은 말줄임 —
     잘린 긴 이름·임시 휴무일 사유는 클릭 시 보조 설명 레이어에서 전체 확인 */
  .hc-name {
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
    max-width: 100%;
    font: var(--text-pc-script-12);
    font-size: 11px;
    line-height: 1.25;
    text-align: center;
    color: var(--cs-text-mid);
    word-break: break-all;
    overflow: hidden;
  }

  /* 임시 휴무일 — 날짜 숫자에 극연한 레드 원형 배경(bg 토큰은 원형 배지에만 적용) */
  .hc-cell--manual .hc-day {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 50%;
    background: var(--cs-red-xlight);
  }

  .hc-legend {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: auto;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }
  .hc-legend-dot {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background: var(--cs-red-xlight);
  }
  .hc-legend-hint {
    color: var(--cs-text-light);
  }

  /* is_active=false — /cart 휴무일 판정에서 제외 중인 국경일(기존 목록형의 list-row-inactive와 동일 의미) */
  .hc-cell--inactive {
    opacity: 0.5;
  }
  .hc-cell--inactive .hc-name {
    text-decoration: line-through;
  }

  .hc-layer {
    position: absolute;
    z-index: 20;
    transform: translateX(-50%);
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: max-content;
    max-width: 280px;
    padding: 12px 14px;
    background: var(--cs-white);
    border: 1px solid var(--cs-border);
    border-radius: var(--cms-radius-sm);
    box-shadow: 0 4px 16px rgba(16, 11, 50, 0.12);
    user-select: text;
  }
  /* 등록·편집 레이어 — 정보 보기 레이어(280px)보다 조금 큰 340px(2026-09-24, Stephen 지시) */
  .hc-layer--edit {
    width: 340px;
    max-width: 340px;
    gap: 10px;
    padding: 14px 16px;
  }
  .hc-layer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .hc-layer-title {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }
  .hc-layer-tag {
    flex-shrink: 0;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-red-badge);
    background: var(--cs-red-xlight);
    border-radius: var(--radius-full);
    padding: 2px 10px;
  }
  .hc-layer-date {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }
  .hc-layer-name {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
    word-break: break-all; /* 띄어쓰기 없는 긴 임시 휴무일 사유도 레이어 폭 안에서 줄바꿈 */
  }
  .hc-layer-note {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
  }

  .hc-edit-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .hc-edit-form {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    gap: 6px;
  }
  .hc-input {
    flex: 1;
    min-width: 0;
    height: 36px;
    padding: 0 12px;
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    background: var(--cs-white);
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    outline: none;
  }
  .hc-input:focus {
    border-color: var(--cs-purple);
  }
  .hc-input::placeholder {
    color: var(--cs-text-light);
  }

  /* 라운드 정사각 bg 아이콘 버튼 — 등록(연필)·편집 진입(연필, 옅은 톤) 공용 */
  .hc-icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    padding: 0;
    border: none;
    border-radius: var(--cms-radius-sm);
    cursor: pointer;
    transition: background 0.12s, opacity 0.12s;
  }
  .hc-icon-btn--primary {
    background: var(--cs-purple);
    color: var(--cs-white);
  }
  .hc-icon-btn--primary:hover:not(:disabled) {
    background: var(--cs-purple-hover);
  }
  .hc-icon-btn--soft {
    width: 28px;
    height: 28px;
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
  }
  .hc-icon-btn--soft:hover {
    background: var(--cs-lilac);
    color: var(--cs-purple);
  }
  .hc-icon-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .hc-edit-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }
  .hc-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
  }
  .hc-count {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }
</style>
