<script lang="ts">
  // 고객 본인확인·체크인용 QR 바텀시트 — ChatBottomSheet.svelte 구조(백드롭/dialog/ESC/
  // 슬라이드업)를 그대로 재사용. QR 렌더링은 CustomerDetailPanel·ProductDetailPanel의
  // renderQR() 패턴과 동일(qrcode 패키지 동적 import, 신규 의존성 없음).
  // 페이로드는 상품 QR(원문 그대로)과 겹치지 않도록 `/qr/member/{member_code}` 경로형 고정
  // — CMS 스캐너의 extractProductId()가 이 형식을 이미 안전하게 거부함(qrProductId.ts 참고).

  interface Props {
    open: boolean
    memberCode: string | null
    userName: string
    onclose: () => void
  }

  let { open, memberCode, userName, onclose }: Props = $props()

  let canvasEl = $state<HTMLCanvasElement | null>(null)
  let dialogEl = $state<HTMLDivElement | null>(null)

  $effect(() => {
    if (open && dialogEl) dialogEl.focus()
  })

  $effect(() => {
    const canvas = canvasEl
    if (!open || !canvas || !memberCode) return
    renderQR(canvas, `/qr/member/${memberCode}`)
  })

  async function renderQR(canvas: HTMLCanvasElement, payload: string) {
    try {
      const QRCode = (await import('qrcode')).default
      await QRCode.toCanvas(canvas, payload, {
        width: 220,
        margin: 1,
        color: { dark: '#100B32', light: '#FFFFFF' },
      })
    } catch { /* 미설치 시 무시 */ }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onclose()
  }

  function handleBackdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onclose()
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={handleBackdropClick} aria-hidden="true"></div>

  <div
    class="bottom-sheet"
    role="dialog"
    aria-modal="true"
    aria-label="회원 확인 QR"
    bind:this={dialogEl}
    tabindex="-1"
    onkeydown={handleKeydown}
  >
    <div class="drag-handle" aria-hidden="true"></div>

    <div class="sheet-body">
      <p class="sheet-title">회원 확인 QR</p>
      <p class="sheet-desc">직원에게 이 QR코드를 보여주세요</p>

      {#if memberCode}
        <div class="qr-box">
          <canvas bind:this={canvasEl} width="220" height="220" aria-label="회원 확인 QR 코드"></canvas>
        </div>
        <p class="member-name">{userName}</p>
        <code class="member-code">{memberCode}</code>
      {:else}
        <p class="qr-empty">회원코드가 아직 발급되지 않았습니다.</p>
      {/if}

      <button class="close-btn" type="button" onclick={onclose}>닫기</button>
    </div>
  </div>
{/if}

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 11, 50, 0);
    z-index: 200;
    animation: fade-in 0.2s ease forwards;
  }
  @keyframes fade-in {
    from { background: rgba(16, 11, 50, 0); }
    to   { background: rgba(16, 11, 50, 0.45); }
  }

  .bottom-sheet {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 201;
    background: var(--cs-white, #ffffff);
    border-radius: var(--radius-2xl) var(--radius-2xl) 0 0;
    display: flex;
    flex-direction: column;
    outline: none;
    animation: slide-up 0.3s cubic-bezier(0.32, 0.72, 0, 1);
    max-width: 480px;
    margin: 0 auto;
    padding-bottom: env(safe-area-inset-bottom, 0);
  }
  @keyframes slide-up {
    from { transform: translateY(100%); }
    to   { transform: translateY(0); }
  }

  .drag-handle {
    width: 40px;
    height: 4px;
    background: rgba(59, 47, 138, 0.25);
    border-radius: 2px;
    margin: 12px auto 0;
    flex-shrink: 0;
  }

  .sheet-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 24px 24px 32px;
  }

  .sheet-title { font: var(--text-m-title-18B); color: var(--cs-text); margin: 0; }
  .sheet-desc { font: var(--text-m-script-14B); color: var(--cs-text-mid); margin: 0 0 8px; }

  .qr-box {
    padding: 16px;
    background: var(--cs-white, #ffffff);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-lg);
  }
  .qr-box canvas { display: block; }

  .member-name { font: var(--text-m-body-16B); color: var(--cs-text); margin: 4px 0 0; }
  .member-code { font: var(--text-m-script-14B); color: var(--cs-text-mid); letter-spacing: 0.02em; }

  .qr-empty {
    padding: 40px 0;
    font: var(--text-m-body-16B);
    color: var(--cs-text-mid);
  }

  .close-btn {
    margin-top: 12px;
    width: 100%;
    min-height: 44px;
    padding: 12px;
    border: none;
    border-radius: var(--radius-md);
    background: var(--cs-lilac);
    color: var(--cs-text);
    font: var(--text-m-body-16B);
    cursor: pointer;
  }
  .close-btn:hover { opacity: 0.85; }

  /* PC: 우하단 팝업 (ChatBottomSheet와 동일 브레이크포인트) */
  @media (min-width: 640px) {
    .bottom-sheet {
      bottom: 24px;
      right: 24px;
      left: auto;
      margin: 0;
      width: 340px;
      max-width: 340px;
      border-radius: var(--radius-xl);
    }
    .drag-handle { display: none; }
  }
</style>
