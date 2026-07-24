<script lang="ts">
  import { goto } from '$app/navigation'
  import { page } from '$app/stores'
  import { performSignIn } from '$lib/stores/auth'
  import MobileMoreMenu from '$lib/components/common/MobileMoreMenu.svelte'
  import SignUpModal from '$lib/components/auth/SignUpModal.svelte'
  import type { PageData } from './$types'

  // ── 서버 데이터 (CMS → 프로모션 → 광고 배너) ──
  let { data }: { data: PageData } = $props()

  // ── 상태 ──
  let menuOpen = $state(false)
  let email = $state('')
  let password = $state('')
  let rememberMe = $state(false)
  let showPassword = $state(false)
  let isLoading = $state(false)
  let errorMsg = $state<string | null>(null)
  let showSignUpModal = $state(false)

  // 이메일+비밀번호 모두 입력 시 Sign In 모드, 아니면 Sign Up 모드
  let isSignInMode = $derived(email.trim().length > 0 && password.length > 0)

  async function handleSignIn() {
    if (!email || !password) {
      errorMsg = '이메일과 비밀번호를 입력해주세요.'
      return
    }
    isLoading = true
    errorMsg = null
    try {
      await performSignIn(email, password)
      const redirectTo = $page.url.searchParams.get('redirect') ?? '/'
      goto(redirectTo)
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '로그인에 실패했습니다.'
    } finally {
      isLoading = false
    }
  }

  function handleBack() {
    history.back()
  }

  function handleKeydown(e: globalThis.KeyboardEvent) {
    if (e.key === 'Enter') handleSignIn()
  }
</script>

<!-- ═══════════════════════════════════════════════
     PC (≥ 768px)
