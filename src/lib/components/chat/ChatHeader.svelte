<script lang="ts">
  // PRD.1.7 — ChatHeader: 채팅 창 상단 사용자 정보 헤더
  // Figma node: 2497:8692 (user-info)

  interface Props {
    userName: string
    userHandle: string
    onclose?: () => void
  }

  let { userName = 'CS', userHandle = '', onclose }: Props = $props()

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
  <div class="user-info">
    <p class="user-name">{displayName}</p>
    <p class="user-handle">{userHandle}</p>
  </div>
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
