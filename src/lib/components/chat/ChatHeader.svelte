<script lang="ts">
  // PRD.1.7 — ChatHeader: 채팅 창 상단 사용자 정보 헤더
  // Figma node: 2497:8692 (user-info)
  import { supabase } from '$lib/services/supabase'
  import DeleteIconButton from '$lib/components/common/DeleteIconButton.svelte'
  import { createDeleteSafetyToast } from '$lib/utils/deleteSafetyToast.svelte'

  interface Props {
    userId?: string
    userName: string
    userHandle: string
    guestMode?: 'prompt' | 'info'
    onGuestInfo?: () => void
    onclose?: () => void
    /** 내 대화목록 삭제(2단계 확인 후 호출) — 있으면 닫기(✕) 대신 삭제 아이콘 버튼 표시 */
    onclear?: () => Promise<void>
  }

  let { userId = '', userName = 'CS', userHandle = '', guestMode = 'prompt', onGuestInfo, onclose, onclear }: Props = $props()

  // 삭제 아이콘 2단계 확인(front-uiux.md §25) — 1차: 경고 토스트+무장, 2차: 실제 삭제
  const deleteSafety = createDeleteSafetyToast({
    successMessage: '채팅 대화목록이 삭제됐습니다.',
    errorMessage: '채팅 대화목록 삭제에 실패했습니다.',
  })

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

  // 등록된 프로필 이미지(user_profiles.avatar_url) — GNB 아바타와 같은 방식으로 불러와 표시, 없거나 로드 실패 시 이니셜로 폴백(2026-10-09, Stephen 지시)
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  let avatarUrl = $state<string | null>(null)
  $effect(() => {
    const id = userId
    if (!isLoggedIn || !id || !UUID_RE.test(id)) { avatarUrl = null; return }
    let cancelled = false
    supabase
      .from('user_profiles')
      .select('avatar_url')
      .eq('id', id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) avatarUrl = (data as { avatar_url: string | null } | null)?.avatar_url ?? null
      })
    return () => { cancelled = true }
  })

  // 내정보로 이동할 때 채팅 모달을 같이 닫는다(2026-10-09, Stephen 지시 "링크 랜딩이 이상해") — 안 닫으면 내정보 화면 위에 채팅 모달이 그대로 떠 있고
  // 페이지 스크롤도 잠긴 채 남는다(/account는 자체 채팅 시트를 같은 열림 상태에 연결해 둠). 링크 이동 자체는 막지 않는다.
  function closeOnNavigate() {
    onclose?.()
  }

  // 핸들이 이름과 같거나 이메일 형태면 같은 정보를 두 번 보여주는 것 — 모바일에서는 숨긴다(2026-10-09, Stephen 지시).
  // 핸들은 이메일 앞부분(아이디)이 기본값이라 이름이 없는 계정은 이름과 핸들이 똑같이 나온다. 게스트 식별용('#xxxxxxxx')은 그대로 보여준다.
  let duplicateHandle = $derived(
    !!userHandle &&
      (userHandle.trim().toLowerCase() === displayName.trim().toLowerCase() || userHandle.includes('@'))
  )
</script>

<div class="chat-header">
  {#snippet avatarInner()}
    {#if avatarUrl}
      <img class="avatar-img" src={avatarUrl} alt="" decoding="async" onerror={() => (avatarUrl = null)} />
    {:else}
      <span class="avatar-initials">{initials}</span>
    {/if}
  {/snippet}

  {#if isLoggedIn}
    <!-- 로그인 사용자: 아바타를 누르면 내정보 페이지로 이동(이름 영역 링크와 같은 목적지) -->
    <a class="avatar avatar-link" href="/account" aria-label="내 정보 보기" onclick={closeOnNavigate}>
      {@render avatarInner()}
    </a>
  {:else}
    <div class="avatar" aria-label="{userName} 아바타">
      {@render avatarInner()}
    </div>
  {/if}

  <!-- 모바일: 아바타는 배경 밖(좌측), 이름·핸들·닫기만 배경 카드(우측). PC: display: contents로 기존 한 덩어리 배치 그대로 -->
  <div class="info-bg">
  {#if isLoggedIn}
    <!-- 로그인 사용자: 내정보 페이지 링크 -->
    <a class="user-info user-info-link" href="/account" aria-label="내 정보 보기" onclick={closeOnNavigate}>
      <p class="user-name">{displayName}</p>
      <p class="user-handle" class:dup={duplicateHandle}>{userHandle}</p>
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
      <p class="user-handle" class:dup={duplicateHandle}>{userHandle}</p>
    </div>
  {/if}

  {#if onclear && isLoggedIn}
    <DeleteIconButton
      ariaLabel="채팅 대화목록 삭제"
      confirming={deleteSafety.pendingKey === 'chat'}
      disabled={deleteSafety.busyKey === 'chat'}
      onclick={() => deleteSafety.handleAction('chat', async () => { await onclear(); return true })}
    />
  {:else if onclose}
    <button class="close-btn" onclick={onclose} aria-label="채팅 닫기">✕</button>
  {/if}
  </div>
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

  /* PC·기본: 래퍼는 레이아웃에 참여하지 않는다(기존 배치 그대로) */
  .info-bg {
    display: contents;
  }

  /* 모바일(<640px) — 2026-10-09(Stephen 지시): 아바타를 배경 카드에서 분리해 좌측에 두고, 배경 카드는 이름·닫기만 담아
     가로·세로를 줄여 우측에 붙인다. 이름과 같은 핸들(이메일 아이디 중복)은 숨김 */
  @media (max-width: 639px) {
    .chat-header {
      background: transparent;
      border-radius: 0;
      padding: 0;
      justify-content: space-between;
      gap: 12px;
    }
    .info-bg {
      display: flex;
      align-items: center;
      gap: 8px;
      align-self: stretch; /* 세로폭을 아바타(65px)와 같게 — 아바타가 헤더 높이를 정하므로 카드가 그 높이까지 늘어난다(2026-10-09 Stephen 지시) */
      min-height: 65px;
      flex: 1 1 0; /* 아바타 바로 옆(간격 12px)까지 좌측으로 확장 — 우측 끝은 그대로(2026-10-09 Stephen 지시: 159px → 240px → 아바타 근접) */
      min-width: 0;
      background: var(--cs-points);
      border-radius: var(--radius-xl);
      padding: 8px 8px 8px 20px;
    }
    .user-info {
      flex: 1 1 auto; /* 넓어진 카드 안에서 이름은 좌측, ✕는 우측 끝에 고정 */
      min-width: 0;
    }
    /* 이름 글자 토큰 한 단계 작게(2026-10-09 Stephen 지시): 18px → --text-m-body-16B(16px). 굵기는 기존 900 유지 */
    .info-bg .user-name { /* 아래쪽 기본 .user-name 규칙(18px)보다 우선하도록 선택자를 한 단계 구체화 */
      font: var(--text-m-body-16B);
      font-weight: 900;
    }
    .user-name,
    .user-handle {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .user-handle.dup {
      display: none;
    }
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
    overflow: hidden;
  }

  /* 로그인 사용자 아바타 링크 — 이름 영역 링크(.user-info-link)와 같은 호버 반응 */
  .avatar-link {
    text-decoration: none;
    transition: opacity 0.15s;
  }
  .avatar-link:hover {
    opacity: 0.75;
  }

  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
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
