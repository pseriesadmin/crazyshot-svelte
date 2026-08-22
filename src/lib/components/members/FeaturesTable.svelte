<script lang="ts">
  import type { SubscriptionPlanRow } from '$lib/types/subscription'
  import { isAuthenticated } from '$lib/stores/auth'
  import { csToast } from '$lib/utils/toast'
  import { goto } from '$app/navigation'

  interface Props {
    plans: SubscriptionPlanRow[]
    selectedPlanId: number | null
    onselect: (id: number) => void
  }

  let { plans, selectedPlanId, onselect }: Props = $props()

  // 모든 플랜의 스펙 라벨 합집합(첫 등장 순서 유지) — 플랜별 값은 없으면 '—'
  const rows = $derived.by(() => {
    const labels: string[] = []
    for (const plan of plans) {
      for (const f of plan.features) {
        if (!labels.includes(f.label)) labels.push(f.label)
      }
    }
    return labels.map((label) => ({
      label,
      values: plans.map((plan) => plan.features.find((f) => f.label === label)?.value ?? '—'),
    }))
  })

  const activeIndex = $derived(Math.max(0, plans.findIndex((p) => p.id === selectedPlanId)))

  function handleSubscribe(planId: number) {
    if (!$isAuthenticated) {
      csToast.info('로그인 후 구독하기를 이용하실 수 있습니다.', {
        actionLabel: '확인',
        onClick: () => goto(`/login?returnTo=/subscribe/${planId}`),
      })
      return
    }
    goto(`/subscribe/${planId}`)
  }
</script>

