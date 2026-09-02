<script lang="ts">
  import { performSignUp, performSignIn } from '$lib/stores/auth'
  import { supabase, rpc } from '$lib/services/supabase'

  type Mode = 'login' | 'signup' | 'find-email' | 'reset-pw'

  interface Props {
    open: boolean
    onclose: () => void
    onsuccess: () => void
    initialMode?: Mode
  }

  let { open, onclose, onsuccess, initialMode = 'signup' }: Props = $props()

  // ── 로그인/가입 전환 상태 ──
  let mode = $state<Mode>(initialMode)
  $effect(() => {
    if (open) mode = initialMode
  })

  // ── 로그인 폼 상태 ──
  let loginEmail = $state('')
  let loginPassword = $state('')
  let showLoginPassword = $state(false)
  let isLoggingIn = $state(false)
  let rememberLogin = $state(false)

  // ── 폼 상태 (회원가입) ──
  let email = $state('')
  let password = $state('')
  let passwordConfirm = $state('')
  let phone = $state('')           // 형식: 01012345678
  let verifyCode = $state('')
  let showPassword = $state(false)
  let showPasswordConfirm = $state(false)

  // ── 단계 상태 ──
  type Step = 'form' | 'verify'
  let step = $state<Step>('form')

  // ── 로딩·에러 ──
  let isLoading = $state(false)
  let isSendingOtp = $state(false)
  let errorMsg = $state<string | null>(null)
  let otpSent = $state(false)

  // ── 아이디 찾기 상태 ──
  let findPhone = $state('')
  let findCode = $state('')
  let findOtpSent = $state(false)
  let isSendingFindOtp = $state(false)
  let isFinding = $state(false)
  let foundEmail = $state<string | null>(null)

  // ── 비밀번호 재설정 상태 ──
  let resetEmail = $state('')
  let isResetting = $state(false)
  let resetSent = $state(false)

  // ── 초기화 (모달 닫힐 때) ──
  function reset() {
    mode = initialMode
    loginEmail = ''
    loginPassword = ''
    showLoginPassword = false
    isLoggingIn = false
    email = ''
    password = ''
    passwordConfirm = ''
    phone = ''
    verifyCode = ''
    step = 'form'
    errorMsg = null
    otpSent = false
    isLoading = false
    isSendingOtp = false
    findPhone = ''
    findCode = ''
    findOtpSent = false
    isSendingFindOtp = false
    isFinding = false
    foundEmail = null
    resetEmail = ''
    isResetting = false
    resetSent = false
  }

  // ── 로그인 제출 ──
  async function handleLogin() {
    errorMsg = null
    if (!loginEmail || !loginPassword) {
      errorMsg = '이메일과 비밀번호를 입력해주세요.'
      return
    }
    isLoggingIn = true
    try {
      // 이메일은 반드시 trim 후 전송 — auth/login/+page.svelte와 동일 이유(복사·붙여넣기
      // 공백/개행으로 인한 "Invalid login credentials" 오탐 방지). 비밀번호는 트림 안 함.
      await performSignIn(loginEmail.trim(), loginPassword)
      reset()
      onsuccess()
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '로그인에 실패했습니다.'
    } finally {
      isLoggingIn = false
    }
  }

  function handleClose() {
    reset()
    onclose()
  }

  // ── 폼 → 인증 단계 진입 ──
  function handleNextStep() {
    errorMsg = null
    if (!email || !password || !passwordConfirm) {
      errorMsg = '이메일과 비밀번호를 모두 입력해주세요.'
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errorMsg = '올바른 이메일 형식이 아닙니다.'
      return
    }
    if (password.length < 6) {
      errorMsg = '비밀번호는 6자 이상이어야 합니다.'
      return
    }
    if (password !== passwordConfirm) {
      errorMsg = '비밀번호가 일치하지 않습니다.'
      return
    }
    step = 'verify'
  }

  // 익명 세션 보장 — 휴대폰 OTP 발송·검증 RPC가 auth.uid() 기반이라 세션이 먼저 있어야 함.
  // 채팅으로 들어온 게스트는 이미 익명 세션이 있고(ChatWindow.ensureAuth와 동일 패턴),
  // /auth/login으로 바로 들어온 방문자는 여기서 새로 발급받는다 — 이후 performSignUp()이
  // 항상 "익명→영구 전환"(updateUser) 경로를 타게 되어 세션이 끊기지 않는다.
  // user_profiles 행도 미리 만들어둬야 휴대폰 인증 시 verify_and_update_phone의
  // UPDATE가 대상 행을 찾아 실제로 저장된다(행이 없으면 조용히 0건 업데이트로 유실됨).
  async function ensureSignupSession(): Promise<boolean> {
    const { data: { session: current } } = await supabase.auth.getSession()
    if (!current) {
      const { error } = await supabase.auth.signInAnonymously()
      if (error) return false
    }
    try {
      await rpc.ensureUserProfile()
    } catch {
      // user_profiles 보정 실패해도 가입 자체는 막지 않음 — performSignUp()에서도 재시도됨
    }
    return true
  }

  // ── 전화 인증번호 발송 (알리고 SMS 실연동 — /account/profile 휴대폰 인증과 동일 API 재사용) ──
  async function handleSendOtp() {
    errorMsg = null
    const cleaned = phone.replace(/\D/g, '')
    if (!/^010\d{8}$/.test(cleaned)) {
      errorMsg = '올바른 휴대폰 번호를 입력해주세요. (예: 01012345678)'
      return
    }
    isSendingOtp = true
    try {
      const ready = await ensureSignupSession()
      if (!ready) {
        errorMsg = '인증 세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.'
        return
      }
      const res = await fetch('/api/profile/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned }),
      })
      const data = await res.json() as { ok: boolean; error?: string; devCode?: string }
      if (!data.ok) {
        errorMsg = data.error ?? '인증번호 발송에 실패했습니다.'
        return
      }
      otpSent = true
      // 개발 환경 바이패스: 서버가 devCode를 내려주면 자동 입력
      if (data.devCode) verifyCode = data.devCode
    } catch {
      errorMsg = '네트워크 오류가 발생했습니다.'
    } finally {
      isSendingOtp = false
    }
  }

  // ── 회원가입 최종 완료 ──
  async function handleSignUp() {
    errorMsg = null
    if (!otpSent) {
      errorMsg = '인증번호를 먼저 발송해주세요.'
      return
    }
    if (!verifyCode) {
      errorMsg = '인증번호를 입력해주세요.'
      return
    }

    isLoading = true
    try {
      const cleaned = phone.replace(/\D/g, '')
      // supabase-js rpc() 제네릭 오버로드 추론 이슈로 로컬 캐스트 필요(기존 관례,
      // ProductHeroModal.svelte 등과 동일 패턴) — database.ts에 타입 자체는 등록돼 있음
      const { data: verifyData, error: verifyErr } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: { ok: boolean; error?: string } | null; error: { message: string } | null }>)(
        'verify_and_update_phone',
        { p_phone: cleaned, p_code: verifyCode },
      )
      if (verifyErr || !verifyData?.ok) {
        errorMsg = verifyData?.error ?? '인증번호가 올바르지 않거나 만료되었습니다.'
        return
      }

      await performSignUp(email, password)

      // 휴대폰 인증을 실제 검증 채널로 채택 — 서버가 Supabase의 이메일 확인 요구사항을 우회
      // (실패해도 가입 자체는 이미 완료된 상태이므로 조용히 넘어감 — 사용자가 재시도할 수단 없음,
      //  다만 이 호출 실패는 이례적 상황이라 별도 알림 없이도 낮은 리스크로 판단)
      try {
        await fetch('/api/auth/confirm-verified-signup', { method: 'POST' })
      } catch {
        // no-op
      }

      reset()
      onsuccess()
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      if (msg.includes('already registered') || msg.includes('already been registered')) {
        errorMsg = '이미 가입된 이메일입니다.'
      } else if (msg.includes('rate limit') || msg.includes('429')) {
        errorMsg = '잠시 후 다시 시도해주세요.'
      } else {
        errorMsg = '회원가입에 실패했습니다. 다시 시도해주세요.'
      }
    } finally {
      isLoading = false
    }
  }

  // ── 아이디 찾기: OTP 발송 ──
  async function handleFindSendOtp() {
    errorMsg = null
    const cleaned = findPhone.replace(/\D/g, '')
    if (!/^010\d{8}$/.test(cleaned)) {
      errorMsg = '올바른 휴대폰 번호를 입력해주세요. (예: 01012345678)'
      return
    }
    isSendingFindOtp = true
    try {
      const ready = await ensureSignupSession()
      if (!ready) {
        errorMsg = '인증 세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.'
        return
      }
      const res = await fetch('/api/profile/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned }),
      })
      const data = await res.json() as { ok: boolean; error?: string; devCode?: string }
      if (!data.ok) {
        errorMsg = data.error ?? '인증번호 발송에 실패했습니다.'
        return
      }
      findOtpSent = true
      if (data.devCode) findCode = data.devCode
    } catch {
      errorMsg = '네트워크 오류가 발생했습니다.'
    } finally {
      isSendingFindOtp = false
    }
  }

  // ── 아이디 찾기: OTP 검증 후 이메일 조회 ──
  async function handleFindEmail() {
    errorMsg = null
    if (!findCode) {
      errorMsg = '인증번호를 입력해주세요.'
      return
    }
    isFinding = true
    try {
      const res = await fetch('/api/auth/find-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: findPhone.replace(/\D/g, ''), code: findCode }),
      })
      const data = await res.json() as { ok: boolean; email?: string; error?: string }
      if (!data.ok) {
        errorMsg = data.error ?? '아이디를 찾을 수 없습니다.'
        return
      }
      foundEmail = data.email ?? null
    } catch {
      errorMsg = '네트워크 오류가 발생했습니다.'
    } finally {
      isFinding = false
    }
  }

  // ── 비밀번호 재설정 링크 발송 ──
  async function handleResetPw() {
    errorMsg = null
    if (!resetEmail) {
      errorMsg = '이메일 주소를 입력해주세요.'
      return
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(resetEmail)) {
      errorMsg = '올바른 이메일 형식이 아닙니다.'
      return
    }
    isResetting = true
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(resetEmail, {
        redirectTo: `${window.location.origin}/auth/reset-password`,
      })
      if (error) {
        errorMsg = '재설정 링크 발송에 실패했습니다. 잠시 후 다시 시도해주세요.'
        return
      }
      resetSent = true
    } catch {
      errorMsg = '네트워크 오류가 발생했습니다.'
    } finally {
      isResetting = false
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) handleClose()
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleClose()
  }
