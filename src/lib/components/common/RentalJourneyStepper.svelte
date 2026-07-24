<script lang="ts">
  interface Props {
    status: string
    steps?: string[]  // 표시할 status 값 목록 — 미지정 시 전체 6단계
  }

  let { status, steps }: Props = $props()

  const ALL_STEPS = [
    { status: 'hold',             label: '신청' },
    { status: 'confirmed',        label: '승인완료' },
    { status: 'shipped',          label: '반출중' },
    { status: 'in_use',           label: '대여중' },
    { status: 'return_requested', label: '반납중' },
    { status: 'returned',         label: '반납완료' },
  ]

  let visibleSteps = $derived(
    steps ? ALL_STEPS.filter(s => steps!.includes(s.status)) : ALL_STEPS
  )

  let currentStepIndex = $derived(
    status === 'completed'
      ? visibleSteps.length - 1
      : visibleSteps.findIndex(s => s.status === status)
  )

  let isCancelled = $derived(status === 'cancelled' || status === 'damage_claimed')
</script>

<div class="journey-stepper" role="list" aria-label="대여 여정">
  {#if isCancelled}
    <div class="journey-cancelled">
      <span class="cancelled-icon">✕</span>
      <span class="cancelled-label">
        {status === 'damage_claimed' ? '파손신고' : '취소됨'}
      </span>
    </div>
  {:else}
    {#each visibleSteps as step, i}
      <div
        class="step-item"
        role="listitem"
        class:done={i < currentStepIndex}
        class:active={i === currentStepIndex}
      >
        <div class="step-dot"></div>
        <span class="step-label">{step.label}</span>
      </div>
      {#if i < visibleSteps.length - 1}
        <div class="step-connector" class:done={i < currentStepIndex}></div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  /* Mobile base (-20%) */
  .journey-stepper {
    display: flex;
    align-items: center;
    padding: 20px 13px;
    background: var(--cs-surface-gray);
    border-radius: 30px;
    flex-wrap: nowrap;
    overflow-x: auto;
  }
  .step-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .step-dot {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--cs-lilac);
    border: 2px solid var(--cs-text-light);
    transition: background 0.15s, border-color 0.15s;
  }
  .step-item.done .step-dot {
    background: var(--cs-purple);
    border-color: var(--cs-purple);
  }
  .step-item.active .step-dot {
    background: var(--cs-white);
    border-color: var(--cs-purple);
    box-shadow: 0 0 0 5px rgba(59,47,138,0.2);
    width: 19px;
    height: 19px;
  }
  .step-label {
    font-family: var(--font-kr);
    font-size: var(--text-m-script-14B);
    color: var(--cs-text-light);
    white-space: nowrap;
  }
  .step-item.done .step-label  { color: var(--cs-purple); font-weight: 700; }
  .step-item.active .step-label { color: var(--cs-purple-dark); font-weight: 700; }
  .step-connector {
    flex: 1;
    height: 3px;
    background: var(--cs-lilac);
    min-width: 16px;
    margin-bottom: 22px;
    transition: background 0.15s;
  }
  .step-connector.done { background: var(--cs-purple); }

  /* 취소 상태 */
  .journey-cancelled {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .cancelled-icon {
    width: 18px; height: 18px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 50%;
    background: var(--cs-error, #ef4444);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    flex-shrink: 0;
  }
  .cancelled-label {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-error, #ef4444);
  }

  /* PC 반응형 (-20%) */
  @media (min-width: 768px) {
    .journey-stepper { padding: 20px 16px; }
    .step-item { gap: 8px; }
    .step-dot { width: 19px; height: 19px; border-width: 2px; }
    .step-item.active .step-dot { width: 22px; height: 22px; box-shadow: 0 0 0 6px rgba(59,47,138,0.2); }
    .step-label { font-size: var(--text-pc-body-14); }
    .step-connector { height: 3px; min-width: 19px; margin-bottom: 27px; }
  }
</style>
