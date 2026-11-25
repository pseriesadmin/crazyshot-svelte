<script lang="ts">
  // MobileDatePickerModal — 모바일 현장앱 날짜 선택 모달 (2026-11-25)
  // 표준 달력(CalendarGrid)을 하단 시트 모달에 담았다. 날짜를 누르면 바로 선택·닫힘, 바깥을 누르거나 ✕(close-red)로 닫는다.
  import CalendarGrid from '$lib/components/common/CalendarGrid.svelte'

  interface Props {
    open: boolean
    value: string
    onselect: (iso: string) => void
    onclose: () => void
    /** 주면 달력 아래에 이 문구의 글자 버튼을 보이고, 누르면 호출(예: 날짜 선택 해제) */
    onreset?: () => void
    resetLabel?: string
  }
  let { open, value, onselect, onclose, onreset, resetLabel = '선택 해제' }: Props = $props()

  function onKeydown(e: KeyboardEvent): void {
    if (open && e.key === 'Escape') onclose()
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if open}
  <div class="dp-backdrop" role="presentation" onclick={onclose}>
    <div class="dp-sheet" role="dialog" aria-modal="true" aria-label="날짜 선택" tabindex="-1" onclick={(e) => e.stopPropagation()} onkeydown={() => {}}>
      <button class="close-btn" type="button" aria-label="닫기" onclick={onclose}>✕</button>
      <CalendarGrid {value} {onselect} pastSelectable swipeMonths />
      {#if onreset}<button class="reset-btn" type="button" onclick={onreset}>{resetLabel}</button>{/if}
    </div>
  </div>
{/if}

<style>
  .dp-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    background: rgba(16, 11, 50, 0.45);
    animation: dp-fade 0.2s ease both;
  }
  .dp-sheet {
    position: relative;
    width: 100%;
    max-width: 480px;
    padding: 44px 16px 24px;
    border-radius: var(--cms-radius-lg) var(--cms-radius-lg) 0 0;
    background: var(--cs-white);
    max-height: 88dvh;
    overflow-y: auto;
    animation: dp-up 0.5s cubic-bezier(0.25, 0.1, 0.25, 1) both;
  }
  @keyframes dp-fade { from { opacity: 0; } to { opacity: 1; } }
  /* 아래에서 올라와 감쇠하며 한 번 튕긴다 */
  @keyframes dp-up {
    0%   { transform: translateY(100%); }
    55%  { transform: translateY(-14px); }
    72%  { transform: translateY(6px); }
    86%  { transform: translateY(-2px); }
    100% { transform: translateY(0); }
  }
  /* 공통 닫기 버튼 close-red (cms-uiux §0-10-A-1) */
  .close-btn {
    position: absolute;
    top: 10px;
    right: 14px;
    width: 28px; height: 28px; min-height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .close-btn:hover { background: rgba(255, 53, 53, 0.08); color: var(--cs-red-badge); }
  .reset-btn {
    display: block;
    width: 100%;
    margin-top: 12px;
    min-height: 44px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font: var(--text-m-body-16B);
    cursor: pointer;
  }
  .reset-btn:active { background: var(--cs-lilac); }
  @media (prefers-reduced-motion: reduce) {
    .dp-backdrop, .dp-sheet { animation: none; }
  }
</style>
