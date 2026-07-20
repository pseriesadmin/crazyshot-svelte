<script lang="ts">
  interface UserInfo {
    displayName: string
    avatarUrl: string | null
    membershipGrade: string | null
    level: string
  }

  interface Props {
    currentUser: UserInfo | null
    isLoggedIn: boolean
    visible?: boolean
    /** 뷰 페이지에서만 사용: 현재 포스트 ID */
    postId?: string | null
    /** 뷰 페이지에서만 사용: 본인 글 여부 */
    isOwner?: boolean
    /** 삭제 버튼 비활성화 (처리 중) */
    deleteBusy?: boolean
    /** 삭제 버튼 클릭 콜백 */
    onDelete?: () => void
  }

  let {
    currentUser,
    isLoggedIn,
    visible = true,
    postId = null,
    isOwner = false,
    deleteBusy = false,
    onDelete,
  }: Props = $props()
</script>

<div
  class="write-card"
  class:write-card-hidden={!visible}
  aria-label="내 로그 작성"
  role="complementary"
>
  {#if isLoggedIn && currentUser}
    <div class="wc-user">
      <div class="wc-avatar">
        {#if currentUser.avatarUrl}
          <img src={currentUser.avatarUrl} alt={currentUser.displayName} class="wc-avatar-img" />
        {:else}
          {currentUser.displayName[0] ?? '?'}
        {/if}
      </div>
      <div class="wc-info">
        <span class="wc-name">{currentUser.displayName}</span>
        {#if currentUser.membershipGrade && currentUser.membershipGrade !== 'NONE'}
          <span class="wc-badge wc-badge-c" aria-label="{currentUser.membershipGrade} 멤버십">
            {currentUser.membershipGrade[0]}
          </span>
        {/if}
        <span class="wc-level">{currentUser.level}</span>
      </div>
    </div>
    <div class="wc-actions">
      <a href="/crazylog/new" class="wc-write-btn" aria-label="로그 작성하기">쓰기</a>
      {#if isOwner && postId}
        <a href="/crazylog/{postId}" class="wc-edit-btn" aria-label="이 로그 수정">수정</a>
        <button
          class="wc-delete-btn"
          disabled={deleteBusy}
          onclick={onDelete}
          aria-label="이 로그 삭제"
        >삭제</button>
      {/if}
    </div>
  {:else}
    <div class="wc-user">
      <div class="wc-avatar wc-avatar-guest">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="12" cy="8" r="4" stroke="currentColor" stroke-width="1.8"/>
          <path d="M4 20c0-4 3.582-7 8-7s8 3 8 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </div>
      <div class="wc-info">
        <span class="wc-name wc-guest-msg">로그인해 로그 작성해주세요.</span>
      </div>
    </div>
  {/if}
</div>

<style>
  .write-card {
    position: fixed;
    bottom: 24px;
    left: 24px;
    right: 24px;
    width: auto;
    transform: translateY(0);
    z-index: 100;
    display: flex;
    align-items: center;
    gap: 16px;
    background: var(--cs-white);
    border-radius: var(--radius-lg);
    padding: 12px 16px 12px 20px;
    box-shadow: 0 4px 24px rgba(16, 11, 50, 0.14);
    min-height: 64px;
    transition: transform 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                opacity  0.35s cubic-bezier(0.4, 0, 0.2, 1);
    opacity: 1;
    pointer-events: auto;
  }

  .write-card-hidden {
    transform: translateY(calc(100% + 32px));
    opacity: 0;
    pointer-events: none;
  }

  @media (min-width: 640px) {
    .write-card {
      left: 50%;
      right: auto;
      width: auto;
      min-width: 460px;
      max-width: 700px;
      transform: translateX(-50%) translateY(0);
      white-space: nowrap;
    }
    .write-card-hidden {
      transform: translateX(-50%) translateY(calc(100% + 32px));
    }
  }

  .wc-user { display: flex; align-items: center; gap: 12px; flex: 1; min-width: 0; }
  .wc-avatar {
    width: 38px; height: 38px; border-radius: 50%;
    background: linear-gradient(135deg, var(--cs-purple) 0%, var(--cs-red-badge) 100%);
    display: flex; align-items: center; justify-content: center;
    font-size: 15px; font-weight: 900; color: var(--cs-white); flex-shrink: 0; overflow: hidden;
  }
  .wc-avatar-img { width: 100%; height: 100%; object-fit: cover; border-radius: 50%; }
  .wc-avatar-guest { background: var(--cs-surface-gray); color: var(--cs-text-light); }
  .wc-info { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; min-width: 0; }
  .wc-name { font: var(--text-pc-body-14); color: var(--cs-text); letter-spacing: -0.5px; display: none; }
  @media (min-width: 768px) { .wc-name { display: inline; } }
  .wc-guest-msg { color: var(--cs-text-mid); font: var(--text-pc-script-12); letter-spacing: -0.3px; }
  .wc-badge {
    display: inline-flex; align-items: center; justify-content: center;
    width: 20px; height: 20px; border-radius: 6px;
    font-size: 11px; font-weight: 900; color: var(--cs-white);
    flex-shrink: 0; letter-spacing: 0; line-height: 1;
  }
  .wc-badge-e { background: var(--cs-text-mid); }
  .wc-badge-p { background: var(--cs-purple); }
  .wc-badge-c { background: var(--cs-orange); }
  .wc-level {
    font-size: 11px; font-weight: 500; color: var(--cs-purple-light);
    background: var(--cs-purple-op10); padding: 2px 8px; border-radius: var(--radius-full);
  }
  .wc-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .wc-write-btn {
    display: inline-flex; align-items: center; padding: 0 20px; min-height: 44px;
    background: var(--cs-purple-dark); color: var(--cs-white);
    border-radius: var(--radius-xl); font: var(--text-pc-body-14); font-weight: 700;
    letter-spacing: -0.3px; text-decoration: none; flex-shrink: 0; transition: background 0.15s;
  }
  .wc-write-btn:hover { background: var(--cs-purple); }
  .wc-edit-btn {
    display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px;
    background: var(--cs-surface-gray); color: var(--cs-text);
    border-radius: var(--radius-xl); font: var(--text-pc-body-14); font-weight: 700;
    letter-spacing: -0.3px; text-decoration: none; flex-shrink: 0; transition: background 0.15s;
  }
  .wc-edit-btn:hover { background: var(--cs-border); }
  .wc-delete-btn {
    display: inline-flex; align-items: center; min-height: 44px; padding: 0 16px;
    background: var(--cs-red-xlight); color: var(--cs-red-badge); border: none;
    border-radius: var(--radius-xl); font: var(--text-pc-body-14); font-weight: 700;
    letter-spacing: -0.3px; cursor: pointer; flex-shrink: 0; transition: background 0.15s;
  }
  .wc-delete-btn:hover:not(:disabled) { background: var(--cs-red-light); }
  .wc-delete-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
