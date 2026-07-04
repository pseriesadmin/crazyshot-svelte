<script lang="ts">
  import { goto } from '$app/navigation'
  import type { PageData } from './$types'

  let { data }: { data: PageData } = $props()

  function handleConfirm() {
    goto('/')
  }
</script>

<svelte:head>
  <title>결제중지 — 크레이지샷</title>
</svelte:head>

<div class="page-root">

  <!-- GNB pill -->
  <div class="gnb-wrap">
    <div class="gnb-pill">
      <button class="gnb-back" onclick={() => goto('/')} aria-label="홈으로">
        <svg width="15" height="10" viewBox="0 0 15 10" fill="none" aria-hidden="true">
          <path d="M14 5H1M1 5L5.5 1M1 5L5.5 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="gnb-title">결제중지</span>
      <div class="gnb-ham" aria-hidden="true">
        <span></span><span></span><span></span>
      </div>
    </div>
  </div>

  <!-- 타이틀 영역 -->
  <div class="title-bar">
    <div class="icon-box icon-box--fail" aria-hidden="true">
      <svg width="6" height="22" viewBox="0 0 6 22" fill="none">
        <rect x="0" y="0" width="6" height="14" rx="3" fill="white"/>
        <rect x="0" y="17" width="6" height="5" rx="2.5" fill="white"/>
      </svg>
    </div>
    <p class="title-text">결제진행 중지</p>
  </div>

  <!-- 안내 카드 -->
  <div class="body">
    <div class="fail-card">

      <!-- 메시지 섹션 -->
      <div class="fail-message">
        <p class="fail-desc">{data.message}</p>
        {#if data.code && data.code !== 'UNKNOWN' && data.code !== 'PAY_PROCESS_CANCELED'}
          <p class="fail-code">오류코드: {data.code}</p>
        {/if}
      </div>

      <!-- 안내사항 섹션 -->
      <div class="fail-guide">
        <p class="guide-item">결제 정보를 다시 확인한 후 시도해주세요.</p>
        <p class="guide-item">문제가 지속되면 고객 채팅으로 문의해주세요.</p>
      </div>

    </div>

    <!-- 확인 버튼 -->
    <button class="confirm-btn" onclick={handleConfirm}>
      <svg width="15" height="10" viewBox="0 0 15 10" fill="none" aria-hidden="true">
        <path d="M14 5H1M1 5L5.5 1M1 5L5.5 9" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
      <span>확인</span>
      <svg width="15" height="10" viewBox="0 0 15 10" fill="none" aria-hidden="true">
        <path d="M1 5H14M14 5L9.5 1M14 5L9.5 9" stroke="white" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>
  </div>

</div>

<style>
  .page-root {
    display: flex;
    flex-direction: column;
    align-items: center;
    min-height: 100vh;
    background: var(--cs-lilac);
  }

  /* GNB */
  .gnb-wrap {
    width: 100%;
    padding: 40px 25px 0;
  }
  .gnb-pill {
    display: flex;
    align-items: center;
    justify-content: space-between;
    max-width: 1240px;
    min-width: 340px;
    margin: 0 auto;
    background: var(--cs-purple-op10);
    border-radius: var(--radius-lg);
    padding: 5px 20px;
    min-height: 60px;
  }
  .gnb-back {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    border: none;
    background: transparent;
    color: var(--cs-text);
    cursor: pointer;
  }
  .gnb-title {
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    letter-spacing: -0.5px;
  }
  .gnb-ham {
    display: flex;
    flex-direction: column;
    gap: 4px;
    width: 20px;
    padding: 8px 0;
  }
  .gnb-ham span {
    display: block;
    height: 2px;
    background: var(--cs-orange);
    border-radius: 2px;
  }
  .gnb-ham span:nth-child(1) { width: 100%; }
  .gnb-ham span:nth-child(2) { width: 70%; }
  .gnb-ham span:nth-child(3) { width: 100%; }

  /* 타이틀 */
  .title-bar {
    display: flex;
    flex-direction: column;
    gap: 20px;
    align-items: flex-start;
    justify-content: center;
    width: 100%;
    max-width: 1240px;
    min-width: 340px;
    padding: 50px 40px;
  }
  .icon-box {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 70px;
    height: 70px;
    border-radius: var(--radius-icon-box);
    flex-shrink: 0;
  }
  .icon-box--fail {
    background: var(--cs-red);
  }
  .title-text {
    font: var(--text-m-htitle-24L);
    color: var(--cs-purple-dark);
    letter-spacing: -0.5px;
    margin: 0;
  }

  /* body */
  .body {
    display: flex;
    flex-direction: column;
    gap: 50px;
    align-items: flex-start;
    width: 100%;
    padding: 0 25px;
  }

  /* 안내 카드 — 비대칭 radius: TL-10 TR-50 BR-10 BL-50 */
  .fail-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    width: 100%;
    border-radius: var(--radius-asym-card);
    overflow: hidden;
  }

  /* 메시지 섹션 */
  .fail-message {
    display: flex;
    flex-direction: column;
    gap: 8px;
    background: var(--cs-surface-gray);
    padding: 25px 30px;
    width: 100%;
  }
  .fail-desc {
    font: var(--text-m-body-16B);
    color: var(--cs-text-dark);
    letter-spacing: -0.3px;
    line-height: 1.5;
    margin: 0;
  }
  .fail-code {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    letter-spacing: -0.3px;
    margin: 0;
  }

  /* 안내 섹션 */
  .fail-guide {
    display: flex;
    flex-direction: column;
    gap: 5px;
    background: var(--cs-surface-gray);
    padding: 25px 30px;
    width: 100%;
  }
  .guide-item {
    font: var(--text-m-script-14);
    color: var(--cs-text-mid);
    letter-spacing: -0.3px;
    line-height: 1.8;
    margin: 0;
  }

  /* 확인 버튼 */
  .confirm-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 15px;
    width: 100%;
    max-width: 340px;
    padding: 15px 20px;
    background: var(--cs-text-dark);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-m-body-16B);
    letter-spacing: -0.5px;
    cursor: pointer;
    min-height: 44px;
    transition: opacity 0.15s;
  }
  .confirm-btn:hover { opacity: 0.85; }
</style>
