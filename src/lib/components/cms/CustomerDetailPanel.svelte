<script lang="ts">
  import { enhance } from '$app/forms'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import { supabase } from '$lib/services/supabase'
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
    password_set: boolean
    created_at: string
    total_count: number
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

  let activeTab = $state<'info' | 'score' | 'subscription'>('info')
  let subscriptions = $state<Subscription[]>([])
  let auditLog = $state<AuditEntry[]>([])
  let loadingSubscriptions = $state(false)
  let loadingAudit = $state(false)

  // 스코어 탭 폼 상태
  let adjustDelta = $state(0)
  let adjustReason = $state('')
  let isAdjusting = $state(false)

  // 블랙리스트 폼 상태
  let blacklistReason = $state('')
  let showBlacklistForm = $state(false)

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
  })

  async function loadSubscriptions() {
    loadingSubscriptions = true
    const { data, error } = await supabase
      .from('user_subscriptions')
      .select('id, plan_id, status, started_at, expires_at, cancelled_at, created_at, subscription_plans(name)')
      .eq('user_id', row.user_id)
      .order('created_at', { ascending: false })
    loadingSubscriptions = false
    if (!error && data) {
      subscriptions = data.map((r: Record<string, unknown>) => ({
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
  }

  async function loadAuditLog() {
    loadingAudit = true
    const { data, error } = await supabase
      .from('credit_score_audit')
      .select('id, old_score, new_score, reason, metadata, created_at')
      .eq('user_id', row.user_id)
      .order('created_at', { ascending: false })
      .limit(10)
    loadingAudit = false
    if (!error && data) auditLog = data as AuditEntry[]
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
    member_type: row.member_type ?? 'B2C',
    created_at_date: row.created_at ? row.created_at.slice(0, 10) : '',
  })

  // row 변경(invalidateAll) 시 localInfo 동기화
  $effect(() => {
    localInfo.name = row.name ?? ''
    localInfo.email = row.email
    localInfo.phone = row.phone ?? ''
    localInfo.member_type = row.member_type ?? 'B2C'
    localInfo.created_at_date = row.created_at ? row.created_at.slice(0, 10) : ''
  })

  const isDirtyInfo = $derived(
    localInfo.name !== (row.name ?? '') ||
    localInfo.email !== row.email ||
    localInfo.phone !== (row.phone ?? '') ||
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
        <div class="info-row">
          <span class="info-label">본인 증명</span>
          <button
            type="button"
            class="btn-file-view"
            disabled={!row.identity_type || !row.identity_doc_url}
            onclick={() => row.identity_doc_url && openIdentityDoc(row.identity_doc_url)}
          >
            {#if row.identity_type === 'student'}학생증 보기
            {:else if row.identity_type === 'general'}일반증명 보기
            {:else}미등록{/if}
          </button>
          {#if row.identity_type && row.identity_verified_at}
            <span class="identity-date">
              {formatIdentityDate(row.identity_verified_at)}
              {#if isIdentityExpired(row.identity_verified_at)}
                <span class="identity-expired">경과</span>
              {/if}
            </span>
          {/if}
        </div>
        <div class="info-row">
          <span class="info-label">외국인 여부</span>
          {#if row.is_foreign}<span class="info-val">외국인</span>{/if}
          <button type="button" class="btn-file-view" disabled={!row.is_foreign}>여권 보기</button>
        </div>
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

      <!-- 블랙리스트 -->
      <div class="section-divider"></div>
      <div class="blacklist-section">
        <div class="blacklist-header">
          <span class="section-title">블랙리스트</span>
          <button
            class="btn-toggle"
            class:bl-on={row.blacklisted}
            onclick={() => (showBlacklistForm = !showBlacklistForm)}
          >
            {row.blacklisted ? '해제' : '등록'}
          </button>
        </div>
        {#if row.blacklisted && row.blacklist_reason}
          <div class="info-panel">사유: {row.blacklist_reason}</div>
        {/if}
        {#if showBlacklistForm}
          <form
            method="POST"
            action="/cms/customers?/toggleBlacklist"
            use:enhance={() => {
              return ({ result }) => {
                if (result.type === 'success') {
                  csToast.success(row.blacklisted ? '블랙리스트가 해제되었습니다.' : '블랙리스트에 등록되었습니다.')
                  showBlacklistForm = false
                  blacklistReason = ''
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
                rows="2"
                bind:value={blacklistReason}
                required
              ></textarea>
            {:else}
              <input type="hidden" name="reason" value="" />
            {/if}
            <button type="submit" class="btn-danger">
              {row.blacklisted ? '블랙리스트 해제 확인' : '블랙리스트 등록'}
            </button>
          </form>
        {/if}
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

  .btn-danger {
    display: inline-flex; align-items: center; height: 40px; padding: 0 16px;
    background: var(--cs-chat-in-bg); color: var(--cs-red-badge); border: none;
    border-radius: var(--radius-sm); font: var(--text-pc-body-14);
    cursor: pointer; transition: background 0.12s; white-space: nowrap;
  }
  .btn-danger:hover    { background: #ffb3b3; }
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
</style>
