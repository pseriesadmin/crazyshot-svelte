<script lang="ts">
  import { performSignUp, performSignIn } from '$lib/stores/auth'
  import { supabase, rpc } from '$lib/services/supabase'
  import { csToast } from '$lib/utils/toast'
  import { slide } from 'svelte/transition'
  import { tick } from 'svelte'
  import { openChat } from '$lib/stores/chat.svelte'
  import { goto } from '$app/navigation'
  import { loginHref } from '$lib/utils/loginRedirect'
  import { resetPasswordViolation } from '$lib/utils/passwordPolicy'

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
  let fullName = $state('')
  let phone = $state('010-')        // 형식: 010-0000-0000
  let verifyCode = $state('')
  let showPassword = $state(false)
  let showPasswordConfirm = $state(false)

  // ── 단계 상태 ──
  type Step = 'form' | 'verify'
  let step = $state<Step>('form')

  // ── 전화번호 자동 하이픈 ──
  function formatPhoneWithHyphen(raw: string): string {
    const digits = raw.replace(/[^0-9]/g, '')
    if (digits.length <= 3) return digits
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    if (digits.length <= 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`
  }

  // ── 이메일 중복 체크 ──
  const EMAIL_MAX_LENGTH = 254
  let emailCheckTimer: ReturnType<typeof setTimeout> | null = null
  let emailKoreanWarned = false
  let emailAvailable = $state(false)
  let emailDuplicate = $state(false)
  // 가입 확인이 "실제로 진행 중"인 동안만 true — 확인 실패(null 고착)와 구분해 Tab 가로채기가 갇히지 않게 한다
  let emailChecking = false

  function onEmailInput(e: Event) {
    const el = e.currentTarget as HTMLInputElement
    pendingFocusPw = false // 이메일을 다시 고치면 대기 중이던 '확인 끝나면 비밀번호로 이동'을 취소
    // 한글(비ASCII) 차단 — 로그인 화면과 동일 패턴
    const filtered = el.value.replace(/[^\x00-\x7F]/g, '')
    if (el.value !== filtered) {
      el.value = filtered; email = filtered
      if (!emailKoreanWarned) {
        emailKoreanWarned = true
        csToast.warning('영문(숫자) 메일 형식으로 입력하세요.')
        setTimeout(() => { emailKoreanWarned = false }, 3000)
      }
    }
    emailAvailable = false
    emailDuplicate = false
    emailChecking = false
    const val = el.value
    if (emailCheckTimer) { clearTimeout(emailCheckTimer); emailCheckTimer = null }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) {
      // 형식 오류: @ 입력 후에도 형식이 안 맞으면 안내 (타이핑 중 과도한 경고 방지)
      if (val.includes('@')) {
        emailCheckTimer = setTimeout(() => {
          csToast.warning('이메일 형식을 확인해주세요.')
        }, 600)
      }
      return
    }
    emailChecking = true
    emailCheckTimer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('check_email_registered', { p_email: val } as never)
      if (email.trim() !== val.trim()) return // 그 사이 이메일이 바뀜 — 오래된 응답은 무시(새 확인이 플래그를 관리)
      emailChecking = false
      if (error) {
        pendingFocusPw = false
        csToast.warning('이메일 확인에 실패했습니다. 잠시 후 다시 시도해주세요.')
        return
      }
      if (data) {
        csToast.warning('이미 가입한 아이디입니다.')
        emailAvailable = false
        emailDuplicate = true
      } else {
        csToast.success('등록 가능한 아이디입니다.')
        emailAvailable = true
        emailDuplicate = false
      }
    }, 600)
  }

  // ── 이름 입력 노출: 비밀번호 확인까지 일치하게 입력되는 즉시 아래에 '성함' 입력란을 보여준다 ──
  // 한 번 노출되면 비밀번호를 다시 고쳐도 숨기지 않는다(입력 중인 이름이 사라지는 것 방지).
  const FULL_NAME_MAX_LENGTH = 30
  const passwordsMatched = $derived(resetPasswordViolation(password) === null && passwordConfirm === password)
  let nameRevealed = $state(false)
  $effect(() => {
    if (passwordsMatched) nameRevealed = true
  })

  const canProceed = $derived(
    emailAvailable && !!password && !!passwordConfirm && nameRevealed && fullName.trim().length > 0,
  )

  // ── 회원가입 1단계: Enter/키보드 '다음'으로 입력란을 차례로 이동 (IME-SAFE-INPUT: 한글 조합 중 Enter는 무시) ──
  // 이메일 → 비밀번호 → 비밀번호 확인 → 성함 → (모두 충족하면) 다음 단계. 비활성 입력란에는 포커스하지 않는다.
  // 이메일 가입 확인(0.6초 입력 멈춤 후)이 끝나기 전에 Enter를 눌렀다면 확인이 끝나는 즉시 비밀번호로 이동한다.
  let pendingFocusPw = false
  $effect(() => {
    if (emailAvailable && pendingFocusPw) {
      pendingFocusPw = false
      void tick().then(() => document.getElementById('su-pw')?.focus())
    }
  })
  // Tab 키도 Enter와 같은 순서로 다음 '입력란'에 포커스한다(사이의 눈 아이콘·발송 버튼은 건너뜀, Shift+Tab·조합 중·보조키 조합은 기본 동작)
  // 한글 조합 판정: isComposing 외에 Safari가 조합 종료 Enter를 isComposing=false·keyCode 229로 보내는 경우까지 조합 중으로 본다
  function isImeKey(e: KeyboardEvent): boolean {
    return e.isComposing || e.keyCode === 229
  }
  function isPlainTab(e: KeyboardEvent): boolean {
    return e.key === 'Tab' && !e.shiftKey && !e.altKey && !e.ctrlKey && !e.metaKey && !isImeKey(e)
  }
  function onTabTo(e: KeyboardEvent, nextId: string) {
    if (!isPlainTab(e)) return
    const next = document.getElementById(nextId) as HTMLInputElement | null
    if (next && !next.disabled) {
      e.preventDefault()
      next.focus()
    }
  }
  function onSignupEnter(e: KeyboardEvent, nextId: string | null) {
    if (nextId) onTabTo(e, nextId)
    if (e.key !== 'Enter' || isImeKey(e)) return
    e.preventDefault()
    if (nextId === null) {
      if (canProceed) handleNextStep()
      return
    }
    const next = document.getElementById(nextId) as HTMLInputElement | null
    if (next && !next.disabled) next.focus()
  }
  // 인증(OTP) 흐름 공용: Enter로 다음 입력란 포커스 또는 해당 단계 실행 (IME 조합 중 Enter 무시)
  function onEnterRun(e: KeyboardEvent, run: () => void) {
    if (e.key !== 'Enter' || isImeKey(e)) return
    e.preventDefault()
    run()
  }
  function focusById(id: string) {
    void tick().then(() => {
      const el = document.getElementById(id) as HTMLInputElement | null
      if (el && !el.disabled) el.focus()
    })
  }
  // 비밀번호 찾기 이메일: 가입 확인(0.6초)이 끝나기 전 Enter를 눌렀다면 확인 완료 즉시 휴대폰 입력란으로 이동
  let pendingFocusResetPhone = false
  $effect(() => {
    if (resetEmailRegistered && pendingFocusResetPhone) {
      pendingFocusResetPhone = false
      focusById('su-reset-phone')
    }
  })
  function onResetEmailEnter(e: KeyboardEvent) {
    const tab = isPlainTab(e)
    if (!tab && (e.key !== 'Enter' || isImeKey(e))) return
    const checking = resetEmailChecking
    // Tab은 이동할 수 있을 때(확인 완료·확인 중)만 가로챈다 — 미가입·형식 오류면 기본 Tab 동작
    if (tab && !resetEmailRegistered && !checking) return
    e.preventDefault()
    if (resetEmailRegistered) focusById('su-reset-phone')
    else if (checking) pendingFocusResetPhone = true
  }

  function onSignupEmailEnter(e: KeyboardEvent) {
    const tab = isPlainTab(e)
    if (!tab && (e.key !== 'Enter' || isImeKey(e))) return
    const checking = emailChecking
    // Tab은 이동할 수 있을 때(확인 완료·확인 중)만 가로챈다 — 중복 이메일·형식 오류면 기본 Tab 동작
    if (tab && !emailAvailable && !checking) return
    e.preventDefault()
    if (emailAvailable) document.getElementById('su-pw')?.focus()
    else if (checking) pendingFocusPw = true
  }

  // ── 로딩·에러 ──
  let isLoading = $state(false)
  let isSendingOtp = $state(false)
  let errorMsg = $state<string | null>(null)
  // 모달 안 경고는 화면에 문구로 두지 않고 경고 토스트로 알린다(2026-10-24, Stephen 지시) — 각 핸들러는 기존처럼 errorMsg에 값을 넣기만 하면 된다
  $effect(() => {
    if (errorMsg) {
      csToast.warning(errorMsg)
      errorMsg = null
    }
  })
  let otpSent = $state(false)
  let otpVerified = $state(false)   // [인증 확인]으로 인증번호 확인을 마친 상태(가입 완료 때 재확인하지 않음)
  let signupFinalizePending = $state(false)   // 계정 전환은 끝났으나 서버의 이메일 확정(가입 마무리)이 실패한 상태 — [가입 완료]를 다시 누르면 마무리만 재시도
  // 인증번호 유효시간 3분 타이머 — 인증번호 발송이 성공한 직후부터 시작(서버 유효시간 3분과 같음)
  const OTP_TTL_SEC = 180
  let otpRemain = $state(0)
  let otpTimer: ReturnType<typeof setInterval> | null = null
  let codeFocused = $state(false)
  function stopOtpTimer() {
    if (otpTimer) { clearInterval(otpTimer); otpTimer = null }
  }
  function startOtpTimer() {
    stopOtpTimer()
    otpRemain = OTP_TTL_SEC
    otpTimer = setInterval(() => {
      otpRemain -= 1
      if (otpRemain <= 0) { otpRemain = 0; stopOtpTimer() }
    }, 1000)
  }
  $effect(() => () => stopOtpTimer())
  let isVerifyingOtp = $state(false)
  const otpExpired = $derived(otpSent && !otpVerified && otpRemain <= 0)
  // 입력칸을 아직 선택(커서·터치)하지 않았고 비어 있을 때만 남은 시간을 안내 문구 자리에 보여준다
  const codeGuide = $derived.by(() => {
    if (!otpSent || otpVerified || codeFocused || verifyCode !== '') return '인증번호 입력'
    if (otpRemain <= 0) return '인증 시간 만료'
    const mm = String(Math.floor(otpRemain / 60)).padStart(2, '0')
    const ss = String(otpRemain % 60).padStart(2, '0')
    return `남은 시간 ${mm}:${ss}`
  })

  // ── 아이디 찾기 상태 ──
  let findPhone = $state('010-') // 전화번호 입력폼 표준: '010-' 기본값·자동 하이픈(비밀번호 찾기와 동일)
  let findName = $state('')
  const findNameOk = $derived(findName.trim().length >= 2) // 이름 입력 후에만 휴대폰 인증 단계가 열린다(비밀번호 찾기의 이메일 확인과 같은 역할)
  let findCode = $state('')
  let findOtpSent = $state(false)
  let isSendingFindOtp = $state(false)
  let isFinding = $state(false)
  let foundEmail = $state<string | null>(null)

  // ── 비밀번호 재설정 상태 ──
  // 문자 인증번호 방식(2026-10-23): info(이메일+휴대폰) → code(인증번호) → newpw(새 비밀번호) → done
  let resetEmail = $state('')
  let resetPhone = $state('010-')
  let resetCode = $state('')
  let resetNewPw = $state('')
  let resetNewPw2 = $state('')
  let resetToken = $state<string | null>(null)
  let resetStep = $state<'info' | 'code' | 'newpw' | 'done'>('info')
  let isResetting = $state(false)
  let resetVerifying = $state(false)
  // 입력한 이메일이 가입된 계정인지(null=미확인) — 확인되면 휴대폰·인증번호 입력이 활성화된다
  let resetEmailRegistered = $state<boolean | null>(null)
  let resetEmailTimer: ReturnType<typeof setTimeout> | null = null
  let resetEmailChecking = false // 확인이 실제로 진행 중일 때만 true(실패 후 null 고착과 구분)

  // ── 초기화 (모달 닫힐 때) ──
  function reset() {
    // 키보드 이동 대기·가입 확인 진행 플래그 해제 — 모달을 닫았다 열어도 이전 대기가 포커스를 뺏지 않게 한다
    pendingFocusPw = false
    pendingFocusResetPhone = false
    emailChecking = false
    resetEmailChecking = false
    signupFinalizePending = false
    mode = initialMode
    loginEmail = ''
    loginPassword = ''
    showLoginPassword = false
    isLoggingIn = false
    email = ''
    password = ''
    passwordConfirm = ''
    fullName = ''
    nameRevealed = false
    phone = '010-'   // 초기값과 동일 — 초기화 후에도 '010-' 기본값 유지(전화번호 입력폼 표준)
    verifyCode = ''
    step = 'form'
    errorMsg = null
    otpSent = false
    otpVerified = false
    isVerifyingOtp = false
    stopOtpTimer()
    otpRemain = 0
    codeFocused = false
    isLoading = false
    isSendingOtp = false
    findName = ''
    findPhone = '010-'
    findCode = ''
    findOtpSent = false
    isSendingFindOtp = false
    isFinding = false
    foundEmail = null
    resetEmail = ''
    resetEmailRegistered = null
    if (resetEmailTimer) { clearTimeout(resetEmailTimer); resetEmailTimer = null }
    resetPhone = '010-'
    resetCode = ''
    resetNewPw = ''
    resetNewPw2 = ''
    resetToken = null
    resetStep = 'info'
    isResetting = false
    resetVerifying = false
    emailAvailable = false
    emailDuplicate = false
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
      await performSignIn(loginEmail.trim(), loginPassword, rememberLogin)
      reset()
      onsuccess()
    } catch (err) {
      errorMsg = err instanceof Error ? err.message : '로그인에 실패했습니다.'
    } finally {
      isLoggingIn = false
    }
  }

  // 아이디/비밀번호 찾기 완료 후 — 모달 로그인 폼이 아니라 기존 로그인 화면(/auth/login)으로 돌아간다.
  // 이미 로그인 화면이면 모달만 닫아 그 화면이 보이고, 다른 화면(예: 상품상세)에서 열렸다면 지금 화면을 redirect로 붙여 이동한다.
  function goToLoginPage() {
    handleClose()
    const { pathname, search } = window.location
    if (!pathname.startsWith('/auth/login')) void goto(loginHref(pathname, search))
  }

  // 고객채팅 문의 — 로그인 모달(z-index 1000)이 채팅창을 가리므로 먼저 닫고 연다
  function openSupportChat() {
    handleClose()
    openChat()
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
    const pwViolation = resetPasswordViolation(password)
    if (pwViolation) {
      errorMsg = pwViolation
      return
    }
    if (password !== passwordConfirm) {
      errorMsg = '비밀번호가 일치하지 않습니다.'
      return
    }
    if (!fullName.trim()) {
      errorMsg = '성함을 입력해주세요.'
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
  // 반환: 'ok' 진행 가능 / 'logged_in' 이미 일반 계정으로 로그인돼 있음(가입 중이면 차단) / 'error' 세션 생성 실패
  // ⛔ 2026-10-23: 가입 중에 일반(비익명) 로그인 세션이 있으면 이름·휴대폰 인증이 "로그인된 그 계정"의 프로필에 저장되고
  //    새 계정은 빈 프로필로 만들어지는 결함이 확인됐다(관리자로 로그인한 채 가입 테스트 → 관리자 계정의 이름·번호가 덮어써짐).
  //    가입에서는 익명 세션만 허용한다.
  async function ensureSignupSession(forSignup = false): Promise<'ok' | 'logged_in' | 'error'> {
    const { data: { session: current } } = await supabase.auth.getSession()
    if (forSignup && current && !current.user.is_anonymous) return 'logged_in'
    if (!current) {
      const { error } = await supabase.auth.signInAnonymously()
      if (error) return 'error'
    }
    try {
      await rpc.ensureUserProfile()
    } catch {
      // user_profiles 보정 실패해도 가입 자체는 막지 않음 — performSignUp()에서도 재시도됨
    }
    return 'ok'
  }

  const LOGGED_IN_SIGNUP_MSG = '이미 로그인된 상태예요. 로그아웃한 뒤 회원가입을 진행해주세요.'


  // ── 전화 인증번호 발송 (Solapi SMS 실연동 — /account/profile 휴대폰 인증과 동일 API 재사용) ──
  async function handleSendOtp() {
    errorMsg = null
    const cleaned = phone.replace(/\D/g, '')
    if (!/^010\d{8}$/.test(cleaned)) {
      errorMsg = '올바른 휴대폰 번호를 입력해주세요. (예: 01012345678)'
      return
    }
    isSendingOtp = true
    try {
      // 휴대폰 번호 중복 조회
      // 서버 함수로 판정 — 브라우저 세션은 남의 프로필을 읽을 수 없어 직접 조회로는 중복을 찾지 못한다(하이픈 저장 번호도 함께 비교)
      const { data: existing, error: dupErr } = await supabase.rpc('check_phone_registered', { p_phone: cleaned } as never) // 이메일 확인(check_email_registered)과 같은 호출 방식
      if (dupErr) {
        errorMsg = '휴대폰 번호 확인에 실패했습니다. 잠시 후 다시 시도해주세요.'
        return
      }
      if (existing) {
        csToast.warning('이미 가입된 휴대폰 번호입니다.')
        return
      }

      const ready = await ensureSignupSession(true)
      if (ready === 'logged_in') {
        errorMsg = LOGGED_IN_SIGNUP_MSG
        return
      }
      if (ready !== 'ok') {
        errorMsg = '인증 세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.'
        return
      }
      // context: 'signup' — 서버가 이 값을 보고 dev 환경 SMS 미발송 우회를 건너뛴다
      // (Stephen 지시, 2026-09-11: 회원가입 화면은 로컬에서도 실제 문자 발송 검증 필요).
      // /account/profile 등 이 필드를 안 보내는 다른 호출부는 기존 dev 우회 그대로 유지.
      const res = await fetch('/api/profile/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: cleaned, context: 'signup' }),
      })
      const data = await res.json() as { ok: boolean; error?: string; devCode?: string }
      if (!data.ok) {
        errorMsg = data.error ?? '인증번호 발송에 실패했습니다.'
        return
      }
      otpSent = true
      startOtpTimer()
      csToast.success('인증번호가 발송됐습니다.')
      // 개발 환경 바이패스: 서버가 devCode를 내려주면 자동 입력
      if (data.devCode) verifyCode = data.devCode
      focusById('su-code') // 발송 직후 인증번호 입력란으로 이동
    } catch {
      errorMsg = '네트워크 오류가 발생했습니다.'
    } finally {
      isSendingOtp = false
    }
  }

  // ── 인증번호 확인 ([인증 확인] 버튼 — 기존회원 인증과 같은 구성) ──
  // 같은 RPC(verify_and_update_phone)를 가입 완료 전에 미리 호출한다. 성공하면 otpVerified로 기억해 가입 완료 때 다시 확인하지 않는다
  // ([인증 확인]을 누르지 않고 가입 완료를 눌러도 기존처럼 그때 확인한다).
  async function handleVerifyOtp() {
    errorMsg = null
    if (!otpSent) { errorMsg = '인증번호를 먼저 발송해주세요.'; return }
    if (!/^\d{6}$/.test(verifyCode.trim())) { errorMsg = '인증번호 6자리를 입력해주세요.'; return }
    isVerifyingOtp = true
    try {
      const cleaned = phone.replace(/\D/g, '')
      const { data, error } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: { ok: boolean; error?: string } | null; error: { message: string } | null }>)(
        'verify_and_update_phone',
        { p_phone: cleaned, p_code: verifyCode.trim() },
      )
      if (error || !data?.ok) {
        errorMsg = data?.error ?? '인증번호가 올바르지 않거나 만료되었습니다.'
        return
      }
      otpVerified = true
      stopOtpTimer()
      csToast.success('휴대폰 인증이 완료됐습니다.')
    } catch {
      errorMsg = '네트워크 오류가 발생했습니다.'
    } finally {
      isVerifyingOtp = false
    }
  }

  // 서버에 이메일 확정 요청(최대 2회) — 성공(ok:true)일 때만 true
  async function finalizeSignupOnServer(): Promise<boolean> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch('/api/auth/confirm-verified-signup', { method: 'POST' })
        const data = await res.json() as { ok?: boolean }
        if (res.ok && data.ok) return true
      } catch {
        // 네트워크 오류 — 다시 시도
      }
    }
    return false
  }

  // 로그인된 상태로 랜딩 — 서버가 이메일을 확정한 뒤에도 브라우저가 들고 있는 토큰은 가입 전(익명·이메일 없음) 내용이라
  // GNB가 게스트로 보고 서버도 비회원으로 읽는다. 토큰을 새로 받아 로그인 계정(is_anonymous=false·이메일 포함)으로 맞추고,
  // 그래도 익명이면 방금 만든 이메일·비밀번호로 직접 로그인한다.
  async function landAfterSignup(): Promise<void> {
    try {
      const { data: refreshed } = await supabase.auth.refreshSession()
      const user = refreshed.session?.user
      if (!user || user.is_anonymous || !user.email) {
        await performSignIn(email, password)
      }
    } catch {
      try {
        await performSignIn(email, password)
      } catch {
        // 로그인까지 실패해도 가입은 완료된 상태 — 이동 후 로그인 화면에서 다시 로그인할 수 있다
      }
    }
  }

  // ── 회원가입 최종 완료 ──
  async function handleSignUp() {
    errorMsg = null
    // 계정 전환은 끝났고 서버의 이메일 확정만 실패했던 경우 — 마무리만 다시 시도한다
    if (signupFinalizePending) {
      isLoading = true
      try {
        if (!(await finalizeSignupOnServer())) {
          errorMsg = '가입 마무리에 실패했습니다. 잠시 후 [가입 완료]를 다시 눌러주세요.'
          return
        }
        await landAfterSignup()
        reset()
        onsuccess()
      } finally {
        isLoading = false
      }
      return
    }
    if (!otpSent) {
      errorMsg = '인증번호를 먼저 발송해주세요.'
      return
    }
    if (!verifyCode) {
      errorMsg = '인증번호를 입력해주세요.'
      return
    }

    const trimmedName = fullName.trim()
    if (!trimmedName) {
      errorMsg = '성함을 입력해주세요.'
      return
    }

    isLoading = true
    try {
      const cleaned = phone.replace(/\D/g, '')

      // 가입 확정 직전에도 일반 로그인 세션이 아닌지 확인 — 이름·인증이 엉뚱한 계정에 저장되는 것을 막는다
      const { data: { session: nowSession } } = await supabase.auth.getSession()
      if (nowSession && !nowSession.user.is_anonymous) {
        errorMsg = LOGGED_IN_SIGNUP_MSG
        return
      }

      // 성함 저장 — 이름 없는 가입을 막기 위해 가입 확정(인증번호 소진·계정 전환)보다 "먼저" 저장하고,
      // 실패하면 여기서 중단한다(인증번호는 아직 쓰이지 않아 같은 화면에서 다시 시도할 수 있다).
      // 인증 단계에 들어온 시점에 익명 세션과 프로필 행이 이미 있고(ensureSignupSession), 익명→영구 전환은
      // 같은 UID를 유지하므로 저장한 이름이 그대로 이어진다. 마이페이지 이름 수정과 동일한 update_user_profile RPC
      // (email·생일은 null = 변경 없음).
      // 프로필 행 보정 1회 재시도 — ensureSignupSession은 프로필 생성 실패를 삼키므로, 행이 없으면 이름 저장이
      // "프로필을 찾을 수 없습니다"로 실패해 가입이 막힐 수 있다. ensure_user_profile은 이미 있으면 안전(멱등)하고,
      // 여기서 실패해도 아래 이름 저장 결과로 판단하므로 오류는 무시한다.
      try {
        await rpc.ensureUserProfile()
      } catch {
        // 아래 이름 저장 결과로 최종 판단
      }
      const { data: nameData, error: nameErr } = await (supabase.rpc as unknown as (
        fn: string,
        args: Record<string, unknown>,
      ) => Promise<{ data: { ok: boolean } | null; error: { message: string } | null }>)(
        'update_user_profile',
        { p_full_name: trimmedName, p_email: null, p_birth_date: null },
      )
      if (nameErr || !nameData?.ok) {
        errorMsg = '성함 저장에 실패했습니다. 잠시 후 다시 시도해주세요.'
        return
      }

      // supabase-js rpc() 제네릭 오버로드 추론 이슈로 로컬 캐스트 필요(기존 관례,
      // ProductHeroModal.svelte 등과 동일 패턴) — database.ts에 타입 자체는 등록돼 있음
      // [인증 확인]으로 이미 확인했다면 같은 인증번호를 다시 쓰지 않는다(otpVerified)
      if (!otpVerified) {
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
      }

      await performSignUp(email, password)

      // 가입 마무리 — 서버가 대기 중인 이메일을 계정에 확정한다. 실패하면 가입 완료로 보지 않고 안내한다(2026-10-24:
      // 예전엔 실패를 조용히 넘겨 이메일이 계정·프로필에 없는 회원이 생겼다). 이미 계정 전환은 끝났으므로 다시 누르면 마무리만 재시도한다.
      signupFinalizePending = true
      if (!(await finalizeSignupOnServer())) {
        errorMsg = '가입 마무리에 실패했습니다. 잠시 후 [가입 완료]를 다시 눌러주세요.'
        return
      }
      await landAfterSignup()
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
  // ── 아이디 찾기: 이름·휴대폰이 모두 입력되면 일치 계정 여부를 자동 확인해 토스트로 알린다(문자 발송 없음) ──
  let findCheckTimer: ReturnType<typeof setTimeout> | null = null
  let findCheckedKey = ''
  $effect(() => {
    const nm = findName.trim()
    const digits = findPhone.replace(/\D/g, '')
    if (findCheckTimer) { clearTimeout(findCheckTimer); findCheckTimer = null }
    if (mode !== 'find-email' || nm.length < 2 || !/^010\d{8}$/.test(digits)) { findCheckedKey = ''; return }
    const key = `${nm}|${digits}`
    if (key === findCheckedKey) return
    findCheckTimer = setTimeout(async () => {
      try {
        const res = await fetch('/api/auth/find-email/check', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: nm, phone: digits }),
        })
        const data = await res.json() as { ok: boolean; matched?: boolean; error?: string }
        if (`${findName.trim()}|${findPhone.replace(/\D/g, '')}` !== key) return // 확인 중 입력이 바뀌었으면 결과 무시
        findCheckedKey = key
        if (!data.ok) csToast.warning(data.error ?? '확인에 실패했어요. 잠시 후 다시 시도해 주세요.')
        else if (data.matched) csToast.success('인증번호 입력 후 동일인 확인 가능합니다.')
        else csToast.warning('입력하신 이름과 휴대폰 정보가 일치하는 계정을 찾을 수 없어요.')
      } catch {
        csToast.warning('네트워크 오류가 발생했습니다.')
      }
    }, 600)
    return () => { if (findCheckTimer) { clearTimeout(findCheckTimer); findCheckTimer = null } }
  })

  async function handleFindSendOtp() {
    errorMsg = null
    if (!findNameOk) {
      csToast.warning('이름을 입력해주세요.')
      focusById('su-find-name')
      return
    }
    const cleaned = findPhone.replace(/\D/g, '')
    if (!/^010\d{8}$/.test(cleaned)) {
      csToast.warning('올바른 휴대폰 번호를 입력해주세요. (예: 01012345678)')
      return
    }
    isSendingFindOtp = true
    try {
      const ready = await ensureSignupSession()
      if (ready !== 'ok') {
        csToast.warning('인증 세션 생성에 실패했습니다. 잠시 후 다시 시도해주세요.')
        return
      }
      const res = await fetch('/api/auth/find-email/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: findName.trim(), phone: cleaned }),
      })
      const data = await res.json() as { ok: boolean; error?: string; devCode?: string }
      if (!data.ok) {
        csToast.warning(data.error ?? '인증번호 발송에 실패했습니다.')
        focusById('su-find-phone')
        return
      }
      findOtpSent = true
      csToast.success('인증번호를 문자로 보냈어요.')
      if (data.devCode) findCode = data.devCode
      focusById('su-find-code')
    } catch {
      csToast.warning('네트워크 오류가 발생했습니다.')
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
        body: JSON.stringify({ name: findName.trim(), phone: findPhone.replace(/\D/g, ''), code: findCode }),
      })
      const data = await res.json() as { ok: boolean; email?: string; error?: string }
      if (!data.ok) {
        errorMsg = data.error ?? '아이디를 찾을 수 없습니다.'
        focusById('su-find-code')
        return
      }
      foundEmail = data.email ?? null
    } catch {
      errorMsg = '네트워크 오류가 발생했습니다.'
    } finally {
      isFinding = false
    }
  }

  // ── 비밀번호 재설정 입력 — 한글(비ASCII) 차단 + 경고 토스트 (front-uiux.md §21 로그인 입력폼 표준, 2026-10-23) ──
  // 필드별 독립 debounce 플래그(3초 내 재경고 안 함) — 다른 필드 경고와 섞이지 않게 분리
  const resetKoreanWarned: Record<'email' | 'pw' | 'pw2', boolean> = { email: false, pw: false, pw2: false }
  function warnResetKorean(field: 'email' | 'pw' | 'pw2', message: string) {
    if (resetKoreanWarned[field]) return
    resetKoreanWarned[field] = true
    csToast.warning(message)
    setTimeout(() => { resetKoreanWarned[field] = false }, 3000)
  }

  // ── 비밀번호 재설정(문자 인증번호) ──
  async function resetRequest<T>(url: string, payload: Record<string, unknown>): Promise<T | null> {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return (await res.json()) as T
    } catch {
      errorMsg = '네트워크 오류가 발생했습니다.'
      return null
    }
  }

  // 모달이 사라질 때 대기 중인 이메일 확인 타이머 정리
  $effect(() => () => { if (resetEmailTimer) { clearTimeout(resetEmailTimer); resetEmailTimer = null } })

  // 이메일 입력 즉시(0.6초 입력 멈춤 후) 가입 여부 확인 — 가입된 이메일이면 휴대폰·인증번호 영역을 활성화한다
  function handleResetEmailInput() {
    resetEmailRegistered = null
    resetEmailChecking = false
    pendingFocusResetPhone = false // 이메일을 다시 고치면 대기 중이던 이동 취소
    if (resetStep !== 'info') { resetStep = 'info'; resetCode = '' }
    if (resetEmailTimer) { clearTimeout(resetEmailTimer); resetEmailTimer = null }
    const val = resetEmail.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val)) return
    resetEmailChecking = true
    resetEmailTimer = setTimeout(async () => {
      const { data, error } = await supabase.rpc('check_email_registered', { p_email: val } as never)
      if (resetEmail.trim() !== val) return // 그 사이 이메일이 바뀜 — 오래된 응답 무시
      resetEmailChecking = false
      if (error) { resetEmailRegistered = null; pendingFocusResetPhone = false; csToast.warning('이메일 확인에 실패했습니다. 잠시 후 다시 시도해주세요.'); return }
      if (data) {
        resetEmailRegistered = true
        csToast.warning('기존 계정정보가 확인되었습니다.')
      } else {
        resetEmailRegistered = false
        csToast.warning('가입된 이메일이 아닙니다.')
      }
    }, 600)
  }

  // 1단계: 이메일 + 휴대폰 번호가 같은 계정이면 인증번호 문자 발송
  async function handleResetSendOtp() {
    errorMsg = null
    const email = resetEmail.trim()
    const cleaned = resetPhone.replace(/\D/g, '')
    if (!email) { errorMsg = '이메일 주소를 입력해주세요.'; return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorMsg = '올바른 이메일 형식이 아닙니다.'; return }
    if (!/^010\d{8}$/.test(cleaned)) { errorMsg = '올바른 휴대폰 번호를 입력해주세요. (예: 01012345678)'; return }
    isResetting = true
    try {
      const data = await resetRequest<{ ok: boolean; error?: string; devCode?: string; code?: string }>('/api/auth/password-reset/send-otp', { email, phone: cleaned })
      if (!data) { focusById('su-reset-phone'); return }
      if (!data.ok && data.code === 'admin_account') { csToast.warning('관리자계정은 CMS를 통해 수정하세요.'); focusById('su-reset-phone'); return }
      if (!data.ok) { errorMsg = data.error ?? '인증번호 발송에 실패했습니다.'; focusById('su-reset-phone'); return }
      resetStep = 'code'
      resetCode = data.devCode ?? ''
      focusById('su-reset-code')
    } finally {
      isResetting = false
    }
  }

  // 2단계: 인증번호 확인
  async function handleResetVerify() {
    errorMsg = null
    if (!/^\d{6}$/.test(resetCode.trim())) { errorMsg = '인증번호 6자리를 입력해주세요.'; return }
    isResetting = true
    resetVerifying = true
    try {
      const data = await resetRequest<{ ok: boolean; error?: string; token?: string }>('/api/auth/password-reset/verify-otp', {
        email: resetEmail.trim(),
        phone: resetPhone.replace(/\D/g, ''),
        code: resetCode.trim(),
      })
      if (!data) { focusById('su-reset-code'); return }
      if (!data.ok || !data.token) { errorMsg = data.error ?? '인증번호가 올바르지 않습니다.'; focusById('su-reset-code'); return }
      resetToken = data.token
      resetStep = 'newpw'
    } finally {
      isResetting = false
      resetVerifying = false
    }
  }

  // 3단계: 새 비밀번호 설정
  async function handleResetComplete() {
    errorMsg = null
    const pwViolation = resetPasswordViolation(resetNewPw)
    if (pwViolation) { errorMsg = pwViolation; focusById('su-reset-newpw'); return }
    if (resetNewPw !== resetNewPw2) { errorMsg = '비밀번호가 일치하지 않습니다.'; focusById('su-reset-newpw2'); return }
    if (!resetToken) { errorMsg = '인증 정보가 없습니다. 처음부터 다시 진행해주세요.'; return }
    isResetting = true
    try {
      const data = await resetRequest<{ ok: boolean; error?: string }>('/api/auth/password-reset/complete', { token: resetToken, password: resetNewPw })
      if (!data) return
      if (!data.ok) { errorMsg = data.error ?? '비밀번호를 바꾸지 못했습니다.'; return }
      resetNewPw = ''
      resetNewPw2 = ''
      resetToken = null
      resetStep = 'done'
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

<!-- 아이디/비밀번호 찾기 탭 — 두 화면 상단에 공통 배치(전환해도 각 화면에 입력하던 값은 유지) -->
{#snippet findTabs()}
  <div class="su-tabs" role="tablist" aria-label="아이디·비밀번호 찾기">
    <button
      type="button"
      role="tab"
      class="su-tab"
      class:su-tab-active={mode === 'find-email'}
      aria-selected={mode === 'find-email'}
      onclick={() => { if (mode !== 'find-email') { mode = 'find-email'; errorMsg = null } }}
    >아이디</button>
    <button
      type="button"
      role="tab"
      class="su-tab"
      class:su-tab-active={mode === 'reset-pw'}
      aria-selected={mode === 'reset-pw'}
      onclick={() => { if (mode !== 'reset-pw') { mode = 'reset-pw'; errorMsg = null } }}
    >비밀번호</button>
  </div>
{/snippet}

{#if open}
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div
  class="su-overlay"
  role="dialog"
  aria-modal="true"
  aria-label={mode === 'login' ? '로그인' : mode === 'find-email' ? '아이디 찾기' : mode === 'reset-pw' ? '비밀번호 재설정' : '회원가입'}
  tabindex="-1"
  onclick={handleOverlayClick}
  onkeydown={handleKeydown}
>
  <div class="su-modal">
    <!-- 헤더 -->
    <div class="su-header">
      <span class="su-title">{mode === 'login' ? 'Login' : mode === 'find-email' ? 'Confirm ID' : mode === 'reset-pw' ? 'Password Reset' : 'Sign Up'}</span>
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
        <div class="su-group su-group-signup">
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
        <div class="su-group su-group-signup">

          <!-- 이메일 -->
          <div class="su-field">
            <input
              id="su-email"
              class="su-input"
              type="email"
              maxlength={EMAIL_MAX_LENGTH}
              placeholder="사용할 메일 아이디를 입력하세요."
              bind:value={email}
              autocomplete="email"
              enterkeyhint="next"
              oninput={onEmailInput}
              onkeydown={onSignupEmailEnter}
            />
          </div>

          <!-- 비밀번호 -->
          <p class="su-group-label su-group-label-center">영문, 숫자, 특수문자(@#%*)를 포함 <strong class="su-emph">8 ~ 16자</strong> 이내로 입력하세요.</p>
          <div class="su-field">
            <div class="su-input-wrap" onclick={() => { if (emailDuplicate) csToast.warning('이미 가입한 아이디입니다.') }}>
              <input
                id="su-pw"
                class="su-input"
                type={showPassword ? 'text' : 'password'}
                placeholder="비밀번호를 입력하세요."
                bind:value={password}
                autocomplete="new-password"
                maxlength={16}
                enterkeyhint="next"
                onkeydown={(e) => onSignupEnter(e, 'su-pw2')}
                disabled={!emailAvailable}
              />
              <button
                class="su-eye"
                type="button"
                disabled={!emailAvailable}
                onclick={(e) => { e.stopPropagation(); if (emailAvailable) showPassword = !showPassword }}
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
            <div class="su-input-wrap" onclick={() => { if (emailDuplicate) csToast.warning('이미 가입한 아이디입니다.') }}>
              <input
                id="su-pw2"
                class="su-input"
                type={showPasswordConfirm ? 'text' : 'password'}
                placeholder="비밀번호를 한 번 더 입력하세요"
                bind:value={passwordConfirm}
                autocomplete="new-password"
                maxlength={16}
                enterkeyhint="next"
                onkeydown={(e) => onSignupEnter(e, 'su-name')}
                disabled={!emailAvailable}
              />
              <button
                class="su-eye"
                type="button"
                disabled={!emailAvailable}
                onclick={(e) => { e.stopPropagation(); if (emailAvailable) showPasswordConfirm = !showPasswordConfirm }}
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

          <!-- 성함 — 비밀번호 확인이 일치하는 즉시 노출 -->
          {#if nameRevealed}
            <div class="su-field" transition:slide={{ duration: 200 }}>
              <input
                id="su-name"
                class="su-input"
                type="text"
                maxlength={FULL_NAME_MAX_LENGTH}
                placeholder="성함을 입력해주세요."
                bind:value={fullName}
                autocomplete="name"
                aria-label="성함"
                enterkeyhint="next"
                onkeydown={(e) => onSignupEnter(e, null)}
              />
            </div>
          {/if}
        </div>


        <button class="su-cta" type="button" onclick={handleNextStep} disabled={!canProceed}>
          다음 단계 →
        </button>

        <button class="su-switch-mode" type="button" onclick={openSupportChat}>
          <span>고객채팅 문의하기</span>
        </button>

      {:else}
        <!-- ── 인증 그룹 ── -->
        <div class="su-group su-group-signup">
          <p class="su-group-label">휴대폰 인증</p>

          <!-- 기존회원 인증(LegacyMemberVerifyModal)과 같은 구성: 라벨 없이 placeholder, 휴대폰 행 [인증번호 받기], 인증번호 행 [인증 확인] (2026-10-23) -->
          <div class="su-field">
            <div class="su-phone-row">
              <input
                id="su-phone"
                class="su-input su-phone-input"
                type="tel"
                placeholder="010-0000-0000"
                aria-label="휴대폰 번호"
                value={phone}
                disabled={otpVerified}
                enterkeyhint="send"
                onkeydown={(e) => { onTabTo(e, 'su-code'); onEnterRun(e, () => { if (!isSendingOtp && !otpVerified) void handleSendOtp() }) }}
                oninput={(e) => { phone = formatPhoneWithHyphen((e.currentTarget as HTMLInputElement).value); (e.currentTarget as HTMLInputElement).value = phone }}
              />
              <button
                class="su-otp-btn"
                type="button"
                onclick={handleSendOtp}
                disabled={isSendingOtp || otpVerified}
              >
                {isSendingOtp ? '발송 중...' : '인증번호 받기'}
              </button>
            </div>
          </div>

          <div class="su-field">
            <div class="su-phone-row">
              <input
                id="su-code"
                class="su-input su-phone-input"
                type="tel"
                inputmode="numeric"
                placeholder={codeGuide}
                aria-label="인증번호"
                value={verifyCode}
                maxlength={6}
                disabled={!otpSent || otpVerified}
                enterkeyhint="go"
                onkeydown={(e) => onEnterRun(e, () => { if (otpSent && !otpVerified && verifyCode.length === 6 && !otpExpired && !isVerifyingOtp) void handleVerifyOtp() })}
                onfocus={() => { codeFocused = true }}
                onblur={() => { codeFocused = false }}
                oninput={(e) => {
                  const el = e.currentTarget as HTMLInputElement
                  el.value = el.value.replace(/[^0-9]/g, '').slice(0, 6)
                  verifyCode = el.value
                }}
              />
              <button
                class="su-otp-btn su-otp-btn-confirm"
                type="button"
                onclick={handleVerifyOtp}
                disabled={isVerifyingOtp || otpVerified || !otpSent || otpExpired || verifyCode.length !== 6}
              >
                {#if isVerifyingOtp}
                  확인 중...
                {:else if otpVerified}
                  인증 완료 ✓
                {:else}
                  인증 확인
                {/if}
              </button>
            </div>
          </div>
        </div>


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
          {@render findTabs()}
          <!-- 비밀번호 찾기와 동일한 배치: 안내 문구(가운데·레드 강조) → 첫 입력란(이름) → 휴대폰 행 [인증번호 받기] → 인증번호 행 [인증 확인] (2026-10-24) -->
          <div class="su-group su-group-signup">
            <p class="su-group-label su-group-label-center">가입된 <strong class="su-emph">이름, 휴대폰 정보</strong>가 동일해야<br class="su-br-m" /> 아이디(이메일)를 알려드립니다.</p>
            <div class="su-field">
              <input
                id="su-find-name"
                class="su-input"
                type="text"
                placeholder="이름을 입력해 주세요."
                aria-label="이름"
                autocomplete="name"
                maxlength={FULL_NAME_MAX_LENGTH}
                bind:value={findName}
                disabled={isSendingFindOtp || isFinding}
                enterkeyhint="next"
                oninput={() => { findOtpSent = false; findCode = '' }}
                onkeydown={(e) => onSignupEnter(e, 'su-find-phone')}
              />
            </div>
            <div class="su-field">
              <div class="su-phone-row">
                <input
                  id="su-find-phone"
                  class="su-input su-phone-input"
                  type="tel"
                  placeholder="01012345678"
                  aria-label="휴대폰 번호"
                  value={findPhone}
                  disabled={isSendingFindOtp || isFinding || !findNameOk}
                  enterkeyhint="send"
                  onkeydown={(e) => { onTabTo(e, 'su-find-code'); onEnterRun(e, () => { if (!isSendingFindOtp && !isFinding) void handleFindSendOtp() }) }}
                  oninput={(e) => { findPhone = formatPhoneWithHyphen((e.currentTarget as HTMLInputElement).value); (e.currentTarget as HTMLInputElement).value = findPhone; findOtpSent = false; findCode = '' }}
                />
                <button class="su-otp-btn" type="button" onclick={handleFindSendOtp} disabled={isSendingFindOtp || isFinding || !findNameOk}>
                  {isSendingFindOtp ? '발송 중...' : '인증번호 받기'}
                </button>
              </div>
              {#if findOtpSent}
                <p class="su-otp-hint">📱 인증번호가 발송되었습니다. (3분 이내 입력)</p>
              {/if}
            </div>
            <div class="su-field">
              <div class="su-phone-row">
                <input
                  id="su-find-code"
                  class="su-input su-phone-input"
                  type="tel"
                  inputmode="numeric"
                  placeholder="인증번호 입력"
                  aria-label="인증번호"
                  bind:value={findCode}
                  maxlength={6}
                  disabled={!findNameOk || !findOtpSent || isFinding}
                  enterkeyhint="go"
                  onkeydown={(e) => onEnterRun(e, () => { if (findOtpSent && findCode.length === 6 && !isFinding) void handleFindEmail() })}
                  oninput={(e) => {
                    const el = e.currentTarget as HTMLInputElement
                    el.value = el.value.replace(/[^0-9]/g, '').slice(0, 6)
                    findCode = el.value
                  }}
                />
                <button
                  class="su-otp-btn su-otp-btn-confirm"
                  type="button"
                  onclick={handleFindEmail}
                  disabled={isFinding || !findOtpSent || findCode.length !== 6}
                >
                  {isFinding ? '확인 중...' : '인증 확인'}
                </button>
              </div>
            </div>
          </div>

        {:else}
          <div class="su-result-box">
            <p class="su-result-label">가입된 아이디(이메일)</p>
            <p class="su-result-email">{foundEmail}</p>
          </div>
          <button class="su-cta" type="button" onclick={goToLoginPage}>로그인하기</button>
        {/if}

        <!-- 계정을 못 찾는 경우의 도움 경로 — 모달을 닫고 공통 고객 채팅을 연다(비로그인은 기존 채팅 계정 로직 그대로) -->
        <button class="su-switch-mode" type="button" onclick={openSupportChat}>
          <span>고객채팅 문의하기</span>
        </button>

      {:else if mode === 'reset-pw'}
        <!-- ── 비밀번호 재설정(문자 인증번호) ── -->
        {#if resetStep === 'info' || resetStep === 'code'}
          {@render findTabs()}
          <!-- 기존회원 인증(LegacyMemberVerifyModal) 입력 배치와 동일: 라벨 없이 placeholder, 휴대폰 행 [인증번호 받기], 인증번호 행 [인증 확인]을 한 화면에 항상 노출(2026-10-23) -->
          <div class="su-group su-group-signup">
            <p class="su-group-label su-group-label-center">가입된 <strong class="su-emph">아이디, 휴대폰 정보</strong>가<br class="su-br-m" /> 동일해야 인증번호가 발송됩니다.</p>
            <div class="su-field">
              <input
                id="su-reset-email"
                class="su-input"
                type="email"
                placeholder="이메일(아이디)을 입력해주세요"
                aria-label="이메일"
                bind:value={resetEmail}
                autocomplete="email"
                inputmode="email"
                disabled={isResetting}
                maxlength={254}
                enterkeyhint="next"
                onkeydown={onResetEmailEnter}
                oninput={(e) => {
                  const el = e.currentTarget as HTMLInputElement
                  const filtered = el.value.replace(/[^\u0020-\u007E]/g, '')
                  if (el.value !== filtered) {
                    el.value = filtered
                    warnResetKorean('email', '영문(숫자) 메일 형식으로 입력하세요.')
                  }
                  resetEmail = el.value
                  handleResetEmailInput()
                }}
              />
            </div>
            <div class="su-field">
              <div class="su-phone-row">
                <input
                  id="su-reset-phone"
                  class="su-input su-phone-input"
                  type="tel"
                  placeholder="01012345678"
                  aria-label="휴대폰 번호"
                  value={resetPhone}
                  enterkeyhint="send"
                  onkeydown={(e) => { onTabTo(e, 'su-reset-code'); onEnterRun(e, () => { if (resetEmailRegistered && !isResetting) void handleResetSendOtp() }) }}
                  oninput={(e) => { resetPhone = formatPhoneWithHyphen((e.currentTarget as HTMLInputElement).value); (e.currentTarget as HTMLInputElement).value = resetPhone }}
                  disabled={isResetting || !resetEmailRegistered}
                />
                <button class="su-otp-btn" type="button" onclick={handleResetSendOtp} disabled={isResetting || !resetEmailRegistered}>
                  {isResetting && !resetVerifying ? '발송 중...' : '인증번호 받기'}
                </button>
              </div>
              {#if resetStep === 'code'}
                <p class="su-otp-hint">📱 인증번호가 발송되었습니다. (3분 이내 입력)</p>
              {/if}
            </div>
            <div class="su-field">
              <div class="su-phone-row">
                <input
                  id="su-reset-code"
                  class="su-input su-phone-input"
                  type="tel"
                  inputmode="numeric"
                  placeholder="인증번호 입력"
                  aria-label="인증번호"
                  bind:value={resetCode}
                  maxlength={6}
                  disabled={isResetting || !resetEmailRegistered}
                  enterkeyhint="go"
                  onkeydown={(e) => onEnterRun(e, () => { if (resetStep === 'code' && resetCode.length === 6 && !isResetting) void handleResetVerify() })}
                  oninput={(e) => {
                    const el = e.currentTarget as HTMLInputElement
                    el.value = el.value.replace(/[^0-9]/g, '').slice(0, 6)
                    resetCode = el.value
                  }}
                />
                <button
                  class="su-otp-btn su-otp-btn-confirm"
                  type="button"
                  onclick={handleResetVerify}
                  disabled={isResetting || resetStep !== 'code' || resetCode.length !== 6}
                >
                  {isResetting && resetVerifying ? '확인 중...' : '인증 확인'}
                </button>
              </div>
            </div>
          </div>

        {:else if resetStep === 'newpw'}
          <div class="su-group su-group-signup">
            <p class="su-group-label su-group-label-center">영문, 숫자, 특수문자(@#%*)를 포함 <strong class="su-emph">8 ~ 16자</strong> 이내로 입력하세요.</p>
            <div class="su-field">
              <input
                id="su-reset-newpw"
                class="su-input"
                aria-label="새 비밀번호"
                type="password"
                placeholder="최소 6자 이상 입력하세요."
                bind:value={resetNewPw}
                autocomplete="new-password"
                maxlength={16}
                enterkeyhint="next"
                onkeydown={(e) => { onTabTo(e, 'su-reset-newpw2'); onEnterRun(e, () => focusById('su-reset-newpw2')) }}
                oninput={(e) => {
                  const el = e.currentTarget as HTMLInputElement
                  const hadNonAscii = /[^\x00-\x7F]/.test(el.value)
                  el.value = el.value.replace(/[^\x21-\x7E]/g, '')
                  if (hadNonAscii) warnResetKorean('pw', '영문(숫자)으로 입력하세요.')
                  resetNewPw = el.value
                }}
              />
            </div>
            <div class="su-field">
              <input
                id="su-reset-newpw2"
                class="su-input"
                aria-label="새 비밀번호 확인"
                type="password"
                placeholder="한번 더 확인 입력하세요."
                bind:value={resetNewPw2}
                autocomplete="new-password"
                maxlength={16}
                enterkeyhint="go"
                onkeydown={(e) => onEnterRun(e, () => { if (!isResetting) void handleResetComplete() })}
                oninput={(e) => {
                  const el = e.currentTarget as HTMLInputElement
                  const hadNonAscii = /[^\x00-\x7F]/.test(el.value)
                  el.value = el.value.replace(/[^\x21-\x7E]/g, '')
                  if (hadNonAscii) warnResetKorean('pw2', '영문(숫자)으로 입력하세요.')
                  resetNewPw2 = el.value
                }}
              />
            </div>
          </div>


          <button class="su-cta" type="button" onclick={handleResetComplete} disabled={isResetting} aria-busy={isResetting}>
            {isResetting ? '변경 중...' : '비밀번호 변경'}
          </button>
        {:else}
          <div class="su-result-box">
            <p class="su-result-label">✅ 비밀번호가 변경되었습니다</p>
            <p class="su-result-desc">새 비밀번호로 로그인해주세요.</p>
          </div>
          <button class="su-cta" type="button" onclick={goToLoginPage}>로그인하기</button>
        {/if}

        {#if resetStep !== 'done'}
          <button class="su-switch-mode" type="button" onclick={openSupportChat}>
            <span>고객채팅 문의하기</span>
          </button>
        {/if}

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
  /* 안내 문구 강조(레드 토큰 + 한 단계 굵게 900) — 2026-10-24 Stephen 지시 */
  .su-emph { color: var(--cs-red-badge); font-weight: 900; }
  .su-br-m { display: none; } /* 모바일에서만 줄바꿈 */
  @media (max-width: 640px) { .su-br-m { display: inline; } }
  .su-group-label-center { text-align: center; } /* 비밀번호 찾기 안내 문구 중앙 정렬(2026-10-24, Stephen 지시) */

  /* 아이디/비밀번호 찾기 탭 — 단순 텍스트 탭: 배경·알약 없음, 활성은 진한 글자(900)+아래 바, 비활성은 연한 글자, 호버는 글자색만 */
  .su-tabs {
    position: relative;
    display: flex;
    justify-content: center;
    gap: 84px;
    margin-bottom: 10px; /* 탭 ↔ 아래 영역 여백 20px → 30px(+50%, 본문 gap 20px + 10px) */
  }
  /* 탭 줄 전체 폭 구분선 — 1px 매우 옅은 그레이(면), 활성 바(3px)는 이 위에 겹쳐 보인다 */
  .su-tabs::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 1px;
    background: var(--cs-border);
    opacity: 0.6;
  }
  .su-tab {
    position: relative;
    min-height: 44px;
    padding: 0 4px;
    border: none;
    background: transparent;
    color: var(--cs-text-light);
    font: var(--text-pc-title-16);
    font-weight: 700;
    cursor: pointer;
    transition: color 0.15s;
  }
  .su-tab-active { color: var(--cs-text); font-weight: 900; }
  /* 활성 탭 아래 바 — 선(border)이 아니라 면(fill)으로 표현 */
  .su-tab-active::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    border-radius: var(--radius-full);
    background: var(--cs-purple-dark);
    z-index: 1;
  }
  /* 모바일: 탭 글자 한 단계 작게(16→14px) */
  @media (max-width: 640px) {
    .su-tabs { gap: 50px; } /* PC 84px × 0.6 (모바일 비율) */
    .su-tab { font: var(--text-m-script-14B); }
    .su-tab-active { font-weight: 900; }
  }
  .su-tab:not(.su-tab-active):hover { color: var(--cs-text-mid); }

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
    border-radius: var(--radius-xl); /* 입력폼 30px — 인증 버튼(30px)과 같은 알약 모양(2026-10-23, Stephen 확정) */
    padding: 13px 16px 13px var(--spacing-6); /* 좌측 24px — 30px 알약 곡선에서 글자가 떨어지도록(2026-10-23) */
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
  .su-input:disabled { opacity: 0.5; cursor: not-allowed; pointer-events: none; }
  .su-input-wrap { cursor: default; }

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
    align-items: center;
    gap: 8px;
  }
  .su-phone-input {
    flex: 1;
  }
  /* 인증 버튼 — front-uiux.md §5 보조 버튼(.cs-btn-secondary) 규격(2026-10-23): 30px 반경·16px Bold·--cs-purple,
     PC 높이 50px/패딩 0 30px, 모바일(≤640px) 44px/0 20px. 인증번호 받기·인증 확인 두 버튼은 같은 최소 가로폭으로 통일 */
  .su-otp-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 50px;
    padding: 0 30px;
    min-width: 164px;
    box-sizing: border-box;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    font: var(--text-pc-title-16);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, opacity 0.15s;
    flex-shrink: 0;
  }
  .su-otp-btn:disabled { background: var(--cs-text-light); cursor: default; } /* 비활성: 반투명 보라 → 그레이 토큰(2026-10-23) */
  .su-otp-btn:not(:disabled):hover { background: var(--cs-purple-hover); }
  /* '인증 확인' 버튼: 활성 시 짙은 그레이(--cs-text-dark), 호버는 배경색만 --cs-dark로(테두리·그림자 추가 금지). 비활성은 위 .su-otp-btn:disabled 그대로(2026-10-24, Stephen 지시) */
  .su-otp-btn-confirm { background: var(--cs-text-dark); }
  .su-otp-btn-confirm:not(:disabled):hover { background: var(--cs-dark); }
  @media (max-width: 640px) {
    .su-otp-btn { height: 44px; padding: 0 12px; width: 120px; min-width: 120px; font: var(--text-m-script-14B); } /* 모바일 축소: 가로는 두 버튼 동일 120px 고정('인증번호 받기' 글자가 들어가는 폭, 2026-10-24 Stephen 지시), 높이는 터치 타겟 44px 유지, 글자 14px 그대로 */
  }
  /* PC 반응형(≥641px) 모달 안 모든 입력폼 그룹(로그인·회원가입 1단계·휴대폰 인증·아이디 찾기·비밀번호 찾기 + 새 비밀번호): 입력되는 글자만 사다리 두 단계 위로 14→16→18px(--text-pc-title-18, 2026-10-24, Stephen 지시).
     안내(placeholder) 글자는 기존 --text-pc-body-14 그대로 유지. 모바일·다른 모드(로그인·찾기·휴대폰 인증)는 변경 없음 */
  @media (min-width: 641px) {
    .su-group-signup .su-input { font: var(--text-pc-title-18); }
    .su-group-signup .su-input::placeholder { font: var(--text-pc-body-14); }
    /* 인증번호 받기·인증 확인 버튼(.su-otp-btn) 글자: 직전 18px에서 두 단계 아래 18→16→14px(--text-pc-body-14, 2026-10-24, Stephen 지시) — 굵기 700 그대로.
       입력폼 그룹(.su-group-signup)은 모달 안 모든 입력 단계가 공유한다.
       .su-cta(주 버튼)는 기본 규칙이 아래에 있어 그 뒤에 따로 18px로 둔다(같은 우선순위에서 뒤 규칙이 이김) */
    .su-otp-btn { font: var(--text-pc-body-14); }
    /* 입력 그룹 안내 문구(.su-group-label) 13px → 한 단계 위 14px(--text-pc-body-14, 2026-10-24, Stephen 지시) — 굵기 700·글자 간격은 기존 그대로, 모달 안 모든 안내 문구 공통 */
    .su-group-label { font: var(--text-pc-body-14); }
  }

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
  .su-cta:disabled { background: var(--cs-chat-in-bg); cursor: not-allowed; }
  .su-cta-flex { flex: 1; width: auto; }
  @media (min-width: 641px) {
    .su-cta { font: var(--text-pc-title-18); } /* 위 PC 블록의 .su-otp-btn과 같은 한 단계 상향(16→18px) */
  }

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
    /* 모바일 비율(PC의 약 0.6): 상단 바 높이 84→50px(닫기 터치 영역 44px 유지 + 위아래 3px), 제목 18→16px 한 단계, 닫기 아이콘 18→12px */
    .su-header { padding: 3px 14px 3px 20px; }
    .su-title { font-size: 16px; }
    .su-close svg { width: 12px; height: 12px; }
  }
</style>
