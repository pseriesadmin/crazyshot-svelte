<script lang="ts">
  // iOS Safari 전용 "홈 화면에 추가" 안내 배너 — iOS 16.4+ Safari는 standalone(홈 화면 설치)
  // 웹앱에서만 Web Push를 허용하는 플랫폼 제약이 있어(service-operations.md §15), 안드로이드의
  // 네이티브 설치 유도(beforeinstallprompt)가 없는 iOS에서 이를 대신 안내한다.
  import { browser } from '$app/environment'
  import { shouldShowIosAddToHomeScreenBanner, dismissIosAddToHomeScreenBanner } from '$lib/utils/iosPwa'

  let visible = $state(false)

  $effect(() => {
    if (!browser) return
    // 배너가 첫 화면부터 뜨면 방해가 커서 약간의 딜레이 후 노출
    const timer = window.setTimeout(() => {
      visible = shouldShowIosAddToHomeScreenBanner()
    }, 2000)
    return () => window.clearTimeout(timer)
  })

  function handleDismiss() {
    dismissIosAddToHomeScreenBanner()
    visible = false
  }
</script>

{#if visible}
  <div class="a2hs-banner" role="dialog" aria-label="홈 화면에 추가 안내">
    <button type="button" class="a2hs-close" onclick={handleDismiss} aria-label="닫기">✕</button>
    <div class="a2hs-row">
      <img src="/app-icons/icon-192.png" alt="크레이지샷" class="a2hs-icon" width="44" height="44" />
      <div class="a2hs-text">
        <p class="a2hs-title">홈 화면에 추가하세요</p>
        <p class="a2hs-desc">예약·대여 알림을 놓치지 않으려면 홈 화면에 추가해 주세요.</p>
      </div>
    </div>
    <div class="a2hs-steps">
      <span class="a2hs-step">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <path d="M12 3v12M12 3l-4 4M12 3l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M5 12v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        공유 아이콘
      </span>
      <span class="a2hs-arrow">→</span>
      <span class="a2hs-step-label">"홈 화면에 추가" 선택</span>
    </div>
  </div>
{/if}

<style>
  .a2hs-banner {
    position: fixed;
    left: var(--spacing-3);
    right: var(--spacing-3);
    bottom: calc(78px + env(safe-area-inset-bottom, 0px));
    z-index: 60;
    max-width: 420px;
    margin: 0 auto;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    box-shadow: 0 4px 20px rgba(16, 11, 50, 0.18);
    padding: var(--spacing-4);
    animation: a2hs-slide-up 0.3s ease-out;
  }

  @keyframes a2hs-slide-up {
    from { transform: translateY(16px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  .a2hs-close {
    position: absolute;
    top: var(--spacing-2);
    right: var(--spacing-2);
    width: 28px;
    height: 28px;
    min-width: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-full);
    color: var(--cs-text-light);
    font-size: 14px;
    cursor: pointer;
  }
  .a2hs-close:hover { background: var(--cs-lilac); color: var(--cs-text-dark); }

  .a2hs-row {
    display: flex;
    align-items: center;
    gap: var(--spacing-3);
    padding-right: var(--spacing-6);
  }

  .a2hs-icon {
    width: 44px;
    height: 44px;
    border-radius: var(--radius-md);
    flex-shrink: 0;
  }

  .a2hs-text { display: flex; flex-direction: column; gap: 2px; }

  .a2hs-title {
    font: var(--text-m-title-18B);
    color: var(--cs-text);
    margin: 0;
  }

  .a2hs-desc {
    font: var(--text-m-script-14);
    color: var(--cs-text-mid);
    margin: 0;
  }

  .a2hs-steps {
    display: flex;
    align-items: center;
    gap: var(--spacing-2);
    margin-top: var(--spacing-3);
    padding: var(--spacing-2) var(--spacing-3);
    background: var(--cs-lilac);
    border-radius: var(--radius-md);
    color: var(--cs-purple);
    font: var(--text-m-script-14B);
  }

  .a2hs-step {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .a2hs-arrow { color: var(--cs-text-light); flex-shrink: 0; }

  .a2hs-step-label { color: var(--cs-text); }
</style>
