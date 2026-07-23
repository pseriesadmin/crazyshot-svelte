<svelte:head>
  <title>서명 완료 — 크레이지샷</title>
</svelte:head>

<div class="page">
  <header class="header">
    <span class="logo">CRAZY<span class="orange">SHOT</span></span>
  </header>
  <main class="main">
    <div class="card">
      <span class="icon">🎉</span>
      <h1 class="title">계약서 서명이 완료되었습니다!</h1>
      <p class="desc">
        전자 대여 계약서에 서명해 주셔서 감사합니다.<br />
        대여 준비가 완료되면 채팅으로 안내드리겠습니다.
      </p>
      <a href="/" class="btn-home">홈으로 돌아가기</a>
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
  .title {
    font-size: 18px;
    font-weight: 700;
    color: var(--cs-dark, #100B32);
    margin: 0;
    line-height: 1.4;
  }
  .desc  { font-size: 14px; color: #666; line-height: 1.6; margin: 0; }
  .btn-home {
    display: inline-block;
    margin-top: 8px;
    padding: 0 32px;
    height: 50px;
    line-height: 50px;
    background: var(--cs-red-badge, #FF3535);
    color: #fff;
    border-radius: 30px;
    font-size: 15px;
    font-weight: 700;
    text-decoration: none;
    transition: background 0.15s;
  }
  .btn-home:hover { background: var(--cs-red, #CF0000); }
</style>
