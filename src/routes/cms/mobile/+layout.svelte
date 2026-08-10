<script lang="ts">
  import { supabase } from '$lib/services/supabase'
  import { goto } from '$app/navigation'
  import { Toaster } from 'svelte-sonner'
  import { unregisterCurrentPushToken } from '$lib/utils/push'
  import type { LayoutData } from './$types'

  interface Props {
    data: LayoutData
    children: import('svelte').Snippet
  }

  let { data, children }: Props = $props()

  let showProfileModal = $state(false)

  const userInitial = $derived((data.session?.user?.email?.[0] ?? '?').toUpperCase())

  function roleLabel(role: string | null | undefined): string {
    if (role === 'superadmin') return '슈퍼관리자'
    if (role === 'manager') return '매니저'
    if (role === 'partner') return '파트너'
    return role ?? '-'
  }

  function formatDateTime(iso: string | null | undefined): string {
    if (!iso) return '-'
    const d = new Date(iso)
    if (Number.isNaN(d.getTime())) return '-'
    return d.toLocaleString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    })
  }

  async function logout(): Promise<void> {
    await unregisterCurrentPushToken()
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
        <img src="/logo-bi2.svg" alt="CRAZYSHOT" class="mob-gnb-logo-img" width="117" height="72" />
      </a>
      <button
        type="button"
        class="mob-gnb-avatar"
        onclick={() => (showProfileModal = true)}
        aria-label="내 정보"
        title="내 정보"
      >{userInitial}</button>
    </header>
  </div>
  <div class="mob-content">
    {@render children()}
  </div>
</div>

{#if showProfileModal}
  <div class="profile-backdrop" onclick={() => (showProfileModal = false)} role="presentation">
    <div
      class="profile-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="내 정보"
      onclick={(e) => e.stopPropagation()}
    >
      <button type="button" class="profile-modal-close" onclick={() => (showProfileModal = false)} aria-label="닫기">✕</button>

      <div class="profile-avatar-lg" aria-hidden="true">{userInitial}</div>

      <p class="profile-email">{data.session?.user?.email ?? '-'}</p>
      <span class="role-tag role-{data.cmsRole}">{roleLabel(data.cmsRole)}</span>

      <div class="profile-info-row">
        <span class="profile-info-label">접속일자</span>
        <span class="profile-info-value">{formatDateTime(data.session?.user?.last_sign_in_at)}</span>
      </div>

      <div class="profile-actions">
        <button type="button" class="profile-logout-btn" onclick={logout}>Sign Out</button>
      </div>
    </div>
  </div>
{/if}

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
    height: 61px;
    background: #1d183e;
    border-radius: 22px;
    overflow: visible;
  }

  .mob-gnb-brand {
    display: block;
    line-height: 0;
    text-decoration: none;
    flex-shrink: 0;
  }

  .mob-gnb-logo-img {
    display: block;
    width: 117px;
    height: 72px;
    transform: translateY(-3px);
  }

  /* 아바타 이니셜 배지 — ui-mobile.md GNB 모바일 레이아웃 원칙 확정값 적용 */
  .mob-gnb-avatar {
    width: 40px;
    height: 40px;
    min-width: 40px;
    min-height: 40px;
    border-radius: 50%;
    background: rgba(85, 63, 224, 0.60);
    color: #ffffff;
    border: none;
    font-family: var(--font-en-display);
    font-size: 18px;
    font-weight: 700;
    text-transform: uppercase;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    transition: filter 0.15s, opacity 0.15s;
  }
  .mob-gnb-avatar:hover { filter: brightness(0.92); }

  .mob-content {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
  }

  /* 내 정보 모달 — cms-uiux.md §7-9 확인 모달 패턴 기반, 모바일 반응형 적용 */
  .profile-backdrop {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(16,11,50,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }

  .profile-dialog {
    position: relative;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 32px 28px 28px;
    width: 100%;
    max-width: 340px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }

  /* close-basic(기본닫기버튼) — ProductDetailPanel.svelte .clone-modal-close 표준 재사용 */
  .profile-modal-close {
    position: absolute;
    top: 14px;
    right: 14px;
    width: 32px;
    height: 32px;
    border: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .profile-modal-close:hover { background: rgba(255,53,53,0.1); color: var(--cs-red-badge); }

  .profile-avatar-lg {
    width: 64px;
    height: 64px;
    border-radius: var(--radius-full);
    background: var(--cs-purple-pale);
    color: var(--cs-dark);
    font-family: var(--font-en-display);
    font-size: 26px;
    font-weight: 700;
    text-transform: uppercase;
    display: flex;
    align-items: center;
    justify-content: center;
    margin-bottom: 14px;
  }

  .profile-email {
    font: var(--text-m-body-16B);
    color: var(--cs-text);
    margin: 0 0 8px;
    word-break: break-all;
  }

  .role-tag {
    display: inline-block;
    font: var(--text-pc-script-12);
    font-weight: 700;
    padding: 4px 12px;
    border-radius: var(--radius-full);
    margin-bottom: 20px;
  }
  .role-tag.role-superadmin { background: rgba(59,47,138,0.12); color: var(--cs-purple); }
  .role-tag.role-manager    { background: rgba(16,11,50,0.07);  color: var(--cs-text-dark); }
  .role-tag.role-partner    { background: rgba(255,69,0,0.08);  color: var(--cs-orange); }

  .profile-info-row {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    margin-bottom: 24px;
  }
  .profile-info-label { font: var(--text-m-script-12); color: var(--cs-text-mid); }
  .profile-info-value { font: var(--text-m-script-14B); color: var(--cs-text); }

  .profile-actions {
    width: 100%;
    display: flex;
    gap: 10px;
  }

  .profile-logout-btn {
    flex: 1;
    height: 44px;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-lg);
    font-weight: 700;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .profile-logout-btn:hover { opacity: 0.85; }
</style>
