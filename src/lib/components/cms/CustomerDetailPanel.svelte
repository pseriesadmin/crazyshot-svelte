<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import { supabase } from '$lib/services/supabase'
  import { validateUploadFile } from '$lib/utils/fileValidation'
  // CustomerRow 타입을 인라인으로 정의 (circular import 방지)
  interface CustomerRow {
    user_id: string
    email: string
    phone: string | null
    name: string | null
    member_code: string | null
    member_type: string | null
    membership_grade: string
    credit_score: number
    rental_count: number
    late_return_count: number
    damage_count: number
    points: number
    blacklisted: boolean
    blacklist_reason: string | null
    is_student: boolean
    is_foreign: boolean
    identity_type: string | null
    identity_doc_url: string | null
    identity_verified_at: string | null
    foreign_doc_url: string | null
    foreign_verified_at: string | null
    password_set: boolean
    created_at: string
    total_count: number
    birth_date: string | null
  }

  interface Subscription {
    id: string
    plan_id: number | null
    plan_name: string | null
    status: string
    started_at: string | null
    expires_at: string | null
    cancelled_at: string | null
    created_at: string
  }

  interface AuditEntry {
    id: string
    old_score: number
    new_score: number
    reason: string
    metadata: Record<string, unknown> | null
    created_at: string
  }

  interface Props {
    row: CustomerRow
    onclose: () => void
  }
  let { row, onclose }: Props = $props()

  interface CsInquiryReply {
    id: string
    response: string
    is_resolution: boolean
    created_at: string
  }

  interface CsPost {
    id: string
    title: string
    content: string
    category: string
    status: string
    created_at: string
    cs_inquiries: CsInquiryReply[]
  }

  let activeTab = $state<'info' | 'score' | 'subscription' | 'blacklist' | 'inquiry'>('info')
  let subscriptions = $state<Subscription[]>([])
  let auditLog = $state<AuditEntry[]>([])
  let inquiryPosts = $state<CsPost[]>([])
  let loadingSubscriptions = $state(false)
  let loadingAudit = $state(false)
  let loadingInquiries = $state(false)
  let inquiryExpandedId = $state<string | null>(null)

  // 스코어 탭 폼 상태
  let adjustDelta = $state(0)
  let adjustReason = $state('')
  let isAdjusting = $state(false)

  // 블랙리스트 폼 상태
  let blacklistReason = $state('')
  let showBlacklistForm = $state(false)

  // 회원 삭제 2단계 경고 상태
  let deleteWarnPending = $state(false)

  // 구독 취소 모달 상태
  let showCancelModal = $state(false)
  let cancelTargetId = $state<string | null>(null)
  let cancelReason = $state('')

  $effect(() => {
    if (activeTab === 'subscription' && subscriptions.length === 0 && !loadingSubscriptions) {
      loadSubscriptions()
    }
    if (activeTab === 'score' && auditLog.length === 0 && !loadingAudit) {
      loadAuditLog()
    }
    if (activeTab === 'inquiry' && inquiryPosts.length === 0 && !loadingInquiries) {
      loadInquiries()
    }
  })

  async function loadSubscriptions() {
    loadingSubscriptions = true
    try {
      const res = await fetch(`/cms/customers/subscriptions?userId=${encodeURIComponent(row.user_id)}`)
      if (res.ok) {
        const data = await res.json() as Array<Record<string, unknown>>
        subscriptions = data.map(r => ({
          id: String(r.id),
          plan_id: r.plan_id as number | null,
          plan_name: (r.subscription_plans as Record<string, unknown> | null)?.name as string | null,
          status: r.status as string,
          started_at: r.started_at as string | null,
          expires_at: r.expires_at as string | null,
          cancelled_at: r.cancelled_at as string | null,
          created_at: r.created_at as string,
        }))
      }
    } finally {
      loadingSubscriptions = false
    }
  }

  async function loadAuditLog() {
    loadingAudit = true
    try {
      const res = await fetch(`/cms/customers/credit-audit?userId=${encodeURIComponent(row.user_id)}`)
      if (res.ok) {
        auditLog = await res.json() as AuditEntry[]
      }
    } finally {
      loadingAudit = false
    }
  }

  async function loadInquiries() {
    loadingInquiries = true
    try {
      const res = await fetch(`/api/cms/customers/${encodeURIComponent(row.user_id)}/inquiries`)
      if (res.ok) {
        inquiryPosts = await res.json() as CsPost[]
      }
    } finally {
      loadingInquiries = false
    }
  }

  function toggleInquiry(id: string) {
    inquiryExpandedId = inquiryExpandedId === id ? null : id
  }

  const INQUIRY_STATUS_LABEL: Record<string, string> = {
    open:        '답변대기',
    in_progress: '처리중',
    resolved:    '해결됨',
    closed:      '종결',
  }

  const INQUIRY_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    open:        { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    in_progress: { bg: 'rgba(59,47,138,0.12)',   color: '#3B2F8A' },
    resolved:    { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    closed:      { bg: 'rgba(102,102,102,0.12)', color: '#666666' },
  }

  const INQUIRY_CATEGORY_LABEL: Record<string, string> = {
    general: '일반',
    rental:  '대여',
    payment: '결제·환불',
    product: '상품',
    other:   '기타',
  }

  function getScoreClass(score: number): string {
    if (score >= 85) return 'score-high'
    if (score >= 70) return 'score-mid'
    if (score >= 50) return 'score-low'
    return 'score-critical'
  }

  function getDepositRate(score: number): string {
    if (score >= 85) return '0%'
    if (score >= 70) return '30%'
    if (score >= 50) return '50%'
    return '100%'
  }

  function scoreBarWidth(score: number): string {
    return `${Math.max(2, score)}%`
  }

  function tierLabel(tier: string): string {
    return tier.toUpperCase()
  }

  function statusLabel(s: string): string {
    const m: Record<string, string> = { active: '활성', cancelled: '취소', paused: '일시정지', expired: '만료' }
    return m[s] ?? s
  }

  function formatDate(dt: string | null): string {
    return dt ? dt.slice(0, 10) : '-'
  }

  function openCancelModal(id: string) {
    cancelTargetId = id
    cancelReason = ''
    showCancelModal = true
  }

  const scoreDelta = $derived(adjustDelta > 0 ? `+${adjustDelta}` : `${adjustDelta}`)
  const newScore = $derived(Math.max(0, Math.min(100, row.credit_score + adjustDelta)))

  // 기본정보 편집 상태
  interface MemberTypeGroup {
    id: string
    name: string
    is_active: boolean
    sort_order: number
  }

  let localInfo = $state({
    name: row.name ?? '',
    email: row.email,
    phone: row.phone ?? '',
    birth_date: row.birth_date ? row.birth_date.slice(0, 10) : '',
    member_type: row.member_type ?? 'B2C',
    created_at_date: row.created_at ? row.created_at.slice(0, 10) : '',
  })

  // row 변경(invalidateAll) 시 localInfo 동기화
  $effect(() => {
    localInfo.name = row.name ?? ''
    localInfo.email = row.email
    localInfo.phone = row.phone ?? ''
    localInfo.birth_date = row.birth_date ? row.birth_date.slice(0, 10) : ''
    localInfo.member_type = row.member_type ?? 'B2C'
    localInfo.created_at_date = row.created_at ? row.created_at.slice(0, 10) : ''
  })

  const isDirtyInfo = $derived(
    localInfo.name !== (row.name ?? '') ||
    localInfo.email !== row.email ||
    localInfo.phone !== (row.phone ?? '') ||
    localInfo.birth_date !== (row.birth_date ? row.birth_date.slice(0, 10) : '') ||
    localInfo.member_type !== (row.member_type ?? 'B2C') ||
    localInfo.created_at_date !== (row.created_at ? row.created_at.slice(0, 10) : '')
  )

  let isSavingInfo = $state(false)

  function formatPhone(val: string): string {
    const digits = val.replace(/\D/g, '')
    if (digits.length <= 3) return digits
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`
    if (digits.length <= 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`
  }

  function handlePhoneInput(e: Event) {
    const target = e.target as HTMLInputElement
    localInfo.phone = formatPhone(target.value)
    target.value = localInfo.phone
  }

  // 이메일 허용 문자: 영문·숫자·@·.·_·-·+ 만 허용 (한글 및 그 외 불허)
  const EMAIL_ALLOWED = /^[a-zA-Z0-9@._+\-]$/

  function handleEmailKeydown(e: KeyboardEvent) {
    // 제어키(백스페이스, Delete, 방향키, Tab, Enter, Home, End) 허용
    const ctrl = e.ctrlKey || e.metaKey
    if (ctrl) return  // Ctrl/Cmd 조합 (복붙 등) 허용
    if (['Backspace','Delete','ArrowLeft','ArrowRight','ArrowUp','ArrowDown',
         'Tab','Enter','Home','End'].includes(e.key)) return
    if (e.key.length > 1) return  // 나머지 비문자 키 허용
    if (!EMAIL_ALLOWED.test(e.key)) e.preventDefault()
  }

  function handleEmailInput(e: Event) {
    const target = e.target as HTMLInputElement
    // 한글 IME 조합 후 삽입된 경우 사후 제거
    const cleaned = target.value.replace(/[^a-zA-Z0-9@._+\-]/g, '')
    if (cleaned !== target.value) {
      const pos = target.selectionStart ?? cleaned.length
      target.value = cleaned
      target.setSelectionRange(pos, pos)
      localInfo.email = cleaned
    }
  }

  // ── 알림설정 + 개인정보 동의 (통합 서버 엔드포인트) ──────────
  interface NotificationSettings {
    rental_alert: boolean
    benefit_alert: boolean
  }

  interface ConsentSettings {
    privacy_consent: boolean
    third_party_consent: boolean
  }

  let notifSettings   = $state<NotificationSettings | null>(null)
  let notifLoaded     = $state(false)
  let consentSettings = $state<ConsentSettings | null>(null)
  let consentLoaded   = $state(false)

  async function loadProfileSettings(userId: string) {
    const res = await fetch(`/cms/customers/profile-settings?userId=${encodeURIComponent(userId)}`)
    if (res.ok) {
      const d = await res.json() as {
        rental_alert: boolean; benefit_alert: boolean
        privacy_consent: boolean; third_party_consent: boolean
      }
      notifSettings   = { rental_alert: d.rental_alert,   benefit_alert: d.benefit_alert }
      consentSettings = { privacy_consent: d.privacy_consent, third_party_consent: d.third_party_consent }
    } else {
      notifSettings   = { rental_alert: true,  benefit_alert: false }
      consentSettings = { privacy_consent: false, third_party_consent: false }
    }
    notifLoaded   = true
    consentLoaded = true
  }

  // ── 배송지 목록 ────────────────────────────────────────────────
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

  let shippingAddresses = $state<ShippingAddress[]>([])
  let loadingAddresses  = $state(false)
  let addressesLoaded   = $state(false)

  async function loadShippingAddresses(userId: string) {
    loadingAddresses = true
    try {
      const res = await fetch(`/cms/customers/addresses?userId=${encodeURIComponent(userId)}`)
      if (res.ok) {
        shippingAddresses = await res.json() as ShippingAddress[]
      }
    } finally {
      loadingAddresses = false
      addressesLoaded  = true
    }
  }

  // row 변경 또는 info 탭 진입 시 배송지·알림설정·동의설정 재로드
  $effect(() => {
    const uid = row.user_id
    shippingAddresses = []
    addressesLoaded   = false
    notifSettings     = null
    notifLoaded       = false
    consentSettings   = null
    consentLoaded     = false
    if (activeTab === 'info') {
      loadShippingAddresses(uid)
      loadProfileSettings(uid)
    }
  })

  // ── 본인증명 뷰어 ──────────────────────────────────────────────
  let identityDocUrl = $state<string | null>(null)

  function openIdentityDoc(url: string) {
    identityDocUrl = url
  }

  function closeIdentityDoc() {
    identityDocUrl = null
  }

  function formatIdentityDate(iso: string): string {
    const d = new Date(iso)
    return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`
  }

  function isIdentityExpired(iso: string): boolean {
    const sixMonthsAgo = new Date()
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6)
    return new Date(iso) < sixMonthsAgo
  }

  const isPdf = $derived(identityDocUrl ? identityDocUrl.toLowerCase().includes('.pdf') : false)

  // ── 증명서 재업로드 (기간경과 / 미등록) ───────────────────────
  const DOC_ACCEPT = 'image/png,image/jpeg,image/webp,image/heif,image/heic,application/pdf'

  let reuploadIdentityOpen = $state(false)
  let reuploadForeignOpen  = $state(false)
  let identityFile         = $state<File | null>(null)
  let foreignFile          = $state<File | null>(null)
  let identityPreviewUrl   = $state<string | null>(null)
  let foreignPreviewUrl    = $state<string | null>(null)
  let identityFileError    = $state('')
  let foreignFileError     = $state('')
  let uploadingIdentity    = $state(false)
  let uploadingForeign     = $state(false)

  $effect(() => {
    return () => {
      if (identityPreviewUrl) URL.revokeObjectURL(identityPreviewUrl)
      if (foreignPreviewUrl)  URL.revokeObjectURL(foreignPreviewUrl)
    }
  })

  function handleDocFile(e: Event, type: 'identity' | 'foreign') {
    const input = e.target as HTMLInputElement
    const file  = input.files?.[0] ?? null
    // 파일 선택 취소 시 무시
    if (!file) return

    if (file.size > 10 * 1024 * 1024) {
      if (type === 'identity') { identityFileError = '파일 크기는 10MB 이하여야 합니다.'; identityFile = null }
      else                     { foreignFileError  = '파일 크기는 10MB 이하여야 합니다.'; foreignFile  = null }
      input.value = ''
      return
    }

    const validation = validateUploadFile(file)
    if (!validation.ok) {
      if (type === 'identity') { identityFileError = validation.error!; identityFile = null }
      else                     { foreignFileError  = validation.error!; foreignFile  = null }
      input.value = ''
      return
    }

    if (type === 'identity') {
      identityFileError = ''
      identityFile      = file
      if (identityPreviewUrl) URL.revokeObjectURL(identityPreviewUrl)
      identityPreviewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    } else {
      foreignFileError = ''
      foreignFile      = file
      if (foreignPreviewUrl) URL.revokeObjectURL(foreignPreviewUrl)
      foreignPreviewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null
    }
  }

  async function submitDocUpload(type: 'identity' | 'foreign') {
    const file = type === 'identity' ? identityFile : foreignFile
    if (!file) return

    if (type === 'identity') uploadingIdentity = true
    else                     uploadingForeign  = true

    try {
      const fd = new FormData()
      fd.append('user_id', row.user_id)
      fd.append('type', type)
      fd.append('file', file)
      if (type === 'identity' && row.identity_type) fd.append('identity_type', row.identity_type)

      const res  = await fetch('/api/cms/upload-doc', { method: 'POST', body: fd })
      const data = await res.json() as { ok: boolean; error?: string }

      if (data.ok) {
        csToast.success('증명서가 재등록되었습니다.')
        await invalidateAll()
        cancelDocUpload(type)
      } else {
        csToast.error(data.error ?? '업로드 실패')
      }
    } catch {
      csToast.error('네트워크 오류가 발생했습니다.')
    } finally {
      if (type === 'identity') uploadingIdentity = false
      else                     uploadingForeign  = false
    }
  }

  function cancelDocUpload(type: 'identity' | 'foreign') {
    if (type === 'identity') {
      reuploadIdentityOpen = false
      identityFile         = null
      identityFileError    = ''
      if (identityPreviewUrl) { URL.revokeObjectURL(identityPreviewUrl); identityPreviewUrl = null }
    } else {
      reuploadForeignOpen = false
      foreignFile         = null
      foreignFileError    = ''
      if (foreignPreviewUrl)  { URL.revokeObjectURL(foreignPreviewUrl);  foreignPreviewUrl  = null }
    }
  }

  let showMemberTypeModal = $state(false)
  let memberTypeGroups = $state<MemberTypeGroup[]>([])
  let loadingGroups = $state(false)
  let groupsLoaded = $state(false)

  async function openMemberTypeModal() {
    showMemberTypeModal = true
    if (groupsLoaded) return
    loadingGroups = true
    const { data, error } = await supabase
      .from('code_mapping_groups')
      .select('id, name, is_active, sort_order')
      .order('sort_order', { ascending: true })
    loadingGroups = false
    if (!error && data) {
      memberTypeGroups = data as MemberTypeGroup[]
      groupsLoaded = true
    }
  }

  function selectMemberType(type: string) {
    localInfo.member_type = type
    showMemberTypeModal = false
  }
</script>

<div class="panel">
  <!-- 패널 헤더 -->
  <div class="panel-header">
    <div class="panel-user">
      <span class="panel-name">{row.name ?? row.email}</span>
      {#if row.member_code}
        <code class="panel-code">{row.member_code}</code>
      {/if}
    </div>
    <button class="close-btn" onclick={onclose} aria-label="닫기">✕</button>
  </div>

  <!-- 탭 -->
  <div class="panel-tabs">
    <button
      class="panel-tab"
      class:active={activeTab === 'info'}
      onclick={() => (activeTab = 'info')}
    >기본정보</button>
    <button
      class="panel-tab"
      class:active={activeTab === 'score'}
      onclick={() => (activeTab = 'score')}
    >크레이지스코어</button>
    <button
      class="panel-tab"
      class:active={activeTab === 'subscription'}
      onclick={() => (activeTab = 'subscription')}
    >구독이력</button>
    <button
      class="panel-tab"
      class:active={activeTab === 'blacklist'}
      class:tab-blacklist={row.blacklisted}
      onclick={() => (activeTab = 'blacklist')}
    >블랙리스트</button>
    <button
      class="panel-tab"
      class:active={activeTab === 'inquiry'}
      onclick={() => (activeTab = 'inquiry')}
    >빠른문의</button>
  </div>

  <!-- 탭 콘텐츠 -->
  <div class="panel-body">

    <!-- 기본정보 탭 -->
    {#if activeTab === 'info'}
      <form
        method="POST"
        action="/cms/customers?/updateCustomerInfo"
        use:enhance={() => {
          isSavingInfo = true
          return async ({ result }) => {
            isSavingInfo = false
            if (result.type === 'success') {
              csToast.success('고객 정보가 수정되었습니다.')
              await invalidateAll()
            } else if (result.type === 'failure') {
              csToast.error((result.data as { error?: string })?.error ?? '수정 실패')
            }
          }
        }}
        class="info-grid"
      >
        <input type="hidden" name="user_id" value={row.user_id} />
        <input type="hidden" name="member_type" value={localInfo.member_type} />

        <div class="info-row">
          <span class="info-label">이름</span>
          <input class="info-input" type="text" name="name" bind:value={localInfo.name} placeholder="이름" />
        </div>
        <div class="info-row">
          <span class="info-label">이메일</span>
          <input class="info-input" type="email" name="email" bind:value={localInfo.email} placeholder="이메일" onkeydown={handleEmailKeydown} oninput={handleEmailInput} />
        </div>
        <div class="info-row">
          <span class="info-label">전화번호</span>
          <input class="info-input" type="text" name="phone" value={localInfo.phone} oninput={handlePhoneInput} placeholder="010-0000-0000" />
        </div>
        <div class="info-row">
          <span class="info-label">생년월일</span>
          <input class="info-input" type="date" name="birth_date" bind:value={localInfo.birth_date} />
        </div>
        <div class="info-row">
          <span class="info-label">회원유형</span>
          <button type="button" class="info-select-btn" onclick={openMemberTypeModal}>
            {localInfo.member_type}
            <span class="info-select-arrow">▾</span>
          </button>
        </div>
        <div class="info-row">
          <span class="info-label">등급</span>
          <span class="info-val grade-badge grade-{row.membership_grade}">{row.membership_grade.toUpperCase()}</span>
        </div>
        <div class="info-row">
          <span class="info-label">포인트</span>
          <span class="info-val">{row.points.toLocaleString('ko-KR')}P</span>
        </div>
        <!-- 본인 증명 -->
        <div class="info-row">
          <span class="info-label">본인 증명</span>
          <button
            type="button"
            class="btn-file-view"
            disabled={!row.identity_type || !row.identity_doc_url}
            onclick={() => row.identity_doc_url && openIdentityDoc(row.identity_doc_url)}
          >
            {#if row.identity_type === 'student'}학생증 보기
            {:else if row.identity_type === 'resident'}주민등록증 보기
            {:else if row.identity_type === 'driver'}운전면허증 보기
            {:else if row.identity_type === 'other'}기타 증명 보기
            {:else if row.identity_type === 'general'}일반증명 보기
            {:else}미등록{/if}
          </button>
          {#if row.identity_type && row.identity_verified_at}
            <span class="identity-date">
              {formatIdentityDate(row.identity_verified_at)}
              {#if isIdentityExpired(row.identity_verified_at)}
                <span class="identity-expired">기간경과</span>
              {/if}
            </span>
          {/if}
          {#if !row.identity_doc_url || (row.identity_verified_at && isIdentityExpired(row.identity_verified_at))}
            <button
              type="button"
              class="btn-reupload"
              class:btn-reupload-cancel={reuploadIdentityOpen}
              onclick={() => reuploadIdentityOpen ? cancelDocUpload('identity') : (reuploadIdentityOpen = true)}
            >{reuploadIdentityOpen ? '취소' : '재등록'}</button>
          {/if}
        </div>
        {#if reuploadIdentityOpen}
          <div class="reupload-box">
            <p class="reupload-hint">PNG · JPEG · WebP · HEIF · PDF (최대 10MB)</p>
            <label class="btn-file-pick">
              파일 선택
              <input
                type="file"
                accept={DOC_ACCEPT}
                class="sr-only"
                onchange={(e) => handleDocFile(e, 'identity')}
              />
            </label>
            {#if identityFile}
              <div class="reupload-preview">
                {#if identityPreviewUrl}
                  <img src={identityPreviewUrl} alt="미리보기" class="reupload-img" />
                {:else}
                  <span class="reupload-pdf-name">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    {identityFile.name}
                  </span>
                {/if}
              </div>
            {/if}
            {#if identityFileError}
              <p class="reupload-error" role="alert">{identityFileError}</p>
            {/if}
            <div class="reupload-actions">
              <button
                type="button"
                class="btn-doc-confirm"
                disabled={!identityFile || uploadingIdentity}
                onclick={() => submitDocUpload('identity')}
              >{uploadingIdentity ? '업로드 중...' : '등록 확인'}</button>
              <button type="button" class="btn-doc-cancel" onclick={() => cancelDocUpload('identity')}>취소</button>
            </div>
          </div>
        {/if}

        <!-- 외국인 증명 -->
        <div class="info-row">
          <span class="info-label">외국인 여부</span>
          {#if row.is_foreign}<span class="info-val">외국인</span>{/if}
          <button
            type="button"
            class="btn-file-view"
            disabled={!row.is_foreign || !row.foreign_doc_url}
            onclick={() => row.foreign_doc_url && openIdentityDoc(row.foreign_doc_url)}
          >여권 보기</button>
          {#if row.is_foreign && row.foreign_verified_at}
            <span class="identity-date">
              {formatIdentityDate(row.foreign_verified_at)}
              {#if isIdentityExpired(row.foreign_verified_at)}
                <span class="identity-expired">기간경과</span>
              {/if}
            </span>
          {/if}
          {#if row.is_foreign && (!row.foreign_doc_url || (row.foreign_verified_at && isIdentityExpired(row.foreign_verified_at)))}
            <button
              type="button"
              class="btn-reupload"
              class:btn-reupload-cancel={reuploadForeignOpen}
              onclick={() => reuploadForeignOpen ? cancelDocUpload('foreign') : (reuploadForeignOpen = true)}
            >{reuploadForeignOpen ? '취소' : '재등록'}</button>
          {/if}
        </div>
        {#if reuploadForeignOpen}
          <div class="reupload-box">
            <p class="reupload-hint">PNG · JPEG · WebP · HEIF · PDF (최대 10MB)</p>
            <label class="btn-file-pick">
              파일 선택
              <input
                type="file"
                accept={DOC_ACCEPT}
                class="sr-only"
                onchange={(e) => handleDocFile(e, 'foreign')}
              />
            </label>
            {#if foreignFile}
              <div class="reupload-preview">
                {#if foreignPreviewUrl}
                  <img src={foreignPreviewUrl} alt="미리보기" class="reupload-img" />
                {:else}
                  <span class="reupload-pdf-name">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    {foreignFile.name}
                  </span>
                {/if}
              </div>
            {/if}
            {#if foreignFileError}
              <p class="reupload-error" role="alert">{foreignFileError}</p>
            {/if}
            <div class="reupload-actions">
              <button
                type="button"
                class="btn-doc-confirm"
                disabled={!foreignFile || uploadingForeign}
                onclick={() => submitDocUpload('foreign')}
              >{uploadingForeign ? '업로드 중...' : '등록 확인'}</button>
              <button type="button" class="btn-doc-cancel" onclick={() => cancelDocUpload('foreign')}>취소</button>
            </div>
          </div>
        {/if}
        <div class="info-row">
          <span class="info-label">가입일</span>
          <input class="info-input" type="date" name="created_at" bind:value={localInfo.created_at_date} />
        </div>
        <div class="info-row">
          <span class="info-label">대여 횟수</span>
          <span class="info-val">{row.rental_count}회</span>
        </div>
        <div class="info-row">
          <span class="info-label">연체 횟수</span>
          <span class="info-val">{row.late_return_count}회</span>
        </div>
        <div class="info-row">
          <span class="info-label">파손 횟수</span>
          <span class="info-val">{row.damage_count}건</span>
        </div>

        <!-- 배송지 정보 -->
        <div class="addr-section">
          <div class="addr-section-header">
            <span class="info-label addr-section-label">배송지</span>
            {#if loadingAddresses}
              <span class="addr-loading">로딩 중...</span>
            {:else if shippingAddresses.length === 0 && addressesLoaded}
              <span class="addr-empty">등록 없음</span>
            {/if}
          </div>
          {#if shippingAddresses.length > 0}
            <div class="addr-list">
              {#each shippingAddresses as addr (addr.id)}
                <div class="addr-item" class:addr-default={addr.is_default}>
                  <div class="addr-item-top">
                    <span class="addr-badge" class:addr-badge-default={addr.is_default} class:addr-badge-extra={!addr.is_default}>
                      {addr.is_default ? '기본' : '추가'}
                    </span>
                    {#if addr.label && addr.label !== '기본' && addr.label !== '추가'}
                      <span class="addr-tag">{addr.label}</span>
                    {/if}
                  </div>
                  <p class="addr-road">
                    {addr.road_address}{addr.detail_address ? ' ' + addr.detail_address : ''}
                  </p>
                  {#if addr.recipient || addr.phone}
                    <p class="addr-meta">{[addr.recipient, addr.phone].filter(Boolean).join(' · ')}</p>
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>

        <!-- 알림설정 -->
        <div class="notif-section">
          <div class="notif-section-header">
            <span class="info-label notif-section-label">알림설정</span>
            {#if !notifLoaded}
              <span class="addr-loading">로딩 중...</span>
            {:else}
              <button
                type="button"
                class="notif-refresh-btn"
                aria-label="알림설정 새로고침"
                onclick={() => { notifLoaded = false; notifSettings = null; consentLoaded = false; consentSettings = null; loadProfileSettings(row.user_id) }}
              >↺</button>
            {/if}
          </div>
          {#if notifLoaded}
            <div class="notif-rows">
              <div class="notif-row">
                <span class="notif-row-label">대여예약 정보 알림</span>
                {#if notifSettings?.rental_alert}
                  <span class="notif-badge notif-allow">허용</span>
                {:else}
                  <span class="notif-badge notif-deny">거부</span>
                {/if}
              </div>
              <div class="notif-row">
                <span class="notif-row-label">혜택 정보 알림</span>
                {#if notifSettings?.benefit_alert}
                  <span class="notif-badge notif-allow">허용</span>
                {:else}
                  <span class="notif-badge notif-deny">거부</span>
                {/if}
              </div>
            </div>
          {/if}
        </div>

        <!-- 개인정보 동의 -->
        <div class="notif-section">
          <div class="notif-section-header">
            <span class="info-label notif-section-label">개인정보 동의</span>
            {#if !consentLoaded}
              <span class="addr-loading">로딩 중...</span>
            {:else}
              <button
                type="button"
                class="notif-refresh-btn"
                aria-label="동의 정보 새로고침"
                onclick={() => { consentLoaded = false; consentSettings = null; notifLoaded = false; notifSettings = null; loadProfileSettings(row.user_id) }}
              >↺</button>
            {/if}
          </div>
          {#if consentLoaded}
            <div class="notif-rows">
              <div class="notif-row">
                <span class="notif-row-label">개인정보 수집·이용 동의</span>
                {#if consentSettings?.privacy_consent}
                  <span class="notif-badge notif-allow">동의</span>
                {:else}
                  <span class="notif-badge notif-deny">미동의</span>
                {/if}
              </div>
              <div class="notif-row">
                <span class="notif-row-label">개인정보 제3자 제공 동의</span>
                {#if consentSettings?.third_party_consent}
                  <span class="notif-badge notif-allow">동의</span>
                {:else}
                  <span class="notif-badge notif-deny">미동의</span>
                {/if}
              </div>
            </div>
          {/if}
        </div>

        {#if isDirtyInfo}
          <div class="save-bar">
            <button type="submit" class="btn-primary" disabled={isSavingInfo}>
              {isSavingInfo ? '저장 중...' : '변경사항 저장'}
            </button>
          </div>
        {/if}
      </form>

      <!-- 회원유형 선택 모달 -->
      {#if showMemberTypeModal}
        <div class="modal-backdrop" role="presentation" onclick={() => (showMemberTypeModal = false)}>
          <div class="modal-dialog member-type-dialog" role="dialog" aria-modal="true">
            <p class="modal-title">회원유형 선택</p>
            {#if loadingGroups}
              <p class="modal-loading">불러오는 중...</p>
            {:else}
              <div class="member-type-grid">
                {#each memberTypeGroups.filter(g => g.is_active) as group (group.id)}
                  <button
                    type="button"
                    class="member-type-chip"
                    class:member-type-chip-active={localInfo.member_type === group.name}
                    onclick={() => selectMemberType(group.name)}
                  >{group.name}</button>
                {/each}
                {#each ['B2C', 'B2B'] as preset}
                  {#if !memberTypeGroups.find(g => g.name === preset)}
                    <button
                      type="button"
                      class="member-type-chip"
                      class:member-type-chip-active={localInfo.member_type === preset}
                      onclick={() => selectMemberType(preset)}
                    >{preset}</button>
                  {/if}
                {/each}
              </div>
            {/if}
            <button type="button" class="btn-secondary modal-close-btn" onclick={() => (showMemberTypeModal = false)}>닫기</button>
          </div>
        </div>
      {/if}

      <!-- 회원 삭제 -->
      <div class="delete-account-section">
        <form
          method="POST"
          action="/cms/customers?/deleteCustomer"
          use:enhance={() => {
            return async ({ result, update }) => {
              if (result.type === 'success') {
                csToast.success('회원이 삭제되었습니다.')
                deleteWarnPending = false
                await update()
                onclose()
              } else if (result.type === 'failure') {
                const err = (result.data as { error?: string })?.error ?? '삭제 실패'
                csToast.error(err)
                deleteWarnPending = false
              }
            }
          }}
        >
          <input type="hidden" name="user_id" value={row.user_id} />
          <button
            type={deleteWarnPending ? 'submit' : 'button'}
            class="act-del act-del-account"
            aria-label="회원 삭제"
            title="회원 삭제"
            onclick={() => {
              if (!deleteWarnPending) {
                deleteWarnPending = true
                csToast.warning('한번 더 선택 시 삭제됩니다.')
                setTimeout(() => { deleteWarnPending = false }, 4000)
              }
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
            회원 삭제
          </button>
        </form>
      </div>
    {/if}

    <!-- 크레이지스코어 탭 -->
    {#if activeTab === 'score'}
      <div class="score-section">
        <!-- 현재 스코어 -->
        <div class="score-display">
          <div class="score-top">
            <span class="score-big {getScoreClass(row.credit_score)}">{row.credit_score}점</span>
            <div class="score-meta">
              <span>보증금율: <strong>{getDepositRate(row.credit_score)}</strong></span>
            </div>
          </div>
          <div class="score-bar-wrap">
            <div class="score-bar-bg">
              <div
                class="score-bar-fill {getScoreClass(row.credit_score)}"
                style="width: {scoreBarWidth(row.credit_score)}"
              ></div>
            </div>
            <div class="score-bar-labels">
              <span>0</span><span>50</span><span>70</span><span>85</span><span>100</span>
            </div>
          </div>
        </div>

        <!-- 산정 근거 -->
        <div class="info-panel score-basis">
          <div class="basis-row">
            <span>기본값</span><span>70점</span>
          </div>
          <div class="basis-row">
            <span>대여 횟수 +{row.rental_count * 2}</span>
            <span class="basis-pos">({row.rental_count}회 × 2)</span>
          </div>
          <div class="basis-row">
            <span>연체 -{row.late_return_count * 8}</span>
            <span class="basis-neg">({row.late_return_count}회 × 8)</span>
          </div>
          <div class="basis-row">
            <span>파손 -{row.damage_count * 15}</span>
            <span class="basis-neg">({row.damage_count}건 × 15)</span>
          </div>
        </div>

        <!-- 수동 조정 폼 -->
        <div class="section-divider"></div>
        <div class="adjust-section">
          <span class="section-title">수동 조정</span>
          <form
            method="POST"
            action="/cms/customers?/adjustScore"
            use:enhance={() => {
              isAdjusting = true
              return ({ result }) => {
                isAdjusting = false
                if (result.type === 'success') {
                  csToast.success('스코어가 조정되었습니다.')
                  adjustDelta = 0
                  adjustReason = ''
                  loadAuditLog()
                } else if (result.type === 'failure') {
                  csToast.error((result.data as { error?: string })?.error ?? '조정 실패')
                }
              }
            }}
            class="adjust-form"
          >
            <input type="hidden" name="user_id" value={row.user_id} />
            <div class="adjust-row">
              <label class="info-label" for="delta">조정값</label>
              <div class="delta-wrap">
                <button type="button" class="delta-btn" onclick={() => (adjustDelta = Math.max(-100, adjustDelta - 1))}>−</button>
                <input
                  id="delta"
                  type="number"
                  name="delta"
                  class="f-input delta-input"
                  bind:value={adjustDelta}
                  min="-100"
                  max="100"
                  step="1"
                  required
                />
                <button type="button" class="delta-btn" onclick={() => (adjustDelta = Math.min(100, adjustDelta + 1))}>+</button>
              </div>
              {#if adjustDelta !== 0}
                <span class="delta-preview">
                  {row.credit_score} → <strong class={getScoreClass(newScore)}>{newScore}점</strong>
                  ({scoreDelta})
                </span>
              {/if}
            </div>
            <div class="adjust-row">
              <label class="info-label" for="adjust-reason">사유</label>
              <input
                id="adjust-reason"
                type="text"
                name="reason"
                class="f-input"
                placeholder="조정 사유 입력 (필수)"
                bind:value={adjustReason}
                required
              />
            </div>
            <button
              type="submit"
              class="btn-primary"
              disabled={isAdjusting || adjustDelta === 0 || !adjustReason.trim()}
            >
              {isAdjusting ? '처리 중...' : '스코어 조정'}
            </button>
          </form>
        </div>

        <!-- 최근 조정 이력 -->
        {#if auditLog.length > 0 || loadingAudit}
          <div class="section-divider"></div>
          <span class="section-title">최근 조정 이력</span>
          {#if loadingAudit}
            <div class="loading-text">로딩 중...</div>
          {:else}
            <div class="audit-list">
              {#each auditLog as entry}
                <div class="audit-row">
                  <span class="audit-scores">
                    {entry.old_score}→<strong class={getScoreClass(entry.new_score)}>{entry.new_score}</strong>점
                    <span class="audit-delta" class:pos={entry.new_score > entry.old_score}>
                      ({entry.new_score > entry.old_score ? '+' : ''}{entry.new_score - entry.old_score})
                    </span>
                  </span>
                  <span class="audit-reason">{entry.reason}</span>
                  <span class="audit-date">{formatDate(entry.created_at)}</span>
                </div>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/if}

    <!-- 구독이력 탭 -->
    {#if activeTab === 'subscription'}
      <div class="subscription-notice info-panel">
        구독 등급 변경은 사용자가 직접 진행해야 합니다. 관리자는 취소·일시정지만 가능합니다.
      </div>

      {#if loadingSubscriptions}
        <div class="loading-text">로딩 중...</div>
      {:else if subscriptions.length === 0}
        <div class="no-data">구독 이력이 없습니다.</div>
      {:else}
        {#each subscriptions as sub (sub.id)}
          <div class="sub-card" class:sub-active={sub.status === 'active'}>
            <div class="sub-row">
              {#if sub.plan_name}
                <span class="sub-tier grade-badge grade-{sub.plan_name.toLowerCase()}">{tierLabel(sub.plan_name)}</span>
              {/if}
              <span class="sub-status status-{sub.status}">{statusLabel(sub.status)}</span>
            </div>
            <div class="sub-meta">
              <span>{formatDate(sub.started_at)} ~ {formatDate(sub.expires_at)}</span>
            </div>
            {#if sub.status === 'active'}
              <div class="sub-actions">
                <button
                  class="btn-danger"
                  onclick={() => openCancelModal(sub.id)}
                >구독 취소</button>
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    {/if}

    <!-- 블랙리스트 탭 -->
    {#if activeTab === 'blacklist'}
      <div class="bl-tab-section">

        <!-- 현재 상태 배너 -->
        <div class="bl-status-banner" class:bl-active={row.blacklisted}>
          <div class="bl-status-left">
            {#if row.blacklisted}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              <span class="bl-status-text">블랙리스트 등록 중</span>
            {:else}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              <span class="bl-status-text">정상 회원</span>
            {/if}
          </div>
          <button
            class="btn-toggle"
            class:bl-on={row.blacklisted}
            onclick={() => (showBlacklistForm = !showBlacklistForm)}
          >
            {row.blacklisted ? '해제' : '등록'}
          </button>
        </div>

        {#if row.blacklisted && row.blacklist_reason}
          <div class="bl-reason-panel">
            <span class="bl-reason-label">등록 사유</span>
            <p class="bl-reason-text">{row.blacklist_reason}</p>
          </div>
        {/if}

        {#if showBlacklistForm}
          <form
            method="POST"
            action="/cms/customers?/toggleBlacklist"
            use:enhance={() => {
              return async ({ result }) => {
                if (result.type === 'success') {
                  csToast.success(row.blacklisted ? '블랙리스트가 해제되었습니다.' : '블랙리스트에 등록되었습니다.')
                  showBlacklistForm = false
                  blacklistReason = ''
                  await invalidateAll()
                } else if (result.type === 'failure') {
                  csToast.error((result.data as { error?: string })?.error ?? '처리 실패')
                }
              }
            }}
            class="bl-form"
          >
            <input type="hidden" name="user_id" value={row.user_id} />
            <input type="hidden" name="blacklisted" value={row.blacklisted ? 'false' : 'true'} />
            {#if !row.blacklisted}
              <textarea
                name="reason"
                class="f-input"
                placeholder="블랙리스트 등록 사유를 입력하세요 (필수)"
                rows="3"
                bind:value={blacklistReason}
                required
              ></textarea>
            {:else}
              <input type="hidden" name="reason" value="" />
            {/if}
            <button type="submit" class="btn-danger" disabled={!row.blacklisted && !blacklistReason.trim()}>
              {row.blacklisted ? '블랙리스트 해제 확인' : '블랙리스트 등록'}
            </button>
          </form>
        {/if}

      </div>
    {/if}

    <!-- 빠른문의 탭 -->
    {#if activeTab === 'inquiry'}
      <div class="inquiry-tab-section">
        {#if loadingInquiries}
          <div class="inq-loading">불러오는 중...</div>
        {:else if inquiryPosts.length === 0}
          <div class="inq-empty">등록된 문의가 없습니다.</div>
        {:else}
          {#each inquiryPosts as post (post.id)}
            {@const st = INQUIRY_STATUS_STYLE[post.status] ?? INQUIRY_STATUS_STYLE['open']}
            {@const isOpen = inquiryExpandedId === post.id}
            {@const replyCount = post.cs_inquiries?.length ?? 0}
            <div class="inq-card" class:inq-open={isOpen}>
              <button
                class="inq-head"
                onclick={() => toggleInquiry(post.id)}
                aria-expanded={isOpen}
              >
                <span class="inq-chip" style="background:{st.bg};color:{st.color}">
                  {INQUIRY_STATUS_LABEL[post.status] ?? post.status}
                </span>
                <div class="inq-summary">
                  <span class="inq-title">{post.title}</span>
                  <span class="inq-meta">
                    <span>{INQUIRY_CATEGORY_LABEL[post.category] ?? post.category}</span>
                    <span>{post.created_at.slice(0,10)}</span>
                    {#if replyCount > 0}
                      <span class="inq-reply-badge">답변 {replyCount}</span>
                    {/if}
                  </span>
                </div>
                <span class="inq-chevron" class:rotated={isOpen}>
                  <svg width="12" height="12" viewBox="0 0 14 14" fill="none">
                    <path d="M2 5L7 9L12 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                </span>
              </button>

              {#if isOpen}
                <div class="inq-body">
                  <div class="inq-section-label">고객 문의</div>
                  <div class="inq-content">{post.content}</div>

                  {#if post.cs_inquiries?.length > 0}
                    <div class="inq-section-label inq-reply-label">관리자 답변</div>
                    {#each post.cs_inquiries as reply (reply.id)}
                      <div class="inq-reply">
                        <div class="inq-reply-text">{reply.response}</div>
                        <div class="inq-reply-meta">
                          {#if reply.is_resolution}
                            <span class="inq-resolved-tag">종결 답변</span>
                          {/if}
                          <span>{reply.created_at.slice(0,10)}</span>
                        </div>
                      </div>
                    {/each}
                  {:else}
                    <div class="inq-no-reply">아직 답변이 등록되지 않았습니다.</div>
                  {/if}
                </div>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    {/if}

  </div>
</div>

<!-- 구독 취소 확인 모달 -->
{#if showCancelModal}
  <div
    class="modal-backdrop"
    role="presentation"
    onclick={() => (showCancelModal = false)}
  >
    <div
      class="modal-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="구독 취소 확인"
      onclick={(e) => e.stopPropagation()}
    >
      <p class="modal-title">구독을 취소하시겠습니까?</p>
      <p class="modal-sub">취소 후 복구가 불가능합니다. 사용자에게 취소 사유를 제공해주세요.</p>
      <form
        method="POST"
        action="/cms/customers?/cancelSubscription"
        use:enhance={() => {
          return ({ result }) => {
            if (result.type === 'success') {
              csToast.success('구독이 취소되었습니다.')
              showCancelModal = false
              loadSubscriptions()
            } else if (result.type === 'failure') {
              csToast.error((result.data as { error?: string })?.error ?? '취소 실패')
            }
          }
        }}
        class="modal-form"
      >
        <input type="hidden" name="subscription_id" value={cancelTargetId} />
        <input type="hidden" name="status" value="cancelled" />
        <textarea
          name="reason"
          class="f-input"
          placeholder="취소 사유 입력 (필수)"
          rows="2"
          bind:value={cancelReason}
          required
        ></textarea>
        <div class="modal-actions">
          <button type="button" class="btn-secondary" onclick={() => (showCancelModal = false)}>취소</button>
          <button type="submit" class="btn-danger" disabled={!cancelReason.trim()}>구독 취소 확인</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<!-- 본인증명 파일 뷰어 -->
{#if identityDocUrl}
  <div
    class="doc-viewer-backdrop"
    role="presentation"
    onclick={closeIdentityDoc}
  >
    <div
      class="doc-viewer-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="본인증명 문서 보기"
      onclick={(e) => e.stopPropagation()}
    >
      <div class="doc-viewer-header">
        <span class="doc-viewer-title">본인증명 문서</span>
        <button type="button" class="doc-viewer-close" onclick={closeIdentityDoc} aria-label="닫기">✕</button>
      </div>
      <div class="doc-viewer-body">
        {#if isPdf}
          <iframe
            src={identityDocUrl}
            title="본인증명 문서"
            class="doc-viewer-iframe"
          ></iframe>
        {:else}
          <img
            src={identityDocUrl}
            alt="본인증명 문서"
            class="doc-viewer-img"
          />
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  .panel {
    background: var(--cs-white);
    border-radius: var(--cms-radius-md);
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
  }

  /* 헤더 */
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px 12px;
    border-bottom: 1px solid #ECEBF4;
    flex-shrink: 0;
  }
  .panel-user { display: flex; flex-direction: column; gap: 4px; }
  .panel-name { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }
  .panel-code { font: var(--text-pc-script-12); font-family: monospace; background: var(--cs-surface-gray); padding: 2px 6px; border-radius: 4px; color: var(--cs-text-mid); }
  .close-btn {
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: var(--cs-surface-gray); border: none; border-radius: 50%;
    color: var(--cs-text-mid); font-size: 12px; cursor: pointer;
    transition: background 0.12s;
  }
  .close-btn:hover { background: rgba(59,47,138,0.08); }

  /* 탭 */
  .panel-tabs {
    display: flex;
    gap: 0;
    padding: 0 8px;
    border-bottom: 1px solid #ECEBF4;
    flex-shrink: 0;
  }
  .panel-tab {
    flex: 1;
    height: 40px;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
  }
  .panel-tab:hover { color: var(--cs-text); }
  .panel-tab.active {
    color: var(--cs-purple);
    border-bottom-color: var(--cs-purple);
    font-weight: 700;
  }

  /* 바디 */
  .panel-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  /* 기본정보 */
  .info-grid { display: flex; flex-direction: column; gap: 8px; }
  .info-row {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 6px 0;
    border-bottom: 1px solid var(--cs-surface-gray);
  }
  .info-row:last-child { border-bottom: none; }
  .info-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    min-width: 80px;
    flex-shrink: 0;
  }
  .info-val { font: var(--text-pc-body-14); color: var(--cs-text); }

  /* 등급 배지 */
  .grade-badge {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); font-weight: 700;
  }
  .grade-none  { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .grade-easy  { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .grade-pop   { background: rgba(59,47,138,0.10);   color: var(--cs-purple); }
  .grade-crazy { background: rgba(255,69,0,0.12);    color: var(--cs-orange); }

  /* 구분선 */
  .section-divider { height: 1px; background: #ECEBF4; margin: 4px 0; }
  .section-title { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); }

  /* 블랙리스트 */
  .blacklist-section { display: flex; flex-direction: column; gap: 8px; }
  .blacklist-header { display: flex; align-items: center; justify-content: space-between; }
  .btn-toggle {
    height: 30px; padding: 0 12px;
    background: var(--cs-surface-gray); border: none;
    border-radius: var(--radius-sm); font: var(--text-pc-script-12);
    color: var(--cs-text-mid); cursor: pointer; transition: background 0.12s;
  }
  .btn-toggle.bl-on { background: rgba(255,53,53,0.10); color: var(--cs-red-badge); }
  .bl-form { display: flex; flex-direction: column; gap: 8px; }

  /* 정보 패널 */
  .info-panel {
    background: #F3F4F6;
    border-radius: var(--cms-radius-sm);
    padding: 12px 14px;
    font: var(--text-pc-descript-10);
    color: var(--cs-text-mid);
    line-height: 160%;
  }

  /* 스코어 */
  .score-section { display: flex; flex-direction: column; gap: 12px; }
  .score-display { display: flex; flex-direction: column; gap: 8px; }
  .score-top { display: flex; align-items: baseline; gap: 12px; }
  .score-big { font: var(--text-pc-htitle-25); font-weight: 700; }
  .score-meta { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .score-high     { color: var(--cs-success-light); }
  .score-mid      { color: var(--cs-text); }
  .score-low      { color: var(--cs-warning); }
  .score-critical { color: var(--cs-red-badge); }

  .score-bar-wrap { display: flex; flex-direction: column; gap: 4px; }
  .score-bar-bg { height: 8px; background: var(--cs-surface-gray); border-radius: 4px; overflow: hidden; }
  .score-bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
  .score-bar-fill.score-high     { background: var(--cs-success-light); }
  .score-bar-fill.score-mid      { background: var(--cs-purple-pale); }
  .score-bar-fill.score-low      { background: var(--cs-warning); }
  .score-bar-fill.score-critical { background: var(--cs-red-badge); }
  .score-bar-labels {
    display: flex; justify-content: space-between;
    font: var(--text-pc-descript-10); color: var(--cs-text-light);
  }

  .score-basis { display: flex; flex-direction: column; gap: 4px; }
  .basis-row { display: flex; justify-content: space-between; font: var(--text-pc-descript-10); }
  .basis-pos { color: var(--cs-success-light); }
  .basis-neg { color: var(--cs-red-badge); }

  /* 수동 조정 */
  .adjust-section { display: flex; flex-direction: column; gap: 10px; }
  .adjust-form { display: flex; flex-direction: column; gap: 8px; }
  .adjust-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .delta-wrap { display: flex; align-items: center; gap: 4px; }
  .delta-btn {
    width: 32px; height: 32px; border: 1px solid #ECEBF4; background: var(--cs-white);
    border-radius: var(--radius-sm); font-size: 16px; cursor: pointer; color: var(--cs-text);
    display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  }
  .delta-input { width: 70px; text-align: center; padding: 6px 10px; }
  .delta-preview { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin-left: 4px; }

  /* 감사 로그 */
  .audit-list { display: flex; flex-direction: column; gap: 6px; }
  .audit-row {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    padding: 6px 10px; background: var(--cs-surface-gray); border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
  }
  .audit-scores { color: var(--cs-text); font-weight: 700; flex-shrink: 0; }
  .audit-delta { font-weight: 400; color: var(--cs-text-mid); }
  .audit-delta.pos { color: var(--cs-success-light); }
  .audit-reason { flex: 1; color: var(--cs-text-mid); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .audit-date { color: var(--cs-text-light); flex-shrink: 0; }

  /* 구독 */
  .subscription-notice { margin-bottom: 4px; }
  .sub-card {
    border: 1px solid #ECEBF4; border-radius: var(--cms-radius-sm);
    padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
  }
  .sub-card.sub-active { border-color: var(--cs-purple); }
  .sub-row { display: flex; align-items: center; gap: 8px; }
  .sub-tier { }
  .sub-status { font: var(--text-pc-script-12); font-weight: 700; }
  .status-active   { color: var(--cs-success-light); }
  .status-cancelled{ color: var(--cs-red-badge); }
  .status-paused   { color: var(--cs-warning); }
  .status-expired  { color: var(--cs-text-light); }
  .sub-renew { font: var(--text-pc-descript-10); background: rgba(59,47,138,0.08); color: var(--cs-purple); padding: 2px 6px; border-radius: 4px; }
  .sub-meta { font: var(--text-pc-script-12); color: var(--cs-text-mid); display: flex; gap: 12px; }
  .sub-reason { font: var(--text-pc-descript-10); color: var(--cs-text-mid); background: #F3F4F6; padding: 6px 10px; border-radius: 4px; }
  .sub-actions { display: flex; gap: 8px; }

  /* 버튼들 */
  .btn-primary {
    display: inline-flex; align-items: center; height: 44px; padding: 0 24px;
    background: var(--cs-purple); color: var(--cs-white); border: none;
    border-radius: var(--radius-md); font: var(--text-pc-body-14);
    cursor: pointer; transition: background 0.12s; white-space: nowrap;
  }
  .btn-primary:hover    { background: var(--cs-purple-hover); }
  .btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-secondary {
    display: inline-flex; align-items: center; height: 44px; padding: 0 20px;
    background: var(--cs-white); color: var(--cs-purple-dark);
    border: 1px solid #201857; border-radius: var(--radius-md);
    font: var(--text-pc-body-14); cursor: pointer; transition: background 0.12s;
  }
  .btn-secondary:hover { background: rgba(59,47,138,0.06); }

  /* 회원 삭제 섹션 */
  .delete-account-section {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--cs-lilac);
    display: flex;
    justify-content: flex-end;
  }

  .act-del {
    display: inline-flex; align-items: center; justify-content: center;
    height: 28px; padding: 0 8px;
    border: none; border-radius: var(--radius-sm);
    background: transparent; cursor: pointer;
    color: var(--cs-text-light);
    transition: background 0.1s, color 0.1s;
    flex-shrink: 0;
  }
  .act-del:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  .act-del-account {
    gap: 6px;
    padding: 0 12px;
    font: var(--text-pc-script-12);
  }

  .btn-danger {
    display: inline-flex; align-items: center; height: 40px; padding: 0 16px;
    background: var(--cs-chat-in-bg); color: var(--cs-red-badge); border: none;
    border-radius: var(--radius-sm); font: var(--text-pc-body-14);
    cursor: pointer; transition: background 0.12s; white-space: nowrap;
  }
  .btn-danger:hover    { background: var(--cs-bg-error); }
  .btn-danger:disabled { opacity: 0.5; cursor: not-allowed; }

  .f-input {
    background: var(--cs-surface-gray); border: none; border-radius: var(--radius-sm);
    padding: 8px 12px; font: var(--text-pc-body-14); color: var(--cs-text); width: 100%;
    box-sizing: border-box; resize: vertical;
  }
  .f-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }

  /* 공통 */
  .loading-text { font: var(--text-pc-script-12); color: var(--cs-text-light); padding: 12px 0; }
  .no-data { font: var(--text-pc-body-14); color: var(--cs-text-light); text-align: center; padding: 24px; }

  /* 모달 */
  .modal-backdrop {
    position: fixed; inset: 0; z-index: 300;
    background: rgba(16,11,50,0.45);
    display: flex; align-items: center; justify-content: center;
  }
  .modal-dialog {
    background: var(--cs-white); border-radius: var(--cms-radius-lg);
    padding: 28px 32px; width: 380px; max-width: calc(100vw - 40px);
    display: flex; flex-direction: column; gap: 12px;
  }
  .modal-title { font: var(--text-pc-body-14); font-weight: 700; color: var(--cs-text); margin: 0; }
  .modal-sub   { font: var(--text-pc-script-12); color: var(--cs-text-mid); margin: 0; }
  .modal-form  { display: flex; flex-direction: column; gap: 10px; }
  .modal-actions { display: flex; gap: 8px; justify-content: flex-end; }
  .modal-loading { font: var(--text-pc-script-12); color: var(--cs-text-light); margin: 0; }
  .modal-close-btn { align-self: flex-end; margin-top: 4px; }

  /* 기본정보 편집 입력 */
  .info-input {
    flex: 1;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 5px 10px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    min-width: 0;
  }
  .info-input:focus { outline: 2px solid var(--cs-purple); outline-offset: -2px; }
  .info-input[type="date"] { cursor: pointer; }

  /* 회원유형 선택 버튼 */
  .info-select-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: space-between;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-sm);
    padding: 5px 10px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    cursor: pointer;
    text-align: left;
    min-height: 30px;
  }
  .info-select-btn:hover { background: rgba(59,47,138,0.06); }
  .info-select-arrow { color: var(--cs-text-light); font-size: 11px; }

  /* 파일 보기 버튼 */
  .btn-file-view {
    height: 24px;
    padding: 0 8px;
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .btn-file-view:disabled { opacity: 0.35; cursor: not-allowed; }
  .btn-file-view:not(:disabled):hover { background: rgba(59,47,138,0.12); }

  /* 저장 바 */
  .save-bar {
    grid-column: 1 / -1;
    display: flex;
    justify-content: flex-end;
    padding-top: 8px;
    border-top: 1px solid var(--cs-lilac);
    margin-top: 4px;
  }

  /* 회원유형 모달 */
  .member-type-dialog { width: 320px; }
  .member-type-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .member-type-chip {
    height: 30px;
    padding: 0 14px;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    color: var(--cs-text);
    border: 1px solid #ECEBF4;
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .member-type-chip:hover { background: rgba(59,47,138,0.06); }
  .member-type-chip-active {
    background: var(--cs-purple-dark);
    color: var(--cs-white);
    border-color: var(--cs-purple-dark);
  }

  /* 본인증명 날짜 + 경과 */
  .identity-date {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }
  .identity-expired {
    display: inline-flex;
    align-items: center;
    height: 20px;
    padding: 0 7px;
    background: rgba(255,53,53,0.10);
    color: var(--cs-red-badge);
    border-radius: var(--radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
  }
  .info-val-empty {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  /* 재등록 버튼 */
  .btn-reupload {
    height: 22px;
    padding: 0 8px;
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    border: none;
    border-radius: var(--radius-sm);
    font: var(--text-pc-descript-10);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: background 0.12s;
  }
  .btn-reupload:hover { background: rgba(59,47,138,0.15); }
  .btn-reupload.btn-reupload-cancel {
    background: rgba(255,53,53,0.08);
    color: var(--cs-red-badge);
  }
  .btn-reupload.btn-reupload-cancel:hover { background: rgba(255,53,53,0.14); }

  /* 재업로드 폼 박스 */
  .reupload-box {
    margin-left: 92px;
    padding: 12px 14px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    border: 1px solid var(--cs-lilac);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .reupload-hint {
    font: var(--text-pc-descript-10);
    color: var(--cs-text-light);
    margin: 0;
  }
  .btn-file-pick {
    display: inline-flex;
    align-items: center;
    height: 28px;
    padding: 0 12px;
    background: var(--cs-white);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    cursor: pointer;
    transition: background 0.12s, border-color 0.12s;
    width: fit-content;
  }
  .btn-file-pick:hover { background: var(--cs-purple-op10); border-color: var(--cs-purple); }
  .sr-only {
    position: absolute;
    width: 1px; height: 1px;
    padding: 0; margin: -1px;
    overflow: hidden;
    clip: rect(0,0,0,0);
    white-space: nowrap;
    border-width: 0;
  }
  .reupload-preview { display: flex; align-items: center; }
  .reupload-img {
    max-width: 120px;
    max-height: 80px;
    object-fit: contain;
    border-radius: var(--cms-radius-sm);
    border: 1px solid var(--cs-lilac);
  }
  .reupload-pdf-name {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }
  .reupload-error {
    font: var(--text-pc-script-12);
    color: var(--cs-red-badge);
    margin: 0;
  }
  .reupload-actions { display: flex; gap: 8px; align-items: center; }

  .btn-doc-confirm {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 14px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .btn-doc-confirm:hover    { background: var(--cs-purple-hover); }
  .btn-doc-confirm:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-doc-cancel {
    display: inline-flex;
    align-items: center;
    height: 30px;
    padding: 0 12px;
    background: var(--cs-white);
    color: var(--cs-text-mid);
    border: 1px solid var(--cs-lilac);
    border-radius: var(--cms-radius-sm);
    font: var(--text-pc-script-12);
    cursor: pointer;
    transition: background 0.12s;
    white-space: nowrap;
  }
  .btn-doc-cancel:hover { background: var(--cs-surface-gray); }

  /* 본인증명 파일 뷰어 모달 */
  .doc-viewer-backdrop {
    position: fixed; inset: 0; z-index: 400;
    background: rgba(16,11,50,0.72);
    display: flex; align-items: center; justify-content: center;
  }
  .doc-viewer-dialog {
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    display: flex; flex-direction: column;
    width: min(860px, calc(100vw - 40px));
    max-height: calc(100vh - 80px);
    overflow: hidden;
  }
  .doc-viewer-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid #ECEBF4;
    flex-shrink: 0;
  }
  .doc-viewer-title {
    font: var(--text-pc-body-14);
    font-weight: 700;
    color: var(--cs-text);
  }
  .doc-viewer-close {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px;
    background: none; border: none;
    border-radius: var(--radius-sm);
    font-size: 14px; color: var(--cs-text-mid);
    cursor: pointer;
    transition: background 0.12s;
  }
  .doc-viewer-close:hover { background: rgba(59,47,138,0.08); color: var(--cs-text); }
  .doc-viewer-body {
    flex: 1; overflow: auto;
    display: flex; align-items: center; justify-content: center;
    background: #F3F4F6;
    min-height: 400px;
  }
  .doc-viewer-img {
    max-width: 100%; max-height: calc(100vh - 160px);
    object-fit: contain;
  }
  .doc-viewer-iframe {
    width: 100%; height: calc(100vh - 160px);
    border: none;
  }

  /* 배송지 섹션 */
  .addr-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--cs-surface-gray);
  }

  .addr-section-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .addr-section-label { min-width: 80px; flex-shrink: 0; }

  .addr-loading {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  .addr-empty {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  .addr-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-left: 92px;
  }

  .addr-item {
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    padding: 8px 12px;
    display: flex;
    flex-direction: column;
    gap: 3px;
    border: 1px solid transparent;
  }

  .addr-item.addr-default {
    border-color: var(--cs-purple);
    background: rgba(59,47,138,0.04);
  }

  .addr-item-top {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .addr-badge {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 7px;
    border-radius: 30px;
    font: var(--text-pc-descript-10);
    font-weight: 700;
    flex-shrink: 0;
  }

  .addr-badge-default {
    background: var(--cs-purple);
    color: var(--cs-white);
  }

  .addr-badge-extra {
    background: var(--cs-surface-gray);
    border: 1px solid #ddd;
    color: var(--cs-text-mid);
  }

  .addr-tag {
    font: var(--text-pc-descript-10);
    color: var(--cs-text-mid);
  }

  .addr-road {
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    font-weight: 600;
    margin: 0;
    line-height: 1.4;
  }

  .addr-meta {
    font: var(--text-pc-descript-10);
    color: var(--cs-text-mid);
    margin: 0;
  }

  /* 알림설정 섹션 */
  .notif-section {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 6px 0;
    border-bottom: 1px solid var(--cs-surface-gray);
  }

  .notif-section-header {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .notif-section-label { min-width: 80px; flex-shrink: 0; }

  .notif-refresh-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    background: none;
    border: none;
    border-radius: 4px;
    font-size: 14px;
    color: var(--cs-text-light);
    cursor: pointer;
    transition: color 0.12s, background 0.12s;
    padding: 0;
    line-height: 1;
  }
  .notif-refresh-btn:hover { color: var(--cs-purple); background: rgba(59,47,138,0.08); }

  .notif-rows {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding-left: 92px;
  }

  .notif-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 5px 10px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
  }

  .notif-row-label {
    font: var(--text-pc-script-12);
    color: var(--cs-text);
  }

  .notif-badge {
    display: inline-flex;
    align-items: center;
    height: 18px;
    padding: 0 8px;
    border-radius: 30px;
    font: var(--text-pc-descript-10);
    font-weight: 700;
    flex-shrink: 0;
  }

  .notif-allow {
    background: rgba(16,185,129,0.12);
    color: var(--cs-success-light);
  }

  .notif-deny {
    background: var(--cs-surface-gray);
    color: var(--cs-text-light);
    border: 1px solid #ddd;
  }

  /* 블랙리스트 탭 */
  .bl-tab-section { display: flex; flex-direction: column; gap: 12px; }

  .bl-status-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: var(--cs-surface-gray);
    border-radius: var(--cms-radius-sm);
    border: 1px solid transparent;
  }
  .bl-status-banner.bl-active {
    background: rgba(255,53,53,0.06);
    border-color: rgba(255,53,53,0.20);
  }

  .bl-status-left {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--cs-text-mid);
  }
  .bl-status-banner.bl-active .bl-status-left { color: var(--cs-red-badge); }

  .bl-status-text {
    font: var(--text-pc-body-14);
    font-weight: 700;
  }

  .bl-reason-panel {
    background: rgba(255,53,53,0.04);
    border: 1px solid rgba(255,53,53,0.15);
    border-radius: var(--cms-radius-sm);
    padding: 12px 14px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .bl-reason-label {
    font: var(--text-pc-descript-10);
    font-weight: 700;
    color: var(--cs-red-badge);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }
  .bl-reason-text {
    font: var(--text-pc-script-12);
    color: var(--cs-text);
    margin: 0;
    line-height: 1.6;
  }

  /* 블랙리스트 탭 활성 시 강조 */
  .panel-tab.tab-blacklist { color: var(--cs-red-badge); }
  .panel-tab.tab-blacklist.active {
    color: var(--cs-red-badge);
    border-bottom-color: var(--cs-red-badge);
  }

  /* 빠른문의 탭 */
  .inquiry-tab-section { display: flex; flex-direction: column; gap: 6px; }
  .inq-loading, .inq-empty {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text-mid);
    padding: 40px 0;
    text-align: center;
  }
  .inq-card {
    border: 1px solid var(--cs-lilac);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--cs-white);
  }
  .inq-card.inq-open { border-color: var(--cs-purple); }
  .inq-head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    width: 100%;
    padding: 10px 14px;
    background: none;
    border: none;
    cursor: pointer;
    text-align: left;
  }
  .inq-chip {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: var(--radius-xl);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    font-weight: 700;
    white-space: nowrap;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .inq-summary { flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .inq-title {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inq-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    color: var(--cs-text-mid);
    flex-wrap: wrap;
  }
  .inq-reply-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: var(--radius-xl);
    background: rgba(59,47,138,0.10);
    color: var(--cs-purple);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 10px;
    font-weight: 700;
  }
  .inq-chevron {
    flex-shrink: 0;
    color: var(--cs-text-mid);
    transition: transform 0.2s;
    margin-top: 2px;
  }
  .inq-chevron.rotated { transform: rotate(180deg); }
  .inq-body {
    padding: 10px 14px 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    border-top: 1px solid var(--cs-lilac);
  }
  .inq-section-label {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: var(--cs-text-mid);
  }
  .inq-reply-label { color: var(--cs-purple); }
  .inq-content {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text);
    white-space: pre-wrap;
    line-height: 1.7;
    background: var(--cs-surface-gray);
    border-radius: var(--radius-sm);
    padding: 10px 12px;
  }
  .inq-reply {
    background: rgba(59,47,138,0.05);
    border-left: 3px solid var(--cs-purple);
    border-radius: 0 8px 8px 0;
    padding: 8px 12px;
  }
  .inq-reply-text {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    color: var(--cs-text);
    white-space: pre-wrap;
    line-height: 1.7;
  }
  .inq-reply-meta {
    margin-top: 4px;
    display: flex;
    align-items: center;
    gap: 6px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    color: var(--cs-text-mid);
  }
  .inq-resolved-tag {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    border-radius: var(--radius-xl);
    background: rgba(16,185,129,0.12);
    color: #047857;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 10px;
    font-weight: 700;
  }
  .inq-no-reply {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 12px;
    color: var(--cs-text-mid);
  }
</style>
