<script lang="ts">
  import { performSignUp } from '$lib/stores/auth'

  interface Props {
    open: boolean
    onclose: () => void
    onsuccess: () => void
  }

  let { open, onclose, onsuccess }: Props = $props()

  // ── 폼 상태 ──
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

  // ── 초기화 (모달 닫힐 때) ──
  function reset() {
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

  // ── 전화 인증번호 발송 ──
  // TODO: 추후 알리고 SMS 문자 인증 API와 연동 예정
  //   1. POST /api/auth/send-otp { phone } → 알리고 API 호출 후 인증번호 발송
  //   2. POST /api/auth/verify-otp { phone, code } → 발송된 인증번호와 비교 검증
  //   3. 검증 성공 시 supabase.auth.signUp 호출 (현재 구조 동일)
  async function handleSendOtp() {
    errorMsg = null
    const cleaned = phone.replace(/\D/g, '')
    if (!/^01[0-9]{8,9}$/.test(cleaned)) {
      errorMsg = '올바른 휴대폰 번호를 입력해주세요. (예: 01012345678)'
      return
    }
    isSendingOtp = true
    // 더미 지연 (실제 SMS 발송 시 API 호출로 교체)
    await new Promise(r => setTimeout(r, 800))
    isSendingOtp = false
    otpSent = true
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
    // TODO: 추후 알리고 연동 시 아래 더미 검증을 서버 검증으로 교체
    //   현재: 인증번호 아무 값이나 입력하면 통과 (테스트용 더미)
    //   교체: const res = await fetch('/api/auth/verify-otp', { body: { phone, code: verifyCode } })
    //         if (!res.ok) { errorMsg = '인증번호가 일치하지 않습니다.'; return }

    isLoading = true
    try {
      await performSignUp(email, password)
      reset()
      onsuccess()
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '회원가입에 실패했습니다.'
    } finally {
      isLoading = false
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
  aria-label="회원가입"
  tabindex="-1"
  onclick={handleOverlayClick}
  onkeydown={handleKeydown}
>
  <div class="su-modal">
    <!-- 헤더 -->
    <div class="su-header">
      <span class="su-title">Sign Up</span>
      <button class="su-close" onclick={handleClose} aria-label="닫기" type="button">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M1 1L17 17M17 1L1 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <!-- 바디 -->
    <div class="su-body">

      {#if step === 'form'}
        <!-- ── 폼 그룹 ── -->
        <div class="su-group">
          <p class="su-group-label">계정 정보</p>

          <!-- 이메일 -->
          <div class="su-field">
            <label class="su-field-label" for="su-email">이메일 주소</label>
            <input
              id="su-email"
              class="su-input"
              type="email"
              placeholder="example@email.com"
              bind:value={email}
              autocomplete="email"
            />
          </div>

          <!-- 비밀번호 -->
          <div class="su-field">
            <label class="su-field-label" for="su-pw">비밀번호</label>
            <div class="su-input-wrap">
              <input
                id="su-pw"
                class="su-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="6자 이상 입력하세요"
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
            <label class="su-field-label" for="su-pw2">비밀번호 확인</label>
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
              <!-- TODO: 알리고 SMS 연동 후 실제 인증번호 문자 수신 안내로 교체 -->
              <p class="su-otp-hint">📱 테스트 모드: 아무 숫자나 입력하세요.</p>
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

  /* 모바일 */
  @media (max-width: 540px) {
    .su-modal { border-radius: var(--radius-xl); }
    .su-body { padding: 20px; }
    .su-header { padding: 16px 20px; }
  }
</style>
