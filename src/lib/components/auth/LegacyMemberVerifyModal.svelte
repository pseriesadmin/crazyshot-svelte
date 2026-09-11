<script lang="ts">
  /**
   * LegacyMemberVerifyModal.svelte
   * 레거시 회원(SNS 로그인) 클레임 인증 모달 — 4단계 흐름
   *
   * Step 1: 안내
   * Step 2: 이름 + 전화번호 입력 → send-otp
   * Step 3: OTP 입력 → verify-otp
   * Step 4: 정보확인 + 완료 → complete → 홈 리다이렉트
   */

  import { goto } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'

  interface Props {
    open: boolean
    onclose: () => void
    onsignup?: () => void
  }
  let { open = $bindable(), onclose, onsignup }: Props = $props()

  // ─── 상태 ─────────────────────────────────────────────────
  // Step 3(OTP 입력)을 Step 2에 병합(Stephen 지시, 2026-09-10 — SignUpModal.svelte처럼
  // 전화번호 발송+인증번호 확인을 한 화면에서 완결) — 3은 더 이상 별도 화면으로 쓰지 않음
  let step        = $state<1 | 2 | 4>(1)
  let isLoading   = $state(false)
  // SignUpModal.svelte .su-header와 동일하게 헤더에 단계별 타이틀을 표시(Stephen 지시,
  // 2026-09-10 — 4번째 선택영역 스타일을 1~3번째 SignUpModal 참조요소와 동일하게 반영)
  let stepTitle = $derived(
    step === 1 ? '기존 회원이신가요?'
    : step === 2 ? '기존 고객정보 입력'
    : '인증 완료!'
  )

  // "더 이상 보지 않아요" 체크(Step1, Stephen 지시 2026-09-10) — 체크된 경우에만
  // localStorage dismiss를 영구 기록한다(front-uiux.md §17 체크 확인 버튼 표준)
  let dontShowAgain = $state(false)

  // 모달 최초 오픈(Step1) 시점의 높이를 측정해 이후 모든 단계에 min-height로 고정
  // (Stephen 지시, 2026-09-10) — 단계 전환 시 콘텐츠 양이 달라 모달 상하폭이 들쭉날쭉
  // 변하던 것을 방지. bodyEl은 .lm-body에 바인딩.
  let bodyEl: HTMLDivElement | undefined = $state()
  let initialBodyHeight = $state<number | null>(null)
  $effect(() => {
    if (open && step === 1 && bodyEl && initialBodyHeight === null) {
      initialBodyHeight = bodyEl.offsetHeight
    }
    if (!open) {
      // 다음 오픈 때 현재 뷰포트 기준으로 다시 측정
      initialBodyHeight = null
    }
  })

  // Step 2 입력값 — 휴대폰 번호는 "010-" 기본 노출(Stephen 지시, 2026-09-10)
  let nameInput  = $state('')
  let phoneInput = $state('010-')

  // OTP (Step 2 화면 내 병합)
  let otpInput   = $state('')
  let verifyToken = $state('')  // verify-otp 성공 후 반환된 token

  // Step 4 확인용 회원 정보 (complete 후 채움)
  let memberInfo = $state<{
    name: string
    email: string
    grade: string
    signupAt: string
    purchaseCount: number
    points: number
  } | null>(null)

  // ─── 이벤트 핸들러 ────────────────────────────────────────
  function handleOverlayClick(e: MouseEvent) {
    if ((e.target as Element)?.classList.contains('lm-overlay')) handleClose()
  }
  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') handleClose()
  }
  function handleClose() {
    // "더 이상 보지 않아요" 체크박스를 선택한 경우에만 localStorage dismiss를 영구 기록
    // (Stephen 지시, 2026-09-10 — 이전엔 닫을 때마다 무조건 기록했음)
    if (dontShowAgain) {
      try { localStorage.setItem('cs-legacy-verify-dismissed-v2', '1') } catch { /* noop */ }
    }
    step = 1
    nameInput = otpInput = verifyToken = ''
    phoneInput = '010-'
    memberInfo = null
    open = false
    onclose()
  }

  // 전화번호 정규화 — 서버 전송/검증용(하이픈 제거, 숫자만)
  function normalizePhone(raw: string): string {
    const digits = raw.replace(/[^0-9]/g, '')
    return digits
  }

  // 전화번호 자동 하이픈 표시(uiux-index.md "전화번호 입력폼 표준" — CustomerDetailPanel.svelte
  // formatPhone()과 동일 패턴, 최대 11자리에서 캡)
  function formatPhoneWithHyphen(raw: string): string {
    const digits = raw.replace(/[^0-9]/g, '')
    if (digits.length <= 3) return digits
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    if (digits.length <= 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`
  }

  // 전화번호 발송 + OTP 검증이 Step 2 화면 안에서 함께 이뤄짐(Stephen 지시, 2026-09-10)
  async function handleSendOtp() {
    const phone = normalizePhone(phoneInput)
    if (!nameInput.trim()) { csToast.error('이름을 입력해주세요.'); return }
    if (!/^01[0-9]\d{7,8}$/.test(phone)) { csToast.error('올바른 휴대폰 번호를 입력해주세요.'); return }

    isLoading = true
    try {
      const res = await fetch('/api/auth/legacy-claim/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: nameInput.trim(), phone }),
      })
      const data = await res.json()
      if (data.ok && data.found) {
        // 화면 전환 없이 같은 화면에서 인증번호 입력을 이어감
        // (재발송도 이 버튼 재클릭으로 동일하게 처리됨)
        csToast.info('인증번호를 발송했습니다. 문자를 확인해주세요.')
      } else if (data.ok && !data.found) {
        // 2026-09-11 Stephen 지시 — send-otp/+server.ts의 열거공격 방지("응답을 항상
        // 동일하게") 원칙을 이 화면에 한해 의도적으로 해제, 매칭 실패를 명시적으로 안내
        csToast.error('확인 가능한 회원 정보가 없습니다.')
      } else {
        csToast.error('네트워크 오류가 발생했습니다.')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      isLoading = false
    }
  }

  // OTP 검증
  async function handleVerifyOtp() {
    const phone = normalizePhone(phoneInput)
    if (!otpInput.trim() || otpInput.length !== 6) {
      csToast.error('6자리 인증번호를 입력해주세요.')
      return
    }

    isLoading = true
    try {
      const res = await fetch('/api/auth/legacy-claim/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code: otpInput.trim() }),
      })
      const data = await res.json()
      if (data.ok && data.token) {
        verifyToken = data.token
        await handleComplete(phone)
      } else {
        csToast.error(data.error ?? '인증번호가 올바르지 않습니다.')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      isLoading = false
    }
  }

  // OTP 검증 성공 후 즉시 complete 호출
  async function handleComplete(phone: string) {
    isLoading = true
    try {
      const res = await fetch('/api/auth/legacy-claim/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verifyToken, name: nameInput.trim(), phone }),
      })
      const data = await res.json()
      if (data.ok) {
        // 인증 완료 자체가 "더 이상 물어볼 필요 없음"의 충분조건이므로, Step1 체크박스
        // 선택 여부와 무관하게 무조건 영구 dismiss 기록(sp3-qa-agent GATE E 지적 — 2026-09-11
        // 수정. 이전엔 체크박스 미선택 시 인증을 완료해도 로그아웃 후 재방문마다 이 모달이
        // 반복 재노출되는 결함이었음).
        try { localStorage.setItem('cs-legacy-verify-dismissed-v2', '1') } catch { /* noop */ }
        step = 4
        memberInfo = {
          name: data.user?.name ?? nameInput,
          email: data.user?.email ?? '',
          grade: data.user?.grade ?? 'NONE',
          signupAt: data.user?.signupAt ? String(data.user.signupAt).slice(0, 10) : '',
          purchaseCount: data.user?.purchaseCount ?? 0,
          points: data.user?.points ?? 0,
        }
        csToast.success('기존 회원 인증이 완료됐습니다.')
      } else {
        csToast.error(data.error ?? '인증 처리 중 오류가 발생했습니다.')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      isLoading = false
    }
  }

  // Step 4 → 완료 후 홈 이동
  async function handleFinish() {
    handleClose()
    await goto('/', { replaceState: true, invalidateAll: true })
  }

  // OTP 숫자만 허용
  function onOtpInput(e: Event) {
    const el = e.target as HTMLInputElement
    el.value = el.value.replace(/[^0-9]/g, '').slice(0, 6)
    otpInput = el.value
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
{#if open}
<div
  class="lm-overlay"
  role="dialog"
  aria-modal="true"
  aria-label="기존 회원 인증"
  tabindex="-1"
  onclick={handleOverlayClick}
  onkeydown={handleKeydown}
>
  <div class="lm-modal">
    <!-- 헤더: SignUpModal.svelte .su-header와 동일 구조(다크 배경 + 타이틀 + 닫기 버튼) -->
    <div class="lm-header">
      <span class="lm-title">{stepTitle}</span>
      <button class="lm-close" onclick={handleClose} aria-label="닫기" type="button">
        <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
          <path d="M1 1L17 17M17 1L1 17" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        </svg>
      </button>
    </div>

    <div class="lm-body" bind:this={bodyEl} style:min-height={initialBodyHeight ? `${initialBodyHeight}px` : null}>
    <!-- Step 1: 안내 -->
    {#if step === 1}
      <div class="lm-step">
        <div class="lm-icon">
          <svg class="lm-icon-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 81 80" fill="none">
            <ellipse cx="39.5993" cy="39.5995" rx="39.5993" ry="39.5995" fill="#FFB3B3"/>
            <ellipse cx="39.7288" cy="39.7289" rx="35.5023" ry="35.5024" fill="url(#lm-icon-gradient)"/>
            <ellipse cx="39.8512" cy="39.8517" rx="14.1246" ry="14.1247" fill="white"/>
            <path d="M74.3903 47.0109C74.0901 49.6085 73.1981 51.7389 71.6968 53.3928C70.2397 54.9719 68.3763 56.0932 66.1067 56.7473C63.8812 57.3733 61.4527 57.5789 58.7768 57.42C56.4984 57.3079 54.2288 56.9715 51.9238 56.4483C51.235 56.2894 50.8111 55.6914 50.8906 55.0373C50.9965 54.159 51.1025 53.29 51.2173 52.421C51.2791 51.8604 51.3498 51.3185 51.4204 50.7765C51.5352 49.758 52.754 49.0012 53.8314 49.2254C55.4651 49.6085 56.9841 49.8421 58.4324 49.9356C60.5077 50.0851 62.1857 49.9636 63.4662 49.5525C64.7732 49.104 65.462 48.3845 65.5768 47.4314C65.6563 46.7587 65.3737 46.2541 64.7379 45.8616C64.102 45.4692 63.2366 45.1328 62.168 44.8712C61.1259 44.6096 60.022 44.3106 58.8651 43.9742C57.7082 43.6191 56.622 43.1706 55.5799 42.6193C54.582 42.0587 53.796 41.2831 53.2308 40.3207C52.701 39.3303 52.5332 38.0502 52.7186 36.4804C52.9482 34.5275 53.743 32.7896 55.0766 31.2104C56.4277 29.622 58.141 28.2391 60.2163 27.0991C62.3799 25.8938 64.7202 25.0248 67.3077 24.4642C69.5509 23.9876 71.8558 23.7914 74.1607 23.8848C74.8849 23.9222 75.3088 24.4922 75.2116 25.2584C75.0792 26.2956 74.9467 27.3327 74.8231 28.3419C74.7524 28.9212 74.6906 29.5285 74.6376 30.0985C74.4963 31.3319 73.1628 32.3504 72.0413 32.1448C70.6724 31.9206 69.3566 31.8552 68.1025 31.9299C66.195 32.0234 64.6584 32.3597 63.4397 32.9577C62.2563 33.509 61.6116 34.2005 61.5145 35.0601C61.4438 35.6768 61.7088 36.1347 62.3623 36.443C63.0158 36.7514 63.8459 37.0036 64.9057 37.2092C65.9742 37.4054 67.1223 37.6484 68.2792 37.9848C69.4449 38.2838 70.5223 38.7883 71.5467 39.4424C72.5711 40.0965 73.3748 41.0309 73.9135 42.2362C74.4522 43.4416 74.62 45.0113 74.3903 47.0109Z" fill="#271B7A"/>
            <path d="M67.5197 19.3904C70.169 18.7831 72.8714 18.5215 75.5207 18.6149C75.5266 18.6149 75.5325 18.6149 75.5384 18.6149C75.5384 18.6149 75.5413 18.6149 75.5472 18.6149C78.7441 18.7551 80.634 21.4274 80.2542 24.7164C80.2542 24.7164 80.2542 24.7196 80.2542 24.7258C80.2542 24.7258 80.2542 24.7289 80.2542 24.7351C80.1306 25.791 80.007 26.8095 79.8922 27.8093C79.8304 28.3606 79.7685 28.9118 79.7155 29.5005C79.7155 29.5067 79.7126 29.513 79.7067 29.5192C79.4506 32.1261 77.9758 34.3033 76.0948 35.7048C77.1898 36.6486 78.0641 37.8259 78.7 39.2275C78.7588 39.3708 78.8148 39.5109 78.8678 39.648C79.7155 41.741 79.848 44.1704 79.5919 46.6278C79.5919 46.6341 79.5919 46.6403 79.5919 46.6465C79.5919 46.6528 79.5919 46.659 79.5919 46.6652C79.1945 50.1879 77.9316 53.7198 75.3176 56.6351C72.9685 59.186 70.0454 60.8586 66.8132 61.7275C66.8073 61.7275 66.8044 61.7275 66.8044 61.7275C63.8194 62.5124 60.7373 62.69 57.6023 62.4564C54.9882 62.2788 52.4007 61.8584 49.8308 61.2417C49.8249 61.2354 49.822 61.2323 49.822 61.2323C49.8161 61.2323 49.8132 61.2323 49.8132 61.2323C47.0755 60.5689 45.3446 58.2703 45.689 55.4765C45.6831 55.4703 45.6831 55.4609 45.689 55.4485C45.8038 54.5795 45.9274 53.7198 46.0511 52.8695C46.1129 52.3369 46.1836 51.7763 46.2719 51.2063C46.6251 48.6181 48.3119 46.7213 50.2901 45.5626C49.6365 44.9366 49.0625 44.2265 48.6033 43.4229C48.5915 43.4167 48.5827 43.4042 48.5768 43.3855C48.5709 43.3731 48.5621 43.3575 48.5503 43.3388C47.5789 41.5167 47.4199 39.3957 47.7025 37.2466C48.0999 34.2659 49.4158 31.3786 51.6589 28.7717C51.6707 28.753 51.6854 28.7374 51.703 28.725C53.7254 26.3329 56.1628 24.352 58.8916 22.801C58.9005 22.801 58.9005 22.801 58.9093 22.7916C61.6381 21.1938 64.4994 20.0912 67.5197 19.3904ZM66.8309 24.5763C64.4288 25.1463 62.2386 25.9779 60.2163 27.0991C58.141 28.2391 56.4277 29.622 55.0766 31.2104C53.743 32.7896 52.9482 34.5275 52.7186 36.4804C52.5332 38.0502 52.701 39.3303 53.2308 40.3207C53.796 41.2831 54.582 42.0587 55.5799 42.6193C55.7095 42.6816 55.839 42.7501 55.9685 42.8249C56.8958 43.2827 57.8407 43.6658 58.8651 43.9742C59.4303 44.1299 59.9955 44.2888 60.5607 44.4507C61.1082 44.6002 61.6469 44.731 62.168 44.8712C63.2366 45.1328 64.102 45.4692 64.7379 45.8616C65.3737 46.2541 65.6563 46.7587 65.5768 47.4314C65.462 48.3845 64.7732 49.104 63.4662 49.5525C63.3837 49.5774 63.3013 49.6023 63.2189 49.6272C61.9737 49.9729 60.3753 50.0757 58.4324 49.9356C56.9841 49.8421 55.4651 49.6085 53.8314 49.2254C52.754 49.0012 51.5352 49.758 51.4204 50.7765C51.3498 51.3185 51.2791 51.8604 51.2173 52.421C51.1025 53.29 50.9965 54.159 50.8906 55.0373C50.8906 55.0747 50.8876 55.1121 50.8817 55.1495C50.8641 55.7662 51.2791 56.3081 51.9238 56.4483C54.2288 56.9715 56.4984 57.3079 58.7768 57.42C61.276 57.5695 63.5721 57.392 65.6916 56.8594C65.8329 56.8158 65.9713 56.7784 66.1067 56.7473C68.3763 56.0932 70.2397 54.9719 71.6968 53.3928C73.101 51.8511 73.9753 49.8702 74.3374 47.4875C74.355 47.3317 74.3727 47.1729 74.3903 47.0109C74.62 45.0113 74.4522 43.4416 73.9135 42.2362C73.4012 41.1056 72.6771 40.2179 71.7233 39.5639C71.6645 39.5265 71.6056 39.486 71.5467 39.4424C70.5223 38.7883 69.4449 38.2838 68.2792 37.9848C67.1223 37.6484 65.9742 37.4054 64.9057 37.2092C63.8459 37.0036 63.0158 36.7514 62.3623 36.443C61.7088 36.1347 61.4438 35.6768 61.5145 35.0601C61.6028 34.2659 62.1768 33.6025 63.2277 33.0605C63.3043 33.0232 63.3749 32.9889 63.4397 32.9577C64.6584 32.3597 66.195 32.0234 68.1025 31.9299C68.2556 31.9175 68.4116 31.9081 68.5706 31.9019C69.6922 31.8645 70.849 31.9486 72.0413 32.1448C73.1628 32.3504 74.4963 31.3319 74.6376 30.0985C74.6906 29.5285 74.7524 28.9212 74.8231 28.3419C74.9585 27.314 75.088 26.2862 75.2116 25.2584C75.3088 24.4922 74.8849 23.9222 74.1607 23.8848C71.8558 23.7914 69.5509 23.9876 67.3077 24.4642C67.1488 24.5015 66.9898 24.5389 66.8309 24.5763Z" fill="white"/>
            <path d="M20.1914 40.7457C20.745 37.8175 21.7042 35.0942 23.045 32.5909C24.4368 30.0259 26.1491 27.7126 28.1772 25.6639C30.2016 23.5844 32.4972 21.8305 35.0597 20.4214C37.6215 19.0062 40.3426 18.0099 43.2252 17.4509C45.8801 16.9356 48.6086 16.8798 51.422 17.2698C51.9359 17.3506 52.2188 17.8308 52.1168 18.4466C51.8821 19.8563 51.6537 21.2652 51.4148 22.694C51.2485 23.6971 51.0879 24.6935 50.9209 25.6905C50.7498 26.7066 49.6493 27.5191 48.8272 27.2913C47.3313 26.8879 45.8005 26.7377 44.235 26.8407C42.0608 26.9916 40.0226 27.5827 38.1026 28.6284C36.1812 29.6618 34.5418 31.1131 33.1703 32.9714C31.7993 34.7798 30.8777 37.0003 30.388 39.6472C29.8975 42.288 30.0257 44.4184 30.7728 46.0384C31.5233 47.6331 32.7096 48.7561 34.358 49.4108C36.0007 50.0724 37.9345 50.2408 40.1777 49.9077C41.7926 49.6747 43.4607 49.1802 45.1828 48.4305C46.1295 48.0151 47.0016 48.6115 46.824 49.6284C46.6529 50.6445 46.4753 51.6614 46.2928 52.6913C46.0566 54.0886 45.8133 55.4805 45.5715 56.8846C45.4631 57.5012 44.9935 58.0701 44.4158 58.2705C41.2783 59.3 38.3936 59.8404 35.7367 59.9009C32.8472 59.9619 30.3005 59.5303 28.0909 58.6128C25.8779 57.7208 24.0929 56.4015 22.7334 54.6865C21.3775 53.0024 20.4613 50.9895 19.987 48.6663C19.5609 46.313 19.6307 43.6685 20.1914 40.7457Z" fill="#CF0000"/>
            <path d="M42.3379 13.2003C45.3284 12.6199 48.3687 12.532 51.4462 12.8988L52.0617 12.9781L52.1041 12.9838L52.1466 12.9907C53.7844 13.2485 55.1348 14.2013 55.9093 15.514C56.6382 16.7494 56.7345 18.0636 56.5578 19.1302L56.557 19.134C56.3318 20.4864 56.0886 21.9799 55.8549 23.3773L55.8556 23.3779C55.6951 24.3464 55.5265 25.3902 55.3604 26.3816L55.3602 26.3853C55.0673 28.124 54.0435 29.5 52.8924 30.3698C51.8287 31.1735 49.8858 32.082 47.6159 31.466C46.6236 31.1984 45.6116 31.0973 44.5577 31.1649C43.0491 31.2696 41.656 31.6729 40.3146 32.4035L40.3039 32.4089L40.2938 32.4149C39.0089 33.106 37.856 34.1011 36.8343 35.4853L36.818 35.5078L36.801 35.5298C35.9105 36.7044 35.2097 38.2759 34.815 40.4087L34.8147 40.4118C34.4122 42.579 34.6374 43.728 34.8725 44.2553C35.1658 44.8745 35.5188 45.1825 36.071 45.4018L36.081 45.4062L36.0915 45.4099C36.7939 45.6928 37.8553 45.8655 39.4935 45.6222L39.5028 45.6212L39.5121 45.6196C40.6544 45.4547 41.9238 45.092 43.3317 44.4791C45.0308 43.7379 47.2626 43.6956 49.101 45.0079C50.9799 46.3492 51.5751 48.4803 51.2619 50.3232L51.2632 50.3236C51.0912 51.3448 50.9125 52.3632 50.731 53.3881L50.7317 53.3886C50.4941 54.7941 50.2476 56.2047 50.0081 57.5947L50.0065 57.6022L50.0054 57.609C49.6505 59.6283 48.1773 61.5733 45.9384 62.3501L45.9019 62.3626L45.8649 62.3752C42.3944 63.514 39.0515 64.1624 35.8429 64.2354L35.8353 64.2357C32.4408 64.3073 29.2496 63.8057 26.3562 62.6127C26.3467 62.6088 26.3372 62.605 26.3277 62.6012C26.3226 62.599 26.317 62.5972 26.3118 62.595C23.4382 61.4286 21.0298 59.6666 19.1816 57.3445L19.181 57.3452C19.1742 57.3367 19.1671 57.328 19.1603 57.3195L19.1609 57.3188C17.3388 55.0467 16.1659 52.4011 15.5744 49.5037L15.5652 49.4578L15.5566 49.4118C15.0194 46.4448 15.1348 43.2719 15.7675 39.968C16.3981 36.6328 17.4973 33.4995 19.0495 30.6016L19.0546 30.5913L19.0603 30.581C20.6358 27.6773 22.5832 25.0397 24.898 22.6964C27.224 20.3072 29.8724 18.2822 32.8315 16.655C35.8002 15.016 38.9729 13.8529 42.3379 13.2003ZM42.6865 17.5611C40.0031 18.1363 37.4613 19.0947 35.0597 20.4214L34.5826 20.6899C32.2115 22.0512 30.0751 23.7143 28.1772 25.6639L27.8009 26.0511C25.9365 28.0027 24.3498 30.1862 23.045 32.5909C21.7042 35.0942 20.745 37.8175 20.1914 40.7457C19.6307 43.6685 19.5609 46.313 19.987 48.6663C20.4613 50.9895 21.3775 53.0024 22.7334 54.6865C24.0929 56.4015 25.8779 57.7208 28.0909 58.6128C30.3005 59.5303 32.8472 59.9619 35.7367 59.9009C38.2274 59.8442 40.9185 59.3657 43.8302 58.4579L44.4158 58.2705C44.9935 58.0701 45.4631 57.5012 45.5715 56.8846C45.8133 55.4805 46.0566 54.0886 46.2928 52.6913C46.4753 51.6614 46.6529 50.6445 46.824 49.6284C47.0016 48.6115 46.1295 48.0151 45.1828 48.4305L44.8606 48.5681C43.2526 49.241 41.6916 49.6892 40.1777 49.9077C38.0747 50.22 36.2437 50.0913 34.6695 49.5288L34.358 49.4108C32.7096 48.7561 31.5233 47.6331 30.7728 46.0384C30.0257 44.4184 29.8975 42.288 30.388 39.6472C30.8471 37.1658 31.6861 35.0592 32.9187 33.3155L33.1703 32.9714C34.456 31.2294 35.9773 29.8449 37.7455 28.8272L38.1026 28.6284C40.0226 27.5827 42.0608 26.9916 44.235 26.8407C45.8005 26.7377 47.3313 26.8879 48.8272 27.2913C49.6236 27.5119 50.6812 26.7564 50.9023 25.7852L50.9209 25.6905C51.0879 24.6935 51.2485 23.6971 51.4148 22.694L52.1168 18.4466C52.2188 17.8308 51.9359 17.3506 51.422 17.2698C48.6086 16.8798 45.8801 16.9356 43.2252 17.4509L42.6865 17.5611Z" fill="white"/>
            <defs>
              <radialGradient id="lm-icon-gradient" cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(39.7288 39.7289) rotate(90) scale(35.5024 35.5023)">
                <stop offset="0.831731" stop-color="#CF0000"/>
                <stop offset="1" stop-color="#FFB3B3"/>
              </radialGradient>
            </defs>
          </svg>
        </div>
        <p class="lm-desc lm-desc-intro">
          크레이지샷 리뉴얼 오픈으로<br />
          휴대폰 인증 딱 한번만 부탁드려요.
        </p>
        <div class="lm-actions">
          <button class="lm-btn-primary" onclick={() => step = 2}>
            기존 회원 인증하기
          </button>
          <button class="lm-btn-ghost" onclick={() => { handleClose(); onsignup?.() }}>
            새로 시작할게요
          </button>
        </div>
        <!-- front-uiux.md §17 체크 확인 버튼 표준 재사용(Stephen 지시, 2026-09-10) —
             체크 시에만 localStorage dismiss가 영구 기록됨(handleClose 참고) -->
        <div class="lm-dismiss-row">
          <button
            class="checkbox-btn checkbox-btn-terms"
            class:checked={dontShowAgain}
            onclick={() => dontShowAgain = !dontShowAgain}
            type="button"
            aria-label="더 이상 보지 않기"
          >
            <svg width="18" height="12" viewBox="0 0 18 12" fill="none" aria-hidden="true">
              <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
            </svg>
          </button>
          <span class="lm-dismiss-label">더 이상 보지 않아요</span>
        </div>
      </div>

    <!-- Step 2: 이름 + 전화번호 입력 -->
    {:else if step === 2}
      <div class="lm-step">
        <div class="lm-field">
          <input
            id="lm-name"
            class="lm-input"
            type="text"
            placeholder="이름을 입력해주세요"
            aria-label="이름"
            bind:value={nameInput}
            disabled={isLoading}
            maxlength={50}
          />
        </div>
        <!-- SignUpModal.svelte .su-phone-row와 동일하게 전화번호 입력 + 인증 발송 버튼을
             한 줄에 배치(Stephen 지시, 2026-09-10) -->
        <div class="lm-field">
          <div class="lm-phone-row">
            <input
              id="lm-phone"
              class="lm-input lm-phone-input"
              type="tel"
              placeholder="01012345678"
              aria-label="휴대폰 번호"
              oninput={(e) => { phoneInput = formatPhoneWithHyphen((e.target as HTMLInputElement).value); (e.target as HTMLInputElement).value = phoneInput }}
              value={phoneInput}
              disabled={isLoading}
            />
            <button class="lm-otp-btn" type="button" onclick={handleSendOtp} disabled={isLoading}>
              {isLoading ? '발송 중...' : '인증번호 받기'}
            </button>
          </div>
        </div>
        <!-- OTP 입력폼 + 인증확인 버튼: Step 3으로 분리해 숨기지 않고 이 화면에 항상
             노출(Stephen 지시, 2026-09-10 — SignUpModal.svelte처럼 한 화면에서 완결).
             재발송은 위 "인증번호 받기" 버튼 재클릭으로 동일하게 처리되어 별도 버튼 불필요.
             라벨 대신 placeholder+aria-label 가이드로 전환 + "인증 확인" 버튼을 "인증번호
             받기"와 동일한 .lm-otp-btn 크기로 입력창 옆에 배치(Stephen 지시, 2026-09-10). -->
        <div class="lm-field">
          <div class="lm-phone-row">
            <input
              id="lm-otp"
              class="lm-input lm-phone-input"
              type="tel"
              placeholder="인증번호 입력"
              aria-label="인증번호"
              oninput={onOtpInput}
              value={otpInput}
              disabled={isLoading}
              maxlength={6}
            />
            <button class="lm-otp-btn" type="button" onclick={handleVerifyOtp} disabled={isLoading || otpInput.length !== 6}>
              {isLoading ? '확인 중...' : '인증 확인'}
            </button>
          </div>
        </div>
        <div class="lm-actions">
          <button class="lm-btn-ghost" onclick={() => step = 1} disabled={isLoading}>
            이전
          </button>
        </div>
      </div>

    <!-- Step 4: 완료 + 정보 확인 -->
    {:else if step === 4}
      <div class="lm-step">
        <div class="lm-icon">✅</div>
        <p class="lm-desc">기존 회원 정보가 연결되었습니다.</p>
        {#if memberInfo}
          <div class="lm-info-card">
            <div class="lm-info-row">
              <span class="lm-info-label">이름</span>
              <span class="lm-info-val">{memberInfo.name || nameInput}</span>
            </div>
            <div class="lm-info-row">
              <span class="lm-info-label">이메일</span>
              <span class="lm-info-val">{memberInfo.email}</span>
            </div>
            <div class="lm-info-row">
              <span class="lm-info-label">회원등급</span>
              <span class="lm-info-val">{memberInfo.grade}</span>
            </div>
            <div class="lm-info-row">
              <span class="lm-info-label">가입일</span>
              <span class="lm-info-val">{memberInfo.signupAt || '—'}</span>
            </div>
            <div class="lm-info-row">
              <span class="lm-info-label">구매 횟수</span>
              <span class="lm-info-val">{memberInfo.purchaseCount}회</span>
            </div>
            <div class="lm-info-row">
              <span class="lm-info-label">포인트</span>
              <span class="lm-info-val">{memberInfo.points.toLocaleString()}P</span>
            </div>
          </div>
        {/if}
        <div class="lm-actions">
          <button class="lm-btn-primary" onclick={handleFinish}>
            서비스 시작하기 →
          </button>
        </div>
      </div>
    {/if}
    </div>
  </div>
</div>
{/if}

<style>
  .lm-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    background: rgba(16, 11, 50, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  /* PC(기본값)/Mobile 비율 적용(Stephen 지시, 2026-09-10) — SignUpModal.svelte(.su-modal
     max-width 480px)과 동일하게 데스크톱 기준값을 기본으로 두고, 모바일에서만 축소한다.
     라운드값은 front-uiux.md §4 "카드(대) 반경" 정본(PC 50px --radius-2xl / Mobile 30px
     --radius-xl)을 상·하한으로 삼아 640px 이진 스위치 대신 아이콘·타이틀과 동일하게
     뷰포트 폭에 연속 비례하는 clamp()로 전환 — breakpoint 전후로만 값이 바뀌면 그 사이
     어떤 폭에서 봐도 "PC와 모바일이 똑같다"는 인상을 준다(icon/title에서 이미 발견된 패턴). */
  /* SignUpModal.svelte .su-modal과 동일 — overflow:hidden으로 헤더의 다크 배경이 카드
     상단 라운드 모서리에 맞춰 잘리도록 함(Stephen 지시, 2026-09-10) */
  .lm-modal {
    background: #fff;
    border-radius: clamp(30px, 4.2vw + 13px, 50px);
    width: 100%;
    max-width: 480px;
    position: relative;
    box-sizing: border-box;
    overflow: hidden;
  }
  /* SignUpModal.svelte .su-header와 동일한 다크 헤더바 */
  .lm-header {
    background: var(--cs-dark);
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 28px;
  }
  /* box-sizing: border-box — bodyEl.offsetHeight(패딩 포함 측정값)를 그대로 min-height에
     적용해도 실제 렌더 높이가 부풀지 않도록 함(Stephen 지시, 2026-09-10 — 모달 상하폭
     최초 오픈 시 값 유지) */
  .lm-body {
    padding: 40px 36px;
    box-sizing: border-box;
  }
  .lm-close {
    background: none;
    border: none;
    cursor: pointer;
    color: rgba(255, 255, 255, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 44px;
    min-height: 44px;
    border-radius: var(--radius-sm);
    transition: color 0.15s;
  }
  .lm-close:hover { color: var(--cs-white); }
  .lm-step { display: flex; flex-direction: column; gap: 16px; }
  .lm-icon { display: flex; justify-content: center; }
  /* 640px 이진 스위치 대신 뷰포트 폭에 실시간 비례하는 연속 스케일로 변경(Stephen 지시,
     2026-09-10 — 640px 기준 두 단계 값만 있으면 그 사이 어떤 폭에서도 동일하게 보여
     "비율이 안 먹혔다"는 인상을 줌). 400px 이하는 64px 고정, 880px 이상은 88px 고정,
     그 사이는 창 폭에 정비례해 매끄럽게 커진다. */
  .lm-icon-svg { width: clamp(64px, 5vw + 44px, 88px); height: auto; }
  /* SignUpModal.svelte .su-title과 동일하게 헤더 안 흰 텍스트 타이틀로 전환(Stephen 지시,
     2026-09-10) — 이전엔 본문 중앙정렬 다크 텍스트 h2였음 */
  .lm-title {
    font-size: clamp(18px, 1vw + 14px, 22px);
    font-weight: 900;
    color: var(--cs-white);
    letter-spacing: -0.5px;
    margin: 0;
  }
  .lm-desc {
    font-size: 14px;
    color: var(--cs-text-mid);
    text-align: center;
    line-height: 1.6;
    margin: 0;
  }
  /* front-uiux.md §2 — 기존 대비 한 사이즈 큰 타이포 토큰(PC label 14→body 16 / Mobile
     script-14B→body-16B) */
  .lm-desc-intro {
    font: var(--text-pc-title-16);
    color: var(--cs-text-mid);
  }
  .lm-field { display: flex; flex-direction: column; gap: 6px; }
  /* SignUpModal.svelte .su-input과 동일 값 그대로 적용(Stephen 지시, 2026-09-10 —
     좌우패딩 20px→16px, 상하패딩 12px→13px로 재정정, 나머지는 기존 §6 표준과 동일) */
  .lm-input {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-sm);
    padding: 13px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    width: 100%;
    box-sizing: border-box;
    min-height: 48px;
  }
  .lm-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  /* SignUpModal.svelte .su-phone-row/.su-otp-btn과 동일 구조 — 전화번호 입력 + 인증발송
     버튼을 한 줄에 배치(Stephen 지시, 2026-09-10) */
  .lm-phone-row { display: flex; gap: 8px; }
  .lm-phone-input { flex: 1; }
  /* "인증번호 받기"/"인증 확인" 두 버튼의 가로폭을 고정값으로 통일(Stephen 지시,
     2026-09-10) — 텍스트 길이가 달라 min-width만으로는 "인증 확인"이 더 좁게 렌더링됐음
     (실측: 인증번호 받기 103px / 인증 확인 90px) — 더 넓은 쪽 기준 고정폭으로 맞춤. */
  .lm-otp-btn {
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-sm);
    padding: 0 16px;
    box-sizing: border-box;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    min-height: 48px;
    width: 104px;
    white-space: nowrap;
    flex-shrink: 0;
    transition: opacity 0.15s;
  }
  .lm-otp-btn:disabled { opacity: 0.55; cursor: default; }
  .lm-otp-btn:not(:disabled):hover { opacity: 0.85; }

  /* 버튼 간 여백 확대(Stephen 지시, 2026-09-10) — 10px(spacing sm) → 15px(spacing md) */
  .lm-actions { display: flex; flex-direction: column; gap: 15px; margin-top: 4px; }
  /* front-uiux.md §5 — 사용자 화면 주 CTA = --cs-red-badge(#FF3535), hover = --cs-red.
     CMS의 --cs-purple(보조 액션 전용 색상)을 주 CTA에 쓰던 것을 표준에 맞춰 교체.
     상하 패딩 확보를 위해 고정 height 대신 padding+min-height로 전환(Stephen 지시,
     2026-09-10) — 기존엔 height만 고정돼 있어 실제 상하 여백(패딩)이 없었다. */
  .lm-btn-primary {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-xl);
    padding: 14px 30px;
    min-height: 50px;
    box-sizing: border-box;
    font: var(--text-pc-title-16);
    cursor: pointer;
    width: 100%;
  }
  .lm-btn-primary:hover:not(:disabled) { background: var(--cs-red); }
  .lm-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
  /* 보조 액션 = 면(fill) 스타일 — 보더 지양(Stephen 지시, 2026-09-10). front-uiux.md §5의
     보더형 "고스트" 패턴 대신 SignUpModal.svelte .su-back-btn과 동일한 옅은 퍼플 면 스타일 재사용. */
  .lm-btn-ghost {
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border: none;
    border-radius: var(--radius-xl);
    padding: 14px 30px;
    min-height: 50px;
    box-sizing: border-box;
    font: var(--text-pc-title-16);
    cursor: pointer;
    width: 100%;
  }
  .lm-btn-ghost:hover:not(:disabled) { background: var(--cs-purple-pale); }
  .lm-btn-ghost:disabled { opacity: 0.5; cursor: not-allowed; }
  .lm-info-card {
    background: var(--cs-lilac);
    border-radius: var(--radius-lg);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .lm-info-row { display: flex; justify-content: space-between; align-items: center; }
  .lm-info-label { font-size: 13px; color: var(--cs-text-mid); }
  .lm-info-val { font-size: 14px; font-weight: 700; color: var(--cs-text); }

  /* "더 이상 보지 않아요" — front-uiux.md §17 체크 확인 버튼 표준 그대로 재사용
     (Stephen 지시, 2026-09-10). .lm-actions와의 여백은 .lm-step 기존 gap:16px 위에
     margin-top 8px를 더해 24px로 확대(두 영역 간 여백 추가 요청, 2026-09-10). */
  .lm-dismiss-row {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin-top: 8px;
  }
  /* 기존 대비 한 사이즈 큰 폰트토큰 적용 + PC/Mobile 비율값(Stephen 지시, 2026-09-10) —
     .lm-desc-intro와 동일하게 label(14)→body(16) 토큰 단계로 올리되, 아이콘·타이틀과
     같은 clamp() 연속 비례 방식으로 전환(400px→14px, 800px→16px). */
  .lm-dismiss-label {
    font-size: clamp(14px, 0.5vw + 12px, 16px);
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .checkbox-btn { background: none; border: none; padding: 0; cursor: pointer; flex-shrink: 0; display: flex; align-items: center; }
  .checkbox-btn-terms { color: var(--cs-purple-op10); }
  .checkbox-btn-terms.checked { color: var(--cs-purple); }
  /* 체크 아이콘 30% 확대(Stephen 지시, 2026-09-10) — 22×15→28.6×19.5 / 18×12→23.4×15.6 */
  .checkbox-btn-terms svg { width: 28.6px; height: 19.5px; }
  @media (min-width: 768px) {
    .checkbox-btn-terms svg { width: 23.4px; height: 15.6px; }
  }

  /* 아이콘·타이틀·모달 라운드는 전부 clamp()로 연속 비례 처리(중복 오버라이드 금지 — 여기서
     고정값을 또 주면 매끄러운 램프가 끊긴다). 헤더·바디 패딩·버튼 상하 패딩·폰트처럼 "선택
     가능한 둘 중 하나" 값만 이 breakpoint에서 전환한다(SignUpModal.svelte 모바일 오버라이드와
     동일 값 — .su-header 16px 20px / .su-body 20px). */
  @media (max-width: 640px) {
    .lm-header { padding: 16px 20px; }
    .lm-body { padding: 20px; }
    .lm-desc-intro { font: var(--text-m-body-16B); }
    .lm-btn-primary, .lm-btn-ghost { padding: 12px 20px; min-height: 44px; font: var(--text-m-body-16B); }
  }
</style>
