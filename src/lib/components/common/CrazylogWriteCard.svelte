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
    /** 뷰 페이지에서만 사용: 수정 가능 여부(작성자 본인 또는 모든 관리자) */
    canEdit?: boolean
    /** 뷰 페이지에서만 사용: 삭제 가능 여부(작성자 · 관리자 글은 모든 관리자 · 사용자 글은 매니저 이상) */
    canDelete?: boolean
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
    canEdit = false,
    canDelete = false,
    deleteBusy = false,
    onDelete,
  }: Props = $props()

  // 프로필 사진 로드 실패(파일 삭제·일시 장애) 시 이니셜로 되돌린다 — 실패한 URL만 기억해 URL이 바뀌면 다시 시도
  let failedAvatarUrl = $state<string | null>(null)
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
        {#if currentUser.avatarUrl && failedAvatarUrl !== currentUser.avatarUrl}
          <img src={currentUser.avatarUrl} alt={currentUser.displayName} class="wc-avatar-img" onerror={() => (failedAvatarUrl = currentUser?.avatarUrl ?? null)} />
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
      <a href="/crazylog/new" class="wc-write-btn" aria-label="로그 작성하기"><svg class="wc-ico" viewBox="0 0 25 27" fill="none" aria-hidden="true"><path fill-rule="evenodd" clip-rule="evenodd" d="M17.5 2.5L22.5 7.5L8.5 21.5H3.5V16.5L17.5 2.5ZM17.5 5.33L19.67 7.5L7.5 19.67V18.5H6.33L17.5 5.33ZM3.5 23.5H21.5V25.5H3.5V23.5Z" fill="currentColor"/></svg><span class="wc-label">쓰기</span></a>
      {#if canEdit && postId}
        <a href="/crazylog/{postId}" class="wc-edit-btn" aria-label="이 로그 수정"><svg class="wc-ico" viewBox="0 0 25 27" fill="none" aria-hidden="true">
          <g transform="rotate(-45 12.5 11.5)">
            <rect x="2.5" y="6" width="20" height="11" rx="3" stroke="currentColor" stroke-width="2"/>
            <path d="M6 7H11.5V16H6C4.62 16 3.5 14.88 3.5 13.5V9.5C3.5 8.12 4.62 7 6 7Z" fill="currentColor"/>
          </g>
          <path d="M3.5 23.5H21.5V25.5H3.5V23.5Z" fill="currentColor"/>
        </svg><span class="wc-label">수정</span></a>
      {/if}
      {#if canDelete && postId}
        <button
          class="wc-delete-btn"
          disabled={deleteBusy}
          onclick={onDelete}
          aria-label="이 로그 삭제"
        ><svg class="wc-ico" viewBox="0 0 24 27" fill="none" aria-hidden="true"><path d="M18.375 6.50034H5.125V18.8499C5.125 19.9904 5.12613 20.772 5.1748 21.3773C5.22236 21.9685 5.30953 22.2822 5.42188 22.5062C5.68224 23.0251 6.09559 23.4436 6.59961 23.7044C6.81343 23.8151 7.1148 23.9026 7.69238 23.9505C8.28522 23.9997 9.05146 24.0003 10.1748 24.0003H13.3252C14.4485 24.0003 15.2148 23.9997 15.8076 23.9505C16.3852 23.9026 16.6866 23.8151 16.9004 23.7044C17.4044 23.4436 17.8178 23.0251 18.0781 22.5062C18.1905 22.2822 18.2776 21.9685 18.3252 21.3773C18.3739 20.772 18.375 19.9904 18.375 18.8499V6.50034ZM7.875 19.9173V10.5833C7.87518 9.89314 8.43475 9.33335 9.125 9.33335C9.81525 9.33335 10.3748 9.89314 10.375 10.5833V19.9173C10.3748 20.6075 9.81525 21.1673 9.125 21.1673C8.43475 21.1673 7.87518 20.6075 7.875 19.9173ZM13.125 19.9173V10.5833C13.1252 9.89314 13.6848 9.33335 14.375 9.33335C15.0652 9.33335 15.6248 9.89314 15.625 10.5833V19.9173C15.6248 20.6075 15.0652 21.1673 14.375 21.1673C13.6848 21.1673 13.1252 20.6075 13.125 19.9173ZM10.8398 2.50034C9.64328 2.50034 9.39282 2.52181 9.20703 2.59604C8.9951 2.68079 8.8054 2.81929 8.65625 3.00034C8.54773 3.13217 8.46083 3.31881 8.22949 4.00034H15.2705C15.0392 3.31881 14.9523 3.13217 14.8438 3.00034C14.6946 2.8193 14.5049 2.68079 14.293 2.59604C14.1072 2.52181 13.8567 2.50034 12.6602 2.50034H10.8398ZM20.875 18.8499C20.875 19.9496 20.876 20.8488 20.8174 21.5775C20.7577 22.3201 20.6301 22.9948 20.3135 23.6263C19.8189 24.6125 19.0273 25.4181 18.0498 25.9242C17.4214 26.2494 16.7501 26.3807 16.0146 26.4417C15.2944 26.5015 14.4068 26.5003 13.3252 26.5003H10.1748C9.09324 26.5003 8.20559 26.5015 7.48535 26.4417C6.74993 26.3807 6.07862 26.2494 5.4502 25.9242C4.47266 25.4181 3.68114 24.6125 3.18652 23.6263C2.86987 22.9948 2.74234 22.3201 2.68262 21.5775C2.62403 20.8488 2.625 19.9496 2.625 18.8499V6.50034H1.25C0.559644 6.50034 0 5.9407 0 5.25034C0 4.55998 0.559644 4.00034 1.25 4.00034H5.59473L5.66797 3.77768C5.97894 2.82994 6.22078 2.02469 6.72559 1.41147C7.1401 0.907983 7.67466 0.51672 8.28027 0.274753C9.02067 -0.0209906 9.85939 0.00033895 10.8398 0.00033895H12.6602C13.6406 0.00033895 14.4793 -0.0209905 15.2197 0.274753C15.8253 0.516719 16.3599 0.907983 16.7744 1.41147C17.2792 2.0247 17.5211 2.82994 17.832 3.77768L17.9053 4.00034H22.25C22.9404 4.00034 23.5 4.55998 23.5 5.25034C23.5 5.9407 22.9404 6.50034 22.25 6.50034H20.875V18.8499Z" fill="currentColor"/></svg><span class="wc-label">삭제</span></button>
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
      min-width: 598px;   /* 460px × 1.3 */
      max-width: 910px;   /* 700px × 1.3 */
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
    min-width: 48.4px; box-sizing: border-box; text-align: center;  /* 가로폭 37.25px × 1.3 — 바형 배지 */
  }
  .wc-actions { display: flex; align-items: center; gap: 9.36px;  /* 6px × 1.2 × 1.3 */ flex-shrink: 0; }
  /* 모바일: 원형 아이콘 버튼(44px, 글자는 화면 읽기용으로만 남김) / PC(≥768px): 아이콘 + 글자 알약 버튼 */
  .wc-write-btn, .wc-edit-btn, .wc-delete-btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    position: relative; width: 38px; height: 38px; padding: 0; border: none; border-radius: 50%;  /* 높이 = 아바타(38px)와 동일 */
    font: var(--text-pc-body-14); font-weight: 700; letter-spacing: -0.3px;
    text-decoration: none; cursor: pointer; flex-shrink: 0; transition: background 0.15s, color 0.15s;
  }
  /* 시각 크기는 38px, 터치 영역은 44×44px 확보 */
  .wc-write-btn::before, .wc-edit-btn::before, .wc-delete-btn::before { content: ''; position: absolute; inset: -3px; }
  .wc-ico { width: 18px; height: 20px; display: block; flex-shrink: 0; }
  .wc-label { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
  @media (min-width: 768px) {
    .wc-write-btn, .wc-edit-btn, .wc-delete-btn { width: auto; padding: 0 18px 0 16px; border-radius: var(--radius-xl); }
    .wc-ico { width: 15px; height: 17px; }
    .wc-label { position: static; width: auto; height: auto; overflow: visible; clip-path: none; }
  }
  /* 면(fill) 색 + 같은 계열 짙은 아이콘 색. 호버·터치(:active)는 배경과 아이콘 색을 서로 맞바꾼다(반전) */
  .wc-write-btn { background: var(--cs-lilac); color: var(--cs-purple-dark); }
  .wc-write-btn:hover, .wc-write-btn:active { background: var(--cs-purple-dark); color: var(--cs-lilac); }
  .wc-edit-btn { background: var(--cs-surface-gray); color: var(--cs-text-dark); }
  .wc-edit-btn:hover, .wc-edit-btn:active { background: var(--cs-text-dark); color: var(--cs-surface-gray); }
  .wc-delete-btn { background: var(--cs-red-xlight); color: var(--cs-red-badge); }
  .wc-delete-btn:hover:not(:disabled), .wc-delete-btn:active:not(:disabled) { background: var(--cs-red-badge); color: var(--cs-red-xlight); }
  .wc-delete-btn:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
