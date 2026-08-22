<script lang="ts">
  interface Props {
    status: string
    steps?: string[]  // 표시할 status 값 목록 — 미지정 시 전체 6단계
  }

  let { status, steps }: Props = $props()

  const ALL_STEPS = [
    { status: 'hold',             label: '예약신청' },
    { status: 'confirmed',        label: '계약완료' },
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

  // 모바일 아코디언 등 늦게 렌더링/확장되는 컨테이너에 들어갈 때 overflow-x 스크롤 위치가
  // 0이 아닌 상태로 초기화되어 좌측이 잘려 보이는 문제 방지 — 항상 맨 왼쪽(신청 단계)부터 보이도록 고정
  let stepperEl = $state<HTMLDivElement | null>(null)
  $effect(() => {
    status
    if (stepperEl) stepperEl.scrollLeft = 0
  })
</script>

<div class="journey-stepper" role="list" aria-label="대여 여정" bind:this={stepperEl}>
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
        <div class="step-dot-wrap">
          <div class="step-dot"></div>
        </div>
        <span class="step-label">{step.label}</span>
      </div>
      {#if i < visibleSteps.length - 1}
        <div class="step-connector" class:done={i < currentStepIndex}>
          <svg class="step-connector-icon" viewBox="0 0 15 10" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
            <path d="M6 1.50201C6.00016 0.347444 7.25006 -0.374122 8.25 0.203186L13.5 3.23444C14.4999 3.81179 14.4999 5.25471 13.5 5.83209L8.25 8.86334C7.25003 9.44068 6.00007 8.71916 6 7.56451V6.69733L2.25 8.86334C1.25003 9.44068 7.20656e-05 8.71916 0 7.56451V1.50201C0.000159498 0.347444 1.25006 -0.374122 2.25 0.203186L6 2.36823V1.50201Z" fill="currentColor"/>
          </svg>
        </div>
      {/if}
    {/each}
  {/if}
</div>

<style>
  /* Mobile base (-20%) */
  .journey-stepper {
    display: flex;
    /* step-dot-wrap(35px 원형 박스)과 step-connector(같은 높이로 통일)를 같은 상단 기준선에
       놓아 정확히 수평 중앙이 맞도록 함 — align-items:center는 라벨 유무로 높이가 다른
       step-item과 step-connector를 잘못 정렬시킴(margin-bottom 보정 방식은 부정확) */
    align-items: flex-start;
    /* 일반 center 금지 — overflow-x:auto와 함께 쓰면 콘텐츠가 좌우로 균등하게 넘치면서
       브라우저 초기 스크롤 위치가 중앙으로 잡혀 양쪽 끝이 잘려 보이는 문제 발생.
       safe center: 다 들어갈 땐 중앙 정렬, 넘칠 땐 자동으로 flex-start처럼 동작(잘림 방지) */
    justify-content: safe center;
    padding: 22px 14px;
    background: var(--cs-surface-gray);
    border-radius: 30px;
    flex-wrap: nowrap;
    overflow-x: auto;
  }
  .step-item {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
  }
  .step-dot-wrap {
    display: grid;
    place-items: center;
    width: 35px;
    height: 35px;
    border-radius: 50%;
    background: var(--cs-surface-gray);
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
    flex: 0 0 auto;
    display: grid;
    place-items: center;
    width: 37px;
    height: 35px; /* step-dot-wrap과 동일 높이 — flex-start 기준선에서 자동으로 수평 중앙 정렬 */
    color: var(--cs-purple-pale);
    transition: color 0.15s;
  }
  .step-connector.done { color: var(--cs-purple); }
  .step-connector-icon {
    width: 18px;
    height: 12px;
    flex-shrink: 0;
  }

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
    .journey-stepper { padding: 22px 18px; }
    .step-item { gap: 9px; }
    .step-dot-wrap { width: 42px; height: 42px; }
    .step-dot { width: 19px; height: 19px; border-width: 2px; }
    .step-item.active .step-dot { box-shadow: 0 0 0 6px rgba(59,47,138,0.2); }
    .step-label { font-size: var(--text-pc-body-14); }
    .step-connector { width: 42px; height: 42px; }
  }
</style>
