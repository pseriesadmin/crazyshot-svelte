<script lang="ts">
  import CalendarGrid from '$lib/components/common/CalendarGrid.svelte'

  interface Props {
    value?: string
    name?: string
    placeholder?: string
    disablePast?: boolean
    onchange?: (iso: string) => void
  }

  let { value = $bindable(''), name = '', placeholder = '날짜 선택', disablePast = false, onchange }: Props = $props()

  let open = $state(false)
  let triggerEl = $state<HTMLButtonElement | null>(null)

  function displayValue(iso: string): string {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return `${y}.${m}.${d}`
  }

  function handleSelect(iso: string) {
    value = iso
    open = false
    onchange?.(iso)
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') open = false
  }

  // 2026-09-23(버그 수정) — 이 팝업은 CMS 우측 슬라이드 패널(.panel-body,
  // overflow-y:auto)처럼 스크롤되는 조상 안에서도 쓰인다. 기존 position:absolute는 그
  // 조상의 overflow에 그대로 클리핑되는데, 절대배치 요소는 조상의 scrollHeight를 늘리지
  // 않아 "더 스크롤해서 가려진 마지막 줄을 본다"는 시도 자체가 불가능했다(실사용 버그
  // 리포트 — 달력 마지막 줄 선택 불가). 트리거 위치를 JS로 측정해 position:fixed로
  // 뷰포트 기준 배치하면 어떤 스크롤 조상의 overflow에도 클리핑되지 않는다 — 아래로 열
  // 공간이 부족하면 위로 뒤집고, 그래도 부족하면 뷰포트 안쪽에 붙인 뒤 팝업 자체의
  // overflow-y:auto(아래 CSS)가 나머지를 커버한다.
  function positionPopup(node: HTMLDivElement) {
    const trigger = triggerEl
    if (!trigger) return
    // 2026-09-23(Stephen 피드백) — 트리거(호출 영역)와 팝업 사이 여백이 커 보여
    // "따로 노는" 느낌을 준다는 지적으로 4px → 2px로 축소.
    const margin = 2
    const viewportMargin = 8

    function reposition() {
      const rect = trigger!.getBoundingClientRect()
      const popupRect = node.getBoundingClientRect()
      const popupWidth = popupRect.width || 260
      const popupHeight = popupRect.height

      let top = rect.bottom + margin
      if (top + popupHeight > window.innerHeight - viewportMargin) {
        const above = rect.top - margin - popupHeight
        top = above >= viewportMargin
          ? above
          : Math.max(viewportMargin, window.innerHeight - viewportMargin - popupHeight)
      }

      let left = rect.left
      if (left + popupWidth > window.innerWidth - viewportMargin) {
        left = window.innerWidth - viewportMargin - popupWidth
      }
      left = Math.max(viewportMargin, left)

      node.style.top = `${top}px`
      node.style.left = `${left}px`
      node.style.visibility = 'visible'
    }

    reposition()

    // 팝업이 열려있는 동안 다른 조상(예: 패널 바디)이 스크롤되면, 트리거가 화면에서
    // 움직인 만큼 팝업도 그 자리를 계속 따라가도록 매 스크롤마다 위치를 다시 계산한다
    // (2026-09-23, Stephen 피드백 — 과거엔 스크롤 시 팝업을 그냥 닫아버렸으나 "트리거와
    // 팝업이 따로 논다"는 지적을 받아 닫는 대신 계속 따라붙도록 변경). 팝업 자신의 내부
    // 스크롤(overflow-y:auto, 짧은 뷰포트에서만 발생)은 재계산 대상이 아니므로 제외.
    function onAncestorScroll(e: Event) {
      if (e.target === node) return
      reposition()
    }
    window.addEventListener('scroll', onAncestorScroll, true)

    // 2026-09-23(버그 수정) — "바깥 클릭 시 닫기"를 과거엔 뷰포트 전체를 덮는
    // .dp-backdrop(position:fixed, inset:0) div로 구현했었다. 이 방식은 팝업이 열려있는
    // 동안 화면 어디서 스크롤을 시도해도(달력 위가 아니라 배경 어디든) panel-body에
    // 스크롤이 전혀 전달되지 않는 부작용이 있었다(실측 확인 — backdrop 유무에 따라
    // scrollTop이 아예 안 바뀜/정상적으로 바뀜으로 재현·검증됨) — "달력을 열면 본문
    // 스크롤이 막힌다"는 지적의 실제 원인. 뷰포트를 덮는 div 없이, 클릭 지점이 팝업·
    // 트리거 바깥일 때만 닫는 document 리스너로 교체해 배경 스크롤을 전혀 가로채지 않도록
    // 했다.
    function onOutsideClick(e: PointerEvent) {
      const target = e.target as Node
      if (node.contains(target) || trigger!.contains(target)) return
      open = false
    }
    document.addEventListener('pointerdown', onOutsideClick, true)

    return {
      destroy() {
        window.removeEventListener('scroll', onAncestorScroll, true)
        document.removeEventListener('pointerdown', onOutsideClick, true)
      },
    }
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div class="dp-wrap" class:dp-open={open}>
  {#if name}
    <input type="hidden" {name} {value} />
  {/if}

  <button
    type="button"
    class="dp-trigger"
    bind:this={triggerEl}
    onclick={() => open = !open}
    aria-haspopup="true"
    aria-expanded={open}
  >
    <span class="dp-value" class:dp-placeholder={!value}>
      {value ? displayValue(value) : placeholder}
    </span>
    <svg class="dp-chevron" class:dp-chevron-open={open} width="10" height="6" viewBox="0 0 10 6" fill="none">
      <path d="M1 1L5 5L9 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </svg>
  </button>

  {#if open}
    <div class="dp-popup" role="dialog" aria-label="날짜 선택" use:positionPopup>
      <CalendarGrid {value} onselect={handleSelect} {disablePast} />
    </div>
  {/if}
</div>

<style>
  .dp-wrap {
    position: relative;
    display: inline-block;
    width: 100%;
  }

  .dp-trigger {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 8px 12px;
    cursor: pointer;
    transition: outline 0.15s;
    min-height: 36px;
    text-align: left;
  }
  .dp-trigger:focus-visible {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }
  .dp-open .dp-trigger {
    outline: 2px solid var(--cs-purple);
    outline-offset: -2px;
  }

  .dp-value {
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    flex: 1;
  }
  .dp-placeholder { color: var(--cs-text-placeholder); }

  .dp-chevron {
    color: var(--cs-text-mid);
    transition: transform 0.2s;
    flex-shrink: 0;
  }
  .dp-chevron-open { transform: rotate(180deg); }

  /* position:fixed + JS 측정 배치(positionPopup 액션, 위 script 주석 참고) — 조상의
     overflow-y:auto(CMS 슬라이드 패널 .panel-body 등)에 클리핑되지 않도록 뷰포트 기준으로
     배치한다. visibility:hidden으로 시작해 positionPopup이 top/left를 계산해 넣은 뒤에만
     보이도록 해 위치가 튀는 깜빡임을 방지. max-height+overflow-y:auto는 위·아래 어느
     쪽으로도 공간이 부족한 극단적인 경우(짧은 뷰포트)에도 마지막 줄까지 항상 팝업 자체
     스크롤로 도달 가능하게 하는 안전장치. */
  .dp-popup {
    position: fixed;
    visibility: hidden;
    z-index: 50;
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    padding: 16px;
    box-shadow: 0 8px 24px rgba(16,11,50,0.12);
    width: 260px;
    max-height: calc(100vh - 16px);
    overflow-y: auto;
    box-sizing: border-box;
  }
</style>
