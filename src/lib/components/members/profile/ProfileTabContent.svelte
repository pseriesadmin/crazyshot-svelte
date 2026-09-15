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
    otpCountdown = 180
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
      // context: 'profile' — 서버가 dev 환경 SMS 미발송 우회를 건너뛰고 실제 발송하도록 함
      // (Stephen 지시, 2026-09-11: 내정보 화면도 로컬에서 실제 문자 발송 검증 필요)
      const res  = await fetch('/api/profile/send-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: rawPhone, context: 'profile' }) })
      const data = await res.json() as { ok: boolean; error?: string }
      if (!data.ok) { csToast.error(data.error ?? 'SMS 발송 실패'); return }
      otpSent = true; otpCode = ''; startCountdown()
      csToast.success('인증번호가 발송되었습니다. (3분 이내 입력)')
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

  /* ── 본인증명·외국인증명 탭 UI (이번 세션 신규) */
  let activeDocTab = $state<'identity' | 'foreign'>('identity')

  /* ── 본인증명 업로드 */
  const IDENTITY_TYPES = [
    { value: 'student',       label: '학생증' },
    { value: 'resident',      label: '주민등록증' },
    { value: 'resident_copy', label: '주민등록등본' },
    { value: 'driver',        label: '운전면허증' },
    { value: 'other',         label: '기타' },
  ] as const

  const IDENTITY_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB — CMS 표준 기술 지침(개별 파일 업로드 용량)과 동일

  // front-uiux.md §22-5 "슬롯형" 표준 — 외국인증명과 동일 원칙. 다만 본인증명은 5종 전부가
  // 필수는 아니라("어떤 신분증을 갖고 있는지"는 사람마다 다름) 최소 1개 슬롯만 채우면 등록
  // 가능 — 슬롯을 채우는 것 자체가 곧 그 유형의 선택이므로 별도 체크박스 선택 단계가 없다.
  const IDENTITY_ALL_TYPE_LABELS: Record<string, string> = Object.fromEntries(
    IDENTITY_TYPES.map(t => [t.value, t.label]),
  )

  // 업로드 성공 후 invalidateAll()로 목록 길이가 바뀌면(등록목록 증가 + 병합슬롯 감소 등)
  // 그 위 콘텐츠 높이가 변해 브라우저가 기존 scrollY를 유지 못 하고 강제 보정 스크롤을 일으켜
  // "업로드했더니 화면이 다른 곳으로 튕기는(리다이렉트처럼 보이는)" 체감 결함이 된다
  // (2026-09-14 Stephen 리포트) — 이 카드 자체를 뷰포트에 계속 붙잡아 두어 방지.
  let docCardEl: HTMLDivElement | undefined = $state()

  let identityDocUrls    = $state<string[]>(profile?.identity_doc_url ?? [])
  let identityVerifiedAt = $state(profile?.identity_verified_at ?? null)
  let identityType       = $state<string[]>(profile?.identity_type ?? [])
  let showIdentityForm   = $state(false)
  let isDeletingIdentity = $state(false)

  $effect(() => {
    identityDocUrls    = profile?.identity_doc_url     ?? []
    identityVerifiedAt = profile?.identity_verified_at ?? null
    identityType       = profile?.identity_type        ?? []
  })

  function identityDocLabelAt(i: number): string {
    const t = profile?.identity_type?.[i]
    return t ? (IDENTITY_ALL_TYPE_LABELS[t] ?? `파일 ${i + 1}`) : `파일 ${i + 1}`
  }

  function identityDocTypeAt(i: number): string | null {
    return profile?.identity_type?.[i] ?? null
  }

  function openIdentityDoc(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  // 외국인증명과 동일한 원칙으로 통일(2026-09-15) — 슬롯별 자동 병합 제출로 전환된 이후
  // "재등록"을 눌러도 선택한 슬롯만 그 자리에서 즉시 교체될 뿐 나머지 유형은 보존되므로
  // "기존 정보를 삭제합니다" 확인창은 더 이상 사실과 맞지 않는다(requestForeignReRegister
  // 참고) — 문서를 열어보고 다시 닫을 수 있도록 cancelIdentityReRegister도 대칭으로 추가.
  function requestIdentityReRegister(): void {
    if (identityDocsBusy) return
    showIdentityForm = true
  }

  function cancelIdentityReRegister(): void {
    if (identityDocsBusy) return
    showIdentityForm = false
  }

  /* ── 본인증명 "개별 수정 / 추가 등록" 병합(merge) 업로드 — 등록완료 카드를 통째로
     초기화하는 재등록과 달리, 이미 등록된 다른 유형은 그대로 두고 이번에 고른 유형만
     upsert한다(서버 /api/profile/upload-doc의 merge=true 처리, RPC·스키마 변경 없음).
     identitySingleEditType===null → "추가 등록"(미등록 유형 전체) / 값 있음 → "개별 수정"(그 유형 1개)
     2026-09-14 Stephen 지시: 별도 "등록하기" 버튼 없이 슬롯에 파일을 선택하는 즉시 그
     1개 파일만 곧바로 업로드·반영한다(버튼 클릭 대기 없음 — 슬롯당 즉시 1건 제출). */
  let identitySingleEditType    = $state<string | null>(null)
  let identityMergeDragOverSlot = $state<string | null>(null)
  let isMergingIdentity         = $state(false)
  let identityMergeUploadingType = $state<string | null>(null)

  const identityUnregisteredTypes = $derived(IDENTITY_TYPES.filter(t => !identityType.includes(t.value)))
  const identityMergeTargetTypes  = $derived(
    identitySingleEditType
      ? IDENTITY_TYPES.filter(t => t.value === identitySingleEditType)
      : identityUnregisteredTypes,
  )
  // 본인증명 문서를 바꾸는 작업(개별수정 업로드/삭제/전체삭제) 중 하나라도 진행 중이면
  // 나머지 전부를 잠근다 — 서로 다른 두 mutating 요청이 동시에 같은 배열을 읽고 쓰면
  // 나중에 도착한 응답이 앞선 변경을 조용히 덮어쓰는 race가 가능하기 때문(RPC에 낙관적
  // 잠금이 없어 클라이언트에서 직렬화, 2026-09-14 QA 지적으로 추가).
  const identityDocsBusy = $derived(isDeletingIdentity || isMergingIdentity)

  function startIdentitySingleEdit(typeValue: string): void {
    if (identityDocsBusy) return
    identitySingleEditType = typeValue
  }

  function cancelIdentityMergeEdit(): void {
    identitySingleEditType = null
  }

  async function autoSubmitIdentityMergeFile(typeValue: string, file: File): Promise<void> {
    // 드래그앤드롭 경로는 disabled 속성이 아니라 label의 aria-disabled+pointer-events:none
    // CSS에만 의존해 클릭을 막고 있어(2026-09-14 QA 지적) — 그 CSS 셀렉터가 향후 리팩터링돼도
    // 안전하도록 여기서도 명시적으로 재확인한다(방어적 이중 장치, 버튼 경로는 이미 disabled로 보호됨).
    if (identityDocsBusy) return
    const result = validateUploadFile(file)
    if (!result.ok) { csToast.error(result.error ?? '파일 형식 오류'); return }
    if (file.size > IDENTITY_MAX_FILE_SIZE) { csToast.error('파일 크기는 10MB 이하여야 합니다.'); return }
    isMergingIdentity           = true
    identityMergeUploadingType  = typeValue
    // 업로드 중 사용자가 다른 유형 "수정"으로 전환해도(양쪽 다 잠겨있어 실제로는 불가능하지만
    // 방어적으로) 그 사이 새로 연 패널을 이 요청이 실수로 닫아버리지 않도록 시작 시점 스냅샷
    const editTypeAtStart = identitySingleEditType
    const wasSingleEdit    = Boolean(editTypeAtStart)
    const fd = new FormData()
    fd.set('type', 'identity')
    fd.set('merge', 'true')
    fd.append('file', file)
    fd.append('identity_type', typeValue)
    try {
      const res  = await fetch('/api/profile/upload-doc', { method: 'POST', body: fd })
      const data = await res.json() as { ok: boolean; error?: string }
      if (!data.ok) { csToast.error(data.error ?? '업로드 실패'); return }
      csToast.success(wasSingleEdit ? '수정되었습니다.' : '추가 등록되었습니다.')
      if (identitySingleEditType === editTypeAtStart) cancelIdentityMergeEdit()
      showIdentityForm = false // 최초등록/재등록 슬롯에서 호출된 경우 등록완료 화면으로 전환(foreign과 동일 원칙)
      await invalidateAll()
      await tick()
      docCardEl?.scrollIntoView({ block: 'nearest' })
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      isMergingIdentity          = false
      identityMergeUploadingType = null
    }
  }

  function handleIdentityMergeSlotFileChange(e: Event, typeValue: string): void {
    const input = e.target as HTMLInputElement
    const file  = input.files?.[0]
    input.value = ''
    if (file) void autoSubmitIdentityMergeFile(typeValue, file)
  }

  function handleIdentityMergeSlotDragOver(e: DragEvent, typeValue: string): void {
    e.preventDefault()
    identityMergeDragOverSlot = typeValue
  }

  function handleIdentityMergeSlotDragLeave(typeValue: string): void {
    if (identityMergeDragOverSlot === typeValue) identityMergeDragOverSlot = null
  }

  function handleIdentityMergeSlotDrop(e: DragEvent, typeValue: string): void {
    e.preventDefault()
    identityMergeDragOverSlot = null
    const file = e.dataTransfer?.files?.[0]
    if (file) void autoSubmitIdentityMergeFile(typeValue, file)
  }

  async function deleteIdentityDoc() {
    if (identityDocsBusy) return
    isDeletingIdentity = true
    try {
      const res  = await fetch('/api/profile/delete-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'identity' }),
      })
      const data = await res.json() as { ok: boolean; error?: string }
      if (!data.ok) { csToast.error(data.error ?? '삭제에 실패했습니다.'); return }
      csToast.success('본인증명이 삭제되었습니다.')
      identityDocUrls    = []
      identityType       = []
      identityVerifiedAt = null
      await invalidateAll()
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      isDeletingIdentity = false
    }
  }

  function requestIdentityDelete() {
    csToast.warning('본인증명을 완전히 삭제합니다.', {
      actionLabel: '확인',
      onClick: () => { void deleteIdentityDoc() },
    })
  }

  // 등록완료 목록 내 개별 항목 삭제(2026-09-14 신규) — RPC/스키마 변경 없이 신규 서버
  // 엔드포인트(/api/profile/delete-doc-item)에서 남은 (url,type) 짝만 계산해 기존
  // update_user_doc_url(부분 삭제)/delete_user_doc(마지막 1개 삭제 시 전체 초기화)에 위임한다.
  async function deleteDocItem(type: 'identity' | 'foreign', docType: string): Promise<void> {
    try {
      const res  = await fetch('/api/profile/delete-doc-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, docType }),
      })
      const data = await res.json() as { ok: boolean; error?: string }
      if (!data.ok) { csToast.error(data.error ?? '삭제에 실패했습니다.'); return }
      csToast.success('삭제되었습니다.')
      await invalidateAll()
      await tick()
      docCardEl?.scrollIntoView({ block: 'nearest' })
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    }
  }

  function requestIdentityDocDelete(docType: string, label: string): void {
    if (identityDocsBusy) return
    csToast.warning(`'${label}' 항목을 삭제합니다.`, {
      actionLabel: '확인',
      onClick: () => {
        if (identityDocsBusy) return // 토스트 확인 전 사이에 다른 변경이 시작됐으면 재차 차단
        isDeletingIdentity = true
        void deleteDocItem('identity', docType).finally(() => { isDeletingIdentity = false })
      },
    })
  }

  function formatDocDate(iso: string): string {
    const d = new Date(iso)
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }

  function identityTypeLabel(types: string[]): string {
    if (!types || types.length === 0) return '일반 증명'
    const map: Record<string, string> = {
      student: '학생증', resident: '주민등록증', resident_copy: '주민등록등본',
      driver: '운전면허증', other: '기타 증명', general: '일반 증명',
    }
    return types.map(t => map[t] ?? '증명서').join(', ')
  }

  /* ── 외국인증명 업로드 (체류기간 하위탭 + 콤보버튼 다중파일 등록, 이번 세션 신규) */
  const FOREIGN_SHORT_TYPES = [
    { value: 'passport_photo',            label: '여권사진면' },
    { value: 'accommodation_reservation', label: '숙소예약확인서' },
    { value: 'entry_eticket',             label: '입국 E-Ticket' },
    { value: 'exit_eticket',              label: '출국 E-Ticket' },
  ] as const

  const FOREIGN_LONG_TYPES = [
    { value: 'arc_front',         label: '외국인등록증 앞면' },
    { value: 'arc_back',          label: '외국인등록증 뒷면' },
    { value: 'passport_photo',    label: '여권사진면' },
    { value: 'foreign_fact_cert', label: '외국인사실증명서' },
  ] as const

  const FOREIGN_STAY_OPTIONS = [
    { value: 'short', label: '단기체류(90일 내)' },
    { value: 'long',  label: '장기체류(90일 이상)' },
  ] as const

  const FOREIGN_MAX_FILE_SIZE = 10 * 1024 * 1024 // 10MB — 본인증명과 동일 기준

  // front-uiux.md §22-5 "슬롯형" 표준 — 문서 종류별 드롭존을 각각 독립 배치하고,
  // 파일↔유형을 드롭존 자체로 1:1 고정한다(선택배열+파일배열을 별도 관리하지 않음).
  const FOREIGN_ALL_TYPE_LABELS: Record<string, string> = Object.fromEntries(
    [...FOREIGN_SHORT_TYPES, ...FOREIGN_LONG_TYPES].map(t => [t.value, t.label]),
  )

  let foreignDocUrls    = $state<string[]>(profile?.foreign_doc_urls ?? (profile?.foreign_doc_url ? [profile.foreign_doc_url] : []))
  let foreignVerifiedAt = $state(profile?.foreign_verified_at ?? null)
  let foreignTypeList   = $state<string[]>(profile?.foreign_type ?? [])
  let showForeignForm   = $state(false)
  let foreignStayType   = $state<'short' | 'long'>((profile?.foreign_stay_type as 'short' | 'long' | null) ?? 'short')
  let isDeletingForeign  = $state(false)

  const currentForeignTypes = $derived(foreignStayType === 'short' ? FOREIGN_SHORT_TYPES : FOREIGN_LONG_TYPES)

  $effect(() => {
    foreignDocUrls    = profile?.foreign_doc_urls ?? (profile?.foreign_doc_url ? [profile.foreign_doc_url] : [])
    foreignVerifiedAt = profile?.foreign_verified_at ?? null
    foreignTypeList   = profile?.foreign_type ?? []
    foreignStayType   = (profile?.foreign_stay_type as 'short' | 'long' | null) ?? 'short'
  })

  function foreignDocLabelAt(i: number): string {
    const t = profile?.foreign_type?.[i]
    return t ? (FOREIGN_ALL_TYPE_LABELS[t] ?? `파일 ${i + 1}`) : `파일 ${i + 1}`
  }

  function foreignDocTypeAt(i: number): string | null {
    return profile?.foreign_type?.[i] ?? null
  }

  function selectForeignStayType(value: 'short' | 'long') {
    if (foreignStayType === value) return
    foreignStayType = value
  }

  function openForeignDoc(url: string) {
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  function requestForeignReRegister() {
    // 슬롯별 자동 병합 제출로 통합된 이후(2026-09-14) — 선택한 슬롯만 그 자리에서 즉시
    // 교체될 뿐, 나머지 유형은 그대로 보존되므로 "기존 정보 전체 삭제" 경고는 더 이상
    // 사실과 다르다. 문구를 실제 동작에 맞게 정정.
    if (foreignDocsBusy) return
    showForeignForm = true
    foreignStayType = (profile?.foreign_stay_type as 'short' | 'long' | null) ?? 'short'
  }

  // "재등록" 진입 취소(2026-09-14 QA 지적으로 추가) — 확인 없이 즉시 슬롯이 열리는 대신,
  // 등록완료 상태로 돌아갈 수 있는 명시적 출구를 마련(오클릭 시 되돌릴 방법이 없던 결함 방지).
  // 등록된 문서가 아예 없는 최초등록 상태에서는 돌아갈 곳이 없으므로 노출하지 않는다.
  function cancelForeignReRegister(): void {
    if (foreignDocsBusy) return
    showForeignForm = false
    // requestForeignReRegister()와 대칭으로 체류기간도 실제 등록값으로 되돌린다(2026-09-14
    // QA 지적) — 안 그러면 재등록 폼에서 라디오만 바꾸고 제출 없이 취소해도 foreignStayType
    // 오염이 남아, 이후 "추가 등록"이 잘못된 콤보 기준으로 슬롯을 노출하고 passport_photo처럼
    // 단기/장기에 공통된 유형만 있는 경우 §22-5 정합성 가드(staleTypes)까지 우회해 실제
    // 등록 문서 구성과 foreign_stay_type이 불일치하는 데이터가 DB에 반영될 수 있었다.
    foreignStayType = (profile?.foreign_stay_type as 'short' | 'long' | null) ?? 'short'
  }

  async function deleteForeignDoc() {
    if (foreignDocsBusy) return
    isDeletingForeign = true
    try {
      const res  = await fetch('/api/profile/delete-doc', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'foreign' }),
      })
      const data = await res.json() as { ok: boolean; error?: string }
      if (!data.ok) { csToast.error(data.error ?? '삭제에 실패했습니다.'); return }
      csToast.success('외국인증명이 삭제되었습니다.')
      foreignDocUrls    = []
      foreignVerifiedAt = null
      await invalidateAll()
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      isDeletingForeign = false
    }
  }

  function requestForeignDelete() {
    csToast.warning('외국인증명을 완전히 삭제합니다.', {
      actionLabel: '확인',
      onClick: () => { void deleteForeignDoc() },
    })
  }

  function requestForeignDocDelete(docType: string, label: string): void {
    if (foreignDocsBusy) return
    csToast.warning(`'${label}' 항목을 삭제합니다.`, {
      actionLabel: '확인',
      onClick: () => {
        if (foreignDocsBusy) return // 토스트 확인 전 사이에 다른 변경이 시작됐으면 재차 차단
        isDeletingForeign = true
        void deleteDocItem('foreign', docType).finally(() => { isDeletingForeign = false })
      },
    })
  }

  // 외국인증명 등록완료 목록의 개별 "수정"(2026-09-14 신규) — 본인증명 병합업로드와 동일
  // 원리: 이미 등록된 다른 유형은 그대로 두고 이번에 고른 1개 유형만 upsert(서버
  // /api/profile/upload-doc의 merge=true를 foreign까지 확장, RPC·스키마 변경 없음).
  let foreignSingleEditType     = $state<string | null>(null)
  let foreignMergeUploadingType = $state<string | null>(null)
  let isMergingForeign          = $state(false)
  // 본인증명과 동일 원칙(identityDocsBusy 참고) — 외국인증명 문서를 바꾸는 작업 중
  // 하나라도 진행 중이면 나머지 전부를 잠가 동시 mutating 요청의 lost-update race를 방지.
  const foreignDocsBusy = $derived(isDeletingForeign || isMergingForeign)
  // 콤보(4종) 중 개별 삭제로 일부가 빠질 수 있게 된 이후(2026-09-14 개별삭제 신설) —
  // 본인증명의 identityUnregisteredTypes와 동일 원칙으로 "현재 콤보 기준 미등록 유형"을
  // 계산해 아래 병합 슬롯 그리드가 "추가 등록"까지 다시 노출하도록 함(전에는 개별 "수정"
  // 1슬롯만 있어 삭제로 빠진 유형을 되돌릴 방법이 UI에 없었음 — Stephen 리포트로 발견).
  const foreignUnregisteredTypes = $derived(currentForeignTypes.filter(t => !foreignTypeList.includes(t.value)))
  const foreignMergeTargetTypes  = $derived(
    foreignSingleEditType
      ? currentForeignTypes.filter(t => t.value === foreignSingleEditType)
      : foreignUnregisteredTypes,
  )

  function startForeignSingleEdit(typeValue: string): void {
    if (foreignDocsBusy) return
    foreignSingleEditType = typeValue
  }

  function cancelForeignMergeEdit(): void {
    foreignSingleEditType = null
  }

  async function autoSubmitForeignMergeFile(typeValue: string, file: File): Promise<void> {
    // 본인증명과 동일한 방어적 이중 장치(identityDocsBusy 가드 참고) — 현재는 이 슬롯에
    // 드래그앤드롭 핸들러가 없어 disabled 속성만으로 충분히 막히지만, 향후 추가될 경우를
    // 대비해 함수 진입점에서도 명시적으로 재확인한다.
    if (foreignDocsBusy) return
    // 체류기간 전환 중 부분제출 방지(2026-09-14 QA 지적) — 단기/장기 유형 목록에 겹치는
    // 값(passport_photo)이 있어, 반대 체류기간으로 등록된 기존 문서가 남아있는 상태에서
    // 현재 선택된 체류기간 기준으로 병합 제출하면 최대개수 가드를 우회한 채
    // foreign_stay_type과 실제 등록 문서 구성이 조용히 불일치하게 될 수 있었다. 기존
    // 등록 유형 중 현재 선택된 체류기간 콤보에 속하지 않는 것이 하나라도 있으면 제출 자체를
    // 차단 — 사용자가 먼저 개별삭제로 정리하도록 유도(데이터 정합성 우선).
    const staleTypes = foreignTypeList.filter(existing => !currentForeignTypes.some(ct => ct.value === existing))
    if (staleTypes.length > 0) {
      csToast.error('체류기간을 변경하려면 기존에 등록된 문서를 먼저 모두 삭제해 주세요.')
      return
    }
    const result = validateUploadFile(file)
    if (!result.ok) { csToast.error(result.error ?? '파일 형식 오류'); return }
    if (file.size > FOREIGN_MAX_FILE_SIZE) { csToast.error('파일 크기는 10MB 이하여야 합니다.'); return }
    isMergingForeign           = true
    foreignMergeUploadingType  = typeValue
    // 업로드 중 다른 유형 "수정"으로 전환돼도(양쪽 다 잠겨있어 실제로는 불가능하지만 방어적으로)
    // 그 사이 새로 연 패널을 이 요청이 실수로 닫아버리지 않도록 시작 시점 스냅샷
    const editTypeAtStart = foreignSingleEditType
    const wasSingleEdit    = Boolean(editTypeAtStart)
    const fd = new FormData()
    fd.set('type', 'foreign')
    fd.set('merge', 'true')
    fd.append('file', file)
    fd.append('foreign_type', typeValue)
    // 최초등록/재등록(콤보가 아직 없거나 다시 채우는 중) 슬롯도 이 함수 하나로 통합했으므로
    // (2026-09-14 Stephen 지시 — 본인증명처럼 파일 선택 즉시 자동 등록) 첫 등록 시점엔
    // DB에 foreign_stay_type이 아직 없어 RPC의 COALESCE만으로는 채워지지 않는다 — 항상
    // 현재 선택된 체류기간을 함께 전송해 명시적으로 반영한다.
    fd.set('foreign_stay_type', foreignStayType)
    try {
      const res  = await fetch('/api/profile/upload-doc', { method: 'POST', body: fd })
      const data = await res.json() as { ok: boolean; error?: string }
      if (!data.ok) { csToast.error(data.error ?? '업로드 실패'); return }
      csToast.success(wasSingleEdit ? '수정되었습니다.' : '등록되었습니다.')
      if (foreignSingleEditType === editTypeAtStart) cancelForeignMergeEdit()
      showForeignForm = false // 최초등록/재등록 슬롯에서 호출된 경우 등록완료 화면으로 전환
      await invalidateAll()
      await tick()
      docCardEl?.scrollIntoView({ block: 'nearest' })
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      isMergingForeign          = false
      foreignMergeUploadingType = null
    }
  }

  function handleForeignMergeSlotFileChange(e: Event, typeValue: string): void {
    const input = e.target as HTMLInputElement
    const file  = input.files?.[0]
    input.value = ''
    if (file) void autoSubmitForeignMergeFile(typeValue, file)
  }

  /* ── 아바타(프로필 사진) 업로드 */
  const AVATAR_ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heif', 'image/heic']

  let avatarUrl        = $state(profile?.avatar_url ?? null)
  let showAvatarModal  = $state(false)
  let avatarFile       = $state<File | null>(null)
  let avatarPreview    = $state<string | null>(null)
  let isUploadingAvatar = $state(false)
  let avatarError      = $state('')

  $effect(() => {
    avatarUrl = profile?.avatar_url ?? null
  })

  function openAvatarModal() {
    avatarFile    = null
    avatarPreview = null
    avatarError   = ''
    showAvatarModal = true
  }

  function closeAvatarModal() {
    showAvatarModal = false
    avatarFile     = null
    avatarPreview  = null
    avatarError    = ''
  }

  function handleAvatarFileChange(e: Event) {
    const input = e.target as HTMLInputElement
    const file  = input.files?.[0] ?? null
    avatarError = ''
    avatarFile    = null
    avatarPreview = null
    if (!file) return
    if (!AVATAR_ACCEPTED_TYPES.includes(file.type)) {
      avatarError = 'PNG, JPEG, WebP, HEIF 이미지 파일만 업로드할 수 있어요.'
      return
    }
    avatarFile    = file
    avatarPreview = URL.createObjectURL(file)
  }

  async function saveAvatar() {
    if (!avatarFile) return
    isUploadingAvatar = true
    avatarError = ''
    const fd = new FormData()
    fd.set('file', avatarFile)
    try {
      const res  = await fetch('/api/profile/upload-avatar', { method: 'POST', body: fd })
      const data = await res.json() as { ok: boolean; avatarUrl?: string; error?: string }
      if (!data.ok) { avatarError = data.error ?? '업로드 실패'; return }
      csToast.success('프로필 사진이 등록되었습니다.')
      closeAvatarModal()
      await invalidateAll()
    } catch { avatarError = '네트워크 오류가 발생했습니다.' }
    finally  { isUploadingAvatar = false }
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

<!-- ── 프로필 사진(아바타) 업로드 모달 ── -->
{#if showAvatarModal}
  <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
  <div class="avatar-modal-overlay" onclick={closeAvatarModal} role="dialog" aria-modal="true" aria-label="프로필 사진 등록">
    <div class="avatar-modal-inner" onclick={(e) => e.stopPropagation()}>
      <div class="kakao-modal-header">
        <span class="kakao-modal-title">프로필 사진 등록</span>
        <button class="kakao-close-btn" onclick={closeAvatarModal} aria-label="닫기">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <div class="avatar-modal-body">
        <label class="avatar-file-label">
          <input
            type="file"
            class="sr-only"
            accept="image/png,image/jpeg,image/webp,image/heif,image/heic"
            onchange={handleAvatarFileChange}
          />
          <span class="avatar-preview-circle">
            {#if avatarPreview}
              <img src={avatarPreview} alt="미리보기" class="avatar-preview-img" />
            {:else if avatarUrl}
              <img src={avatarUrl} alt="현재 프로필 사진" class="avatar-preview-img" />
            {:else}
              <span class="avatar-preview-initial">{(displayEmail[0] ?? '?').toUpperCase()}</span>
            {/if}
          </span>
          <span class="avatar-file-hint">{avatarFile ? avatarFile.name : '탭하여 사진 선택'}</span>
        </label>

        {#if avatarError}
          <p class="doc-error" role="alert">{avatarError}</p>
        {/if}

        <div class="doc-upload-btns">
          <button type="button" class="btn-doc-cancel" onclick={closeAvatarModal}>취소</button>
          <button
            type="button"
            class="btn-doc-upload"
            onclick={saveAvatar}
            disabled={isUploadingAvatar || !avatarFile}
          >{isUploadingAvatar ? '저장 중...' : '저장'}</button>
        </div>
      </div>
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
          <div class="flex flex-col gap-[10px] min-w-0">
            <p class="profile-card-id">
              {displayEmail || '—'}
            </p>
            <p class="profile-card-date">
              {profile?.created_at ? new Date(profile.created_at).toLocaleDateString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\. /g, '.').replace(/\.$/, '') : '—'}
            </p>
          </div>
          <div class="flex flex-col items-center gap-[6px]">
            <button type="button" class="profile-avatar-initial" onclick={openAvatarModal} aria-label="프로필 사진 변경">
              {#if avatarUrl}
                <img src={avatarUrl} alt="" class="profile-avatar-img" />
              {:else}
                {(displayEmail[0] ?? '?').toUpperCase()}
              {/if}
            </button>
            <button type="button" class="profile-avatar-link" onclick={openAvatarModal}>
              {avatarUrl ? '프로필 편집' : '프로필 등록'}
            </button>
          </div>
        </div>
      </div>

      <!-- 개인정보 폼 -->
      <div class="personal-info-form flex flex-col gap-[20px] items-start pt-[30px] w-full">
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
            <span class="checkbox-btn checkbox-btn-terms" class:checked={check1} aria-hidden="true">
              <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
                <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
              </svg>
            </span>
            <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#444] tracking-[-0.5px] leading-[1.6]">[옵션] 개인정보 수집 및 이용 동의 (보기)</span>
          </button>
          <button class="flex items-center gap-[12px] w-full text-left consent-btn" onclick={() => { check2 = !check2; saveConsent('allow_third_party_consent', check2) }}>
            <span class="checkbox-btn checkbox-btn-terms" class:checked={check2} aria-hidden="true">
              <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
                <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
              </svg>
            </span>
            <span class="font-['Noto_Sans_KR',sans-serif] font-medium text-[14px] text-[#444] tracking-[-0.5px] leading-[1.6]">[옵션] 개인정보 제 3자 제공 (보기)</span>
          </button>
        </div>

      </div>

    </div>
  </div>

  <!-- 본인 증명 · 외국인 증명 탭 섹션 (이번 세션 신규 — 탭 UI 재구성) -->
  <div class="doc-card" bind:this={docCardEl}>
    <div class="doc-card-inner">
      <div class="doc-tab-nav" role="tablist" aria-label="증명서 탭">
        <button
          type="button"
          class="doc-tab-title"
          class:active={activeDocTab === 'identity'}
          role="tab"
          aria-selected={activeDocTab === 'identity'}
          onclick={() => activeDocTab = 'identity'}
        >본인 증명</button>
        <button
          type="button"
          class="doc-tab-title"
          class:active={activeDocTab === 'foreign'}
          role="tab"
          aria-selected={activeDocTab === 'foreign'}
          onclick={() => activeDocTab = 'foreign'}
        >외국인 증명</button>
      </div>

      {#if activeDocTab === 'identity'}
        <div class="doc-section-head">
          <div class="doc-section-head-text">
            <p class="doc-subtitle">신원 확인용 증명서를 등록하세요</p>
            <p class="doc-file-hint">PNG · JPEG · WebP · HEIF · PDF · 개별 10MB 이하</p>
          </div>
          {#if identityDocUrls.length > 0 && !showIdentityForm}
            <button class="btn-doc-re" onclick={requestIdentityReRegister}>재등록</button>
          {/if}
        </div>

        {#if identityDocUrls.length > 0 && !showIdentityForm}
          <!-- 등록 완료 상태 -->
          <div class="doc-registered">
            <div class="doc-registered-head">
              <span class="doc-type-badge">{identityTypeLabel(identityType)}</span>
              {#if identityVerifiedAt}
                <span class="doc-date">{formatDocDate(identityVerifiedAt)}</span>
              {/if}
              <button
                type="button"
                class="btn-doc-delete"
                disabled={identityDocsBusy}
                onclick={requestIdentityDelete}
                aria-label="본인증명 삭제"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
              </button>
            </div>
            <ul class="doc-file-list">
              {#each identityDocUrls as url, i}
                {@const docType = identityDocTypeAt(i)}
                <li class="doc-file-list-item">
                  <span class="doc-file-list-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </span>
                  <span class="doc-file-list-name">{identityDocLabelAt(i)}</span>
                  <!-- "보기" 버튼 임시 감춤(2026-09-11, Stephen 지시) — 개인정보(신분증 이미지)
                       노출 보안 우려. 추후 중요정보 자동 가림(마스킹) 기능 보완 후
                       openIdentityDoc(url) 그대로 재사용해 복원 예정 — 함수는 유지. -->
                  <!-- <button type="button" class="btn-doc-view" onclick={() => openIdentityDoc(url)}>보기</button> -->
                  {#if docType}
                    <div class="doc-file-list-actions">
                      <button type="button" class="btn-doc-edit-chip" disabled={identityDocsBusy} onclick={() => startIdentitySingleEdit(docType)}>수정</button>
                      <button
                        type="button"
                        class="btn-doc-delete"
                        disabled={identityDocsBusy}
                        onclick={() => requestIdentityDocDelete(docType, identityDocLabelAt(i))}
                        aria-label="{identityDocLabelAt(i)} 삭제"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
                      </button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>

          {#if identityUnregisteredTypes.length > 0 || identitySingleEditType}
            <!-- 개별 수정(특정 유형 1개 재업로드) / 추가 등록(미등록 유형) 병합 업로드 —
                 등록완료 카드는 그대로 두고 upsert만(서버 merge=true, 다른 유형 보존) -->
            <div class="doc-upload-wrap doc-merge-wrap">
              {#if identitySingleEditType}
                <div class="doc-merge-head">
                  <button type="button" class="btn-doc-re" disabled={identityDocsBusy} onclick={cancelIdentityMergeEdit}>취소</button>
                </div>
              {/if}
              <div class="doc-slot-grid">
                {#each identityMergeTargetTypes as t (t.value)}
                  <div class="doc-slot">
                    <label
                      class="doc-file-label"
                      class:drag-over={identityMergeDragOverSlot === t.value}
                      aria-disabled={identityDocsBusy}
                      ondragover={(e) => handleIdentityMergeSlotDragOver(e, t.value)}
                      ondragleave={() => handleIdentityMergeSlotDragLeave(t.value)}
                      ondrop={(e) => handleIdentityMergeSlotDrop(e, t.value)}
                    >
                      <input
                        type="file"
                        class="sr-only"
                        disabled={identityDocsBusy}
                        accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
                        onchange={(e) => handleIdentityMergeSlotFileChange(e, t.value)}
                      />
                      <span class="doc-file-btn">
                        {#if identityMergeUploadingType === t.value}
                          <span>업로드 중...</span>
                        {:else}
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                          <span>{t.label}</span>
                        {/if}
                      </span>
                    </label>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {:else}
          <!-- 업로드 폼 (미등록 / 재등록) — 외국인증명과 동일 원칙(버튼 없는 자동 병합
               제출, 2026-09-15). 최초등록도 콤보없음 상태에 대한 병합과 동일하게 동작해
               안전(autoSubmitIdentityMergeFile merge=true — foreign 쪽 선례 참고). -->
          <div class="doc-upload-wrap">
            {#if identityDocUrls.length > 0}
              <!-- "재등록" 진입 취소 — 등록된 문서가 있을 때만(되돌아갈 곳이 있을 때만) 노출 -->
              <div class="doc-merge-head">
                <button type="button" class="btn-doc-re" disabled={identityDocsBusy} onclick={cancelIdentityReRegister}>취소</button>
              </div>
            {/if}
            <div class="doc-slot-grid">
              {#each IDENTITY_TYPES as t (t.value)}
                <div class="doc-slot">
                  <label class="doc-file-label" aria-disabled={identityDocsBusy}>
                    <input
                      type="file"
                      class="sr-only"
                      disabled={identityDocsBusy}
                      accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
                      onchange={(e) => handleIdentityMergeSlotFileChange(e, t.value)}
                    />
                    <span class="doc-file-btn">
                      {#if identityMergeUploadingType === t.value}
                        <span>업로드 중...</span>
                      {:else}
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                        <span>{t.label}</span>
                      {/if}
                    </span>
                  </label>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {:else}
        <div class="doc-section-head">
          <div class="doc-section-head-text">
            <p class="doc-subtitle">여권 또는 외국인등록증을 등록하세요</p>
            <p class="doc-file-hint">PNG · JPEG · WebP · HEIF · PDF · 개별 10MB 이하</p>
          </div>
          {#if foreignDocUrls.length > 0 && !showForeignForm}
            <button class="btn-doc-re" onclick={requestForeignReRegister}>재등록</button>
          {/if}
        </div>

        {#if foreignDocUrls.length > 0 && !showForeignForm}
          <!-- 등록 완료 상태 -->
          <div class="doc-registered">
            <div class="doc-registered-head">
              <span class="doc-type-badge">외국인증명</span>
              {#if foreignVerifiedAt}
                <span class="doc-date">{formatDocDate(foreignVerifiedAt)}</span>
              {/if}
              <button
                type="button"
                class="btn-doc-delete"
                disabled={foreignDocsBusy}
                onclick={requestForeignDelete}
                aria-label="외국인증명 삭제"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
              </button>
            </div>
            <ul class="doc-file-list">
              {#each foreignDocUrls as url, i}
                {@const docType = foreignDocTypeAt(i)}
                <li class="doc-file-list-item">
                  <span class="doc-file-list-icon" aria-hidden="true">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                  </span>
                  <span class="doc-file-list-name">{foreignDocLabelAt(i)}</span>
                  <!-- "보기" 버튼 임시 감춤(2026-09-11, Stephen 지시) — 개인정보(신분증 이미지)
                       노출 보안 우려. 추후 중요정보 자동 가림(마스킹) 기능 보완 후
                       openForeignDoc(url) 그대로 재사용해 복원 예정 — 함수는 유지. -->
                  <!-- <button type="button" class="btn-doc-view" onclick={() => openForeignDoc(url)}>보기</button> -->
                  {#if docType}
                    <div class="doc-file-list-actions">
                      <button type="button" class="btn-doc-edit-chip" disabled={foreignDocsBusy} onclick={() => startForeignSingleEdit(docType)}>수정</button>
                      <button
                        type="button"
                        class="btn-doc-delete"
                        disabled={foreignDocsBusy}
                        onclick={() => requestForeignDocDelete(docType, foreignDocLabelAt(i))}
                        aria-label="{foreignDocLabelAt(i)} 삭제"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
                      </button>
                    </div>
                  {/if}
                </li>
              {/each}
            </ul>
          </div>

          {#if foreignSingleEditType || foreignUnregisteredTypes.length > 0}
            <!-- 외국인증명 개별 수정(그 유형 1개) / 추가 등록(개별삭제로 콤보에서 빠진
                 유형 되돌리기, 2026-09-14 신설 — 개별삭제 도입으로 콤보가 깨질 수 있게
                 됐는데 되돌릴 UI가 없던 결함, Stephen 리포트로 발견) — 본인증명 병합업로드와
                 동일 원리(버튼 없는 자동제출) -->
            <div class="doc-upload-wrap doc-merge-wrap">
              {#if foreignSingleEditType}
                <div class="doc-merge-head">
                  <button type="button" class="btn-doc-re" disabled={foreignDocsBusy} onclick={cancelForeignMergeEdit}>취소</button>
                </div>
              {/if}
              <div class="doc-slot-grid">
                {#each foreignMergeTargetTypes as t (t.value)}
                  <div class="doc-slot">
                    <label class="doc-file-label" aria-disabled={foreignDocsBusy}>
                      <input
                        type="file"
                        class="sr-only"
                        disabled={foreignDocsBusy}
                        accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
                        onchange={(e) => handleForeignMergeSlotFileChange(e, t.value)}
                      />
                      <span class="doc-file-btn">
                        {#if foreignMergeUploadingType === t.value}
                          <span>업로드 중...</span>
                        {:else}
                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                          <span>{t.label}</span>
                        {/if}
                      </span>
                    </label>
                  </div>
                {/each}
              </div>
            </div>
          {/if}
        {:else}
          <!-- 업로드 폼 (미등록 / 재등록) -->
          <div class="doc-upload-wrap">
            {#if foreignDocUrls.length > 0}
              <!-- "재등록" 진입 취소 — 등록된 문서가 있을 때만(되돌아갈 곳이 있을 때만) 노출 -->
              <div class="doc-merge-head">
                <button type="button" class="btn-doc-re" disabled={foreignDocsBusy} onclick={cancelForeignReRegister}>취소</button>
              </div>
            {/if}
            <!-- 체류기간 하위 선택 탭 (단일 선택) -->
            <div class="foreign-stay-select" role="radiogroup" aria-label="체류 기간 선택">
              {#each FOREIGN_STAY_OPTIONS as opt}
                <button
                  type="button"
                  class="foreign-stay-row"
                  class:active={foreignStayType === opt.value}
                  role="radio"
                  aria-checked={foreignStayType === opt.value}
                  disabled={foreignDocsBusy}
                  onclick={() => selectForeignStayType(opt.value)}
                >
                  <span class="checkbox-btn checkbox-btn-terms" class:checked={foreignStayType === opt.value} aria-hidden="true">
                    <svg width="18" height="12" viewBox="0 0 18 12" fill="none">
                      <path d="M14.788 0.40847C15.5937 -0.206503 16.7506 -0.123176 17.4589 0.632103C18.2144 1.4379 18.1729 2.70376 17.3671 3.45925L17.3622 3.46413C17.3585 3.46759 17.3528 3.47297 17.3456 3.47976C17.3311 3.49333 17.3101 3.51407 17.2821 3.54031C17.2261 3.59279 17.1437 3.66974 17.039 3.76784C16.8294 3.96413 16.5289 4.24474 16.1669 4.58327C15.4428 5.26035 14.4707 6.169 13.4774 7.09304C12.4848 8.01654 11.4689 8.95836 10.6591 9.70144C9.90326 10.3949 9.21125 11.0229 8.954 11.219C8.38484 11.6526 7.64783 12.0001 6.7831 12.0003C5.89707 12.0003 5.14509 11.6357 4.57217 11.138C4.258 10.865 3.25694 9.9462 2.37197 9.13015C1.92122 8.71451 1.48885 8.31388 1.16885 8.01785C1.0088 7.86979 0.875998 7.74749 0.78408 7.66238C0.738281 7.61997 0.702073 7.58638 0.677634 7.56374C0.665704 7.55269 0.656551 7.54415 0.650291 7.53835C0.647126 7.53542 0.644094 7.53301 0.642478 7.53152L0.641502 7.52956H0.640525C-0.169647 6.77877 -0.217693 5.51259 0.533103 4.70242C1.28393 3.89251 2.55017 3.84526 3.36025 4.59597L3.36123 4.59792C3.3628 4.59938 3.36592 4.60089 3.36904 4.60378C3.37524 4.60953 3.38439 4.61807 3.39638 4.62917C3.42067 4.65167 3.45618 4.68551 3.50185 4.72781C3.59333 4.81251 3.72524 4.93384 3.88467 5.08132C4.2037 5.37646 4.63512 5.77493 5.08388 6.18874C5.73477 6.78894 6.40077 7.39812 6.82217 7.78054C6.86093 7.74604 6.90358 7.70918 6.94814 7.66921C7.21008 7.43424 7.55408 7.12113 7.954 6.75417C8.7536 6.02049 9.76226 5.0859 10.7528 4.16433C11.7428 3.24336 12.7128 2.33711 13.4354 1.6614C13.7965 1.32374 14.0957 1.04357 14.3046 0.847923C14.409 0.750147 14.491 0.67359 14.5468 0.621361C14.5745 0.595342 14.5959 0.575239 14.6103 0.56179C14.6174 0.555065 14.6232 0.549566 14.6269 0.546165L14.6317 0.541282L14.788 0.40847Z" fill="currentColor" />
                    </svg>
                  </span>
                  <span class="foreign-stay-label">{opt.label}</span>
                </button>
              {/each}
            </div>

            <!-- 문서 종류별 "파일등록" 슬롯 — front-uiux.md §22-5 표준(드롭존 1개 = 문서 1종,
                 순서 보장으로 파일↔유형 메타정보가 항상 1:1 매핑됨). 2026-09-14 Stephen 지시로
                 본인증명과 동일하게 버튼·수동제출 없이 파일 선택 즉시 그 1건만 자동 병합
                 등록(autoSubmitForeignMergeFile, merge=true) — 최초등록도 기존 콤보없음 상태에
                 대한 병합과 동일하게 동작해 안전(§22-5 "전부 함께 필수" 제약은 폐기). -->
            <div class="doc-slot-grid">
              {#each currentForeignTypes as t (t.value)}
                <div class="doc-slot">
                  <label class="doc-file-label" aria-disabled={foreignDocsBusy}>
                    <input
                      type="file"
                      class="sr-only"
                      disabled={foreignDocsBusy}
                      accept="image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf"
                      onchange={(e) => handleForeignMergeSlotFileChange(e, t.value)}
                    />
                    <span class="doc-file-btn">
                      {#if foreignMergeUploadingType === t.value}
                        <span>업로드 중...</span>
                      {:else}
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="16 16 12 12 8 16"/><line x1="12" y1="12" x2="12" y2="21"/><path d="M20.39 18.39A5 5 0 0 0 18 9h-1.26A8 8 0 1 0 3 16.3"/></svg>
                        <span>{t.label}</span>
                      {/if}
                    </span>
                  </label>
                </div>
              {/each}
            </div>
          </div>
        {/if}
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

  /* 로그인 정보 카드 ↔ 개인정보 폼 사이 여백 — PC(≥768px)에서만 50px 확대 (이번 세션 신규) */
  @media (min-width: 768px) {
    .personal-info-form { padding-top: 50px; }
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
    word-break: break-all;
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
    border: none;
    padding: 0;
    cursor: pointer;
    overflow: hidden;
    min-width: 44px;
    min-height: 44px;
    transition: opacity 0.15s;
  }
  .profile-avatar-initial:hover { opacity: 0.85; }

  .profile-avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }

  /* 프로필 등록/편집 텍스트 링크 — 최소 크기 폰트토큰 + 중간 그레이톤 (이번 세션 신규) */
  .profile-avatar-link {
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    white-space: nowrap;
  }
  .profile-avatar-link:hover { color: var(--cs-text-dark); }
  @media (min-width: 768px) {
    .profile-avatar-link { font: var(--text-pc-script-12); }
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
  .doc-section-head-text {
    display: flex;
    flex-direction: column;
    gap: 4px;
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

  /* 본인증명·외국인증명 탭 내비 (이번 세션 신규) — 열림: 기존 doc-title 컬러톤(#444) / 미열림: 옅은 그레이 */
  .doc-tab-nav {
    display: flex;
    align-items: center;
    gap: 20px;
  }
  .doc-tab-title {
    background: none;
    border: none;
    padding: 0 0 8px;
    margin: 0;
    cursor: pointer;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 600;
    font-size: 16px;
    letter-spacing: -0.5px;
    line-height: 1.6;
    color: var(--cs-text-light, #aaa);
    border-bottom: 2px solid transparent;
    transition: color 0.15s, border-color 0.15s;
  }
  .doc-tab-title.active {
    color: #444;
    border-bottom-color: #444;
  }

  /* 외국인증명 — 체류기간 하위 선택(단일 선택) — front-uiux.md §16 콤보 버튼 선택 그룹 표준
     (수평 flex + overflow-x auto, PC·모바일 공통 — 항상 병렬 배열) + 우측 아닌 좌측 체크아이콘 결합 */
  .foreign-stay-select {
    display: flex;
    gap: 6px;
    overflow-x: auto;
    padding-bottom: 2px;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: none;
  }
  .foreign-stay-select::-webkit-scrollbar { display: none; }
  .foreign-stay-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 9px 16px;
    border-radius: var(--radius-xl);
    border: 1.5px solid #DCDCDC;
    background: #fff;
    cursor: pointer;
    transition: all 0.18s;
    flex-shrink: 0;
    white-space: nowrap;
  }
  .foreign-stay-row:hover {
    border-color: var(--cs-purple);
    background: #F5F4FA;
  }
  .foreign-stay-row:disabled { opacity: 0.5; cursor: not-allowed; }
  .foreign-stay-row:disabled:not(.active):hover { border-color: #DCDCDC; background: #fff; }
  .foreign-stay-row.active {
    border-color: var(--cs-purple);
    background: var(--cs-purple);
  }
  .foreign-stay-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 13px;
    color: var(--cs-text);
  }
  .foreign-stay-row.active .foreign-stay-label { color: #fff; }
  @media (max-width: 640px) {
    .foreign-stay-row   { padding: 8px 12px; }
    .foreign-stay-label { font-size: 12px; }
  }
  .checkbox-btn { background: none; border: none; padding: 0; cursor: pointer; flex-shrink: 0; }
  .checkbox-btn-terms { color: var(--cs-purple-op10); }
  .checkbox-btn-terms.checked { color: var(--cs-purple); }
  .foreign-stay-row.active .checkbox-btn-terms.checked { color: #fff; }
  .checkbox-btn-terms svg { width: 22px; height: 15px; }
  @media (min-width: 768px) {
    .checkbox-btn-terms svg { width: 18px; height: 12px; }
  }
  /* 동의 항목 체크아이콘 전용 광학보정 — 체크마크 하단 꼭짓점 1개로 모이는 형태라
     flex 중앙정렬만으로는 텍스트보다 시각적으로 살짝 위로 떠 보임(다른 checkbox-btn-terms
     사용처인 "체류기간 선택" 버튼은 별도 레이아웃이라 영향 없도록 .consent-btn으로 한정) */
  .consent-btn .checkbox-btn-terms { transform: translateY(2px); }

  /* 등록 완료 상태 — 파일 목록형 */
  .doc-registered {
    display: flex;
    flex-direction: column;
    gap: 12px;
    border-radius: 20px;
    padding: 14px 18px;
  }
  .doc-registered-head {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-wrap: wrap;
  }
  .doc-file-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    margin: 0;
    padding: 0;
    list-style: none;
  }
  .doc-file-list-item {
    display: flex;
    align-items: center;
    gap: 10px;
    background: #f0eff8;
    border-radius: 14px;
    padding: 10px 14px;
  }
  .doc-file-list-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    color: #888;
  }
  .doc-file-list-actions {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
  }
  .doc-file-list-name {
    flex: 1;
    min-width: 0;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: #444;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
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
  /* "보기" 버튼(.btn-doc-view) 임시 감춤(2026-09-11) — 마크업도 함께 주석 처리돼
     현재 미사용 상태. 중요정보 자동 가림 기능 보완 후 마크업과 함께 복원 예정. */
  /*
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
  */
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
  /* 등록완료 목록 행별 "수정" 칩 — .doc-type-badge와 동일 형태(24px/radius-full)를 재사용하되
     톤만 purple-on-op10(보조 액션)으로 구분해 카드 헤더의 유형 배지(purple-on-white)와
     시각적으로 경쟁하지 않도록 함 (2026-09-14, Stephen 선택: "눈에 띄는 칩/버튼 형태") */
  .btn-doc-edit-chip {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    height: 24px;
    padding: 0 12px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border: none;
    border-radius: 99px;
    font-family: 'Noto Sans KR', sans-serif;
    font-weight: 700;
    font-size: 12px;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.12s, color 0.12s;
  }
  .btn-doc-edit-chip:hover { background: var(--cs-purple-pale); }
  /* members/profile/AddressTabContent.svelte .btn-delete와 동일 패턴(front 표준) — 배송지
     삭제 버튼과 같은 톤(투명 배경·회색 아이콘·hover 시 레드 강조)으로 통일 */
  .btn-doc-delete {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    background: transparent;
    border: none;
    border-radius: 8px;
    color: #bbb;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .btn-doc-delete:hover:not(:disabled) { background: rgba(255,53,53,0.08); color: #ff3535; }
  .btn-doc-delete:disabled { opacity: 0.4; cursor: not-allowed; }

  /* 업로드 폼 */
  .doc-upload-wrap {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  /* 등록완료 카드 아래 "개별 수정 / 추가 등록" 병합 업로드 영역 —
     제목 텍스트(.doc-merge-title)와 구분선(border-top)은 불필요 요소로 제거됨(2026-09-14) */
  .doc-merge-wrap { margin-top: 16px; padding-top: 16px; }
  .doc-merge-head { display: flex; align-items: center; justify-content: flex-end; gap: 12px; }


  /* 파일 선택 영역 */
  .doc-file-label { cursor: pointer; display: block; }
  .doc-file-label[aria-disabled='true'] { pointer-events: none; opacity: 0.5; }
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
    min-height: 76px;
    background: #f6f6f6;
    border: 2px dashed #d0ceea;
    border-radius: 20px;
    padding: 10px 16px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 14px;
    color: #888;
    transition: border-color 0.15s, background 0.15s;
    cursor: pointer;
    text-align: center;
  }
  .doc-file-btn:hover { border-color: #3B2F8A; background: #f0eff8; color: #3B2F8A; }
  .doc-file-label.drag-over .doc-file-btn {
    border-color: #3B2F8A;
    background: #f0eff8;
    color: #3B2F8A;
  }
  .doc-file-hint {
    font-size: 12px;
    color: #bbb;
    letter-spacing: -0.3px;
  }
  /* 본인증명·외국인증명 — 문서 종류별 "파일등록" 슬롯 그리드 (front-uiux.md §22-5 표준)
     모바일: 1열 직렬 배열 / PC(≥768px): 2열 그리드로 확장 */
  .doc-slot-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 12px;
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
    .btn-doc-upload { height: 50px; }
    .btn-doc-cancel { height: 50px; }
    .doc-slot-grid { grid-template-columns: repeat(2, 1fr); }
    .doc-file-btn { padding: 16px; min-height: 100px; }
  }

  /* ── 아바타 업로드 모달 */
  .avatar-modal-overlay {
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

  .avatar-modal-inner {
    background: white;
    border-radius: 24px;
    width: 100%;
    max-width: 360px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(16,11,50,0.25);
  }

  .avatar-modal-body {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 28px 24px 24px;
  }

  .avatar-file-label {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    cursor: pointer;
  }

  .avatar-preview-circle {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 96px;
    height: 96px;
    border-radius: 50%;
    background: var(--cs-purple-pale);
    overflow: hidden;
    border: 2px dashed #d0ceea;
    transition: border-color 0.15s;
  }
  .avatar-file-label:hover .avatar-preview-circle { border-color: #3B2F8A; }

  .avatar-preview-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .avatar-preview-initial {
    font-family: var(--font-en-display);
    font-size: 32px;
    font-weight: 700;
    color: var(--cs-dark);
    text-transform: uppercase;
  }

  .avatar-file-hint {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: #888;
    letter-spacing: -0.3px;
  }

  @media (max-width: 640px) {
    .avatar-modal-inner { max-width: 320px; }
  }
</style>
