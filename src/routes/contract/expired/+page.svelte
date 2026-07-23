<svelte:head>
  <title>만료된 계약서 링크 — 크레이지샷</title>
</svelte:head>

<div class="page">
  <header class="header">
    <span class="logo">CRAZY<span class="orange">SHOT</span></span>
  </header>
  <main class="main">
    <div class="card">
      <span class="icon">⏰</span>
      <h1 class="title">서명 링크가 만료되었습니다.</h1>
      <p class="desc">
        계약서 서명 링크의 유효기간이 지났습니다.<br />
        업체 채팅으로 재발송을 요청해 주세요.
      </p>
    </div>
  </main>
</div>

<style>
  :global(body) { background: var(--cs-lilac, #ECEBF4); margin: 0; }
  .page { min-height: 100dvh; display: flex; flex-direction: column; }
  .header {
    background: var(--cs-dark, #100B32);
    padding: 16px 20px;
  }
  .logo { font-size: 20px; font-weight: 900; color: #fff; letter-spacing: 1px; }
  .orange { color: var(--cs-orange, #FF4500); }
  .main {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px 20px;
  }
  .card {
    background: #fff;
    border-radius: 20px;
    padding: 48px 32px;
    text-align: center;
    max-width: 400px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }
  .icon  { font-size: 48px; }
  .title { font-size: 18px; font-weight: 700; color: var(--cs-dark, #100B32); margin: 0; }
  .desc  { font-size: 14px; color: #666; line-height: 1.6; margin: 0; }
</style>
