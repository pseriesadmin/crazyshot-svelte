<script lang="ts">
  import { tick } from 'svelte'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import CalendarGrid from '$lib/components/common/CalendarGrid.svelte'
  import NotificationTabContent from './NotificationTabContent.svelte'
  import type { UserProfile } from '../../../../routes/account/profile/+page.server'
  import { validateUploadFile } from '$lib/utils/fileValidation'

  interface ShippingAddress {
    id: string
    label: string
    recipient: string | null
    phone: string | null
    road_address: string
    detail_address: string | null
    postal_code: string | null
    is_default: boolean
    sort_order: number
    created_at: string
  }

  interface KakaoAddressData {
    roadAddress: string
    jibunAddress: string
    zonecode: string
  }

  type KakaoPostcodeCtor = new (opts: { oncomplete: (data: KakaoAddressData) => void; width?: string; height?: string }) => { open(): void; embed(el: HTMLElement, opts?: { autoClose?: boolean }): void }
  interface KakaoWindow extends Window { daum?: { Postcode: KakaoPostcodeCtor } }

  interface Props {
    profile: UserProfile | null
    authEmail: string | null
    addresses: ShippingAddress[]
    onswitchtab: (tab: string) => void
    compact?: boolean
  }

  let { profile, authEmail, addresses, onswitchtab, compact = false }: Props = $props()

  const notifRental  = $derived(profile?.allow_rental_alert  ?? true)
  const notifBenefit = $derived(profile?.allow_benefit_alert ?? false)

  /* ── 읽기 전용 표시값 */
  const displayName      = $derived(profile?.full_name ?? '')
  const displayEmail     = $derived(profile?.email ?? authEmail ?? '')
  const displayPhone     = $derived(profile?.phone ?? '')
  const displayBirthdate = $derived(profile?.birth_date ?? '')

  /* ── 편집 모드 */
  type EditField = 'name' | 'email' | 'birthdate' | 'phone' | null
  let editingField = $state<EditField>(null)

  /* ── 공통 자동 저장 */
  async function autoSaveProfile(payload: Record<string, string | null>) {
    const fd = new FormData()
    for (const [k, v] of Object.entries(payload)) {
      if (v !== null) fd.set(k, v)
    }
    try {
      const res = await fetch('/account/profile?/updateProfile', { method: 'POST', body: fd })
      const text = await res.text()
      if (res.ok) {
        csToast.success('저장되었습니다.')
        await invalidateAll()
      } else {
        // SvelteKit action failure JSON
        try {
          const json = JSON.parse(text) as { data?: { error?: string } }
          csToast.error(json?.data?.error ?? '저장 실패')
        } catch {
          csToast.error('저장 실패')
        }
      }
    } catch {
      csToast.error('네트워크 오류')
    }
    editingField = null
  }

  /* ── 이름 */
  let editName  = $state('')
  let nameInput = $state<HTMLInputElement | null>(null)

  function openEditName() {
    editName     = displayName
    editingField = 'name'
    setTimeout(() => nameInput?.focus(), 30)
  }

  function handleNameBlur() {
    const trimmed = editName.trim()
    if (trimmed && trimmed !== displayName) {
      autoSaveProfile({ full_name: trimmed })
    } else {
      editingField = null
    }
  }

  function handleNameKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter')  { e.preventDefault(); (e.target as HTMLInputElement).blur() }
    if (e.key === 'Escape') { editingField = null }
  }

  /* ── 이메일 */
  const EMAIL_DOMAINS = ['gmail.com', 'naver.com', 'kakao.com', 'daum.net', 'hanmail.net', 'nate.com']
  let editEmailLocal  = $state('')
  let editEmailDomain = $state('')
  let showDomainList  = $state(false)
  let emailWrap       = $state<HTMLDivElement | null>(null)

  const filteredDomains = $derived(
    editEmailDomain.length > 0
      ? EMAIL_DOMAINS.filter(d => d.startsWith(editEmailDomain.toLowerCase()))
      : EMAIL_DOMAINS
  )
  const fullEmail = $derived(
    editEmailLocal && editEmailDomain ? `${editEmailLocal}@${editEmailDomain}` : ''
  )

  function openEditEmail() {
    const full = displayEmail
    const at   = full.indexOf('@')
    editEmailLocal  = at >= 0 ? full.slice(0, at) : full
    editEmailDomain = at >= 0 ? full.slice(at + 1) : ''
    showDomainList  = false
    editingField    = 'email'
  }

  function handleDomainInput(e: Event) {
    editEmailDomain = (e.target as HTMLInputElement).value
    showDomainList  = true
  }

  function selectDomain(d: string) {
    editEmailDomain = d
    showDomainList  = false
    // 도메인 선택 후 즉시 저장
    const composed = editEmailLocal && d ? `${editEmailLocal}@${d}` : ''
    if (composed && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(composed) && composed !== displayEmail) {
      autoSaveProfile({ email: composed })
    } else {
      editingField = null
    }
  }

  function handleEmailWrapFocusout(e: FocusEvent) {
    const wrap = e.currentTarget as HTMLElement
    // 포커스가 여전히 래퍼 내부에 있으면 무시
    if (wrap.contains(e.relatedTarget as Node)) return
    showDomainList = false
    if (fullEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fullEmail) && fullEmail !== displayEmail) {
      autoSaveProfile({ email: fullEmail })
    } else {
      editingField = null
    }
  }

  function handleEmailKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') { editingField = null; showDomainList = false }
  }

  /* ── 생년월일 */
  let editBirthdate = $state('')
  let showCalendar  = $state(false)

  function openEditBirthdate() {
    editBirthdate = displayBirthdate
    showCalendar  = true
    editingField  = 'birthdate'
  }

  function handleBirthdateSelect(iso: string) {
    showCalendar = false
    if (iso !== displayBirthdate) {
      autoSaveProfile({ birth_date: iso })
    } else {
      editingField = null
    }
  }

  function formatBirthdate(iso: string): string {
    if (!iso) return ''
    const [y, m, d] = iso.split('-')
    return `${y}년 ${parseInt(m)}월 ${parseInt(d)}일`
  }

  /* ── 휴대폰 OTP */
  let editPhone        = $state('')
  let otpCode          = $state('')
  let otpSent          = $state(false)
  let otpSending       = $state(false)
  let otpCountdown     = $state(0)
  let countdownTimer   = $state<ReturnType<typeof setInterval> | null>(null)
  let isVerifyingPhone = $state(false)

  function openEditPhone() {
    editPhone    = displayPhone ? formatPhoneDisplay(displayPhone) : ''
    otpSent      = false
    otpCode      = ''
    editingField = 'phone'
  }

  function formatPhoneDisplay(raw: string): string {
    const d = raw.replace(/\D/g, '')
    if (d.length <= 3) return d
    if (d.length <= 7) return `${d.slice(0,3)}-${d.slice(3)}`
    if (d.length <= 11) return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7)}`
    return `${d.slice(0,3)}-${d.slice(3,7)}-${d.slice(7,11)}`
  }

  function handlePhoneInput(e: Event) {
    const t = e.target as HTMLInputElement
    editPhone = formatPhoneDisplay(t.value)
    t.value   = editPhone
  }

  function startCountdown() {
    otpCountdown = 300
    if (countdownTimer) clearInterval(countdownTimer)
    countdownTimer = setInterval(() => {
      otpCountdown -= 1
      if (otpCountdown <= 0 && countdownTimer) { clearInterval(countdownTimer); countdownTimer = null }
    }, 1000)
  }

  function fmtCountdown(s: number): string {
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
  }

  async function sendOtp() {
    const rawPhone = editPhone.replace(/\D/g, '')
    if (!/^010\d{8}$/.test(rawPhone)) { csToast.error('올바른 휴대폰 번호를 입력해 주세요.'); return }
    otpSending = true
    try {
      const res  = await fetch('/api/profile/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: rawPhone }) })
      const data = await res.json() as { ok: boolean; error?: string }
      if (!data.ok) { csToast.error(data.error ?? 'SMS 발송 실패'); return }
      otpSent = true; otpCode = ''; startCountdown()
      csToast.success('인증번호가 발송되었습니다. (5분 이내 입력)')
    } catch { csToast.error('네트워크 오류가 발생했습니다.') }
    finally  { otpSending = false }
  }

  async function verifyOtp() {
    const rawPhone = editPhone.replace(/\D/g, '')
    if (!rawPhone || otpCode.length !== 6) return
    isVerifyingPhone = true
    const fd = new FormData(); fd.set('phone', rawPhone); fd.set('code', otpCode)
    try {
      const res  = await fetch('/account/profile?/verifyPhone', { method: 'POST', body: fd })
      if (res.ok) {
        csToast.success('휴대폰 인증이 완료되었습니다.')
        editingField = null
        if (countdownTimer) clearInterval(countdownTimer)
        await invalidateAll()
      } else {
        const json = await res.json().catch(() => ({})) as { data?: { error?: string } }
        csToast.error(json?.data?.error ?? '인증 실패')
      }
    } catch { csToast.error('네트워크 오류') }
    finally  { isVerifyingPhone = false }
  }

  function cancelPhone() {
    editingField = null
    if (countdownTimer) clearInterval(countdownTimer)
  }

  /* ── 기본 배송지 (카카오 주소 embed 모달) */
  const defaultAddress = $derived(addresses.find(a => a.is_default) ?? addresses[0] ?? null)

  let editingAddress    = $state(false)
  let newRoadAddress    = $state('')
  let newPostalCode     = $state('')
  let newDetailAddress  = $state('')
  let isSubmittingAddr  = $state(false)
  let detailInput       = $state<HTMLInputElement | null>(null)

  // 카카오 embed 모달
  let showKakaoModal    = $state(false)
  let kakaoContainer    = $state<HTMLDivElement | null>(null)

  function loadKakaoScript(): Promise<void> {
    const w = window as KakaoWindow
    return new Promise((resolve, reject) => {
      if (w.daum?.Postcode) { resolve(); return }
      const s = document.createElement('script')
      s.src = 'https://t1.daumcdn.net/mapjsapi/bundle/postcode/prod/postcode.v2.js'
      s.onload  = () => resolve()
      s.onerror = () => reject(new Error('load_fail'))
      document.head.appendChild(s)
    })
  }

  async function openKakaoModal() {
    if (typeof window === 'undefined') return
    showKakaoModal = true
    try { await loadKakaoScript() } catch {
      csToast.error('주소 검색 서비스를 불러올 수 없습니다.')
      showKakaoModal = false
      return
    }
    await tick()  // DOM 업데이트 후 container 참조 확보
    const w = window as KakaoWindow
    if (!w.daum?.Postcode || !kakaoContainer) { showKakaoModal = false; return }
    new w.daum.Postcode({
      oncomplete: (data: KakaoAddressData) => {
        newRoadAddress   = data.roadAddress || data.jibunAddress
        newPostalCode    = data.zonecode
        showKakaoModal   = false
        editingAddress   = true
        setTimeout(() => detailInput?.focus(), 80)
      },
      width:  '100%',
      height: '100%'
    }).embed(kakaoContainer, { autoClose: false })
  }

  function openAddressEdit() {
    newRoadAddress   = defaultAddress?.road_address   ?? ''
    newPostalCode    = defaultAddress?.postal_code    ?? ''
    newDetailAddress = defaultAddress?.detail_address ?? ''
    editingAddress   = true
  }

  function cancelAddressEdit() {
    editingAddress   = false
    newRoadAddress   = ''
    newPostalCode    = ''
    newDetailAddress = ''
  }

  async function saveAddress() {
    if (!newRoadAddress.trim()) return
    isSubmittingAddr = true
    const fd = new FormData()
    fd.set('road_address',   newRoadAddress.trim())
    fd.set('detail_address', newDetailAddress.trim())
    fd.set('postal_code',    newPostalCode)
    fd.set('set_default',    'true')
    try {
      const res = await fetch('/account/profile?/addAddress', { method: 'POST', body: fd })
      if (res.ok) {
        csToast.success('배송지가 저장되었습니다.')
        cancelAddressEdit()
        await invalidateAll()
      } else {
        csToast.error('배송지 저장에 실패했습니다.')
      }
    } catch { csToast.error('네트워크 오류가 발생했습니다.') }
    finally  { isSubmittingAddr = false }
  }

  /* ── 개인정보 동의 체크박스 */
  let check1 = $state(profile?.allow_privacy_consent     ?? false)
  let check2 = $state(profile?.allow_third_party_consent ?? false)

  $effect(() => {
    check1 = profile?.allow_privacy_consent     ?? false
    check2 = profile?.allow_third_party_consent ?? false
  })

  async function saveConsent(field: 'allow_privacy_consent' | 'allow_third_party_consent', value: boolean) {
    const fd = new FormData()
    fd.set(field, String(value))
    try {
      const res = await fetch('?/updateConsent', { method: 'POST', body: fd })
      if (!res.ok) {
        // 저장 실패 시 로컬 상태 롤백
        if (field === 'allow_privacy_consent')     check1 = !value
        else                                        check2 = !value
        csToast.error('동의 저장 실패')
      }
    } catch {
      if (field === 'allow_privacy_consent')     check1 = !value
      else                                        check2 = !value
      csToast.error('네트워크 오류')
    }
  }

  /* ── 본인증명 업로드 */
  const IDENTITY_TYPES = [
    { value: 'student',  label: '학생증' },
    { value: 'resident', label: '주민등록증' },
    { value: 'driver',   label: '운전면허증' },
    { value: 'other',    label: '기타' },
  ] as const

  let identityDocUrl     = $state(profile?.identity_doc_url    ?? null)
  let identityVerifiedAt = $state(profile?.identity_verified_at ?? null)
  let identityType       = $state(profile?.identity_type        ?? 'general')
  let showIdentityForm   = $state(false)
  let identityFile       = $state<File | null>(null)
  let identityPreview    = $state<string | null>(null)
  let identityIsPdf      = $state(false)
  let identitySelType    = $state('student')
  let isUploadingId      = $state(false)
  let identityError      = $state('')

  $effect(() => {
    identityDocUrl     = profile?.identity_doc_url     ?? null
    identityVerifiedAt = profile?.identity_verified_at ?? null
    identityType       = profile?.identity_type        ?? 'general'
  })

  function handleIdentityFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file  = input.files?.[0] ?? null
    identityError = ''
    identityFile  = null
    identityPreview = null
    if (!file) return
    const result = validateUploadFile(file)
    if (!result.ok) { identityError = result.error ?? ''; return }
    identityFile  = file
    identityIsPdf = file.type === 'application/pdf'
    if (!identityIsPdf) identityPreview = URL.createObjectURL(file)
  }

  async function uploadIdentityDoc() {
    if (!identityFile) return
    isUploadingId = true
    identityError = ''
    const fd = new FormData()
    fd.set('type',          'identity')
    fd.set('file',          identityFile)
    fd.set('identity_type', identitySelType)
    try {
      const res  = await fetch('/api/profile/upload-doc', { method: 'POST', body: fd })
      const data = await res.json() as { ok: boolean; docUrl?: string; verifiedAt?: string; error?: string }
      if (!data.ok) { identityError = data.error ?? '업로드 실패'; return }
      csToast.success('본인증명이 등록되었습니다.')
      showIdentityForm = false
      identityFile     = null
      identityPreview  = null
      await invalidateAll()
    } catch { identityError = '네트워크 오류가 발생했습니다.' }
    finally  { isUploadingId = false }
  }

  function cancelIdentityUpload() {
    showIdentityForm = false
    identityFile     = null
    identityPreview  = null
    identityError    = ''
  }

  function openIdentityDoc() {
    if (identityDocUrl) window.open(identityDocUrl, '_blank', 'noopener,noreferrer')
  }

  function formatDocDate(iso: string): string {
    const d = new Date(iso)
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }

  function identityTypeLabel(type: string): string {
    const map: Record<string, string> = {
      student: '학생증', resident: '주민등록증', driver: '운전면허증',
      other: '기타 증명', general: '일반 증명',
    }
    return map[type] ?? '증명서'
  }

  /* ── 외국인증명 업로드 */
  let foreignDocUrl     = $state(profile?.foreign_doc_url     ?? null)
  let foreignVerifiedAt = $state(profile?.foreign_verified_at ?? null)
  let showForeignForm   = $state(false)
  let foreignFile       = $state<File | null>(null)
  let foreignPreview    = $state<string | null>(null)
  let foreignIsPdf      = $state(false)
  let isUploadingForeign = $state(false)
  let foreignError      = $state('')

  $effect(() => {
    foreignDocUrl     = profile?.foreign_doc_url     ?? null
    foreignVerifiedAt = profile?.foreign_verified_at ?? null
  })

  function handleForeignFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file  = input.files?.[0] ?? null
    foreignError = ''
    foreignFile  = null
    foreignPreview = null
    if (!file) return
    const result = validateUploadFile(file)
    if (!result.ok) { foreignError = result.error ?? ''; return }
    foreignFile  = file
    foreignIsPdf = file.type === 'application/pdf'
    if (!foreignIsPdf) foreignPreview = URL.createObjectURL(file)
  }

  async function uploadForeignDoc() {
    if (!foreignFile) return
    isUploadingForeign = true
    foreignError = ''
    const fd = new FormData()
    fd.set('type', 'foreign')
    fd.set('file', foreignFile)
    try {
      const res  = await fetch('/api/profile/upload-doc', { method: 'POST', body: fd })
      const data = await res.json() as { ok: boolean; docUrl?: string; verifiedAt?: string; error?: string }
      if (!data.ok) { foreignError = data.error ?? '업로드 실패'; return }
      csToast.success('외국인증명이 등록되었습니다.')
      showForeignForm = false
      foreignFile     = null
      foreignPreview  = null
      await invalidateAll()
    } catch { foreignError = '네트워크 오류가 발생했습니다.' }
    finally  { isUploadingForeign = false }
  }

  function cancelForeignUpload() {
    showForeignForm = false
    foreignFile     = null
    foreignPreview  = null
    foreignError    = ''
  }

  function openForeignDoc() {
    if (foreignDocUrl) window.open(foreignDocUrl, '_blank', 'noopener,noreferrer')
  }

</script>

<!-- ── 카카오 주소 검색 레이어 모달 ── -->
{#if showKakaoModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="kakao-modal-overlay" onclick={() => { showKakaoModal = false }} role="dialog" aria-modal="true" aria-label="주소 검색">
    <div class="kakao-modal-inner" onclick={(e) => e.stopPropagation()}>
      <div class="kakao-modal-header">
        <span class="kakao-modal-title">주소 검색</span>
        <button class="kakao-close-btn" onclick={() => { showKakaoModal = false }} aria-label="닫기">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div bind:this={kakaoContainer} class="kakao-embed-wrap"></div>
    </div>
  </div>
{/if}

<div class="flex flex-col gap-[10px] w-full">

  <!-- 개인정보 섹션 -->
  <div class="bg-white rounded-tl-[30px] rounded-tr-[30px] w-full">
    <div class="flex flex-col items-start px-[25px] py-[40px] gap-0">

      <!-- 로그인 정보 카드 -->
      <div class="bg-[#f6f6f6] rounded-[30px] w-full">
        <div class="flex items-center justify-between p-[20px]">
          <div class="flex flex-col gap-[10px]">
            <p class="profile-card-id">
              {displayEmail.split('@')[0] || '—'}
            </p>
            <p class="profile-card-date">
              {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '') : '—'}
            </p>
          </div>
          <div class="profile-avatar-initial" aria-hidden="true">
            {(displayEmail[0] ?? '?').toUpperCase()}
          </div>
        </div>
      </div>

      <!-- 개인정보 폼 -->
      <div class="flex flex-col gap-[20px] items-start pt-[30px] w-full">
        <div class="flex flex-col gap-[10px] w-full">
          <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[16px] text-[#444] tracking-[-0.5px] leading-[1.6] whitespace-nowrap">개인정보</p>
          <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">항목을 클릭하면 수정할 수 있습니다</p>
        </div>

        <div class="fields-wrap">

          <!-- ── 이름 ───────────────────────────────────────────── -->
          {#if editingField === 'name'}
            <input
              bind:this={nameInput}
              type="text"
              class="field-input"
              bind:value={editName}
              placeholder="이름 입력"
              onblur={handleNameBlur}
              onkeydown={handleNameKeydown}
            />
          {:else}
            <button class="field-display" onclick={openEditName}>
              <span class:text-value={!!displayName} class:text-placeholder={!displayName}>
                {displayName || '이름 미등록'}
              </span>
              <span class="edit-hint">수정</span>
            </button>
          {/if}

          <!-- ── 이메일 ─────────────────────────────────────────── -->
          {#if editingField === 'email'}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <div
              class="email-edit-wrap"
              bind:this={emailWrap}
              onfocusout={handleEmailWrapFocusout}
            >
              <div class="email-row">
                <input
                  type="text"
                  class="field-input email-local"
                  bind:value={editEmailLocal}
                  placeholder="아이디"
                  autocomplete="off"
                  onkeydown={handleEmailKeydown}
                />
                <span class="at-sign">@</span>
                <div class="email-domain-wrap">
                  <input
                    type="text"
                    class="field-input email-domain"
                    value={editEmailDomain}
                    oninput={handleDomainInput}
                    onfocus={() => { showDomainList = true }}
                    placeholder="도메인"
                    autocomplete="off"
                    onkeydown={handleEmailKeydown}
                  />
                  {#if showDomainList && filteredDomains.length > 0}
                    <ul class="domain-list" role="listbox" aria-label="이메일 도메인 목록">
                      {#each filteredDomains as d}
                        <li>
                          <button
                            type="button"
                            class="domain-item"
                            role="option"
                            aria-selected={editEmailDomain === d}
                            onmousedown={(e) => { e.preventDefault(); selectDomain(d) }}
                          >
                            {d}
                          </button>
                        </li>
                      {/each}
                    </ul>
                  {/if}
                </div>
              </div>
            </div>
          {:else}
            <button class="field-display" onclick={openEditEmail}>
              <span class:text-value={!!displayEmail} class:text-placeholder={!displayEmail}>
                {displayEmail || '이메일 미등록'}
              </span>
              <span class="edit-hint">수정</span>
            </button>
          {/if}

          <!-- ── 생년월일 ─────────────────────────────────────── -->
          {#if editingField === 'birthdate'}
            <div class="birthdate-edit-wrap">
              <div class="field-display-static">
                <span class:text-value={!!editBirthdate} class:text-placeholder={!editBirthdate}>
                  {editBirthdate ? formatBirthdate(editBirthdate) : '날짜를 선택해 주세요'}
                </span>
                <button type="button" class="edit-hint-btn" onclick={() => { editingField = null }}>닫기</button>
              </div>
              <div class="calendar-panel">
                <CalendarGrid
                  value={editBirthdate}
                  onselect={handleBirthdateSelect}
                  disablePast={false}
                />
              </div>
            </div>
          {:else}
            <button class="field-display" onclick={openEditBirthdate}>
              <span class:text-value={!!displayBirthdate} class:text-placeholder={!displayBirthdate}>
                {displayBirthdate ? formatBirthdate(displayBirthdate) : '생년월일 미등록'}
              </span>
              <span class="edit-hint">수정</span>
            </button>
          {/if}

          <!-- ── 휴대폰 (OTP — 버튼 유지) ────────────────────── -->
          {#if editingField === 'phone'}
            <div class="phone-edit-wrap">
              <div class="phone-row">
                <input
                  type="tel"
                  class="field-input phone-input"
                  value={editPhone}
                  oninput={handlePhoneInput}
                  placeholder="010-0000-0000"
                  maxlength={13}
                  onkeydown={(e) => { if (e.key === 'Escape') cancelPhone() }}
                />
                <button
                  type="button"
                  class="btn-send-otp"
                  onclick={sendOtp}
                  disabled={otpSending || (otpSent && otpCountdown > 0)}
                >
                  {otpSending ? '발송 중...' : otpSent ? '재발송' : '인증실행'}
                </button>
              </div>

              {#if otpSent}
                <div class="otp-row">
                  <div class="otp-input-wrap">
                    <input
                      type="text"
                      class="field-input otp-input"
                      bind:value={otpCode}
                      placeholder="6자리 인증번호"
                      maxlength={6}
                      inputmode="numeric"
                      pattern="[0-9]*"
                    />
                    {#if otpCountdown > 0}
                      <span class="otp-countdown">{fmtCountdown(otpCountdown)}</span>
                    {:else}
                      <span class="otp-expired">만료됨</span>
                    {/if}
                  </div>
                  <button
                    type="button"
                    class="btn-verify-otp"
                    onclick={verifyOtp}
                    disabled={isVerifyingPhone || otpCode.length !== 6 || otpCountdown <= 0}
                  >
                    {isVerifyingPhone ? '확인 중...' : '인증확인'}
                  </button>
                </div>
              {:else}
                <div class="otp-placeholder">
                  <span>6자리 인증번호를 입력</span>
                  <button type="button" class="btn-verify-otp" disabled>인증확인</button>
                </div>
              {/if}

              <button type="button" class="btn-cancel-phone" onclick={cancelPhone}>취소</button>
            </div>
          {:else}
            <button class="field-display" onclick={openEditPhone}>
              <span class:text-value={!!displayPhone} class:text-placeholder={!displayPhone}>
                {displayPhone ? formatPhoneDisplay(displayPhone) : '휴대폰 미등록'}
              </span>
              <span class="edit-hint">수정</span>
            </button>
          {/if}

        </div>

        <!-- 동의 항목 -->
        <div class="flex flex-col gap-[20px] w-full">
          <button class="flex items-center gap-[12px] w-full text-left consent-btn" onclick={() => { check1 = !check1; saveConsent('allow_privacy_consent', check1) }}>
            <span class="shrink-0">
              {#if check1}
                <svg fill="none" viewBox="0 0 20 20" width="20" height="20"><rect fill="#444444" height="20" rx="5" width="20" /><path d="M3 10.7143L7.2 15L17 5" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" /></svg>
              {:else}
                <svg fill="none" viewBox="0 0 20 20" width="20" height="20"><rect fill="white" height="18" rx="4" width="18" x="1" y="1" /><rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1" /></svg>
              {/if}
            </span>
            <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#444] tracking-[-0.5px] leading-[1.6]">[옵션] 개인정보 수집 및 이용 동의 (보기)</span>
          </button>
          <button class="flex items-center gap-[12px] w-full text-left consent-btn" onclick={() => { check2 = !check2; saveConsent('allow_third_party_consent', check2) }}>
            <span class="shrink-0">
              {#if check2}
                <svg fill="none" viewBox="0 0 20 20" width="20" height="20"><rect fill="#444444" height="20" rx="5" width="20" /><path d="M3 10.7143L7.2 15L17 5" stroke="white" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" /></svg>
              {:else}
                <svg fill="none" viewBox="0 0 20 20" width="20" height="20"><rect fill="white" height="18" rx="4" width="18" x="1" y="1" /><rect height="18" rx="4" stroke="#AAAAAA" stroke-width="2" width="18" x="1" y="1" /></svg>
              {/if}
            </span>
            <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#444] tracking-[-0.5px] leading-[1.6]">[옵션] 개인정보 제 3자 제공 (보기)</span>
          </button>
        </div>

      </div>

    </div>
  </div>

  <!-- 본인 증명 섹션 -->
  <div class="doc-card">
    <div class="doc-card-inner">
      <div class="doc-section-head">
        <div>
          <p class="doc-title">본인 증명</p>
          <p class="doc-subtitle">신원 확인용 증명서를 등록하세요</p>
        </div>
        {#if identityDocUrl && !showIdentityForm}
          <button class="btn-doc-re" onclick={() => { showIdentityForm = true; identitySelType = identityType ?? 'student' }}>재등록</button>
        {/if}
      </div>

      {#if identityDocUrl && !showIdentityForm}
        <!-- 등록 완료 상태 -->
        <div class="doc-registered">
          <span class="doc-type-badge">{identityTypeLabel(identityType ?? 'general')}</span>
          {#if identityVerifiedAt}
            <span class="doc-date">{formatDocDate(identityVerifiedAt)}</span>
          {/if}
          <button type="button" class="btn-doc-view" onclick={openIdentityDoc}>보기</button>
        </div>
      {:else if showIdentityForm}
        <!-- 업로드 폼 -->
        <div class="doc-upload-wrap">
          <!-- 증명 유형 선택 -->
          <div class="doc-type-row">
            {#each IDENTITY_TYPES as t}
              <button
                type="button"
                class="btn-doc-type"
                class:active={identitySelType === t.value}
                onclick={() => identitySelType = t.value}
              >{t.label}</button>
            {/each}
          </div>

          <!-- 파일 선택 -->
          <label class="doc-file-label">
            <input
              type="file"
              class="sr-only"
              accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
              onchange={handleIdentityFileChange}
            />
            <span class="doc-file-btn">
              {#if identityFile}
                {#if identityIsPdf}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  {identityFile.name}
                {:else}
                  <img src={identityPreview ?? ''} alt="미리보기" class="doc-img-preview" />
                {/if}
              {:else}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                <span>파일 선택</span>
                <span class="doc-file-hint">PNG · JPEG · WebP · HEIF · PDF</span>
              {/if}
            </span>
          </label>

          {#if identityError}
            <p class="doc-error" role="alert">{identityError}</p>
          {/if}

          <div class="doc-upload-btns">
            <button type="button" class="btn-doc-cancel" onclick={cancelIdentityUpload}>취소</button>
            <button
              type="button"
              class="btn-doc-upload"
              onclick={uploadIdentityDoc}
              disabled={isUploadingId || !identityFile}
            >{isUploadingId ? '업로드 중...' : '등록하기'}</button>
          </div>
        </div>
      {:else}
        <!-- 미등록 상태 -->
        <div class="doc-upload-wrap">
          <div class="doc-type-row">
            {#each IDENTITY_TYPES as t}
              <button
                type="button"
                class="btn-doc-type"
                class:active={identitySelType === t.value}
                onclick={() => identitySelType = t.value}
              >{t.label}</button>
            {/each}
          </div>

          <label class="doc-file-label">
            <input
              type="file"
              class="sr-only"
              accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
              onchange={handleIdentityFileChange}
            />
            <span class="doc-file-btn">
              {#if identityFile}
                {#if identityIsPdf}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  {identityFile.name}
                {:else}
                  <img src={identityPreview ?? ''} alt="미리보기" class="doc-img-preview" />
                {/if}
              {:else}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                <span>파일 선택</span>
                <span class="doc-file-hint">PNG · JPEG · WebP · HEIF · PDF</span>
              {/if}
            </span>
          </label>

          {#if identityError}
            <p class="doc-error" role="alert">{identityError}</p>
          {/if}

          <div class="doc-upload-btns">
            <button
              type="button"
              class="btn-doc-upload"
              onclick={uploadIdentityDoc}
              disabled={isUploadingId || !identityFile}
            >{isUploadingId ? '업로드 중...' : '등록하기'}</button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- 외국인 증명 섹션 -->
  <div class="doc-card">
    <div class="doc-card-inner">
      <div class="doc-section-head">
        <div>
          <p class="doc-title">외국인 증명</p>
          <p class="doc-subtitle">여권 또는 외국인등록증을 등록하세요</p>
        </div>
        {#if foreignDocUrl && !showForeignForm}
          <button class="btn-doc-re" onclick={() => { showForeignForm = true }}>재등록</button>
        {/if}
      </div>

      {#if foreignDocUrl && !showForeignForm}
        <!-- 등록 완료 상태 -->
        <div class="doc-registered">
          <span class="doc-type-badge">외국인증명</span>
          {#if foreignVerifiedAt}
            <span class="doc-date">{formatDocDate(foreignVerifiedAt)}</span>
          {/if}
          <button type="button" class="btn-doc-view" onclick={openForeignDoc}>보기</button>
        </div>
      {:else}
        <!-- 업로드 폼 (미등록 / 재등록) -->
        <div class="doc-upload-wrap">
          <label class="doc-file-label">
            <input
              type="file"
              class="sr-only"
              accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
              onchange={handleForeignFileChange}
            />
            <span class="doc-file-btn">
              {#if foreignFile}
                {#if foreignIsPdf}
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  {foreignFile.name}
                {:else}
                  <img src={foreignPreview ?? ''} alt="미리보기" class="doc-img-preview" />
                {/if}
              {:else}
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                <span>파일 선택</span>
                <span class="doc-file-hint">PNG · JPEG · WebP · HEIF · PDF</span>
              {/if}
            </span>
          </label>

          {#if foreignError}
            <p class="doc-error" role="alert">{foreignError}</p>
          {/if}

          <div class="doc-upload-btns">
            {#if showForeignForm}
              <button type="button" class="btn-doc-cancel" onclick={cancelForeignUpload}>취소</button>
            {/if}
            <button
              type="button"
              class="btn-doc-upload"
              onclick={uploadForeignDoc}
              disabled={isUploadingForeign || !foreignFile}
            >{isUploadingForeign ? '업로드 중...' : '등록하기'}</button>
          </div>
        </div>
      {/if}
    </div>
  </div>

  <!-- 기본 배송지 섹션 — 별도 탭에서 관리하므로 숨김 -->
  {#if false}
  <div class="bg-white w-full">
    <div class="flex flex-col gap-[24px] items-start px-[25px] py-[40px]">

      <!-- 헤더 -->
      <div class="addr-section-header">
        <div class="flex flex-col gap-[6px]">
          <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[16px] text-[#444] tracking-[-0.5px] leading-[1.6]">기본 배송지</p>
          <p class="font-['Noto_Sans_KR',sans-serif] font-medium text-[12px] text-[#aaa] tracking-[-0.5px] leading-[1.6]">미리 등록하면 매번 번거로운 입력 끝 · 최대 5개</p>
        </div>
        {#if !editingAddress && addresses.length < 5}
          <button
            class="btn-addr-add"
            onclick={() => {
              if (addresses.length === 0) {
                openKakaoModal()
              } else {
                onswitchtab('address')
              }
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            추가
          </button>
        {/if}
      </div>

      <!-- 등록된 주소 표시 -->
      {#if !editingAddress}
        {#if defaultAddress}
          <!-- 기본 주소 카드 -->
          <div class="addr-card-default">
            <div class="addr-card-top">
              <span class="addr-badge-sm badge-default">기본</span>
              {#if addresses.length > 1}
                <button class="btn-view-all" onclick={() => onswitchtab('address')}>
                  전체 {addresses.length}개 관리 →
                </button>
              {/if}
            </div>
            <p class="addr-card-road">{defaultAddress.road_address}</p>
            {#if defaultAddress.detail_address}
              <p class="addr-card-detail">{defaultAddress.detail_address}</p>
            {/if}
            {#if defaultAddress.postal_code}
              <p class="addr-card-postal">[{defaultAddress.postal_code}]</p>
            {/if}
            <button class="btn-addr-edit" onclick={openAddressEdit}>수정</button>
          </div>
        {:else}
          <!-- 미등록 상태: 클릭 가능한 placeholder -->
          <div class="flex flex-col gap-[10px] w-full">
            <button class="field-display" onclick={openKakaoModal}>
              <span class="text-placeholder">기본주소 입력 (탭하여 주소 검색)</span>
              <svg class="addr-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            </button>
            <div class="field-display" style="cursor:default;opacity:0.45;pointer-events:none;">
              <span class="text-placeholder">상세주소 입력</span>
            </div>
          </div>
        {/if}
      {:else}
        <!-- 편집 모드 -->
        <div class="addr-edit-wrap">
          <button class="field-display addr-kakao-btn" onclick={openKakaoModal}>
            <span class:text-value={!!newRoadAddress} class:text-placeholder={!newRoadAddress}>
              {newRoadAddress || '기본주소 클릭하여 검색'}
            </span>
            <svg class="addr-search-ico" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          </button>
          {#if newPostalCode}
            <p class="addr-postal-hint">[{newPostalCode}]</p>
          {/if}
          <input
            bind:this={detailInput}
            type="text"
            class="field-input"
            bind:value={newDetailAddress}
            placeholder="상세주소 입력 (동·호수 등)"
            onkeydown={(e) => { if (e.key === 'Escape') cancelAddressEdit() }}
          />
          <div class="addr-edit-btns">
            <button type="button" class="btn-addr-cancel" onclick={cancelAddressEdit}>취소</button>
            <button
              type="button"
              class="btn-addr-save"
              onclick={saveAddress}
              disabled={isSubmittingAddr || !newRoadAddress.trim()}
            >
              {isSubmittingAddr ? '저장 중...' : '배송지 저장'}
            </button>
          </div>
        </div>
      {/if}

    </div>
  </div>
  {/if}

  <!-- 알림설정 — 별도 탭에서 관리하므로 숨김 -->
  {#if false}
  <NotificationTabContent rentalAlert={notifRental} benefitAlert={notifBenefit} />
  {/if}

</div>

<style>
  .text-value       { color: #100b32; }
  .text-placeholder { color: #b6b6b6; }

  .fields-wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  /* ── 읽기 전용 필드 (클릭 가능) */
  .field-display {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    background: #f6f6f6;
    border: none;
    border-radius: 15px;
    padding: 12px 20px;
    cursor: pointer;
    text-align: left;
    transition: background 0.15s;
    min-height: 44px;
  }
  .field-display:hover { background: #eeedf6; }
  .field-display > span:first-child {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
    font-size: 14px;
    letter-spacing: -0.5px;
    line-height: 1.6;
  }
  .edit-hint {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: #aaa;
    flex-shrink: 0;
    margin-left: 8px;
  }

  /* ── 편집 인풋 공통 */
  .field-input {
    background: #f6f6f6;
    border: 1.5px solid #3B2F8A;
    border-radius: 15px;
    padding: 10px 16px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 500;
    color: #100b32;
    outline: none;
    min-height: 44px;
    width: 100%;
    transition: border-color 0.15s, box-shadow 0.15s;
  }
  .field-input:focus {
    border-color: #201857;
    box-shadow: 0 0 0 3px rgba(59,47,138,0.12);
  }
  .field-input::placeholder { color: #b6b6b6; }

  /* ── 이메일 편집 */
  .email-edit-wrap { display: flex; flex-direction: column; gap: 0; }
  .email-row { display: flex; align-items: center; gap: 6px; }
  .email-local  { flex: 0 0 40%; }
  .at-sign {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 16px;
    color: #666;
    flex-shrink: 0;
  }
  .email-domain-wrap { flex: 1; position: relative; }
  .email-domain { width: 100%; }

  .domain-list {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    background: white;
    border: 1.5px solid #3B2F8A;
    border-radius: 14px;
    z-index: 30;
    list-style: none;
    margin: 0;
    padding: 4px;
    box-shadow: 0 4px 20px rgba(59,47,138,0.14);
    overflow: hidden;
  }
  .domain-item {
    display: flex;
    align-items: center;
    width: 100%;
    background: none;
    border: none;
    padding: 10px 14px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: #100b32;
    cursor: pointer;
    border-radius: 10px;
    min-height: 40px;
    text-align: left;
    transition: background 0.12s;
  }
  .domain-item:hover,
  .domain-item[aria-selected="true"] { background: #ECEBF4; color: #3B2F8A; font-weight: 700; }

  /* ── 생년월일 편집 */
  .birthdate-edit-wrap { display: flex; flex-direction: column; gap: 10px; }

  .field-display-static {
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: #f0eff8;
    border: 1.5px solid #3B2F8A;
    border-radius: 15px;
    padding: 10px 16px;
    min-height: 44px;
  }
  .field-display-static > span {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 500;
    font-size: 14px;
    letter-spacing: -0.5px;
  }
  .edit-hint-btn {
    background: none;
    border: none;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: #aaa;
    cursor: pointer;
    flex-shrink: 0;
    padding: 2px 6px;
  }
  .edit-hint-btn:hover { color: #666; }

  .calendar-panel {
    background: white;
    border: 1.5px solid #e0dff0;
    border-radius: 20px;
    padding: 20px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.06);
    width: 100%;
    max-width: 340px;
  }

  @media (max-width: 640px) {
    .calendar-panel {
      max-width: 100%;
    }
  }

  /* ── 휴대폰 OTP */
  .phone-edit-wrap { display: flex; flex-direction: column; gap: 8px; }
  .phone-row { display: flex; gap: 10px; align-items: center; }
  .phone-input { flex: 1; }

  .btn-send-otp {
    flex-shrink: 0;
    background: none;
    border: 1.5px solid #201857;
    border-radius: 30px;
    padding: 0 16px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: #201857;
    cursor: pointer;
    min-height: 44px;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .btn-send-otp:hover:not(:disabled) { background: #ECEBF4; }
  .btn-send-otp:disabled { opacity: 0.4; cursor: not-allowed; }

  .otp-row { display: flex; gap: 10px; align-items: center; }
  .otp-input-wrap { flex: 1; position: relative; display: flex; align-items: center; }
  .otp-input { padding-right: 60px; }
  .otp-countdown { position: absolute; right: 14px; font-family: 'Noto Sans KR', sans-serif; font-size: 13px; color: #FF4500; font-weight: 700; pointer-events: none; }
  .otp-expired   { position: absolute; right: 14px; font-family: 'Noto Sans KR', sans-serif; font-size: 13px; color: #aaa; pointer-events: none; }

  .btn-verify-otp {
    flex-shrink: 0;
    background: none;
    border: 1.5px solid #444;
    border-radius: 30px;
    padding: 0 16px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: #444;
    cursor: pointer;
    min-height: 44px;
    white-space: nowrap;
    transition: background 0.15s;
  }
  .btn-verify-otp:hover:not(:disabled) { background: #f0eff8; }
  .btn-verify-otp:disabled { opacity: 0.4; cursor: not-allowed; }

  .otp-placeholder { display: flex; gap: 10px; align-items: center; }
  .otp-placeholder > span {
    flex: 1;
    background: #f6f6f6;
    border: 1.5px solid #e0dff0;
    border-radius: 15px;
    padding: 10px 16px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: #b6b6b6;
    min-height: 44px;
    display: flex;
    align-items: center;
  }

  .btn-cancel-phone {
    align-self: flex-start;
    background: none;
    border: none;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: #aaa;
    cursor: pointer;
    padding: 4px 0;
  }
  .btn-cancel-phone:hover { color: #666; }

  .profile-card-id {
    font: 700 20px/160% var(--font-kr);
    color: var(--cs-text);
    letter-spacing: -0.5px;
  }
  .profile-card-date {
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    letter-spacing: -0.5px;
  }

  .profile-avatar-initial {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 70px;
    height: 70px;
    border-radius: 50%;
    background: var(--cs-purple-pale);
    color: var(--cs-dark);
    font-family: var(--font-en-display);
    font-size: 28px;
    font-weight: 700;
    flex-shrink: 0;
    text-transform: uppercase;
    letter-spacing: -1px;
  }

  .consent-btn {
    border: none;
    outline: none;
    background: transparent;
    padding: 0;
  }
  .consent-btn:focus-visible { outline: 2px solid #3B2F8A; border-radius: 6px; }

  /* ── 배송지 섹션 */
  .addr-section-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    width: 100%;
  }

  .btn-addr-add {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 32px;
    padding: 0 14px;
    background: #100b32;
    color: white;
    border: none;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.15s;
  }
  .btn-addr-add:hover { background: #201857; }

  .addr-card-default {
    background: #f0eff8;
    border: 2px solid #100b32;
    border-radius: 20px;
    padding: 16px 20px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    width: 100%;
    position: relative;
  }

  .addr-card-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 4px;
  }

  .addr-badge-sm {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 8px;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 11px;
  }
  .badge-default { background: #100b32; color: white; }

  .btn-view-all {
    background: none;
    border: none;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    color: #3B2F8A;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
    margin-left: auto;
    white-space: nowrap;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .btn-view-all:hover { color: #201857; }

  .addr-card-road {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 15px;
    color: #100b32;
    letter-spacing: -0.5px;
    line-height: 1.5;
    margin: 0;
  }

  .addr-card-detail,
  .addr-card-postal {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: #666;
    margin: 0;
    letter-spacing: -0.3px;
  }

  .btn-addr-edit {
    align-self: flex-start;
    background: none;
    border: 1px solid #ccc;
    border-radius: 30px;
    padding: 4px 12px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: #666;
    cursor: pointer;
    margin-top: 6px;
    transition: border-color 0.12s, color 0.12s;
  }
  .btn-addr-edit:hover { border-color: #100b32; color: #100b32; }

  /* 편집 모드 */
  .addr-edit-wrap {
    display: flex;
    flex-direction: column;
    gap: 10px;
    width: 100%;
  }

  .addr-kakao-btn {
    cursor: pointer;
  }

  .addr-search-ico {
    flex-shrink: 0;
    color: #888;
    margin-left: 8px;
  }

  .addr-postal-hint {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: #888;
    margin: 0;
    padding-left: 4px;
  }

  .addr-edit-btns {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 4px;
  }

  .btn-addr-cancel {
    height: 44px;
    padding: 0 20px;
    background: white;
    border: 1px solid #ddd;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 600;
    color: #666;
    cursor: pointer;
    transition: background 0.12s;
  }
  .btn-addr-cancel:hover { background: #f0f0f0; }

  .btn-addr-save {
    height: 44px;
    padding: 0 24px;
    background: #FF3535;
    border: none;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    font-weight: 700;
    color: white;
    cursor: pointer;
    transition: background 0.15s;
  }
  .btn-addr-save:hover:not(:disabled) { background: #CF0000; }
  .btn-addr-save:disabled { background: #ccc; cursor: not-allowed; }

  /* ── 카카오 주소 레이어 모달 */
  .kakao-modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(16, 11, 50, 0.55);
    z-index: 300;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
    backdrop-filter: blur(2px);
  }

  .kakao-modal-inner {
    background: white;
    border-radius: 24px;
    width: 100%;
    max-width: 540px;
    height: 520px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(16,11,50,0.25);
  }

  .kakao-modal-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 20px 16px;
    border-bottom: 1px solid #f0eef8;
    flex-shrink: 0;
  }

  .kakao-modal-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 16px;
    color: #100b32;
    letter-spacing: -0.5px;
  }

  .kakao-close-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    background: #f6f6f6;
    border: none;
    border-radius: 50%;
    color: #666;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    flex-shrink: 0;
  }
  .kakao-close-btn:hover { background: #ECEBF4; color: #100b32; }

  .kakao-embed-wrap {
    flex: 1;
    min-height: 0;
  }

  /* 모바일: 바텀시트 스타일 */
  @media (max-width: 640px) {
    .kakao-modal-overlay {
      padding: 0;
      align-items: flex-end;
    }
    .kakao-modal-inner {
      border-radius: 24px 24px 0 0;
      height: 82svh;
      max-width: 100%;
    }
  }

  /* ── 문서 업로드 섹션 공통 */
  .doc-card {
    background: white;
    border-radius: 30px;
    width: 100%;
  }
  .doc-card-inner {
    display: flex;
    flex-direction: column;
    gap: 20px;
    padding: 30px 25px;
  }
  .doc-section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .doc-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 600;
    font-size: 16px;
    color: #444;
    letter-spacing: -0.5px;
    line-height: 1.6;
    margin: 0;
  }
  .doc-subtitle {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 400;
    font-size: 12px;
    color: #aaa;
    letter-spacing: -0.3px;
    line-height: 1.6;
    margin: 0;
  }

  /* 등록 완료 상태 */
  .doc-registered {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
    background: #f0eff8;
    border-radius: 20px;
    padding: 14px 18px;
  }
  .doc-type-badge {
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 12px;
    background: #3B2F8A;
    color: white;
    border-radius: 99px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 12px;
    white-space: nowrap;
  }
  .doc-date {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: #666;
    flex: 1;
  }
  .btn-doc-view {
    flex-shrink: 0;
    height: 32px;
    padding: 0 16px;
    background: none;
    border: 1.5px solid #3B2F8A;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: #3B2F8A;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .btn-doc-view:hover { background: #3B2F8A; color: white; }
  .btn-doc-re {
    flex-shrink: 0;
    background: none;
    border: none;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: #aaa;
    cursor: pointer;
    padding: 2px 0;
    text-decoration: underline;
    text-underline-offset: 2px;
    white-space: nowrap;
  }
  .btn-doc-re:hover { color: #666; }

  /* 업로드 폼 */
  .doc-upload-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }

  /* 증명 유형 선택 pill 버튼 행 */
  .doc-type-row {
    display: flex;
    gap: 8px;
    flex-wrap: wrap;
  }
  .btn-doc-type {
    height: 34px;
    padding: 0 16px;
    background: #f6f6f6;
    border: 1.5px solid transparent;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 600;
    font-size: 13px;
    color: #888;
    cursor: pointer;
    transition: all 0.15s;
    white-space: nowrap;
  }
  .btn-doc-type:hover { background: #ECEBF4; color: #3B2F8A; }
  .btn-doc-type.active {
    background: #3B2F8A;
    border-color: #3B2F8A;
    color: white;
  }

  /* 파일 선택 영역 */
  .doc-file-label { cursor: pointer; display: block; }
  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    white-space: nowrap;
    border: 0;
  }
  .doc-file-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    width: 100%;
    min-height: 100px;
    background: #f6f6f6;
    border: 2px dashed #d0ceea;
    border-radius: 20px;
    padding: 16px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: #888;
    transition: border-color 0.15s, background 0.15s;
    cursor: pointer;
    text-align: center;
  }
  .doc-file-btn:hover { border-color: #3B2F8A; background: #f0eff8; color: #3B2F8A; }
  .doc-file-hint {
    font-size: 12px;
    color: #bbb;
    letter-spacing: -0.3px;
  }
  .doc-img-preview {
    max-height: 80px;
    max-width: 100%;
    border-radius: 10px;
    object-fit: contain;
  }

  /* 오류 메시지 */
  .doc-error {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: #FF3535;
    margin: 0;
    padding: 0 4px;
  }

  /* 업로드 버튼 행 */
  .doc-upload-btns {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    align-items: center;
  }
  .btn-doc-cancel {
    height: 44px;
    padding: 0 20px;
    background: none;
    border: 1.5px solid #ddd;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 600;
    font-size: 14px;
    color: #888;
    cursor: pointer;
    transition: border-color 0.15s, color 0.15s;
    white-space: nowrap;
  }
  .btn-doc-cancel:hover { border-color: #aaa; color: #555; }
  .btn-doc-upload {
    height: 44px;
    padding: 0 28px;
    background: #3B2F8A;
    border: none;
    border-radius: 30px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 14px;
    color: white;
    cursor: pointer;
    transition: background 0.15s, opacity 0.15s;
    white-space: nowrap;
  }
  .btn-doc-upload:hover:not(:disabled) { background: #201857; }
  .btn-doc-upload:disabled { opacity: 0.4; cursor: not-allowed; }

  /* PC 반응형 */
  @media (min-width: 768px) {
    .doc-registered { flex-wrap: nowrap; }
    .doc-type-row { flex-wrap: nowrap; }
    .btn-doc-upload { height: 50px; }
    .btn-doc-cancel { height: 50px; }
  }
</style>
