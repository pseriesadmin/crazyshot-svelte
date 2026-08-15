<script lang="ts">
  import type { PageData } from './$types'

  interface Props { data: PageData }
  let { data }: Props = $props()
</script>

<svelte:head>
  <title>구독 신청 결과 — CrazyShot</title>
</svelte:head>

<div class="result-wrap">
  <div class="result-card">
    {#if data.success}
      <div class="result-icon success">✓</div>
      <h1 class="result-title">구독이 시작됐어요!</h1>
      {#if 'planName' in data && data.planName}
        <p class="result-desc">{data.planName} 구독이 정상적으로 등록됐습니다.</p>
      {/if}
      {#if 'chargeWarning' in data && data.chargeWarning}
        <p class="result-warning">{data.chargeWarning}</p>
      {/if}
      <a href="/members" class="result-cta">멤버십 홈으로</a>
    {:else}
      <div class="result-icon error">✕</div>
      <h1 class="result-title">구독 신청에 실패했어요</h1>
      <p class="result-desc">{data.error}</p>
      <a href="/members" class="result-cta">다시 시도하기</a>
    {/if}
  </div>
</div>

<style>
  .result-wrap {
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--cs-lilac); padding: 40px 20px;
  }
  .result-card {
    width: 100%; max-width: 420px; background: var(--cs-white); border-radius: var(--radius-2xl, 50px);
    padding: 48px 32px; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;
  }
  .result-icon {
    width: 56px; height: 56px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    font-size: 28px; color: var(--cs-white); margin-bottom: 8px;
  }
  .result-icon.success { background: var(--cs-purple); }
  .result-icon.error { background: var(--cs-red-badge); }
  .result-title { font-family: var(--font-kr); font-size: 22px; font-weight: 900; color: var(--cs-text); margin: 0; }
  .result-desc { font-size: 14px; color: var(--cs-text-mid); line-height: 1.6; margin: 0; }
  .result-warning { font-size: 13px; color: var(--cs-red-badge); background: rgba(255,53,53,0.08); padding: 10px 14px; border-radius: var(--radius-sm); margin: 4px 0 0; }
  .result-cta {
    width: 100%; padding: 14px; border-radius: var(--radius-xl); background: var(--cs-purple); color: var(--cs-white);
    font-size: 15px; font-weight: 700; text-decoration: none; margin-top: 12px; transition: opacity 0.15s;
  }
  .result-cta:hover { opacity: 0.85; }
</style>
