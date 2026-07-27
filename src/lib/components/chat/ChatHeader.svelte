<script lang="ts">
  // PRD.1.7 — ChatHeader: 채팅 창 상단 사용자 정보 헤더
  // Figma node: 2497:8692 (user-info)

  interface Props {
    userId?: string
    userName: string
    userHandle: string
    guestMode?: 'prompt' | 'info'
    onGuestInfo?: () => void
    onclose?: () => void
  }

  let { userId = '', userName = 'CS', userHandle = '', guestMode = 'prompt', onGuestInfo, onclose }: Props = $props()

  // 실 로그인 판별: userName이 '게스트'가 아닌 경우만 로그인 상태
  // (익명 auth UUID가 userId로 들어와도 userName='게스트'면 비로그인으로 처리)
  let isLoggedIn = $derived(!!userName && userName !== '게스트')

  // 이니셜 2자 추출
  let initials = $derived(
    !userName || userName === '게스트'
      ? 'G'
      : userName
          .trim()
          .split(/\s+/)
          .map((w) => w[0])
          .join('')
          .toUpperCase()
          .slice(0, 2) || 'G'
  )

  let displayName = $derived(userName || '게스트')
</script>

<div class="chat-header">
  <div class="avatar" aria-label="{userName} 아바타">
    <span class="avatar-initials">{initials}</span>
  </div>

  {#if isLoggedIn}
    <!-- 로그인 사용자: 내정보 페이지 링크 -->
    <a class="user-info user-info-link" href="/account" aria-label="내 정보 보기">
      <p class="user-name">{displayName}</p>
      <p class="user-handle">{userHandle}</p>
    </a>
  {:else if guestMode === 'prompt'}
    <!-- 비로그인: 로그인 / 비회원 선택 프롬프트 -->
    <div class="user-info guest-prompt">
      <button
        class="btn-login"
        onclick={() => window.location.href = '/auth/login'}
      >로그인</button>
      <button
        class="btn-guest"
        onclick={onGuestInfo}
      >비회원</button>
    </div>
  {:else}
    <!-- 비회원 선택 후: 기존 게스트 정보 표시 (링크 없음) -->
    <div class="user-info">
      <p class="user-name">{displayName}</p>
      <p class="user-handle">{userHandle}</p>
    </div>
  {/if}

  {#if onclose}
    <button class="close-btn" onclick={onclose} aria-label="채팅 닫기">✕</button>
  {/if}
</div>

<style>
  /* Figma node 2497:8692 */
  .chat-header {
    background: var(--cs-points);
    border-radius: var(--radius-xl);
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 14px 20px;
    flex-shrink: 0;
    width: 100%;
  }

  /* 65px 원형 아바타 */
  .avatar {
    width: 65px;
    height: 65px;
    border-radius: 50%;
    background: var(--cs-purple);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .avatar-initials {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 600;
    font-size: 21px;
    color: var(--cs-white);
    letter-spacing: -0.2px;
  }

  .user-info {
    display: flex;
    flex-direction: column;
    gap: 3px;
    flex: 1;
  }

  /* 로그인 사용자 링크 */
  .user-info-link {
    text-decoration: none;
    border-radius: var(--radius-sm);
    transition: opacity 0.15s;
  }
  .user-info-link:hover {
    opacity: 0.75;
  }

  /* 게스트 프롬프트: 로그인 / 비회원 버튼 행 */
  .guest-prompt {
    flex-direction: row;
    align-items: center;
    gap: 8px;
  }

  /* 로그인 버튼 — filled (cs-purple) */
  .btn-login {
    height: 36px;
    padding: 0 18px;
    border-radius: var(--radius-xl);
    background: var(--cs-purple);
    color: #fff;
    border: none;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: opacity 0.15s;
  }
  .btn-login:hover { opacity: 0.85; }
  .btn-login:active { opacity: 0.7; }

  /* 비회원 버튼 — outlined */
  .btn-guest {
    height: 36px;
    padding: 0 18px;
    border-radius: var(--radius-xl);
    background: transparent;
    color: var(--cs-purple);
    border: 1.5px solid var(--cs-purple);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .btn-guest:hover { background: rgba(59, 47, 138, 0.07); }
  .btn-guest:active { background: rgba(59, 47, 138, 0.14); }

  /* Noto Sans KR Black 21px — Figma 22px 대비 1pt 축소 */
  .user-name {
    font: var(--text-pc-title-18, 900 18px 'Noto Sans KR', sans-serif);
    font-size: 18px;
    font-weight: 900;
    color: var(--cs-dark);
    margin: 0;
  }

  /* Noto Sans KR Bold 15px — Figma 16px 대비 1pt 축소 */
  .user-handle {
    font: var(--text-m-script-14, 700 14px 'Noto Sans KR', sans-serif);
    font-size: 14px;
    color: var(--cs-text-mid, #777777);
    letter-spacing: -0.5px;
    margin: 0;
  }

  .close-btn {
    background: none;
    border: none;
    color: var(--cs-text-mid, #777777);
    font-size: 18px;
    cursor: pointer;
    padding: 8px;
    min-width: 44px;
    min-height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .close-btn:hover {
    background: var(--cs-lilac);
  }
</style>
