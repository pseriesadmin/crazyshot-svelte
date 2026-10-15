<script lang="ts">
  /**
   * CmsHelpBubble — CMS 풍선형 도움말(2026-10-15 표준 등록, Stephen 지시)
   *
   * 감싼 UI(토글·버튼·라벨 등)에 마우스를 올리거나 키보드 포커스가 들어오면 안내문이
   * 풍선으로 자동 노출된다. 화면에 항상 보이던 긴 안내문을 이 풍선으로 옮겨 가로·세로 공간을 줄인다.
   * 정본 스펙 → cms-uiux.md §7-18
   */
  import type { Snippet } from 'svelte'

  interface Props {
    /** 풍선에 표시할 안내문 */
    text: string
    /** 풍선이 열리는 방향(기본: 아래 — 패널 상단 클리핑 방지) */
    placement?: 'bottom' | 'top'
    children: Snippet
  }

  let { text, placement = 'bottom', children }: Props = $props()

  // SSR·클라이언트 첫 렌더링에서 같은 값이 나오는 Svelte 표준 id(Math.random 사용 시 hydration 불일치)
  const baseId = $props.id()
  const uid = `chb-${baseId}`

  let wrapEl: HTMLSpanElement | undefined = $state()
  /** Esc로 닫은 상태 — 마우스가 벗어나거나 포커스가 나가면 다시 열릴 수 있게 초기화 */
  let dismissed = $state(false)
  /** 감싼 UI가 포커스를 못 받는 경우(예: disabled 버튼) 래퍼 자체를 포커스 대상으로 만든다 */
  let wrapFocusable = $state(false)

  const FOCUSABLE = 'button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])'

  // 풍선 설명을 "포커스를 받는 실제 요소"에 연결(스크린리더가 버튼 설명으로 읽도록).
  // 포커스 가능한 자식이 없거나 전부 disabled면 래퍼에 tabindex를 줘 키보드로도 풍선을 볼 수 있게 한다.
  $effect(() => {
    if (!wrapEl) return
    const root = wrapEl
    const sync = () => {
      const targets = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => !el.closest('.chb-bubble'))
      const usable = targets.filter((el) => !(el as HTMLButtonElement).disabled)
      for (const el of targets) el.setAttribute('aria-describedby', uid)
      wrapFocusable = usable.length === 0
    }
    sync()
    const mo = new MutationObserver(sync)
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['disabled', 'tabindex'] })
    return () => mo.disconnect()
  })

  function onkeydown(e: KeyboardEvent) {
    if (e.key === 'Escape' && !dismissed) dismissed = true
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions -->
<span
  class="chb-wrap"
  role="group"
  class:dismissed
  bind:this={wrapEl}
  tabindex={wrapFocusable ? 0 : undefined}
  aria-describedby={wrapFocusable ? uid : undefined}
  {onkeydown}
  onpointerleave={() => { dismissed = false }}
  onfocusout={() => { dismissed = false }}
>
  {@render children()}
  <span id={uid} role="tooltip" class="chb-bubble" class:top={placement === 'top'}>{text}</span>
</span>

<style>
  .chb-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .chb-bubble {
    position: absolute;
    left: 0;
    z-index: 30;
    width: max-content;
    max-width: 280px;
    padding: 8px 12px;
    border-radius: var(--cms-radius-sm);
    background: var(--cs-dark);
    color: var(--cs-white);
    font: var(--text-pc-script-12);
    font-weight: 500;
    line-height: 1.5;
    white-space: normal;
    pointer-events: none;
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.12s ease, visibility 0.12s;
    top: calc(100% + 8px);
  }
  .chb-bubble.top {
    top: auto;
    bottom: calc(100% + 8px);
  }
  /* 말풍선 꼬리 */
  .chb-bubble::before {
    content: '';
    position: absolute;
    left: 16px;
    top: -5px;
    width: 10px;
    height: 10px;
    background: var(--cs-dark);
    transform: rotate(45deg);
  }
  .chb-bubble.top::before {
    top: auto;
    bottom: -5px;
  }
  .chb-wrap:hover .chb-bubble,
  .chb-wrap:focus-within .chb-bubble {
    opacity: 1;
    visibility: visible;
  }
  /* Esc로 닫은 상태 — hover·focus보다 우선 */
  .chb-wrap.dismissed .chb-bubble {
    opacity: 0;
    visibility: hidden;
  }
  .chb-wrap:focus-visible { outline: none; }
</style>