<!-- ── PC 피처 테이블 (≥1024px) ──────────────────────────────── -->
<section class="table-pc" aria-label="멤버십 혜택 비교">
  <p class="table-section-label">Plans & features</p>

  <div class="items-kr-wrap" data-name="items-kr">
    <!-- 라벨 열 -->
    <div class="col-label">
      <div class="label-header">혜택 항목</div>
      {#each rows as row, i (row.label)}
        <div class="label-row" class:label-row-alt={i % 2 !== 0}>
          {row.label}
        </div>
      {/each}
    </div>

    <!-- 플랜 열 -->
    {#each plans as plan, colIdx (plan.id)}
      <button
        type="button"
        class="col-plan"
        class:col-pop={plan.is_popular}
        class:col-selected={selectedPlanId === plan.id}
        onclick={() => onselect(plan.id)}
      >
        <div class="plan-header-cell" class:pop-header={plan.is_popular} data-name="title-bar">
          <span class="ph-name">{plan.name}</span>
          {#if plan.is_popular}<span class="popular-pill">인기</span>{/if}
          <span class="ph-price">{plan.monthly_price.toLocaleString()}<small>원/월</small></span>
        </div>
        {#each rows as row, i (row.label)}
          <div class="plan-row" class:pop-row={plan.is_popular} class:plan-row-alt={i % 2 !== 0}>
            {row.values[colIdx]}
          </div>
        {/each}
      </button>
    {/each}
  </div>
</section>

<!-- ── Mobile 피처 탭 (<1024px) ──────────────────────────────── -->
<section class="table-mobile" aria-label="멤버십 혜택 비교">
  <!-- 탭 바 -->
  <div class="tab-bar" role="tablist">
    {#each plans as plan, i (plan.id)}
      <button
        class="tab-btn"
        class:tab-active={activeIndex === i}
        role="tab"
        aria-selected={activeIndex === i}
        onclick={() => onselect(plan.id)}
      >
        {plan.name}
        {#if plan.is_popular && activeIndex === i}
          <span class="tab-popular-active">인기</span>
        {:else if plan.is_popular}
          <span class="tab-popular">인기</span>
        {/if}
      </button>
    {/each}
  </div>

  <!-- 슬라이딩 비교 영역 -->
  <div class="tab-body">
    <!-- 라벨 열 (고정) -->
    <div class="tab-labels">
      <div class="tab-header-spacer">혜택 항목</div>
      {#each rows as row, i (row.label)}
        <div class="tab-label-row" class:tab-label-alt={i % 2 !== 0}>
          {row.label}
        </div>
      {/each}
    </div>

    <!-- 슬라이딩 데이터 열 -->
    <div class="tab-data-wrap">
      {#each plans as plan, colIdx (plan.id)}
        <div
          class="tab-col"
          style="
            opacity: {activeIndex === colIdx ? 1 : 0};
            transform: translateX({(colIdx - activeIndex) * 18}px);
            pointer-events: {activeIndex === colIdx ? 'auto' : 'none'};
          "
          aria-hidden={activeIndex !== colIdx}
        >
          <!-- 헤더 -->
          <div class="tab-col-header" class:pop-bg={plan.is_popular}>
            <span class="tch-name">{plan.name}</span>
            {#if plan.is_popular}<span class="tch-popular">인기</span>{/if}
          </div>
          <!-- 행 -->
          {#each rows as row, ri (row.label)}
            <div class="tab-data-row" class:pop-bg-alt={plan.is_popular && ri % 2 !== 0}>
              {row.values[colIdx]}
            </div>
          {/each}
        </div>
      {/each}
    </div>
  </div>

  <!-- 구독하기 버튼 -->
  {#if plans[activeIndex]}
    <button type="button" class="tab-cta" onclick={() => handleSubscribe(plans[activeIndex].id)}>구독하기</button>
  {/if}
</section>

<style>
  /* ── PC ── */
  .table-pc {
    display: none;
  }
  @media (min-width: 1024px) {
    .table-pc {
      display: flex;
      flex-direction: column;
      gap: 20px;
      width: 1240px;
    }
  }

  .table-section-label {
    font-family: var(--font-en-display);
    font-size: 20px;
    font-weight: 400;
    color: var(--cs-dark);
    margin: 0 0 10px;
  }

  .items-kr-wrap {
    display: flex;
    gap: 0;
  }

  /* PC hover 인터랙션 */
  :global([data-name="items-kr"]) > *:not(.col-label) {
    transition: transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1),
                opacity 0.3s ease,
                box-shadow 0.3s ease;
    cursor: pointer;
    border-radius: 30px;
    overflow: hidden;
  }

  :global([data-name="items-kr"]):has(> .col-plan:hover) > .col-plan:not(:hover) {
    opacity: 0.4;
  }

  .col-plan:hover,
  .col-plan.col-selected {
    opacity: 1 !important;
    transform: translateY(-8px) scale(1.03);
    box-shadow: 0 24px 48px rgba(16, 11, 50, 0.22),
                0 6px 16px rgba(255, 53, 53, 0.14);
  }

  .col-plan:hover :global([data-name="title-bar"]),
  .col-plan.col-selected :global([data-name="title-bar"]) {
    transition: letter-spacing 0.25s ease;
    letter-spacing: 0.02em;
  }

  /* 라벨 열 */
  .col-label {
    display: flex;
    flex-direction: column;
    width: 200px;
    flex-shrink: 0;
    border-radius: 30px 0 0 30px;
    overflow: hidden;
  }

  .label-header {
    height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-dark);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
  }

  .label-row {
    height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    text-align: center;
    background: var(--cs-purple-op10);
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-purple);
    white-space: pre-line;
  }

  .label-row-alt {
    background: var(--cs-purple-pale);
  }

  /* 플랜 열 공통 */
  .col-plan {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow: hidden;
    border: none;
    padding: 0;
    background: transparent;
    text-align: left;
  }

  .plan-header-cell {
    height: 100px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 0 16px;
    position: relative;
    background: transparent;
  }

  .ph-name {
    font-family: var(--font-en-display);
    font-size: 20px;
    font-weight: 400;
    color: var(--cs-dark);
  }

  .ph-price {
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    color: var(--cs-dark);
  }

  .ph-price small {
    font-size: 12px;
    font-weight: 400;
    margin-left: 2px;
  }

  .popular-pill {
    background: var(--cs-red);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 11px;
    font-weight: 700;
    border-radius: 20px;
    padding: 2px 8px;
  }

  .plan-row {
    height: 100px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 16px;
    text-align: center;
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-dark);
    white-space: pre-line;
    background: var(--cs-white);
  }
  .plan-row-alt { background: transparent; }

  /* Pop 슬롯(2번째) 강조 */
  .col-pop { border-radius: 30px 30px 0 0; }
  .pop-header {
    background: var(--cs-red-light);
    border-radius: 30px 30px 0 0;
  }
  .pop-row     { background: var(--cs-chat-in-bg); }
  .col-pop .plan-row-alt { background: var(--cs-red-light); }

  /* ── Mobile ── */
  .table-mobile {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 0 20px 40px;
    width: 100%;
  }
  @media (min-width: 1024px) {
    .table-mobile { display: none; }
  }

  /* 탭 바 */
  .tab-bar {
    display: flex;
    background: var(--cs-dark);
    border-radius: 20px;
    padding: 4px;
    gap: 2px;
  }

  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 11px 4px 10px;
    border: none;
    border-radius: 16px;
    background: transparent;
    color: var(--cs-purple-pale);
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.28s, color 0.28s, box-shadow 0.28s;
    white-space: nowrap;
  }

  .tab-btn.tab-active {
    background: var(--cs-red-badge);
    color: var(--cs-white);
    font-weight: 900;
    box-shadow: 0 4px 14px rgba(255, 53, 53, 0.45);
  }

  .tab-popular {
    background: var(--cs-red);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    border-radius: 6px;
    padding: 1px 5px;
  }

  .tab-popular-active {
    background: rgba(255, 255, 255, 0.22);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    border-radius: 6px;
    padding: 1px 5px;
  }

  /* 탭 바디 */
  .tab-body {
    display: flex;
    overflow: hidden;
    border-radius: 20px;
  }

  /* 라벨 열 (고정) */
  .tab-labels {
    display: flex;
    flex-direction: column;
    width: 90px;
    flex-shrink: 0;
  }

  .tab-header-spacer {
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-dark);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 11px;
    font-weight: 700;
    text-align: center;
    padding: 0 8px;
  }

  .tab-label-row {
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 8px;
    text-align: center;
    background: #EAE8F5;
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 700;
    color: #6B5FAA;
    white-space: pre-line;
  }

  .tab-label-alt { background: #F3F2FA; }

  /* 슬라이딩 데이터 */
  .tab-data-wrap {
    position: relative;
    flex: 1;
    overflow: hidden;
  }

  .tab-col {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    transition: opacity 0.35s ease,
                transform 0.35s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  }

  .tab-col-header {
    height: 80px;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex-shrink: 0;
    background: var(--cs-purple-op10);
  }
  .tab-col-header.pop-bg { background: var(--cs-red-light); }

  .tch-name {
    font-family: var(--font-kr);
    font-size: 14px;
    font-weight: 700;
    color: var(--cs-dark);
  }

  .tch-popular {
    background: var(--cs-red);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    border-radius: 6px;
    padding: 1px 6px;
  }

  .tab-data-row {
    height: 80px;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 0 12px;
    text-align: center;
    font-family: var(--font-kr);
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-dark);
    white-space: pre-line;
    flex-shrink: 0;
    background: var(--cs-white);
  }
  .tab-data-row.pop-bg-alt { background: var(--cs-red-light); }

  /* 구독하기 */
  .tab-cta {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 100%;
    border: none;
    border-radius: var(--radius-xl);
    background: var(--cs-purple-dark);
    color: var(--cs-white);
    font-family: var(--font-kr);
    font-size: 16px;
    font-weight: 700;
    padding: 13px 0;
    cursor: pointer;
    transition: background 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
                transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1),
                box-shadow 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  }
  .tab-cta:hover {
    background: var(--cs-purple);
    transform: scale(1.03);
    box-shadow: 0 6px 20px rgba(59, 47, 138, 0.45);
  }
  .tab-cta:active {
    background: var(--cs-dark);
    transform: scale(0.96);
  }
</style>