</script>

{#if open}
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="su-overlay"
  role="dialog"
  aria-modal="true"
  aria-label={mode === 'login' ? '로그인' : mode === 'find-email' ? '아이디 찾기' : mode === 'reset-pw' ? '비밀번호 찾기' : '회원가입'}
  tabindex="-1"
  onclick={handleOverlayClick}
  onkeydown={handleKeydown}
>
  <div class="su-modal">
    <!-- 헤더 -->
    <div class="su-header">
      <span class="su-title">{mode === 'login' ? 'Login' : mode === 'find-email' ? '아이디 찾기' : mode === 'reset-pw' ? '비밀번호 찾기' : 'Sign Up'}</span>
      <button class="su-close" onclick={handleClose} aria-label="닫기" type="button">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M1 1L17 17M17 1L1 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <!-- 바디 -->
    <div class="su-body">

      {#if mode === 'login'}
        <!-- ── 로그인 그룹 ── -->
        <div class="su-group">
          <p class="su-group-label">로그인</p>

          <div class="su-field">
            <label class="su-field-label" for="su-login-email">이메일 주소</label>
            <input
              id="su-login-email"
              class="su-input"
              type="email"
              placeholder="example@email.com"
              bind:value={loginEmail}
              autocomplete="email"
            />
          </div>

          <div class="su-field">
            <label class="su-field-label" for="su-login-pw">비밀번호</label>
            <div class="su-input-wrap">
              <input
                id="su-login-pw"
                class="su-input"
                type={showLoginPassword ? 'text' : 'password'}
                placeholder="비밀번호"
                bind:value={loginPassword}
                autocomplete="current-password"
              />
              <button
                class="su-eye"
                type="button"
                onclick={() => showLoginPassword = !showLoginPassword}
                aria-label={showLoginPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
              >
                {#if showLoginPassword}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M2.75 12C2.75 12 5.75 6 12 6C18.25 6 21.25 12 21.25 12C21.25 12 18.25 18 12 18C5.75 18 2.75 12 2.75 12Z" stroke="#AAAAAA" stroke-width="1.5"/>
                    <circle cx="12" cy="12" r="3" stroke="#AAAAAA" stroke-width="1.5"/>
                  </svg>
                {:else}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M21.27 9.18C20.98 8.72 20.67 8.29 20.35 7.89C19.98 7.42 19.28 7.38 18.86 7.8L15.86 10.8C16.08 11.46 16.12 12.22 15.92 13.01C15.57 14.42 14.43 15.56 13.02 15.91C12.23 16.11 11.47 16.07 10.81 15.85L8.35 18.31C7.85 18.81 8.01 19.69 8.68 19.95C9.75 20.36 10.86 20.57 12 20.57C13.78 20.57 15.51 20.05 17.09 19.08C18.7 18.08 20.15 16.61 21.32 14.74C22.27 13.23 22.22 10.69 21.27 9.18Z" fill="#AAAAAA"/>
                    <path d="M14.02 9.98L9.98 14.02C9.47 13.5 9.14 12.78 9.14 12C9.14 10.43 10.42 9.14 12 9.14C12.78 9.14 13.5 9.47 14.02 9.98Z" fill="#AAAAAA"/>
                    <path d="M18.25 5.75L14.86 9.14C14.13 8.4 13.12 7.96 12 7.96C9.76 7.96 7.96 9.77 7.96 12C7.96 13.12 8.41 14.13 9.14 14.86L5.76 18.25C4.64 17.35 3.62 16.2 2.75 14.84C1.75 13.27 1.75 10.72 2.75 9.15C3.91 7.33 5.33 5.9 6.91 4.92C8.49 3.96 10.22 3.43 12 3.43C14.23 3.43 16.39 4.25 18.25 5.75Z" fill="#AAAAAA"/>
                    <path d="M21.77 2.23C21.47 1.93 20.98 1.93 20.68 2.23L2.23 20.69C1.93 20.99 1.93 21.48 2.23 21.78C2.38 21.92 2.57 22 2.77 22C2.97 22 3.16 21.92 3.31 21.77L21.77 3.31C22.08 3.01 22.08 2.53 21.77 2.23Z" fill="#AAAAAA"/>
                  </svg>
                {/if}
              </button>
            </div>
          </div>
        </div>

        <label class="su-remember">
          <input
            type="checkbox"
            class="su-checkbox-input"
            bind:checked={rememberLogin}
          />
          <span class="su-checkbox-box" aria-hidden="true">
            {#if rememberLogin}
              <svg width="14" height="10" viewBox="0 0 14 10" fill="none" aria-hidden="true">
                <path d="M1 5L5 9L13 1" stroke="var(--cs-purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {/if}
          </span>
          <span class="su-remember-label">로그인 기억하기</span>
        </label>

        {#if errorMsg}
          <p class="su-error" role="alert">{errorMsg}</p>
        {/if}

        <button class="su-cta" type="button" onclick={handleLogin} disabled={isLoggingIn} aria-busy={isLoggingIn}>
          {isLoggingIn ? '로그인 중...' : '로그인'}
        </button>

        <div class="su-auth-links">
          <button class="su-auth-link" type="button" onclick={() => { mode = 'find-email'; errorMsg = null }}>아이디 찾기</button>
          <span class="su-auth-sep">·</span>
          <button class="su-auth-link" type="button" onclick={() => { mode = 'reset-pw'; errorMsg = null }}>비밀번호 찾기</button>
        </div>

        <button class="su-switch-mode" type="button" onclick={() => { mode = 'signup'; errorMsg = null }}>
          아직 계정이 없으신가요? <span>5초 회원가입</span>
        </button>

      {:else if mode === 'signup'}
      {#if step === 'form'}
        <!-- ── 폼 그룹 ── -->
        <div class="su-group">

          <!-- 이메일 -->
          <div class="su-field">
            <input
              id="su-email"
              class="su-input"
              type="email"
              placeholder="사용할 메일 아이디를 입력하세요."
              bind:value={email}
              autocomplete="email"
            />
          </div>

          <!-- 비밀번호 -->
          <div class="su-field">
            <div class="su-input-wrap">
              <input
                id="su-pw"
                class="su-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="비밀번호 6자 이상 입력하세요."
                bind:value={password}
                autocomplete="new-password"
              />
              <button
                class="su-eye"
                type="button"
                onclick={() => showPassword = !showPassword}
                aria-label={showPassword ? '비밀번호 숨기기' : '비밀번호 표시'}
              >
                {#if showPassword}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M2.75 12C2.75 12 5.75 6 12 6C18.25 6 21.25 12 21.25 12C21.25 12 18.25 18 12 18C5.75 18 2.75 12 2.75 12Z" stroke="#AAAAAA" stroke-width="1.5"/>
                    <circle cx="12" cy="12" r="3" stroke="#AAAAAA" stroke-width="1.5"/>
                  </svg>
                {:else}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M21.27 9.18C20.98 8.72 20.67 8.29 20.35 7.89C19.98 7.42 19.28 7.38 18.86 7.8L15.86 10.8C16.08 11.46 16.12 12.22 15.92 13.01C15.57 14.42 14.43 15.56 13.02 15.91C12.23 16.11 11.47 16.07 10.81 15.85L8.35 18.31C7.85 18.81 8.01 19.69 8.68 19.95C9.75 20.36 10.86 20.57 12 20.57C13.78 20.57 15.51 20.05 17.09 19.08C18.7 18.08 20.15 16.61 21.32 14.74C22.27 13.23 22.22 10.69 21.27 9.18Z" fill="#AAAAAA"/>
                    <path d="M14.02 9.98L9.98 14.02C9.47 13.5 9.14 12.78 9.14 12C9.14 10.43 10.42 9.14 12 9.14C12.78 9.14 13.5 9.47 14.02 9.98Z" fill="#AAAAAA"/>
                    <path d="M18.25 5.75L14.86 9.14C14.13 8.4 13.12 7.96 12 7.96C9.76 7.96 7.96 9.77 7.96 12C7.96 13.12 8.41 14.13 9.14 14.86L5.76 18.25C4.64 17.35 3.62 16.2 2.75 14.84C1.75 13.27 1.75 10.72 2.75 9.15C3.91 7.33 5.33 5.9 6.91 4.92C8.49 3.96 10.22 3.43 12 3.43C14.23 3.43 16.39 4.25 18.25 5.75Z" fill="#AAAAAA"/>
                    <path d="M21.77 2.23C21.47 1.93 20.98 1.93 20.68 2.23L2.23 20.69C1.93 20.99 1.93 21.48 2.23 21.78C2.38 21.92 2.57 22 2.77 22C2.97 22 3.16 21.92 3.31 21.77L21.77 3.31C22.08 3.01 22.08 2.53 21.77 2.23Z" fill="#AAAAAA"/>
                  </svg>
                {/if}
              </button>
            </div>
          </div>

          <!-- 비밀번호 확인 -->
          <div class="su-field">
            <div class="su-input-wrap">
              <input
                id="su-pw2"
                class="su-input"
                type={showPasswordConfirm ? 'text' : 'password'}
                placeholder="비밀번호를 한 번 더 입력하세요"
                bind:value={passwordConfirm}
                autocomplete="new-password"
              />
              <button
                class="su-eye"
                type="button"
                onclick={() => showPasswordConfirm = !showPasswordConfirm}
                aria-label={showPasswordConfirm ? '비밀번호 숨기기' : '비밀번호 표시'}
              >
                {#if showPasswordConfirm}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M2.75 12C2.75 12 5.75 6 12 6C18.25 6 21.25 12 21.25 12C21.25 12 18.25 18 12 18C5.75 18 2.75 12 2.75 12Z" stroke="#AAAAAA" stroke-width="1.5"/>
                    <circle cx="12" cy="12" r="3" stroke="#AAAAAA" stroke-width="1.5"/>
                  </svg>
                {:else}
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                    <path d="M21.27 9.18C20.98 8.72 20.67 8.29 20.35 7.89C19.98 7.42 19.28 7.38 18.86 7.8L15.86 10.8C16.08 11.46 16.12 12.22 15.92 13.01C15.57 14.42 14.43 15.56 13.02 15.91C12.23 16.11 11.47 16.07 10.81 15.85L8.35 18.31C7.85 18.81 8.01 19.69 8.68 19.95C9.75 20.36 10.86 20.57 12 20.57C13.78 20.57 15.51 20.05 17.09 19.08C18.7 18.08 20.15 16.61 21.32 14.74C22.27 13.23 22.22 10.69 21.27 9.18Z" fill="#AAAAAA"/>
                    <path d="M14.02 9.98L9.98 14.02C9.47 13.5 9.14 12.78 9.14 12C9.14 10.43 10.42 9.14 12 9.14C12.78 9.14 13.5 9.47 14.02 9.98Z" fill="#AAAAAA"/>
                    <path d="M18.25 5.75L14.86 9.14C14.13 8.4 13.12 7.96 12 7.96C9.76 7.96 7.96 9.77 7.96 12C7.96 13.12 8.41 14.13 9.14 14.86L5.76 18.25C4.64 17.35 3.62 16.2 2.75 14.84C1.75 13.27 1.75 10.72 2.75 9.15C3.91 7.33 5.33 5.9 6.91 4.92C8.49 3.96 10.22 3.43 12 3.43C14.23 3.43 16.39 4.25 18.25 5.75Z" fill="#AAAAAA"/>
                    <path d="M21.77 2.23C21.47 1.93 20.98 1.93 20.68 2.23L2.23 20.69C1.93 20.99 1.93 21.48 2.23 21.78C2.38 21.92 2.57 22 2.77 22C2.97 22 3.16 21.92 3.31 21.77L21.77 3.31C22.08 3.01 22.08 2.53 21.77 2.23Z" fill="#AAAAAA"/>
                  </svg>
                {/if}
              </button>
            </div>
          </div>
        </div>

        {#if errorMsg}
          <p class="su-error" role="alert">{errorMsg}</p>
        {/if}

        <button class="su-cta" type="button" onclick={handleNextStep}>
          다음 단계 →
        </button>

        <button class="su-switch-mode" type="button" onclick={() => { mode = 'login'; errorMsg = null }}>
          이미 계정이 있으신가요? <span>로그인</span>
        </button>

      {:else}
        <!-- ── 인증 그룹 ── -->
        <div class="su-group">
          <p class="su-group-label">휴대폰 인증</p>

          <!-- 전화번호 + 발송 -->
          <div class="su-field">
            <label class="su-field-label" for="su-phone">휴대폰 번호</label>
            <div class="su-phone-row">
              <input
                id="su-phone"
                class="su-input su-phone-input"
                type="tel"
                placeholder="01012345678"
                bind:value={phone}
                maxlength={11}
              />
              <button
                class="su-otp-btn"
                type="button"
                onclick={handleSendOtp}
                disabled={isSendingOtp || otpSent}
              >
                {#if isSendingOtp}
                  발송 중...
                {:else if otpSent}
                  발송됨 ✓
                {:else}
                  인증 발송
                {/if}
              </button>
            </div>
            {#if otpSent}
              <p class="su-otp-hint">📱 인증번호가 발송되었습니다. (5분 이내 입력)</p>
            {/if}
          </div>

          <!-- 인증번호 입력 -->
          <div class="su-field">
            <label class="su-field-label" for="su-code">인증번호</label>
            <input
              id="su-code"
              class="su-input"
              type="text"
              placeholder="인증번호 6자리"
              bind:value={verifyCode}
              maxlength={6}
              disabled={!otpSent}
            />
          </div>
        </div>

        {#if errorMsg}
          <p class="su-error" role="alert">{errorMsg}</p>
        {/if}

        <div class="su-btn-row">
          <button
            class="su-back-btn"
            type="button"
            onclick={() => { step = 'form'; errorMsg = null }}
          >
            ← 이전
          </button>
          <button
            class="su-cta su-cta-flex"
            type="button"
            onclick={handleSignUp}
            disabled={isLoading}
            aria-busy={isLoading}
          >
            {isLoading ? '가입 중...' : '가입 완료'}
          </button>
        </div>
      {/if}

      {:else if mode === 'find-email'}
        <!-- ── 아이디 찾기 ── -->
        {#if !foundEmail}
          <div class="su-group">
            <p class="su-group-label">가입 시 등록한 휴대폰 번호로 아이디를 찾습니다.</p>
            <div class="su-field">
              <label class="su-field-label" for="su-find-phone">휴대폰 번호</label>
              <div class="su-phone-row">
                <input
                  id="su-find-phone"
                  class="su-input su-phone-input"
                  type="tel"
                  placeholder="01012345678"
                  bind:value={findPhone}
                  maxlength={11}
                  disabled={findOtpSent}
                />
                <button
                  class="su-otp-btn"
                  type="button"
                  onclick={handleFindSendOtp}
                  disabled={isSendingFindOtp || findOtpSent}
                >
                  {#if isSendingFindOtp}
                    발송 중...
                  {:else if findOtpSent}
                    발송됨 ✓
                  {:else}
                    인증 발송
                  {/if}
                </button>
              </div>
              {#if findOtpSent}
                <p class="su-otp-hint">📱 인증번호가 발송되었습니다. (5분 이내 입력)</p>
              {/if}
            </div>
            {#if findOtpSent}
              <div class="su-field">
                <label class="su-field-label" for="su-find-code">인증번호</label>
                <input
                  id="su-find-code"
                  class="su-input"
                  type="text"
                  placeholder="인증번호 6자리"
                  bind:value={findCode}
                  maxlength={6}
                />
              </div>
            {/if}
          </div>

          {#if errorMsg}
            <p class="su-error" role="alert">{errorMsg}</p>
          {/if}

          {#if findOtpSent}
            <button class="su-cta" type="button" onclick={handleFindEmail} disabled={isFinding} aria-busy={isFinding}>
              {isFinding ? '확인 중...' : '아이디 확인'}
            </button>
          {/if}
        {:else}
          <div class="su-result-box">
            <p class="su-result-label">가입된 아이디(이메일)</p>
            <p class="su-result-email">{foundEmail}</p>
          </div>
          <button class="su-cta" type="button" onclick={() => { reset(); mode = 'login' }}>로그인하기</button>
        {/if}

        <button class="su-switch-mode" type="button" onclick={() => { mode = 'login'; errorMsg = null; findPhone = ''; findCode = ''; findOtpSent = false; foundEmail = null }}>
          <span>← 로그인으로 돌아가기</span>
        </button>

      {:else if mode === 'reset-pw'}
        <!-- ── 비밀번호 재설정 ── -->
        {#if !resetSent}
          <div class="su-group">
            <p class="su-group-label">가입 시 사용한 이메일로 비밀번호 재설정 링크를 발송합니다.</p>
            <div class="su-field">
              <label class="su-field-label" for="su-reset-email">이메일 주소</label>
              <input
                id="su-reset-email"
                class="su-input"
                type="email"
                placeholder="example@email.com"
                bind:value={resetEmail}
                autocomplete="email"
                inputmode="email"
                oninput={(e) => {
                  const el = e.currentTarget as HTMLInputElement
                  el.value = el.value.replace(/[^\x20-\x7E]/g, '')
                  resetEmail = el.value
                }}
              />
            </div>
          </div>

          {#if errorMsg}
            <p class="su-error" role="alert">{errorMsg}</p>
          {/if}

          <button class="su-cta" type="button" onclick={handleResetPw} disabled={isResetting} aria-busy={isResetting}>
            {isResetting ? '발송 중...' : '재설정 링크 발송'}
          </button>
        {:else}
          <div class="su-result-box">
            <p class="su-result-label">📧 이메일을 확인해주세요</p>
            <p class="su-result-desc">{resetEmail}으로<br>비밀번호 재설정 링크가 발송되었습니다.</p>
          </div>
        {/if}

        <button class="su-switch-mode" type="button" onclick={() => { mode = 'login'; errorMsg = null; resetEmail = ''; resetSent = false }}>
          <span>← 로그인으로 돌아가기</span>
        </button>

      {/if}

    </div>
  </div>
</div>
{/if}

<style>
  /* 오버레이 */
  .su-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(16, 11, 50, 0.5);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }

  /* 모달 카드 */
  .su-modal {
    background: var(--cs-white);
    border-radius: var(--radius-2xl);
    width: 100%;
    max-width: 480px;
    overflow: hidden;
    box-shadow: 0 24px 60px rgba(16, 11, 50, 0.2);
  }

  /* 헤더 */
  .su-header {
    background: var(--cs-dark);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 28px;
  }
  .su-title {
    font-family: var(--font-kr);
    font-size: 18px;
    font-weight: 900;
    color: var(--cs-white);
    letter-spacing: -0.5px;
  }
  .su-close {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255,255,255,0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    border-radius: var(--radius-sm);
    transition: color 0.15s;
  }
  .su-close:hover { color: var(--cs-white); }

  /* 바디 */
  .su-body {
    padding: 28px;
    display: flex;
    flex-direction: column;
    gap: 20px;
  }

  /* 그룹 */
  .su-group {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }
  .su-group-label {
    font-family: var(--font-kr);
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text-mid);
    margin: 0;
    letter-spacing: -0.3px;
  }

  /* 필드 */
  .su-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .su-field-label {
    font-family: var(--font-kr);
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text-dark);
  }

  /* 인풋 */
  .su-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    padding: 13px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 100%;
    box-sizing: border-box;
    min-height: 48px;
    outline: none;
    transition: outline 0.15s;
  }
  .su-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .su-input::placeholder { color: var(--cs-text-light); }
  .su-input:disabled { opacity: 0.5; cursor: not-allowed; }

  /* 인풋 + 눈 버튼 래퍼 */
  .su-input-wrap {
    position: relative;
  }
  .su-input-wrap .su-input {
    padding-right: 52px;
  }
  .su-eye {
    position: absolute;
    right: 0;
    top: 0;
    bottom: 0;
    background: none;
    border: none;
    cursor: pointer;
    padding: 0 14px;
    display: flex;
    align-items: center;
    min-width: 44px;
  }

  /* 전화번호 행 */
  .su-phone-row {
    display: flex;
    gap: 8px;
  }
  .su-phone-input {
    flex: 1;
  }
  .su-otp-btn {
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    padding: 0 16px;
    font-family: var(--font-kr);
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    min-height: 48px;
    min-width: 90px;
    white-space: nowrap;
    transition: opacity 0.15s;
    flex-shrink: 0;
  }
  .su-otp-btn:disabled { opacity: 0.55; cursor: default; }
  .su-otp-btn:not(:disabled):hover { opacity: 0.85; }

  /* OTP 힌트 */
  .su-otp-hint {
    font-family: var(--font-kr);
    font-size: 12px;
    color: var(--cs-purple);
    margin: 2px 0 0;
  }

  /* 에러 */
  .su-error {
    font-family: var(--font-kr);
    font-size: 13px;
    color: var(--cs-red);
    margin: 0;
    text-align: center;
  }

  /* CTA 버튼 */
  .su-cta {
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    height: 50px;
    width: 100%;
    font: var(--text-pc-title-16);
    font-weight: 700;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.15s;
  }
  .su-cta:hover:not(:disabled) { background: var(--cs-red); }
  .su-cta:disabled { background: #B0ABCC; cursor: not-allowed; }
  .su-cta-flex { flex: 1; width: auto; }

  /* 로그인 기억하기 — /auth/login .d-remember와 동일 레이아웃(체크박스+라벨) */
  .su-remember {
    display: flex;
    align-items: center;
    gap: 7px;
    cursor: pointer;
    user-select: none;
    min-height: 44px;
  }
  .su-checkbox-input { position: absolute; opacity: 0; width: 0; height: 0; }
  .su-checkbox-box {
    width: 24px;
    height: 24px;
    background: var(--cs-surface-gray);
    border-radius: 6px;
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .su-remember-label {
    font-family: var(--font-kr);
    font-size: 13px;
    color: var(--cs-text-dark);
  }

  /* 로그인 ↔ 회원가입 전환 링크 */
  .su-switch-mode {
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-kr);
    font-size: 13px;
    color: var(--cs-text-dark);
    text-align: center;
    min-height: 44px;
    width: 100%;
  }
  .su-switch-mode span {
    color: var(--cs-purple);
    font-weight: 700;
    text-decoration: underline;
  }

  /* 이전 버튼 행 */
  .su-btn-row {
    display: flex;
    gap: 10px;
    align-items: stretch;
  }
  .su-back-btn {
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border: none;
    border-radius: var(--radius-xl);
    height: 50px;
    padding: 0 20px;
    font: var(--text-pc-body-14);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
    flex-shrink: 0;
  }
  .su-back-btn:hover { background: var(--cs-purple-pale); }

  /* 아이디/비밀번호 찾기 링크 */
  .su-auth-links {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    min-height: 36px;
  }
  .su-auth-link {
    background: none;
    border: none;
    cursor: pointer;
    font-family: var(--font-kr);
    font-size: 12px;
    color: var(--cs-text-mid);
    padding: 0 2px;
    text-decoration: underline;
    min-height: 36px;
    transition: color 0.15s;
  }
  .su-auth-link:hover { color: var(--cs-purple); }
  .su-auth-sep {
    font-size: 12px;
    color: var(--cs-text-light);
    line-height: 1;
  }

  /* 결과 박스 */
  .su-result-box {
    background: var(--cs-surface-gray);
    border-radius: var(--radius-md);
    padding: 24px 20px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    text-align: center;
  }
  .su-result-label {
    font-family: var(--font-kr);
    font-size: 12px;
    font-weight: 700;
    color: var(--cs-text-mid);
    margin: 0;
    letter-spacing: -0.2px;
  }
  .su-result-email {
    font-family: var(--font-kr);
    font-size: 20px;
    font-weight: 900;
    color: var(--cs-purple);
    margin: 0;
    letter-spacing: -0.5px;
    word-break: break-all;
  }
  .su-result-desc {
    font-family: var(--font-kr);
    font-size: 13px;
    color: var(--cs-text-dark);
    margin: 0;
    line-height: 1.6;
  }

  /* 모바일 */
  @media (max-width: 540px) {
    .su-modal { border-radius: var(--radius-xl); }
    .su-body { padding: 20px; }
    .su-header { padding: 16px 20px; }
  }
</style>
