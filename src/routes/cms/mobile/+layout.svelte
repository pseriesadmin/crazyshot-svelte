<script lang="ts">
  import { supabase } from '$lib/services/supabase'
  import { goto } from '$app/navigation'
  import { Toaster } from 'svelte-sonner'

  interface Props {
    children: import('svelte').Snippet
  }

  let { children }: Props = $props()

  async function logout(): Promise<void> {
    await supabase.auth.signOut()
    goto('/cms/login')
  }
</script>

<Toaster position="bottom-center" />

<div class="mobile-shell">
  <!-- GNB — CMS pill 스타일 (모바일 축소 적용) -->
  <div class="mob-topbar-wrap">
    <header class="mob-gnb">
      <a href="/cms/mobile" class="mob-gnb-brand" aria-label="CRAZYSHOT 현장앱 홈">
        <img src="/logo-bi2.svg" alt="CRAZYSHOT" class="mob-gnb-logo-img" width="100" height="62" />
      </a>
      <button type="button" class="mob-gnb-logout" onclick={logout}>
        Sign Out
      </button>
    </header>
  </div>
  <div class="mob-content">
    {@render children()}
  </div>
</div>

<style>
.mobile-shell {
    height: 100dvh;
    background: var(--cs-lilac);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  /* GNB — CMS pill 스타일 (모바일 축소 적용) */
  .mob-topbar-wrap {
    flex-shrink: 0;
    padding: 14px 14px 0;
    background: var(--cs-lilac);
  }

  .mob-gnb {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 20px;
    height: 62px;
    background: var(--cs-dark);
    border-radius: var(--radius-xl);
  }

  .mob-gnb-brand {
    display: block;
    line-height: 0;
    text-decoration: none;
    flex-shrink: 0;
  }

  .mob-gnb-logo-img {
    display: block;
    width: 100px;
    height: auto;
  }

  .mob-gnb-logout {
    background: var(--cs-red-badge);
    border: none;
    border-radius: var(--radius-lg);
    color: var(--cs-white);
    font: var(--text-pc-menu-en-20);
    width: 100px;
    height: 44px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .mob-gnb-logout:hover { opacity: 0.85; }

  .mob-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }
</style>