════════════════════════════════════════════════ -->
<div class="d-wrap">
  <!-- Body — 메인 레이아웃 GNB(fixed 100px) 아래부터 시작 -->
  <div class="d-body">
    <div class="d-container">
      <!-- 백 버튼 nav pill -->
      <button class="d-nav-pill" onclick={handleBack} aria-label="이전 페이지로">
        <span class="d-back-icon" aria-hidden="true">
          <svg width="21" height="17" viewBox="0 0 21.3844 17.1421" fill="none">
            <path d="M20.3844 8.5711H1M8.5 1L1 8.5711L8.5 16.1421"
              stroke="var(--cs-text)" stroke-width="3"
              stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </span>
        <span class="d-back-label">Back</span>
      </button>

      <!-- 메인 카드 -->
      <div class="d-card">
        <!-- 좌: Title 패널 -->
        <div class="d-title-panel">
          <div class="d-title-bg" aria-hidden="true">
            <img src="/auth/welcome-title-bg.png" alt="" class="d-title-bg-img"/>
          </div>
          <div class="d-title-content">
            <p class="d-welcome-en">Welcome</p>
            <p class="d-welcome-sub">let's start with us</p>
          </div>
        </div>

        <!-- 우: 폼 영역 -->
        <div class="d-form-panel">
          <p class="d-form-heading">Create your Account</p>

          <div class="d-inputs">
            <!-- 이메일 -->
            <div class="d-input-field">
              <span class="d-input-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" fill="#BBBEC7"/>
                  <path d="M12 14.5C6.99 14.5 2.91 17.86 2.91 22C2.91 22.28 3.13 22.5 3.41 22.5H20.59C20.87 22.5 21.09 22.28 21.09 22C21.09 17.86 17.01 14.5 12 14.5Z" fill="#BBBEC7"/>
                </svg>
              </span>
              <input
                class="d-input"
                type="email"
                placeholder="이메일을 입력하세요"
                bind:value={email}
                onkeydown={handleKeydown}
                autocomplete="email"
                aria-label="이메일"
              />
            </div>

            <!-- 비밀번호 -->
            <div class="d-input-field">
              <span class="d-input-icon" aria-hidden="true">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                  <path d="M12 17.35C12.9002 17.35 13.63 16.6202 13.63 15.72C13.63 14.8198 12.9002 14.09 12 14.09C11.0998 14.09 10.37 14.8198 10.37 15.72C10.37 16.6202 11.0998 17.35 12 17.35Z" fill="#BBBEC7"/>
                  <path d="M18.28 9.53V8.28C18.28 5.58 17.63 2 12 2C6.37 2 5.72 5.58 5.72 8.28V9.53C2.92 9.88 2 11.3 2 14.79V16.65C2 20.75 3.25 22 7.35 22H16.65C20.75 22 22 20.75 22 16.65V14.79C22 11.3 21.08 9.88 18.28 9.53ZM7.35 9.44C7.27 9.44 7.2 9.44 7.12 9.44V8.28C7.12 5.35 7.95 3.4 12 3.4C16.05 3.4 16.88 5.35 16.88 8.28V9.45C16.8 9.45 16.73 9.45 16.65 9.45H7.35V9.44Z" fill="#BBBEC7"/>
                </svg>
              </span>
              <input
                class="d-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="비밀번호를 입력하세요"
                bind:value={password}
                onkeydown={handleKeydown}
                autocomplete="current-password"
                aria-label="비밀번호"
              />
              <button
                class="d-eye-btn"
                type="button"
                onclick={() => showPassword = !showPassword}
                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
              >
                {#if showPassword}
                  <!-- eye open -->
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M2.75 12C2.75 12 5.75 6 12 6C18.25 6 21.25 12 21.25 12C21.25 12 18.25 18 12 18C5.75 18 2.75 12 2.75 12Z" stroke="#BBBEC7" stroke-width="1.5"/>
                    <circle cx="12" cy="12" r="3" stroke="#BBBEC7" stroke-width="1.5"/>
                  </svg>
                {:else}
                  <!-- eye slash -->
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                    <path d="M21.27 9.18C20.98 8.72 20.67 8.29 20.35 7.89C19.98 7.42 19.28 7.38 18.86 7.8L15.86 10.8C16.08 11.46 16.12 12.22 15.92 13.01C15.57 14.42 14.43 15.56 13.02 15.91C12.23 16.11 11.47 16.07 10.81 15.85L8.35 18.31C7.85 18.81 8.01 19.69 8.68 19.95C9.75 20.36 10.86 20.57 12 20.57C13.78 20.57 15.51 20.05 17.09 19.08C18.7 18.08 20.15 16.61 21.32 14.74C22.27 13.23 22.22 10.69 21.27 9.18Z" fill="#BBBEC7"/>
                    <path d="M14.02 9.98L9.98 14.02C9.47 13.5 9.14 12.78 9.14 12C9.14 10.43 10.42 9.14 12 9.14C12.78 9.14 13.5 9.47 14.02 9.98Z" fill="#BBBEC7"/>
                    <path d="M18.25 5.75L14.86 9.14C14.13 8.4 13.12 7.96 12 7.96C9.76 7.96 7.96 9.77 7.96 12C7.96 13.12 8.41 14.13 9.14 14.86L5.76 18.25C4.64 17.35 3.62 16.2 2.75 14.84C1.75 13.27 1.75 10.72 2.75 9.15C3.91 7.33 5.33 5.9 6.91 4.92C8.49 3.96 10.22 3.43 12 3.43C14.23 3.43 16.39 4.25 18.25 5.75Z" fill="#BBBEC7"/>
                    <path d="M21.77 2.23C21.47 1.93 20.98 1.93 20.68 2.23L2.23 20.69C1.93 20.99 1.93 21.48 2.23 21.78C2.38 21.92 2.57 22 2.77 22C2.97 22 3.16 21.92 3.31 21.77L21.77 3.31C22.08 3.01 22.08 2.53 21.77 2.23Z" fill="#BBBEC7"/>
                  </svg>
                {/if}
              </button>
            </div>
          </div>

          <!-- Remember me + Forgot -->
          <div class="d-meta-row">
            <label class="d-remember">
              <input
                type="checkbox"
                class="d-checkbox-input"
                bind:checked={rememberMe}
              />
              <span class="d-checkbox-box" aria-hidden="true">
                {#if rememberMe}
                  <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
                    <path d="M1 5L5 9L13 1" stroke="var(--cs-purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {/if}
              </span>
              <span class="d-remember-label">Remember me</span>
            </label>
            <button type="button" class="d-forgot" onclick={() => goto('/auth/forgot-password')}>
              Forgot password?
            </button>
          </div>

          <!-- SNS 구분선 -->
          <div class="d-sns-divider">
            <span class="d-divider-label">or sign in with</span>
          </div>

          <!-- 소셜 아이콘 -->
          <div class="d-social">
            <!-- Apple -->
            <button class="d-social-icon" type="button" aria-label="Apple로 로그인">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                <rect width="44" height="44" rx="22" fill="white"/>
                <path d="M27.6128 21.6254C27.6429 24.652 30.4655 25.6592 30.4967 25.672C30.4729 25.743 30.0458 27.1074 29.0097 28.5166C28.114 29.735 27.1845 30.9488 25.7203 30.974C24.2814 30.9986 23.8188 30.1799 22.1738 30.1799C20.5293 30.1799 20.0153 30.9489 18.6533 30.9987C17.2399 31.0485 16.1636 29.6812 15.2605 28.4673C13.4152 25.9842 12.005 21.4508 13.8986 18.3906C14.8392 16.8709 16.5203 15.9086 18.3449 15.8839C19.7328 15.8593 21.0428 16.753 21.8913 16.753C22.7393 16.753 24.3312 15.6782 26.0048 15.8361C26.7055 15.8632 28.6722 16.0995 29.935 17.8199C29.8332 17.8786 27.5883 19.095 27.6128 21.6254ZM24.9087 14.1933C25.6591 13.3479 26.1641 12.171 26.0263 11C24.9447 11.0405 23.6368 11.6709 22.8609 12.5158C22.1656 13.264 21.5567 14.4616 21.721 15.6095C22.9266 15.6963 24.1582 15.0392 24.9087 14.1933Z" fill="var(--cs-dark)"/>
              </svg>
            </button>
            <!-- Instagram -->
            <button class="d-social-icon" type="button" aria-label="Instagram으로 로그인">
              <div class="d-insta-wrap">
                <div class="d-insta-bg"></div>
                <svg width="19" height="19" viewBox="0 0 19 19" fill="none" class="d-insta-icon">
                  <path d="M13.5591 0H5.52727C2.41818 0 0 2.41818 0 5.44091V13.4727C0 16.5818 2.41818 19 5.52727 19H13.5591C16.5818 19 19 16.5818 19 13.4727V5.44091C19 2.41818 16.5818 0 13.5591 0ZM9.5 14.5091C6.73636 14.5091 4.57727 12.2636 4.57727 9.58636C4.57727 6.90909 6.73636 4.57727 9.5 4.57727C12.2636 4.57727 14.4227 6.82273 14.4227 9.5C14.4227 12.1773 12.2636 14.5091 9.5 14.5091ZM14.5955 5.61364C13.9909 5.61364 13.4727 5.09545 13.4727 4.49091C13.4727 3.88636 13.9909 3.36818 14.5955 3.36818C15.2 3.36818 15.7182 3.88636 15.7182 4.49091C15.7182 5.09545 15.2 5.61364 14.5955 5.61364Z" fill="var(--cs-dark)"/>
                  <path d="M9.5 6.5C7.78829 6.5 6.33333 7.95496 6.33333 9.66667C6.33333 11.3784 7.78829 12.8333 9.5 12.8333C11.2117 12.8333 12.6667 11.3784 12.6667 9.66667C12.6667 7.95496 11.2117 6.5 9.5 6.5Z" fill="var(--cs-dark)"/>
                </svg>
              </div>
            </button>
            <!-- X (Twitter) -->
            <button class="d-social-icon" type="button" aria-label="X로 로그인">
              <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
                <rect width="44" height="44" rx="22" fill="white"/>
                <path d="M27.1761 13H29.9362L23.9061 20.6246L31 31H25.4456L21.0951 24.7074L16.1172 31H13.3554L19.8052 22.8446L13 13H18.6955L22.6279 18.7517L27.1761 13ZM26.2073 29.1723H27.7368L17.8644 14.7317H16.2232L26.2073 29.1723Z" fill="var(--cs-dark)"/>
              </svg>
            </button>
          </div>

          <!-- 에러 메시지 -->
          {#if errorMsg}
            <p class="d-error" role="alert">{errorMsg}</p>
          {/if}

          <!-- Sign Up / Sign In 전환 버튼 -->
          {#if isSignInMode}
            <!-- 이메일+비밀번호 입력 완료 → Sign In 버튼 -->
            <button
              class="d-signin-submit"
              onclick={handleSignIn}
              disabled={isLoading}
              aria-busy={isLoading}
            >
              {isLoading ? '로그인 중...' : 'Sign In'}
              {#if !isLoading}
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M14.43 18.82C14.24 18.82 14.05 18.75 13.9 18.6C13.61 18.31 13.61 17.83 13.9 17.54L19.44 12L13.9 6.46C13.61 6.17 13.61 5.69 13.9 5.4C14.19 5.11 14.67 5.11 14.96 5.4L21.03 11.47C21.32 11.76 21.32 12.24 21.03 12.53L14.96 18.6C14.81 18.75 14.62 18.82 14.43 18.82Z" fill="white"/>
                  <path d="M20.33 12.75H3.5C3.09 12.75 2.75 12.41 2.75 12C2.75 11.59 3.09 11.25 3.5 11.25H20.33C20.74 11.25 21.08 11.59 21.08 12C21.08 12.41 20.74 12.75 20.33 12.75Z" fill="white"/>
                </svg>
              {/if}
            </button>
          {:else}
            <!-- 기본 상태 → Sign Up 버튼 -->
            <button
              class="d-signup-submit"
              onclick={() => showSignUpModal = true}
              type="button"
            >
              Sign Up
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M12 5V19M5 12H19" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
              </svg>
            </button>
          {/if}
        </div>
      </div>
    </div>
  </div>
</div>

<!-- 회원가입 모달 -->
<SignUpModal
  open={showSignUpModal}
  onclose={() => showSignUpModal = false}
  onsuccess={() => {
    showSignUpModal = false
    const redirectTo = $page.url.searchParams.get('redirect') ?? '/'
    goto(redirectTo)
  }}
/>


<!-- ═══════════════════════════════════════════════
     MOBILE (< 768px)
════════════════════════════════════════════════ -->
<MobileMoreMenu open={menuOpen} onclose={() => menuOpen = false} />

<div class="m-wrap">
  <!-- 모바일 전용 상단 내비 바 (루트 GNB 위에 고정, 피그마 MTopGlobalArea 정합) -->
  <div class="m-topbar" class:m-topbar-hidden={menuOpen}>
    <div class="m-topbar-inner">
      <button class="m-topbar-back" onclick={handleBack} aria-label="이전 페이지로">
        <svg width="17" height="12" viewBox="0 0 17 12" fill="none">
          <path d="M16 6.00001H1M5.61549 1.00001L1 6.00001L5.61549 11"
            stroke="#444444" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="m-topbar-title">로그인</span>
      <button class="m-topbar-menu" aria-label="전체 메뉴 열기" onclick={() => menuOpen = true}>
        <svg width="20" height="17" viewBox="0 0 20 17" fill="none">
          <path d="M18.5 6.75C19.3284 6.75 20 7.42157 20 8.25C20 9.07843 19.3284 9.75 18.5 9.75H1.5C0.671573 9.75 0 9.07843 0 8.25C0 7.42157 0.671573 6.75 1.5 6.75H18.5Z" fill="#CF0000"/>
          <path d="M18.5 14C19.1904 14 19.75 14.5596 19.75 15.25C19.75 15.9404 19.1904 16.5 18.5 16.5H1.5C0.809644 16.5 0.25 15.9404 0.25 15.25C0.25 14.5596 0.809644 14 1.5 14H18.5ZM18.5 0C19.1904 0 19.75 0.559644 19.75 1.25C19.75 1.94036 19.1904 2.5 18.5 2.5H1.5C0.809644 2.5 0.25 1.94036 0.25 1.25C0.25 0.559644 0.809644 0 1.5 0H18.5Z" fill="#201857"/>
        </svg>
      </button>
    </div>
  </div>

  <!-- 본문 -->
  <div class="m-body">
    <!-- ──────────────────────────────────────────────────────────────
         광고 배너 영역 (gnb-mobile-nav 아래 첫 번째 콘텐츠 블록)
         관리 경로: CMS → 프로모션 → 광고 (promotion_banners / placement='login_mobile')
         - bg_image_url, overlay_image_url, html_content, link_url 을 CMS에서 관리
         - promotion_banners 테이블 미생성 시 +page.server.ts DEFAULT_BANNER fallback
         - html_content: CMS 관리자 전용 입력 → {@html} 렌더링 (XSS 위험 없음)
    ────────────────────────────────────────────────────────────── -->
    <div class="m-welcome">
      <!-- 배경 레이어: CMS bg_image_url + overlay_image_url -->
      <div class="m-welcome-bg" aria-hidden="true">
        <img src={data.banner.bg_image_url} alt="" class="m-welcome-img"/>
        {#if data.banner.overlay_image_url}
          <img src={data.banner.overlay_image_url} alt="" class="m-welcome-img m-welcome-overlay"/>
        {/if}
      </div>

      <!-- 텍스트 콘텐츠: CMS html_content {@html} 렌더링 -->
      <!-- link_url 있으면 배너 전체를 클릭 가능한 링크로 감쌈 -->
      {#if data.banner.link_url}
        <a href={data.banner.link_url} class="m-welcome-content m-welcome-link" aria-label="프로모션 배너">
          <div class="m-welcome-text">
            {@html data.banner.html_content}
          </div>
        </a>
      {:else}
        <div class="m-welcome-content">
          <div class="m-welcome-text">
            {@html data.banner.html_content}
          </div>
        </div>
      {/if}
    </div>

    <!-- 계정 폼 -->
    <div class="m-account">
      <p class="m-form-heading">Create your Account</p>

      <div class="m-inputs">
        <!-- 이메일 -->
        <div class="m-input-field">
          <span class="m-input-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 12C14.7614 12 17 9.76142 17 7C17 4.23858 14.7614 2 12 2C9.23858 2 7 4.23858 7 7C7 9.76142 9.23858 12 12 12Z" fill="#BBBEC7"/>
              <path d="M12 14.5C6.99 14.5 2.91 17.86 2.91 22C2.91 22.28 3.13 22.5 3.41 22.5H20.59C20.87 22.5 21.09 22.28 21.09 22C21.09 17.86 17.01 14.5 12 14.5Z" fill="#BBBEC7"/>
            </svg>
          </span>
          <input
            class="m-input"
            type="email"
            placeholder="이메일을 입력하세요"
            bind:value={email}
            onkeydown={handleKeydown}
            autocomplete="email"
            aria-label="이메일"
          />
        </div>

        <!-- 비밀번호 -->
        <div class="m-input-field">
          <span class="m-input-icon" aria-hidden="true">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
              <path d="M12 17.35C12.9002 17.35 13.63 16.6202 13.63 15.72C13.63 14.8198 12.9002 14.09 12 14.09C11.0998 14.09 10.37 14.8198 10.37 15.72C10.37 16.6202 11.0998 17.35 12 17.35Z" fill="#BBBEC7"/>
              <path d="M18.28 9.53V8.28C18.28 5.58 17.63 2 12 2C6.37 2 5.72 5.58 5.72 8.28V9.53C2.92 9.88 2 11.3 2 14.79V16.65C2 20.75 3.25 22 7.35 22H16.65C20.75 22 22 20.75 22 16.65V14.79C22 11.3 21.08 9.88 18.28 9.53ZM7.35 9.44C7.27 9.44 7.2 9.44 7.12 9.44V8.28C7.12 5.35 7.95 3.4 12 3.4C16.05 3.4 16.88 5.35 16.88 8.28V9.45C16.8 9.45 16.73 9.45 16.65 9.45H7.35V9.44Z" fill="#BBBEC7"/>
            </svg>
          </span>
          <input
            class="m-input"
            type={showPassword ? 'text' : 'password'}
            placeholder="비밀번호를 입력하세요"
            bind:value={password}
            onkeydown={handleKeydown}
            autocomplete="current-password"
            aria-label="비밀번호"
          />
          <button
            class="m-eye-btn"
            type="button"
            onclick={() => showPassword = !showPassword}
            aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
          >
            {#if showPassword}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M2.75 12C2.75 12 5.75 6 12 6C18.25 6 21.25 12 21.25 12C21.25 12 18.25 18 12 18C5.75 18 2.75 12 2.75 12Z" stroke="#BBBEC7" stroke-width="1.5"/>
                <circle cx="12" cy="12" r="3" stroke="#BBBEC7" stroke-width="1.5"/>
              </svg>
            {:else}
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
                <path d="M21.27 9.18C20.98 8.72 20.67 8.29 20.35 7.89C19.98 7.42 19.28 7.38 18.86 7.8L15.86 10.8C16.08 11.46 16.12 12.22 15.92 13.01C15.57 14.42 14.43 15.56 13.02 15.91C12.23 16.11 11.47 16.07 10.81 15.85L8.35 18.31C7.85 18.81 8.01 19.69 8.68 19.95C9.75 20.36 10.86 20.57 12 20.57C13.78 20.57 15.51 20.05 17.09 19.08C18.7 18.08 20.15 16.61 21.32 14.74C22.27 13.23 22.22 10.69 21.27 9.18Z" fill="#BBBEC7"/>
                <path d="M14.02 9.98L9.98 14.02C9.47 13.5 9.14 12.78 9.14 12C9.14 10.43 10.42 9.14 12 9.14C12.78 9.14 13.5 9.47 14.02 9.98Z" fill="#BBBEC7"/>
                <path d="M18.25 5.75L14.86 9.14C14.13 8.4 13.12 7.96 12 7.96C9.76 7.96 7.96 9.77 7.96 12C7.96 13.12 8.41 14.13 9.14 14.86L5.76 18.25C4.64 17.35 3.62 16.2 2.75 14.84C1.75 13.27 1.75 10.72 2.75 9.15C3.91 7.33 5.33 5.9 6.91 4.92C8.49 3.96 10.22 3.43 12 3.43C14.23 3.43 16.39 4.25 18.25 5.75Z" fill="#BBBEC7"/>
                <path d="M21.77 2.23C21.47 1.93 20.98 1.93 20.68 2.23L2.23 20.69C1.93 20.99 1.93 21.48 2.23 21.78C2.38 21.92 2.57 22 2.77 22C2.97 22 3.16 21.92 3.31 21.77L21.77 3.31C22.08 3.01 22.08 2.53 21.77 2.23Z" fill="#BBBEC7"/>
              </svg>
            {/if}
          </button>
        </div>
      </div>

      <!-- Remember me + Forgot -->
      <div class="m-meta-row">
        <label class="m-remember">
          <input
            type="checkbox"
            class="m-checkbox-input"
            bind:checked={rememberMe}
          />
          <span class="m-checkbox-box" aria-hidden="true">
            {#if rememberMe}
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
                <path d="M1 5L5 9L13 1" stroke="var(--cs-purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {/if}
          </span>
          <span class="m-remember-label">Remember me</span>
        </label>
        <button type="button" class="m-forgot" onclick={() => goto('/auth/forgot-password')}>
          Forgot password?
        </button>
      </div>

      <!-- SNS 구분선 -->
      <div class="m-sns-divider">
        <span class="m-divider-label">or sign in with</span>
      </div>

      <!-- 소셜 아이콘 -->
      <div class="m-social">
        <button class="m-social-icon" type="button" aria-label="Apple로 로그인">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
            <rect width="44" height="44" rx="22" fill="white"/>
            <path d="M27.6128 21.6254C27.6429 24.652 30.4655 25.6592 30.4967 25.672C30.4729 25.743 30.0458 27.1074 29.0097 28.5166C28.114 29.735 27.1845 30.9488 25.7203 30.974C24.2814 30.9986 23.8188 30.1799 22.1738 30.1799C20.5293 30.1799 20.0153 30.9489 18.6533 30.9987C17.2399 31.0485 16.1636 29.6812 15.2605 28.4673C13.4152 25.9842 12.005 21.4508 13.8986 18.3906C14.8392 16.8709 16.5203 15.9086 18.3449 15.8839C19.7328 15.8593 21.0428 16.753 21.8913 16.753C22.7393 16.753 24.3312 15.6782 26.0048 15.8361C26.7055 15.8632 28.6722 16.0995 29.935 17.8199C29.8332 17.8786 27.5883 19.095 27.6128 21.6254ZM24.9087 14.1933C25.6591 13.3479 26.1641 12.171 26.0263 11C24.9447 11.0405 23.6368 11.6709 22.8609 12.5158C22.1656 13.264 21.5567 14.4616 21.721 15.6095C22.9266 15.6963 24.1582 15.0392 24.9087 14.1933Z" fill="var(--cs-dark)"/>
          </svg>
        </button>
        <button class="m-social-icon" type="button" aria-label="Instagram으로 로그인">
          <div class="m-insta-wrap">
            <div class="m-insta-bg"></div>
            <svg width="19" height="19" viewBox="0 0 19 19" fill="none" class="m-insta-icon">
              <path d="M13.5591 0H5.52727C2.41818 0 0 2.41818 0 5.44091V13.4727C0 16.5818 2.41818 19 5.52727 19H13.5591C16.5818 19 19 16.5818 19 13.4727V5.44091C19 2.41818 16.5818 0 13.5591 0ZM9.5 14.5091C6.73636 14.5091 4.57727 12.2636 4.57727 9.58636C4.57727 6.90909 6.73636 4.57727 9.5 4.57727C12.2636 4.57727 14.4227 6.82273 14.4227 9.5C14.4227 12.1773 12.2636 14.5091 9.5 14.5091ZM14.5955 5.61364C13.9909 5.61364 13.4727 5.09545 13.4727 4.49091C13.4727 3.88636 13.9909 3.36818 14.5955 3.36818C15.2 3.36818 15.7182 3.88636 15.7182 4.49091C15.7182 5.09545 15.2 5.61364 14.5955 5.61364Z" fill="var(--cs-dark)"/>
              <path d="M9.5 6.5C7.78829 6.5 6.33333 7.95496 6.33333 9.66667C6.33333 11.3784 7.78829 12.8333 9.5 12.8333C11.2117 12.8333 12.6667 11.3784 12.6667 9.66667C12.6667 7.95496 11.2117 6.5 9.5 6.5Z" fill="var(--cs-dark)"/>
            </svg>
          </div>
        </button>
        <button class="m-social-icon" type="button" aria-label="X로 로그인">
          <svg width="44" height="44" viewBox="0 0 44 44" fill="none">
            <rect width="44" height="44" rx="22" fill="white"/>
            <path d="M27.1761 13H29.9362L23.9061 20.6246L31 31H25.4456L21.0951 24.7074L16.1172 31H13.3554L19.8052 22.8446L13 13H18.6955L22.6279 18.7517L27.1761 13ZM26.2073 29.1723H27.7368L17.8644 14.7317H16.2232L26.2073 29.1723Z" fill="var(--cs-dark)"/>
          </svg>
        </button>
      </div>

      <!-- 에러 메시지 -->
      {#if errorMsg}
        <p class="m-error" role="alert">{errorMsg}</p>
      {/if}

      <!-- Sign Up / Sign In 전환 버튼 -->
      {#if isSignInMode}
        <button
          class="m-signin-submit"
          onclick={handleSignIn}
          disabled={isLoading}
          aria-busy={isLoading}
        >
          {isLoading ? '로그인 중...' : 'Sign In'}
          {#if !isLoading}
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M14.43 18.82C14.24 18.82 14.05 18.75 13.9 18.6C13.61 18.31 13.61 17.83 13.9 17.54L19.44 12L13.9 6.46C13.61 6.17 13.61 5.69 13.9 5.4C14.19 5.11 14.67 5.11 14.96 5.4L21.03 11.47C21.32 11.76 21.32 12.24 21.03 12.53L14.96 18.6C14.81 18.75 14.62 18.82 14.43 18.82Z" fill="white"/>
              <path d="M20.33 12.75H3.5C3.09 12.75 2.75 12.41 2.75 12C2.75 11.59 3.09 11.25 3.5 11.25H20.33C20.74 11.25 21.08 11.59 21.08 12C21.08 12.41 20.74 12.75 20.33 12.75Z" fill="white"/>
            </svg>
          {/if}
        </button>
      {:else}
        <button
          class="m-signup-submit"
          onclick={() => showSignUpModal = true}
          type="button"
        >
          Sign Up
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="M12 5V19M5 12H19" stroke="white" stroke-width="2.5" stroke-linecap="round"/>
          </svg>
        </button>
      {/if}
    </div>
  </div>
</div>


<style>
  /* ══════════════════════════════════
     PC 공통
  ══════════════════════════════════ */
  .d-wrap {
    display: none;
    flex-direction: column;
    min-height: 100vh;
    background: var(--cs-lilac);
  }
  @media (min-width: 768px) {
    .d-wrap  { display: flex; }
    .m-wrap  { display: none !important; }
  }

  /* Body — 메인 레이아웃 fixed GNB(약 114px) 아래부터 시작 */
  .d-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    padding-top: 114px;
    padding-bottom: 80px;
  }
  .d-container {
    max-width: var(--layout-pc-max);
    width: 100%;
    padding: 0 40px;
    display: flex;
    flex-direction: column;
    gap: 50px;
  }

  /* 백 버튼 nav pill */
  .d-nav-pill {
    margin-top: 0;
    background: var(--cs-lilac-nav);
    border: 1px solid rgba(255,255,255,0.6);
    backdrop-filter: blur(8px);
    border-radius: var(--radius-lg);
    padding: 20px 40px;
    display: flex;
    align-items: center;
    gap: 12px;
    cursor: pointer;
    align-self: flex-start;
    min-height: 44px;
    transition: background 0.15s;
  }
  .d-nav-pill:hover { background: var(--cs-lilac-nav); }
  .d-back-icon { display: flex; align-items: center; }
  .d-back-label {
    font: var(--text-pc-title-16);
    color: var(--cs-text);
    font-weight: 700;
  }

  /* 메인 카드 */
  .d-card {
    display: flex;
    align-items: stretch;
    gap: 100px;
    width: 100%;
  }

  /* Title 패널 (좌) */
  .d-title-panel {
    flex-shrink: 0;
    width: 520px;
    border-radius: var(--radius-2xl) 0 0 var(--radius-2xl);
    overflow: hidden;
    position: relative;
    min-height: 350px;
  }
  .d-title-bg {
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .d-title-bg-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }
  .d-title-content {
    position: relative;
    z-index: 1;
    background: var(--cs-purple-light);
    min-height: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    justify-content: flex-start;
    padding: 30px 50px;
    gap: 4px;
  }
  .d-welcome-en {
    font: var(--text-pc-ad-en-80);
    color: var(--cs-white);
    line-height: 1.2;
    letter-spacing: 1.6px;
    text-shadow: var(--shadow-outsh2);
    white-space: nowrap;
  }
  .d-welcome-sub {
    font: var(--text-pc-menu-en-20);
    color: var(--cs-purple-op10);
    letter-spacing: -0.5px;
    white-space: nowrap;
  }

  /* 폼 패널 (우) */
  .d-form-panel {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 30px;
    justify-content: center;
  }
  .d-form-heading {
    font-family: var(--font-kr);
    font-size: 25px;
    font-weight: 900;
    color: var(--cs-text-dark);
    margin: 0;
  }

  /* PC 인풋 */
  .d-inputs {
    display: flex;
    flex-wrap: wrap;
    gap: 20px;
  }
  .d-input-field {
    background: var(--cs-white);
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px 25px;
    flex: 1 1 220px;
    min-width: 220px;
    min-height: 60px;
    position: relative;
  }
  .d-input-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .d-input {
    background: none;
    border: none;
    outline: none;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    flex: 1;
    min-width: 0;
  }
  .d-input::placeholder { color: var(--cs-text-placeholder); }
  .d-eye-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    min-width: 44px;
    align-self: stretch;
    justify-content: center;
    flex-shrink: 0;
  }

  /* PC meta row */
  .d-meta-row {
    display: flex;
    align-items: center;
    gap: 30px;
  }
  .d-remember {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    user-select: none;
  }
  .d-checkbox-input { position: absolute; opacity: 0; width: 0; height: 0; }
  .d-checkbox-box {
    width: 24px;
    height: 24px;
    background: var(--cs-white);
    border-radius: 6px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .d-remember-label {
    font-family: var(--font-kr);
    font-size: 12px;
    color: var(--cs-text-light);
    white-space: nowrap;
  }
  .d-forgot {
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-kr);
    font-size: 12px;
    color: var(--cs-red);
    padding: 0;
    white-space: nowrap;
    min-height: 44px;
  }

  /* SNS 구분선 */
  .d-sns-divider {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .d-divider-label {
    font-family: var(--font-kr);
    font-size: 12px;
    color: var(--cs-text-dark);
  }

  /* 소셜 */
  .d-social {
    display: flex;
    gap: 20px;
    align-items: center;
    justify-content: center;
  }
  .d-social-icon {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    min-width: 44px;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    transition: transform 0.15s;
  }
  .d-social-icon:hover { transform: scale(1.1); }
  .d-insta-wrap {
    position: relative;
    width: 44px;
    height: 44px;
  }
  .d-insta-bg {
    position: absolute;
    inset: 0;
    background: var(--cs-white);
    border-radius: var(--radius-full);
  }
  .d-insta-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%,-50%);
  }

  /* 에러 */
  .d-error {
    font: var(--text-pc-script-12);
    color: var(--cs-error);
    margin: 0;
    text-align: center;
  }

  /* 로그인 버튼 */
  .d-signin-submit {
    background: var(--cs-login-btn-gradient);
    box-shadow: 0px 15px 25px rgba(222,95,143,0.12);
    border: none;
    border-radius: var(--radius-full);
    height: 56px;
    width: 100%;
    color: var(--cs-white);
    font: var(--text-pc-title-16);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: opacity 0.15s, transform 0.15s;
  }
  .d-signin-submit:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .d-signin-submit:active:not(:disabled) { transform: translateY(0); }
  .d-signin-submit:disabled { background: #B0ABCC; cursor: not-allowed; }


  /* ══════════════════════════════════
     MOBILE 공통
  ══════════════════════════════════ */
  .m-wrap {
    display: block;
    background: var(--cs-lilac);
    min-height: 100vh;
  }

  /* 모바일 전용 상단 내비 바 (피그마 MTopGlobalArea 정합) */
  .m-topbar {
    position: fixed;
    top: 0; left: 0; right: 0;
    z-index: 1000;
  }
  .m-topbar-hidden {
    pointer-events: none !important;
    visibility: hidden;
  }
  .m-topbar {
    background: var(--cs-lilac);
    padding: 16px 20px 8px;
    pointer-events: none;
  }
  .m-topbar-inner {
    pointer-events: all;
    background: var(--cs-purple-op10);
    min-height: 55px;
    border-radius: 20px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 20px;
  }
  .m-topbar-back {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    min-width: 44px;
    min-height: 44px;
  }
  .m-topbar-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: var(--cs-dark);
    letter-spacing: -0.5px;
  }
  .m-topbar-menu {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    min-width: 44px;
    min-height: 44px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
  }

  /* 본문 — 탑바(16+55+8=79px) 아래 시작, 여유 6px */
  .m-body {
    padding: 85px 25px 60px;
    display: flex;
    flex-direction: column;
    gap: 50px;
  }
  .m-welcome {
    height: 168px;
    border-radius: 40px 10px 40px 10px;
    position: relative;
    overflow: hidden;
    flex-shrink: 0;
  }
  .m-welcome-bg {
    position: absolute;
    inset: 0;
    border-radius: inherit;
  }
  .m-welcome-img {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: inherit;
  }
  .m-welcome-overlay {
    z-index: 1;
  }
  /* link_url 있을 때 배너 전체 클릭 가능 (a 태그 래퍼) */
  .m-welcome-link {
    text-decoration: none;
    cursor: pointer;
  }
  .m-welcome-content {
    position: relative;
    z-index: 2;
    display: flex;
    align-items: center;
    justify-content: center;
    height: 100%;
    padding: 30px 10px;
  }
  /* {@html} 주입 콘텐츠 — Svelte 스코프 해시 미적용 → :global() 필수 */
  :global(.m-welcome-text) {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
    text-align: center;
  }
  :global(.m-welcome-kr) {
    font-family: 'SB AggroOTF', var(--font-kr-heading);
    font-size: 30px;
    font-weight: 700;
    line-height: 1.3;
    margin: 0;
  }
  :global(.m-w-purple)  { color: var(--cs-purple); }
  :global(.m-w-red)     { color: var(--cs-red-badge); }
  :global(.m-welcome-sub) {
    font: var(--text-pc-title-16);
    color: var(--cs-dark);
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.5px;
  }
  :global(.m-w-red-sub) { color: var(--cs-red); }

  /* 계정 폼 */
  .m-account {
    display: flex;
    flex-direction: column;
    gap: 30px;
  }
  .m-form-heading {
    font: var(--text-pc-title-16);
    color: var(--cs-text-dark);
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.5px;
  }

  /* 모바일 인풋 */
  .m-inputs {
    display: flex;
    flex-direction: column;
    gap: 20px;
  }
  .m-input-field {
    background: var(--cs-white);
    border-radius: var(--radius-full);
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 15px 25px;
    width: 100%;
    min-height: 60px;
    box-sizing: border-box;
    position: relative;
  }
  .m-input-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .m-input {
    background: none;
    border: none;
    outline: none;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    flex: 1;
    min-width: 0;
  }
  .m-input::placeholder { color: var(--cs-text-placeholder); }
  .m-eye-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
    min-width: 44px;
    align-self: stretch;
    justify-content: center;
    flex-shrink: 0;
  }

  /* 모바일 meta row */
  .m-meta-row {
    display: flex;
    align-items: center;
    gap: 30px;
  }
  .m-remember {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    user-select: none;
  }
  .m-checkbox-input { position: absolute; opacity: 0; width: 0; height: 0; }
  .m-checkbox-box {
    width: 24px;
    height: 24px;
    background: var(--cs-white);
    border-radius: 6px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .m-remember-label {
    font-family: var(--font-kr);
    font-size: 12px;
    color: var(--cs-text-light);
    white-space: nowrap;
  }
  .m-forgot {
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-kr);
    font-size: 12px;
    color: var(--cs-red);
    padding: 0;
    white-space: nowrap;
    min-height: 44px;
  }

  /* 모바일 SNS */
  .m-sns-divider {
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .m-divider-label {
    font-family: var(--font-kr);
    font-size: 12px;
    color: var(--cs-text-dark);
  }
  .m-social {
    display: flex;
    gap: 20px;
    align-items: center;
    justify-content: center;
  }
  .m-social-icon {
    background: none;
    border: none;
    cursor: pointer;
    padding: 0;
    display: flex;
    min-width: 44px;
    min-height: 44px;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-full);
    transition: transform 0.15s;
  }
  .m-social-icon:hover { transform: scale(1.1); }
  .m-insta-wrap {
    position: relative;
    width: 44px;
    height: 44px;
  }
  .m-insta-bg {
    position: absolute;
    inset: 0;
    background: var(--cs-white);
    border-radius: var(--radius-full);
  }
  .m-insta-icon {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%,-50%);
  }

  /* 모바일 에러 */
  .m-error {
    font: var(--text-pc-script-12);
    color: var(--cs-error);
    margin: 0;
    text-align: center;
  }

  /* PC Sign Up 버튼 (기본 노출) */
  .d-signup-submit {
    background: var(--cs-purple);
    border: none;
    border-radius: var(--radius-full);
    height: 56px;
    width: 100%;
    color: var(--cs-white);
    font: var(--text-pc-title-16);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: background 0.2s, transform 0.15s;
  }
  .d-signup-submit:hover { background: var(--cs-purple-dark); transform: translateY(-1px); }
  .d-signup-submit:active { transform: translateY(0); }

  /* 모바일 로그인 버튼 */
  .m-signin-submit {
    background: var(--cs-login-btn-gradient);
    box-shadow: 0px 15px 25px rgba(222,95,143,0.12);
    border: none;
    border-radius: var(--radius-full);
    height: 56px;
    width: 100%;
    color: var(--cs-white);
    font: var(--text-pc-title-16);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: opacity 0.15s, transform 0.15s;
  }
  .m-signin-submit:hover:not(:disabled) { opacity: 0.9; transform: translateY(-1px); }
  .m-signin-submit:active:not(:disabled) { transform: translateY(0); }
  .m-signin-submit:disabled { background: #B0ABCC; cursor: not-allowed; }

  /* 모바일 Sign Up 버튼 (기본 노출) */
  .m-signup-submit {
    background: var(--cs-purple);
    border: none;
    border-radius: var(--radius-full);
    height: 56px;
    width: 100%;
    color: var(--cs-white);
    font: var(--text-pc-title-16);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 10px;
    transition: background 0.2s;
  }
  .m-signup-submit:hover { background: var(--cs-purple-dark); }
</style>
