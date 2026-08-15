<svelte:head>
  <title>구독 신청 취소 — CrazyShot</title>
</svelte:head>

<div class="result-wrap">
  <div class="result-card">
    <div class="result-icon">✕</div>
    <h1 class="result-title">카드 등록이 취소됐어요</h1>
    <p class="result-desc">구독을 원하시면 다시 시도해주세요.</p>
    <a href="/members" class="result-cta">멤버십 홈으로</a>
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
    font-size: 28px; color: var(--cs-white); margin-bottom: 8px; background: var(--cs-text-light);
  }
  .result-title { font-family: var(--font-kr); font-size: 22px; font-weight: 900; color: var(--cs-text); margin: 0; }
  .result-desc { font-size: 14px; color: var(--cs-text-mid); line-height: 1.6; margin: 0; }
  .result-cta {
    width: 100%; padding: 14px; border-radius: var(--radius-xl); background: var(--cs-purple); color: var(--cs-white);
    font-size: 15px; font-weight: 700; text-decoration: none; margin-top: 12px; transition: opacity 0.15s;
  }
  .result-cta:hover { opacity: 0.85; }
</style>
