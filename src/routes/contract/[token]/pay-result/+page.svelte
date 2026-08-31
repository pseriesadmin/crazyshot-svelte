<!-- 결제 처리 중 화면 — load()가 항상 /contract/complete 또는 /contract/[token]?payStatus=fail로
     리다이렉트하므로 실제로 이 컴포넌트가 렌더링되는 경우는 없다. SvelteKit 라우트 정의 요건으로
     존재하는 파일. -->
<svelte:head>
  <title>결제 처리 중 — 크레이지샷</title>
</svelte:head>

<div class="processing-wrap">
  <p class="processing-msg">결제를 처리하고 있습니다...</p>
</div>

<style>
  .processing-wrap {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 100dvh;
    background: var(--cs-lilac);
  }
  .processing-msg {
    font-size: 16px;
    color: var(--cs-text);
  }
</style>
