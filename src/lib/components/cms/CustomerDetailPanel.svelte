<script lang="ts">
  import { enhance } from '$app/forms'
  import type { SubmitFunction } from '@sveltejs/kit'
  import { invalidateAll } from '$app/navigation'
  import { csToast } from '$lib/utils/toast'
  import CmsDatePicker from '$lib/components/cms/CmsDatePicker.svelte'
  import CustomerDocRows from '$lib/components/cms/CustomerDocRows.svelte'
  import { supabase } from '$lib/services/supabase'
  import { renderQrToCanvas, downloadQrWithLabel } from '$lib/utils/qrIssue'
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
    identity_type: string[] | null
    identity_doc_url: string[] | null
    identity_verified_at: string | null
    identity_approved_at?: string | null
    foreign_doc_url: string | null
    foreign_doc_urls: string[] | null
    foreign_type: string[] | null
    foreign_stay_type: string | null
    foreign_verified_at: string | null
    foreign_approved_at?: string | null
    password_set: boolean
    created_at: string
    total_count: number
    birth_date: string | null
    withdrawal_status: string
    withdrawal_requested_at: string | null
    withdrawal_purge_at: string | null
    // 레거시 회원 선등록 컬럼 (Migration 483) + 클레임 완료 마커 (Migration 485)
    legacy_imported_at?: string | null
    legacy_claimed_at?: string | null
    legacy_source?: string | null
    legacy_signup_at?: string | null
    legacy_purchase_count?: number | null
    // 회원 가입 이력 없는 관리대상(managed_persons) 행 여부 — Migration #686
    is_managed_person?: boolean
    // 사전 등록 관리대상과 가입 정보 일치(Migration #708) — pending이면 관리자 확인 대기
    managed_match?: {
      status: 'pending' | 'confirmed' | 'dismissed'
      basis: 'phone' | 'email'
      matched_at: string
      person_name: string | null
      person_phone: string | null
      person_reason: string | null
    } | null
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

  interface SubscriptionPaymentLog {
    id: string
    amount: number
    status: string
    billed_at: string
  }

  interface PointTx {
    id: string
    type: string              // 'earn' | 'use' | 'expire' | 'admin_grant' | 'admin_deduct'
    amount: number             // 부호 포함(적립 +, 사용/차감 -)
    balance_after: number
    description: string | null
    ref_type: string | null
    ref_id: string | null
    created_at: string
  }

  interface UserCouponTx {
    id: string
    created_at: string
    used_at: string | null
    used_count: number | null
    coupons: { display_name: string | null; discount_type: string; discount_value: number | string } | null
  }
  /** 포인트이력 탭에 누적 표시하는 한 줄 — 포인트 거래 또는 쿠폰 발급·사용 */
  type PointHistoryItem =
    | { kind: 'point'; key: string; at: string; tx: PointTx }
    | { kind: 'coupon'; key: string; at: string; event: 'issued' | 'used'; name: string; discount: string }

  interface AuditEntry {
    id: string
    old_score: number
    new_score: number
    reason: string
    metadata: Record<string, unknown> | null
    created_at: string
  }

  type CustomerTabKey = 'info' | 'score' | 'subscription' | 'points' | 'rental' | 'blacklist' | 'inquiry'

  interface Props {
    row: CustomerRow
    onclose: () => void
    initialTab?: string | null
    /** 'member'(기본) | 'managed'(회원 가입 이력 없는 관리대상) | 'new'(관리대상 신규 등록 — 빈 패널). managed·new는 기본정보+관리대상 탭만 노출 */
    mode?: 'member' | 'managed' | 'new'
    onregistered?: (r: { id: string; member_code: string; row: CustomerRow }) => void
  }
  let { row, onclose, initialTab = null, mode = 'member', onregistered }: Props = $props()

  const VALID_TABS: CustomerTabKey[] = ['info', 'score', 'subscription', 'points', 'rental', 'blacklist', 'inquiry']
  function resolveInitialTab(tab: string | null, m: 'member' | 'managed' | 'new'): CustomerTabKey {
    if (m !== 'member') return tab === 'blacklist' ? 'blacklist' : 'info'
    return VALID_TABS.includes(tab as CustomerTabKey) ? (tab as CustomerTabKey) : 'info'
  }

  // ─── 관리자용 회원 QR 조회/인쇄 ───────────────────────────────────────────
  // 페이로드는 상품 QR(원문 그대로)과 겹치지 않도록 `/qr/member/{member_code}` 경로형 고정.
  // UI는 RentalDetailPanel.svelte의 예약 QR(헤더 인라인, 44px, 토글 없음) 패턴과 통일 —
  // 애초에 ProductDetailPanel.svelte QR을 참고했었으나(2026-08-18) RentalDetailPanel이
  // 같은 날 별도로 더 최신 헤더인라인형으로 재구성한 것을 뒤늦게 확인해(2026-08-26) 통일함.
  let qrCanvasEl = $state<HTMLCanvasElement | null>(null)

  $effect(() => {
    const canvas = qrCanvasEl
    const code = row.member_code
    if (!canvas || !code) return
    renderQrToCanvas(canvas, `/qr/member/${code}`)
  })

  function downloadMemberQR() {
    if (!qrCanvasEl || !row.member_code) return
    const code = row.member_code
    downloadQrWithLabel(qrCanvasEl, null, `member-qr-${code}.png`)
  }

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

  interface RentalRow {
    id: number
    status: string | null
    reservation_code: string | null
    start_date: string | null
    end_date: string | null
    rental_days: number | null
    duration_type: string | null
    pickup_method: string | null
    return_method: string | null
    created_at: string
    products: { name: string; product_code: string | null } | null
  }

  interface CustomerChatSession {
    id: string
    status: string
    context_type: string
    context_id: string | null
    created_at: string
    updated_at: string
    closed_at: string | null
  }

  let activeTab = $state<CustomerTabKey>(resolveInitialTab(initialTab, mode))
  let subscriptions = $state<Subscription[]>([])
  let auditLog = $state<AuditEntry[]>([])
  let inquiryPosts = $state<CsPost[]>([])
  let loadingSubscriptions = $state(false)
  let loadingAudit = $state(false)
  let loadingInquiries = $state(false)
  let inquiryPostsLoaded = $state(false)
  let rentals = $state<RentalRow[]>([])
  let loadingRentals = $state(false)
  let chatSessions = $state<CustomerChatSession[]>([])
  let loadingChatSessions = $state(false)
  const inquiryFeed = $derived(
    [
      ...chatSessions.map((session) => ({ kind: 'chat' as const, id: session.id, at: session.updated_at, session })),
      ...inquiryPosts.map((post) => ({ kind: 'post' as const, id: post.id, at: post.created_at, post })),
    ].sort((x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0))
  )
  let chatSessionsLoaded = $state(false)
  let subscriptionsLoaded = $state(false)
  let auditLoaded = $state(false)
  let rentalsLoaded = $state(false)
  let points = $state<PointTx[]>([])
  let loadingPoints = $state(false)
  let pointsLoaded = $state(false)
  let userCoupons = $state<UserCouponTx[]>([])

  // 스코어 탭 폼 상태
  let adjustDelta = $state(0)
  let adjustReason = $state('')
  let isAdjusting = $state(false)

  // 블랙리스트 폼 상태
  let blacklistReason = $state('')
  let showBlacklistForm = $state(false)

  // 회원 삭제 2단계 경고 상태
  let deleteWarnPending = $state(false)

  // ─── 비밀번호 설정 링크 발행 (2026-10-23) ─────────────────────────────────
  // 링크는 화면에 보이는 동안에만 들고 있고(저장·로그 없음), 다른 고객을 열면 즉시 지운다.
  let recoveryLink = $state<string | null>(null)
  let recoveryBusy = $state(false)

  $effect(() => {
    void row.user_id
    recoveryLink = null
  })

  async function issueRecoveryLink() {
    if (recoveryBusy) return
    const targetId = row.user_id
    recoveryBusy = true
    try {
      const res = await fetch(`/api/cms/customers/${encodeURIComponent(targetId)}/recovery-link`, { method: 'POST' })
      const data = (await res.json().catch(() => null)) as { ok?: boolean; link?: string; error?: string } | null
      if (targetId !== row.user_id) return // 응답을 기다리는 사이 다른 고객으로 바뀌면 링크를 보여주지 않는다
      if (res.ok && data?.ok && typeof data.link === 'string') {
        recoveryLink = data.link
        csToast.success('비밀번호 설정 링크를 만들었습니다. 바로 고객에게 전달해 주세요.')
      } else {
        csToast.error(data?.error ?? '링크 발행에 실패했습니다.')
      }
    } catch {
      csToast.error('링크 발행 중 오류가 발생했습니다.')
    } finally {
      recoveryBusy = false
    }
  }

  async function copyRecoveryLink() {
    if (!recoveryLink) return
    try {
      await navigator.clipboard.writeText(recoveryLink)
      csToast.success('링크를 복사했습니다.')
    } catch {
      csToast.warning('자동 복사에 실패했습니다. 링크를 직접 선택해 복사해 주세요.')
    }
  }

  // 구독 취소 모달 상태
  let showCancelModal = $state(false)
  let cancelTargetId = $state<string | null>(null)
  let cancelReason = $state('')

  // 구독이력 탭 — 결제내역 펼침 상태(구독별 지연조회, 대여 결제정보 탭과 동일한 탭당-1회 fetch 패턴)
  let expandedPaymentSubId = $state<string | null>(null)
  let paymentsBySubId = $state<Record<string, SubscriptionPaymentLog[]>>({})
  let loadingPaymentsSubId = $state<string | null>(null)

  // 포인트이력 탭 — 포인트 추가 폼 상태
  let grantAmount = $state('')   // 천단위 콤마 포맷 문자열(금액 입력폼 표준)
  let grantReason = $state('')
  let isGrantingPoints = $state(false)

  $effect(() => {
    if (activeTab === 'subscription' && !subscriptionsLoaded && !loadingSubscriptions) {
      loadSubscriptions()
    }
    if (activeTab === 'points' && !pointsLoaded && !loadingPoints) {
      loadPoints()
    }
    if (activeTab === 'score' && !auditLoaded && !loadingAudit) {
      loadAuditLog()
    }
    if (activeTab === 'rental' && !rentalsLoaded && !loadingRentals) {
      loadRentals()
    }
    if (activeTab === 'inquiry' && !inquiryPostsLoaded && !loadingInquiries) {
      loadInquiries()
    }
    if (activeTab === 'inquiry' && !chatSessionsLoaded && !loadingChatSessions) {
      loadChatSessions()
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
      subscriptionsLoaded = true
      loadingSubscriptions = false
    }
  }

  async function loadPoints() {
    loadingPoints = true
    try {
      const res = await fetch(`/cms/customers/points?userId=${encodeURIComponent(row.user_id)}`)
      if (res.ok) points = await res.json() as PointTx[]
      // 쿠폰 발급·사용 이력도 같은 목록에 누적 — 실패해도 포인트 이력은 그대로 보여준다
      const cres = await fetch(`/cms/customers/points?userId=${encodeURIComponent(row.user_id)}&kind=coupons`)
      userCoupons = cres.ok ? (await cres.json() as UserCouponTx[]) : []
      if (!cres.ok) csToast.warning('쿠폰 이력을 불러오지 못했어요.')
    } catch {
      userCoupons = []
      csToast.warning('쿠폰 이력을 불러오지 못했어요.')
    } finally {
      pointsLoaded = true
      loadingPoints = false
    }
  }

  // 금액 입력폼 표준(uiux-index.md "🔴 금액 입력폼 표준") — IME 안전 + 천단위 콤마
  function isComposingEvent(e: Event): boolean {
    return 'isComposing' in e && Boolean((e as unknown as { isComposing?: boolean }).isComposing)
  }
  function handleAmountInput(raw: string, isComposing = false): string {
    if (isComposing) return grantAmount
    const digits = raw.replace(/[^0-9]/g, '')
    if (!digits) return ''
    return parseInt(digits, 10).toLocaleString('ko-KR')
  }

  function couponDiscountText(c: UserCouponTx['coupons']): string {
    if (!c) return '-'
    const v = Number(c.discount_value)
    if (c.discount_type === 'fixed') return `${v.toLocaleString('ko-KR')}원 할인`
    if (c.discount_type === 'free_shipping') return '무료배송'
    return `${v}% 할인`
  }

  // 포인트 거래 + 쿠폰 발급·사용을 시간 역순으로 합친 목록
  const pointHistory = $derived.by<PointHistoryItem[]>(() => {
    const items: PointHistoryItem[] = points.map((tx) => ({ kind: 'point', key: `p-${tx.id}`, at: tx.created_at, tx }))
    for (const uc of userCoupons) {
      const name = uc.coupons?.display_name ?? '쿠폰'
      const discount = couponDiscountText(uc.coupons)
      items.push({ kind: 'coupon', key: `ci-${uc.id}`, at: uc.created_at, event: 'issued', name, discount })
      if (uc.used_at) items.push({ kind: 'coupon', key: `cu-${uc.id}`, at: uc.used_at, event: 'used', name, discount })
    }
    return items.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  })

  function pointSourceLabel(tx: PointTx): string {
    if (tx.description) return tx.description
    if (tx.ref_type === 'rental_complete') return '대여완료 적립'
    if (tx.ref_type === 'order') return '주문 결제 시 사용'
    if (tx.ref_type === 'coupon') return '쿠폰 관련'
    return '-'
  }

  function formatDateTime(dt: string | null): string {
    if (!dt) return '-'
    const d = new Date(dt)
    if (Number.isNaN(d.getTime())) return '-'
    const y = d.getFullYear()
    const mm = String(d.getMonth() + 1).padStart(2, '0')
    const dd = String(d.getDate()).padStart(2, '0')
    const hh = String(d.getHours()).padStart(2, '0')
    const min = String(d.getMinutes()).padStart(2, '0')
    return `${y}.${mm}.${dd} ${hh}:${min}`
  }

  async function togglePaymentHistory(subscriptionId: string) {
    if (expandedPaymentSubId === subscriptionId) {
      expandedPaymentSubId = null
      return
    }
    expandedPaymentSubId = subscriptionId
    if (paymentsBySubId[subscriptionId]) return
    loadingPaymentsSubId = subscriptionId
    try {
      const res = await fetch(`/cms/customers/subscription-payments?userSubscriptionId=${encodeURIComponent(subscriptionId)}`)
      if (res.ok) {
        const data = await res.json() as Array<Record<string, unknown>>
        paymentsBySubId[subscriptionId] = data.map(r => ({
          id: String(r.id),
          amount: r.amount as number,
          status: r.status as string,
          billed_at: r.billed_at as string,
        }))
      } else {
        csToast.error(`결제내역 조회 실패 (${res.status})`)
      }
    } catch {
      csToast.error('결제내역 조회 중 오류가 발생했습니다.')
    } finally {
      loadingPaymentsSubId = null
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
      auditLoaded = true
      loadingAudit = false
    }
  }

  async function loadInquiries() {
    loadingInquiries = true
    try {
      const res = await fetch(`/api/cms/customers/${encodeURIComponent(row.user_id)}/inquiries`)
      if (res.ok) {
        inquiryPosts = await res.json() as CsPost[]
      } else {
        csToast.error(`문의 내역 조회 실패 (${res.status})`)
      }
    } catch {
      csToast.error('문의 내역 조회 중 오류가 발생했습니다.')
    } finally {
      inquiryPostsLoaded = true
      loadingInquiries = false
    }
  }

  async function loadRentals() {
    loadingRentals = true
    try {
      const res = await fetch(`/cms/customers/rentals?userId=${encodeURIComponent(row.user_id)}`)
      if (res.ok) {
        rentals = await res.json() as RentalRow[]
      }
    } finally {
      rentalsLoaded = true
      loadingRentals = false
    }
  }

  async function loadChatSessions() {
    loadingChatSessions = true
    try {
      const res = await fetch(`/cms/customers/chat-sessions?userId=${encodeURIComponent(row.user_id)}`)
      if (res.ok) {
        chatSessions = await res.json() as CustomerChatSession[]
      } else {
        csToast.error(`채팅 상담 조회 실패 (${res.status})`)
      }
    } catch {
      csToast.error('채팅 상담 조회 중 오류가 발생했습니다.')
    } finally {
      chatSessionsLoaded = true
      loadingChatSessions = false
    }
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

  const RENTAL_STATUS_LABEL: Record<string, string> = {
    hold:             '신청대기',
    confirmed:        '예약승인',
    shipped:          '반출중',
    in_use:           '대여중',
    return_requested: '반납중',
    returned:         '반납완료',
    completed:        '대여완료',
    cancelled:        '취소',
    expired:          '만료',
    damage_claimed:   '파손신고',
  }

  const RENTAL_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    hold:             { bg: 'rgba(14,165,233,0.12)',  color: '#0369A1' },
    confirmed:        { bg: 'rgba(59,47,138,0.12)',   color: '#3B2F8A' },
    shipped:          { bg: 'rgba(245,158,11,0.12)',  color: '#B45309' },
    in_use:           { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    return_requested: { bg: 'rgba(245,158,11,0.12)',  color: '#B45309' },
    returned:         { bg: 'rgba(102,102,102,0.12)', color: '#555555' },
    completed:        { bg: 'rgba(16,185,129,0.12)',  color: '#047857' },
    cancelled:        { bg: 'rgba(239,68,68,0.12)',   color: '#DC2626' },
    expired:          { bg: 'rgba(102,102,102,0.12)', color: '#666666' },
    damage_claimed:   { bg: 'rgba(239,68,68,0.12)',   color: '#DC2626' },
  }

  const CHAT_STATUS_LABEL: Record<string, string> = {
    open:    '상담중',
    pending: '대기중',
    closed:  '종료',
  }

  const CHAT_STATUS_STYLE: Record<string, { bg: string; color: string }> = {
    open:    { bg: 'rgba(59,47,138,0.12)',   color: '#3B2F8A' },
    pending: { bg: 'rgba(245,158,11,0.12)',  color: '#B45309' },
    closed:  { bg: 'rgba(102,102,102,0.12)', color: '#666666' },
  }

  const CONTEXT_TYPE_LABEL: Record<string, string> = {
    general:         '일반상담',
    product_inquiry: '상품문의',
    reservation:     '예약관련',
    payment:         '결제관련',
    return:          '반납관련',
  }

  function formatRentalPeriod(start: string | null, end: string | null): string {
    if (!start) return '-'
    const s = start.slice(0, 10)
    const e = end ? end.slice(0, 10) : '-'
    return `${s} ~ ${e}`
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

  // 인증분류(일반/학생/구독) — 2026-09-01 재구성. easy/pop/crazy(membership_grade)는 고객등급이
  // 아니라 정기구독 상품 티어이므로, 실제 고객 분류는 인증 상태 기준 3종으로 별도 정의한다.
  // 한 고객이 학생이면서 동시에 구독자일 수 있어(Stephen 확정) 복수 배지 표시 가능.
  // /cms/customers 목록 화면(+page.svelte)의 동일 로직과 일치시킴.
  const CLASSIFICATION_LABEL: Record<string, string> = { general: '일반', student: '학생', subscriber: '구독' }

  function classificationsOf(r: CustomerRow): string[] {
    const tags: string[] = []
    if (r.is_student) tags.push('student')
    if (r.membership_grade && r.membership_grade !== 'NONE') tags.push('subscriber')
    if (tags.length === 0) tags.push('general')
    return tags
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
    phone: formatPhone(row.phone ?? ''),
    birth_date: row.birth_date ? row.birth_date.slice(0, 10) : '',
    member_type: row.member_type ?? 'B2C',
    created_at_date: row.created_at ? row.created_at.slice(0, 10) : '',
  })

  // row 변경(invalidateAll) 시 localInfo 동기화
  $effect(() => {
    localInfo.name = row.name ?? ''
    localInfo.email = row.email
    localInfo.phone = formatPhone(row.phone ?? '')
    localInfo.birth_date = row.birth_date ? row.birth_date.slice(0, 10) : ''
    localInfo.member_type = row.member_type ?? 'B2C'
    localInfo.created_at_date = row.created_at ? row.created_at.slice(0, 10) : ''
  })

  const isDirtyInfo = $derived(
    localInfo.name !== (row.name ?? '') ||
    localInfo.email !== row.email ||
    localInfo.phone !== formatPhone(row.phone ?? '') ||
    localInfo.birth_date !== (row.birth_date ? row.birth_date.slice(0, 10) : '') ||
    localInfo.member_type !== (row.member_type ?? 'B2C') ||
    localInfo.created_at_date !== (row.created_at ? row.created_at.slice(0, 10) : '')
  )

  let isSavingInfo = $state(false)

  // ─── 관리대상(회원 가입 이력 없는 인물) 편집·등록 — mode='managed'|'new' 전용 ───────────────
  // 이 패널은 부모의 {#key}로 대상이 바뀔 때마다 재마운트되므로 row로 초기화해도 stale되지 않는다.
  const isNewManaged = $derived(mode === 'new')
  let mg = $state({
    name: row.name ?? '',
    phone: row.phone ?? '',
    email: row.email ?? '',
    birth_date: row.birth_date ? row.birth_date.slice(0, 10) : '',
    reason: row.blacklist_reason ?? '',
  })
  let mgBusy = $state(false)
  const isDirtyMg = $derived(
    mode === 'managed' && (
      mg.name !== (row.name ?? '') ||
      mg.phone !== (row.phone ?? '') ||
      mg.email !== (row.email ?? '') ||
      mg.birth_date !== (row.birth_date ? row.birth_date.slice(0, 10) : '') ||
      mg.reason !== (row.blacklist_reason ?? '')
    )
  )

  function handleMgPhoneInput(e: Event) {
    const target = e.target as HTMLInputElement
    mg.phone = formatPhone(target.value)
    target.value = mg.phone
  }

  function validateMg(): string | null {
    if (!mg.name.trim()) return '이름을 입력하세요.'
    if (mg.phone.replace(/\D/g, '').length < 9) return '전화번호를 정확히 입력하세요.'
    if (!mg.reason.trim()) return '관리대상 탭에서 등록 사유를 입력하세요.'
    return null
  }

  function buildManagedRow(id: string, code: string): CustomerRow {
    return {
      user_id: id, email: mg.email.trim(), phone: mg.phone, name: mg.name.trim(), member_code: code, member_type: null,
      membership_grade: 'NONE', credit_score: 70, rental_count: 0, late_return_count: 0, damage_count: 0, points: 0,
      blacklisted: true, blacklist_reason: mg.reason.trim(), is_student: false, is_foreign: false,
      identity_type: null, identity_doc_url: null, identity_verified_at: null,
      foreign_doc_url: null, foreign_doc_urls: null, foreign_type: null, foreign_stay_type: null, foreign_verified_at: null,
      password_set: false, created_at: new Date().toISOString(), total_count: 0,
      birth_date: mg.birth_date || null, withdrawal_status: 'none', withdrawal_requested_at: null, withdrawal_purge_at: null,
      is_managed_person: true,
    }
  }

  const submitManaged: SubmitFunction = ({ cancel }) => {
    const msg = validateMg()
    if (msg) { csToast.error(msg); cancel(); return }
    mgBusy = true
    return async ({ result }) => {
      mgBusy = false
      if (result.type === 'success') {
        const d = result.data as { id?: string; member_code?: string } | undefined
        if (isNewManaged && d?.id && d.member_code) {
          csToast.success('관리대상으로 등록되었습니다. 전용 QR이 생성되었습니다.')
          onregistered?.({ id: d.id, member_code: d.member_code, row: buildManagedRow(d.id, d.member_code) })
        } else {
          csToast.success('관리대상 정보가 저장되었습니다.')
        }
        await invalidateAll()
      } else if (result.type === 'failure') {
        csToast.error((result.data as { error?: string })?.error ?? '처리 실패')
      }
    }
  }

  let matchBusy = $state(false)
  const submitMatchReview: SubmitFunction = () => {
    matchBusy = true
    return async ({ result }) => {
      matchBusy = false
      if (result.type === 'success') {
        const d = result.data as { matchReviewed?: string } | undefined
        csToast.success(d?.matchReviewed === 'confirm' ? '관리대상으로 확정했습니다.' : '해당 없음으로 처리했습니다.')
        await invalidateAll()
      } else if (result.type === 'failure') {
        csToast.error((result.data as { error?: string })?.error ?? '처리 실패')
      }
    }
  }

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
    if (activeTab === 'info' && mode === 'member') {
      loadShippingAddresses(uid)
      loadProfileSettings(uid)
    }
  })

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
      <span class="panel-name">{isNewManaged ? '관리대상 등록' : (row.name ?? row.email)}</span>
      {#if row.member_code}
        <code class="panel-code">{row.member_code}</code>
      {:else if isNewManaged}
        <span class="panel-code">등록 시 전용 QR 자동 생성</span>
      {/if}
    </div>
    {#if row.member_code}
      <div class="member-qr-wrap member-qr-wrap--header">
        <canvas bind:this={qrCanvasEl} width="300" height="300" aria-label="회원 QR 코드"></canvas>
        <button class="qr-dl-btn" onclick={downloadMemberQR} title="QR PNG 다운로드" type="button">↓ QR 저장</button>
      </div>
    {/if}
    <button class="close-btn" onclick={onclose} aria-label="패널 닫기">✕</button>
  </div>

  {#if mode === 'member' && row.managed_match?.status === 'pending'}
    {@const mm = row.managed_match}
    <div class="match-banner" role="status">
      <div class="match-banner-text">
        <strong>사전 등록 관리대상과 일치합니다</strong>
        <span>
          {mm.basis === 'phone' ? '전화번호' : '이메일'} 일치 ·
          등록 인물 {mm.person_name ?? '-'}{mm.person_phone ? ` (${mm.person_phone})` : ''}
          {#if mm.person_reason} · 사유: {mm.person_reason}{/if}
        </span>
      </div>
      <div class="match-banner-actions">
        <form method="POST" action="/cms/customers?/reviewManagedMatch" use:enhance={submitMatchReview}>
          <input type="hidden" name="user_id" value={row.user_id} />
          <input type="hidden" name="decision" value="dismiss" />
          <button type="submit" class="mm-btn" disabled={matchBusy}>해당 없음</button>
        </form>
        <form method="POST" action="/cms/customers?/reviewManagedMatch" use:enhance={submitMatchReview}>
          <input type="hidden" name="user_id" value={row.user_id} />
          <input type="hidden" name="decision" value="confirm" />
          <button type="submit" class="mm-btn mm-btn-danger" disabled={matchBusy}>관리대상 확정</button>
        </form>
      </div>
    </div>
  {/if}

  <!-- 탭 -->
  <div class="panel-tabs">
    <button
      class="panel-tab"
      class:active={activeTab === 'info'}
      onclick={() => (activeTab = 'info')}
    >기본정보</button>
    {#if mode === 'member'}
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
      class:active={activeTab === 'points'}
      onclick={() => (activeTab = 'points')}
    >포인트이력</button>
    <button
      class="panel-tab"
      class:active={activeTab === 'rental'}
      onclick={() => (activeTab = 'rental')}
    >상품대여이력</button>
    {/if}
    <button
      class="panel-tab"
      class:active={activeTab === 'blacklist'}
      class:tab-blacklist={row.blacklisted || mode !== 'member'}
      onclick={() => (activeTab = 'blacklist')}
    >관리대상</button>
    {#if mode === 'member'}
    <button
      class="panel-tab"
      class:active={activeTab === 'inquiry'}
      onclick={() => (activeTab = 'inquiry')}
    >빠른문의</button>
    {/if}
  </div>

  <!-- 탭 콘텐츠 -->
  <div class="panel-body">

    <!-- 기본정보 탭 — 관리대상(회원 가입 이력 없는 인물): 기존 info-grid 레이아웃 그대로, 회원 전용 항목(서류·포인트·배송지 등) 제외 -->
    {#if activeTab === 'info' && mode !== 'member'}
      <div class="info-grid">
        <div class="info-row">
          <span class="info-label">이름</span>
          <input class="info-input" type="text" bind:value={mg.name} placeholder="이름 (필수)" maxlength="100" />
        </div>
        <div class="info-row">
          <span class="info-label">전화번호</span>
          <input class="info-input" type="text" value={mg.phone} oninput={handleMgPhoneInput} placeholder="010-0000-0000 (필수)" />
        </div>
        <div class="info-row">
          <span class="info-label">이메일</span>
          <input class="info-input" type="email" bind:value={mg.email} placeholder="이메일 (선택)" maxlength="255" />
        </div>
        <div class="info-row">
          <span class="info-label">생년월일</span>
          <CmsDatePicker bind:value={mg.birth_date} placeholder="생년월일 선택 (선택)" disablePast={false} />
        </div>
        {#if !isNewManaged}
          <div class="info-row">
            <span class="info-label">회원코드</span>
            <span class="info-val"><code class="panel-code">{row.member_code}</code></span>
          </div>
          <div class="info-row">
            <span class="info-label">등록일</span>
            <span class="info-val">{row.created_at ? row.created_at.slice(0, 10) : '-'}</span>
          </div>
        {/if}
      </div>
    {/if}

    <!-- 기본정보 탭 -->
    {#if activeTab === 'info' && mode === 'member'}
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
          <CmsDatePicker bind:value={localInfo.birth_date} name="birth_date" placeholder="생년월일 선택" disablePast={false} />
        </div>
        <div class="info-row">
          <span class="info-label">회원유형</span>
          <button type="button" class="info-select-btn" onclick={openMemberTypeModal}>
            {localInfo.member_type}
            <span class="info-select-arrow">▾</span>
          </button>
        </div>
        <div class="info-row">
          <span class="info-label">분류</span>
          <span class="info-val classification-badges">
            {#each classificationsOf(row) as c}
              <span class="grade-badge grade-{c}">{CLASSIFICATION_LABEL[c] ?? c}</span>
            {/each}
          </span>
        </div>
        <div class="info-row">
          <span class="info-label">포인트</span>
          <span class="info-val">{row.points.toLocaleString('ko-KR')}P</span>
        </div>
        <!-- 본인 증명·외국인 증명 — 예약 패널 고객정보 탭과 같은 공용 컴포넌트(CustomerDocRows) -->
        <div class="doc-rows-host">
          <CustomerDocRows
            userId={row.user_id}
            memberCode={row.member_code}
            identityCount={row.identity_doc_url?.length ?? 0}
            identityTypes={row.identity_type ?? null}
            identityVerifiedAt={row.identity_verified_at ?? null}
            identityApprovedAt={row.identity_approved_at ?? null}
            isForeign={row.is_foreign}
            foreignCount={row.foreign_doc_urls?.length ? row.foreign_doc_urls.length : (row.foreign_doc_url ? 1 : 0)}
            foreignTypes={row.foreign_type ?? null}
            foreignStayType={row.foreign_stay_type ?? null}
            foreignVerifiedAt={row.foreign_verified_at ?? null}
            foreignApprovedAt={row.foreign_approved_at ?? null}
            foreignLabel="외국인 여부"
            onchanged={() => invalidateAll()}
          />
        </div>
        <div class="info-row">
          <span class="info-label">가입일</span>
          <CmsDatePicker bind:value={localInfo.created_at_date} name="created_at" placeholder="가입일 선택" disablePast={false} />
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

      <!-- 탈회 상태 블록 -->
      {#if row.withdrawal_status && row.withdrawal_status !== 'none'}
        <div class="withdrawal-status-banner">
          <div class="withdrawal-status-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            {#if row.withdrawal_status === 'requested'}
              <span class="withdrawal-status-text">탈회 신청됨</span>
            {:else if row.withdrawal_status === 'purged'}
              <span class="withdrawal-status-text">탈회 완전삭제 완료</span>
            {/if}
          </div>
          {#if row.withdrawal_status === 'requested'}
            <div class="withdrawal-status-detail">
              <span>신청일: {formatDate(row.withdrawal_requested_at)}</span>
              <span>완전삭제 예정일: {formatDate(row.withdrawal_purge_at)}</span>
            </div>
          {/if}
        </div>
      {/if}

      <!-- 비밀번호 설정 링크 — 정식 회원 계정만(관리대상 모드·탈회 완전삭제 제외). 서버가 manager 이상·관리자 계정 제외를 다시 검증한다 -->
      {#if mode === 'member' && row.withdrawal_status !== 'purged'}
        <div class="recovery-link-section">
          <div class="recovery-link-head">
            <div class="recovery-link-text">
              <span class="section-title">비밀번호 설정 링크</span>
              <p class="recovery-link-desc">
                비밀번호를 정하지 못했거나 잊은 고객에게 직접 전달하는 1회용 링크입니다. 메일·문자는 발송되지 않습니다.
                링크를 연 사람은 누구나 비밀번호를 정할 수 있으니 고객 본인에게만 전달해 주세요.
              </p>
            </div>
          </div>
          {#if recoveryLink}
            <div class="recovery-link-result">
              <div class="recovery-link-row">
                <input
                  type="text"
                  class="info-input"
                  readonly
                  value={recoveryLink}
                  aria-label="비밀번호 설정 링크"
                  onfocus={(e) => e.currentTarget.select()}
                />
                <button type="button" class="btn-recovery-copy" onclick={copyRecoveryLink}>복사</button>
              </div>
              <p class="recovery-link-note">
                1회용이며 유효시간은 약 1시간입니다. 만든 직후에 전달해 주세요.
                재설정 화면의 비밀번호는 8자 이상이어야 합니다.
              </p>
            </div>
          {/if}
        </div>
      {/if}

      <!-- 회원 삭제 — 왼쪽에 [링크 발행](정식 회원 계정만) -->
      <div class="delete-account-section">
        {#if mode === 'member' && row.withdrawal_status !== 'purged'}
          <button type="button" class="btn-primary" disabled={recoveryBusy} onclick={issueRecoveryLink}>
            {recoveryBusy ? '발행 중…' : recoveryLink ? '링크 다시 발행' : '링크 발행'}
          </button>
        {/if}
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
            class:act-del--pending={deleteWarnPending}
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
            {#if sub.plan_id}
              <a
                class="sub-plan-link"
                href="/cms/subscriptions?selected={sub.plan_id}"
                target="_blank"
                rel="noopener"
              >구독상품 상세 →</a>
            {/if}
            <div class="sub-footer-row">
              <button class="sub-payment-toggle" onclick={() => togglePaymentHistory(sub.id)}>
                결제내역 {expandedPaymentSubId === sub.id ? '숨기기' : '보기'}
              </button>
              {#if sub.status === 'active'}
                <div class="sub-actions">
                  <button
                    class="btn-danger"
                    onclick={() => openCancelModal(sub.id)}
                  >구독 취소</button>
                </div>
              {/if}
            </div>
            {#if expandedPaymentSubId === sub.id}
              <div class="sub-payment-list">
                {#if loadingPaymentsSubId === sub.id}
                  <div class="loading-text">결제내역 불러오는 중...</div>
                {:else if (paymentsBySubId[sub.id] ?? []).length === 0}
                  <div class="no-data">결제 이력이 없습니다.</div>
                {:else}
                  {#each paymentsBySubId[sub.id] as p (p.id)}
                    <div class="sub-payment-row">
                      <span class="sub-payment-date">{formatDate(p.billed_at)}</span>
                      <span class="sub-payment-amount">{p.amount.toLocaleString()}원</span>
                      <span class="sub-payment-status sub-payment-{p.status}">{p.status === 'succeeded' ? '성공' : p.status === 'failed' ? '실패' : p.status}</span>
                    </div>
                  {/each}
                {/if}
              </div>
            {/if}
          </div>
        {/each}
      {/if}
    {/if}

    <!-- 포인트이력 탭 -->
    {#if activeTab === 'points'}
      <div class="adjust-section points-adjust-section">
        <form
          method="POST"
          action="/cms/customers?/grantCustomerPoints"
          use:enhance={() => {
            isGrantingPoints = true
            return async ({ result }) => {
              isGrantingPoints = false
              if (result.type === 'success') {
                csToast.success('포인트가 등록되었습니다.')
                grantAmount = ''
                grantReason = ''
                pointsLoaded = false
                loadPoints()
                await invalidateAll()  // 기본정보 탭의 포인트 잔액(row.points) 갱신
              } else if (result.type === 'failure') {
                csToast.error((result.data as { error?: string })?.error ?? '등록 실패')
              }
            }
          }}
          class="adjust-form"
        >
          <input type="hidden" name="user_id" value={row.user_id} />
          <div class="adjust-row">
            <input
              id="grant-amount"
              type="text"
              inputmode="numeric"
              name="amount"
              class="f-input grant-amount-input"
              aria-label="포인트"
              value={grantAmount}
              oninput={(e) => grantAmount = handleAmountInput(e.currentTarget.value, isComposingEvent(e))}
              oncompositionend={(e) => grantAmount = handleAmountInput(e.currentTarget.value)}
              placeholder="포인트"
              required
            />
            <input
              id="grant-reason"
              type="text"
              name="description"
              class="f-input grant-reason-input"
              aria-label="사유(출처)"
              placeholder="사유(출처)"
              bind:value={grantReason}
              required
            />
            <button
              type="submit"
              class="btn-primary grant-submit-btn"
              aria-label="포인트 추가"
              disabled={isGrantingPoints || !grantAmount || !grantReason.trim()}
            >
              {isGrantingPoints ? '···' : '+'}
            </button>
          </div>
        </form>
      </div>

      {#if loadingPoints}
        <div class="loading-text">로딩 중...</div>
      {:else if pointHistory.length === 0}
        <div class="no-data">포인트·쿠폰 이력이 없습니다.</div>
      {:else}
        <div class="audit-list points-audit-list">
          {#each pointHistory as item (item.key)}
            {#if item.kind === 'point'}
              {@const tx = item.tx}
              {@const isEarn = tx.amount > 0}
              <div class="audit-row">
                <span class="badge {isEarn ? 'badge-active' : 'badge-error'}">{isEarn ? '적립' : '사용'}</span>
                <span class="audit-scores">{isEarn ? '+' : ''}{tx.amount.toLocaleString('ko-KR')}P</span>
                <span class="audit-reason">{pointSourceLabel(tx)}</span>
                <span class="audit-date">{formatDateTime(tx.created_at)}</span>
                {#if !isEarn}
                  <button type="button" class="sub-payment-toggle" onclick={() => (activeTab = 'rental')}>
                    대여목록 보기 →
                  </button>
                {/if}
              </div>
            {:else}
              <div class="audit-row">
                <span class="badge {item.event === 'issued' ? 'badge-info' : 'badge-error'}">{item.event === 'issued' ? '쿠폰 발급' : '쿠폰 사용'}</span>
                <span class="audit-scores">{item.discount}</span>
                <span class="audit-reason">{item.name}</span>
                <span class="audit-date">{formatDateTime(item.at)}</span>
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    {/if}

    <!-- 상품대여이력 탭 -->
    {#if activeTab === 'rental'}
      <div class="rental-tab-section">
        {#if loadingRentals}
          <div class="inq-loading">불러오는 중...</div>
        {:else if rentals.length === 0}
          <div class="inq-empty">대여 이력이 없습니다.</div>
        {:else}
          {#each rentals as rental (rental.id)}
            {@const st = RENTAL_STATUS_STYLE[rental.status ?? ''] ?? { bg: 'rgba(102,102,102,0.12)', color: '#666' }}
            <a
              class="rental-card"
              href="/cms/rentals?selected={rental.id}"
              target="_blank"
              rel="noopener"
            >
              <div class="rental-card-top">
                <span class="inq-chip" style="background:{st.bg};color:{st.color}">
                  {RENTAL_STATUS_LABEL[rental.status ?? ''] ?? rental.status}
                </span>
                <span class="rental-code">{rental.reservation_code ?? '-'}</span>
              </div>
              <div class="rental-product-name">{rental.products?.name ?? '-'}</div>
              <div class="rental-meta">
                <span>{formatRentalPeriod(rental.start_date, rental.end_date)}</span>
                {#if rental.rental_days}
                  <span class="rental-days">{rental.rental_days}일</span>
                {/if}
              </div>
            </a>
          {/each}
        {/if}
      </div>
    {/if}

    <!-- 관리대상 탭 — 회원 가입 이력 없는 인물(managed·new): 사유 입력 후 하단 [등록]/[저장] -->
    {#if activeTab === 'blacklist' && mode !== 'member'}
      <div class="bl-tab-section">
        <div class="bl-status-banner" class:bl-active={!isNewManaged}>
          <div class="bl-status-left">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
            <span class="bl-status-text">{isNewManaged ? '관리대상 등록 전 — 사유를 입력하고 [등록]을 누르세요' : '관리대상 등록 중'}</span>
          </div>
        </div>
        <div class="bl-form">
          <textarea
            class="f-input"
            placeholder="관리대상 등록 사유를 입력하세요 (필수)"
            rows="4"
            maxlength="1000"
            bind:value={mg.reason}
          ></textarea>
        </div>
      </div>
    {/if}

    <!-- 관리대상 탭 — 기존 회원 -->
    {#if activeTab === 'blacklist' && mode === 'member'}
      <div class="bl-tab-section">

        <!-- 현재 상태 배너 -->
        <div class="bl-status-banner" class:bl-active={row.blacklisted}>
          <div class="bl-status-left">
            {#if row.blacklisted}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/></svg>
              <span class="bl-status-text">관리대상 등록 중</span>
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
                  csToast.success(row.blacklisted ? '관리대상이 해제되었습니다.' : '관리대상으로 등록되었습니다.')
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
                placeholder="관리대상 등록 사유를 입력하세요 (필수)"
                rows="3"
                bind:value={blacklistReason}
                required
              ></textarea>
            {:else}
              <input type="hidden" name="reason" value="" />
            {/if}
            <button type="submit" class="btn-danger" disabled={!row.blacklisted && !blacklistReason.trim()}>
              {row.blacklisted ? '관리대상 해제 확인' : '관리대상 등록'}
            </button>
          </form>
        {/if}

      </div>
    {/if}

    <!-- 관리대상 하단 액션 — [관리대상 삭제] 우측에 [등록](신규) / [저장](수정) -->
    {#if mode !== 'member' && (activeTab === 'info' || activeTab === 'blacklist')}
      <div class="delete-account-section">
        {#if !isNewManaged}
          <form
            method="POST"
            action="/cms/customers?/deleteManagedPerson"
            use:enhance={() => {
              return async ({ result }) => {
                if (result.type === 'success') {
                  csToast.success('관리대상이 삭제되었습니다.')
                  deleteWarnPending = false
                  await invalidateAll()
                  onclose()
                } else if (result.type === 'failure') {
                  csToast.error((result.data as { error?: string })?.error ?? '삭제 실패')
                  deleteWarnPending = false
                }
              }
            }}
          >
            <input type="hidden" name="id" value={row.user_id} />
            <button
              type={deleteWarnPending ? 'submit' : 'button'}
              class="act-del act-del-account"
              class:act-del--pending={deleteWarnPending}
              aria-label="관리대상 삭제"
              title="관리대상 삭제"
              onclick={() => {
                if (!deleteWarnPending) {
                  deleteWarnPending = true
                  csToast.warning('한번 더 선택 시 삭제됩니다.')
                  setTimeout(() => { deleteWarnPending = false }, 4000)
                }
              }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
              관리대상 삭제
            </button>
          </form>
        {/if}
        <form
          method="POST"
          action={isNewManaged ? '/cms/customers?/registerManagedPerson' : '/cms/customers?/updateManagedPerson'}
          use:enhance={submitManaged}
        >
          {#if !isNewManaged}<input type="hidden" name="id" value={row.user_id} />{/if}
          <input type="hidden" name="name" value={mg.name} />
          <input type="hidden" name="phone" value={mg.phone} />
          <input type="hidden" name="email" value={mg.email} />
          <input type="hidden" name="birth_date" value={mg.birth_date} />
          <input type="hidden" name="reason" value={mg.reason} />
          <button type="submit" class="btn-primary" disabled={mgBusy || (!isNewManaged && !isDirtyMg)}>
            {mgBusy ? '처리 중...' : (isNewManaged ? '등록' : '저장')}
          </button>
        </form>
      </div>
    {/if}

    <!-- 빠른문의 탭 -->
    {#if activeTab === 'inquiry'}
      <div class="inquiry-tab-section">
        {#if loadingInquiries || loadingChatSessions}
          <div class="inq-loading">불러오는 중...</div>
        {:else if inquiryPosts.length === 0 && chatSessions.length === 0}
          <div class="inq-empty">등록된 문의 및 상담 내역이 없습니다.</div>
        {:else}
          <!-- 채팅 상담 + 빠른문의 통합 목록(최신순) -->
          {#each inquiryFeed as item (item.kind + item.id)}
            {#if item.kind === 'chat'}
              {@const cs = item.session}
              {@const csSt = CHAT_STATUS_STYLE[cs.status] ?? CHAT_STATUS_STYLE['closed']}
              <a class="chat-card" href="/cms/chat?session={cs.id}" target="_blank" rel="noopener">
                <div class="chat-card-top">
                  <span class="inq-chip" style="background:{csSt.bg};color:{csSt.color}">
                    {CHAT_STATUS_LABEL[cs.status] ?? cs.status}
                  </span>
                  <span class="chat-source-badge">채팅상담</span>
                  <span class="chat-date">{cs.updated_at.slice(0,10)}</span>
                </div>
                <div class="chat-context">
                  {CONTEXT_TYPE_LABEL[cs.context_type] ?? cs.context_type}
                </div>
              </a>
            {:else}
              {@const post = item.post}
              {@const st = INQUIRY_STATUS_STYLE[post.status] ?? INQUIRY_STATUS_STYLE['open']}
              {@const replyCount = post.cs_inquiries?.length ?? 0}
              <a class="chat-card" href="/cms/customers/inquiry?post={post.id}" target="_blank" rel="noopener">
                <div class="chat-card-top">
                  <span class="inq-chip" style="background:{st.bg};color:{st.color}">
                    {INQUIRY_STATUS_LABEL[post.status] ?? post.status}
                  </span>
                  <span class="chat-source-badge inq-source-badge">빠른문의</span>
                  {#if replyCount > 0}<span class="inq-reply-badge">답변 {replyCount}</span>{/if}
                  <span class="chat-date">{post.created_at.slice(0,10)}</span>
                </div>
                <div class="chat-context">
                  {post.title}
                  <span class="inq-meta">{INQUIRY_CATEGORY_LABEL[post.category] ?? post.category}</span>
                </div>
              </a>
            {/if}
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
  .member-qr-wrap {
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 4px;
  }
  .member-qr-wrap canvas { display: block; width: 44px; height: 44px; border-radius: var(--cms-radius-sm); border: 1px solid var(--cs-surface-gray); }
  .member-qr-wrap .qr-dl-btn {
    background: transparent; border: none;
    color: var(--cs-text-light); font: var(--text-pc-script-12);
    cursor: pointer; padding: 2px 6px; border-radius: var(--radius-sm); min-height: 24px;
    transition: color 0.12s, background 0.12s;
  }
  .member-qr-wrap .qr-dl-btn:hover { background: var(--cs-lilac); color: var(--cs-purple); }
  .member-qr-wrap--header { margin-left: auto; margin-right: 12px; }
  .close-btn {
    flex-shrink: 0;
    width: 28px; height: 28px; min-height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: transparent; border: none; border-radius: var(--radius-sm);
    color: var(--cs-text-light); font-size: 14px; cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  /* 탭 */
.match-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 16px;
    background: var(--cs-red-xlight);
    color: var(--cs-text);
  }
  .match-banner-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; font: var(--text-pc-body-14); }
  .match-banner-text span { font: var(--text-pc-script-12); color: var(--cs-text-mid); }
  .match-banner-actions { display: flex; gap: 8px; flex-shrink: 0; }
  /* DetailPanel 대형 CTA 규격(cms-uiux §0-10-G) — [해당 없음]=일반 버튼(퍼플), [관리대상 확정]=삭제·거부 버튼(레드) */
  .mm-btn {
    height: 44px;
    padding: 0 20px;
    border: none;
    border-radius: var(--cms-radius-md);
    background: var(--cs-purple);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, opacity 0.15s;
  }
  .mm-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .mm-btn-danger { background: var(--cs-error); }
  .mm-btn-danger:hover:not(:disabled) { background: var(--cs-error); opacity: 0.85; }
  .mm-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .panel-tabs {
    display: flex;
    gap: 0;
    padding: 16px 8px;
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

  /* 배지(등급 배지 — 구독 탭 플랜 티어용 / 인증분류 배지 — 상단 "분류" 항목용, 클래스 공유) */
  .classification-badges { display: inline-flex; gap: 4px; flex-wrap: wrap; }
  .grade-badge {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); font-weight: 700;
    white-space: nowrap;
  }
  .grade-none  { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .grade-easy  { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .grade-pop   { background: rgba(59,47,138,0.10);   color: var(--cs-purple); }
  .grade-crazy { background: rgba(255,69,0,0.12);    color: var(--cs-orange); }

  /* 이중상태 배지(cms-uiux.md §7-6 표준) — /cms/promotion/point에서 적립/사용 구분에
     쓰는 것과 동일 패턴. Svelte scoped CSS라 이식(신규 발명 아님). */
  .badge {
    display: inline-flex; align-items: center;
    padding: 2px 8px; border-radius: var(--radius-sm);
    font: var(--text-pc-script-12); white-space: nowrap; line-height: 1.6;
  }
  .badge-active { background: rgba(16,185,129,0.12); color: var(--cs-success-light); }
  .badge-error  { background: rgba(255,53,53,0.10);  color: var(--cs-red-badge); }
  .badge-info   { background: rgba(59,47,138,0.08);  color: var(--cs-purple); }
  /* 인증분류(일반/학생/구독) — 위 grade-none/easy/pop/crazy(구독 탭 플랜 티어)와는 별개 */
  .grade-general    { background: var(--cs-surface-gray); color: var(--cs-text-mid); }
  .grade-student    { background: rgba(14,165,233,0.12);  color: var(--cs-info); }
  .grade-subscriber { background: rgba(59,47,138,0.10);   color: var(--cs-purple); }

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
  /* 포인트이력 탭 전용 — 크레이지스코어 탭(.adjust-section 원본)은 그대로 두고 탭메뉴↔목록
     상단 여백만 다른 카드목록 탭과 동일한 32px(panel-body 16px + 16px)로 통일 */
  .points-adjust-section { margin-top: 16px; }
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
  /* 포인트이력 탭 전용 — 크레이지스코어 탭(.audit-list 원본)은 그대로 두고 이 목록만
     행간 여백 3배(6px→18px) 확대(Stephen 지시, 2026-09-14) */
  .points-audit-list {
    gap: 18px;
    /* 포인트 추가 폼(.adjust-section) ↔ 목록 간 여백 — 공용 .panel-body gap:10px는 다른
       탭과 공유라 그대로 두고, 이 목록에만 margin-top 추가. 2026-09-14 100% 확대 요청
       2회 누적: 10px(기본) → 20px(1차, +10px) → 40px(2차, +30px) */
    margin-top: 30px;
  }
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
  .subscription-notice { margin-top: 16px; margin-bottom: 4px; }
  .sub-card {
    border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray);
    padding: 12px 14px; display: flex; flex-direction: column; gap: 6px;
    transition: background 0.15s;
  }
  .sub-card:hover { background: var(--cs-lilac); }
  .sub-card.sub-active { background: var(--cs-purple-op10); }
  .sub-card.sub-active:hover { background: var(--cs-purple-op10); }
  .sub-card + .sub-card { margin-top: 10px; }
  .sub-row { display: flex; align-items: center; gap: 8px; }
  .sub-tier { }
  .sub-plan-link {
    align-self: flex-start; font: var(--text-pc-script-12); color: var(--cs-purple);
    text-decoration: underline; white-space: nowrap;
  }
  .sub-status { font: var(--text-pc-script-12); font-weight: 700; }
  .status-active   { color: var(--cs-success-light); }
  .status-cancelled{ color: var(--cs-red-badge); }
  .status-paused   { color: var(--cs-warning); }
  .status-expired  { color: var(--cs-text-light); }
  .sub-renew { font: var(--text-pc-descript-10); background: rgba(59,47,138,0.08); color: var(--cs-purple); padding: 2px 6px; border-radius: 4px; }
  .sub-meta { font: var(--text-pc-script-12); color: var(--cs-text-mid); display: flex; gap: 12px; }
  .sub-reason { font: var(--text-pc-descript-10); color: var(--cs-text-mid); background: #F3F4F6; padding: 6px 10px; border-radius: 4px; }
  /* 결제내역 보기(좌) ↔ 구독 취소(우)를 한 행에 수직 중앙 정렬 */
  .sub-footer-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .sub-actions { display: flex; gap: 8px; margin-left: auto; }
  .sub-footer-row .sub-payment-toggle { align-self: center; }

  .sub-payment-toggle {
    align-self: flex-start; border: none; background: none; padding: 0;
    font: var(--text-pc-script-12); color: var(--cs-purple); cursor: pointer;
    text-decoration: underline;
  }
  .sub-payment-list {
    display: flex; flex-direction: column; gap: 4px;
    background: #F3F4F6; border-radius: 4px; padding: 8px 10px;
  }
  .sub-payment-row {
    display: flex; align-items: center; gap: 10px; font: var(--text-pc-script-12);
  }
  .sub-payment-date   { color: var(--cs-text-mid); flex-shrink: 0; }
  .sub-payment-amount { color: var(--cs-text); font-weight: 700; }
  .sub-payment-status { font-weight: 700; }
  .sub-payment-succeeded { color: var(--cs-success-light); }
  .sub-payment-failed    { color: var(--cs-red-badge); }

  /* 버튼들 */
  .btn-primary {
    display: inline-flex; align-items: center; height: 44px; padding: 0 24px;
    background: var(--cs-purple); color: var(--cs-white); border: none;
    border-radius: var(--radius-md); font: var(--text-pc-body-14);
    cursor: pointer; transition: background 0.12s; white-space: nowrap;
  }
  .btn-primary:hover    { background: var(--cs-purple-hover); }
  /* 포인트 추가 버튼 — 정사각 아이콘형(기존 .btn-primary 배경색 토큰 유지, 텍스트 대신 '+').
     전역 .cms-shell .btn-primary(padding:0 30px 등)가 동일 명시도라 소스순서로 이겨버려서
     .adjust-row 안에서만 적용되도록 컨텍스트 셀렉터로 명시도를 올림(!important 대신). */
  .adjust-row .grant-submit-btn {
    width: 44px; padding: 0; justify-content: center;
    border-radius: var(--radius-sm); font-size: 20px; font-weight: 700; line-height: 1;
  }
  .btn-primary:disabled { background: var(--cs-disabled-button); cursor: not-allowed; }

  .btn-secondary {
    display: inline-flex; align-items: center; height: 44px; padding: 0 20px;
    background: var(--cs-white); color: var(--cs-purple-dark);
    border: 1px solid #201857; border-radius: var(--radius-md);
    font: var(--text-pc-body-14); cursor: pointer; transition: background 0.12s;
  }
  .btn-secondary:hover { background: rgba(59,47,138,0.06); }

  /* 비밀번호 설정 링크 섹션 */
  .recovery-link-section {
    margin-top: 24px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
  .recovery-link-head { display: flex; align-items: flex-start; }
  .recovery-link-text { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
  .recovery-link-desc,
  .recovery-link-note { margin: 0; font: var(--text-pc-script-12); color: var(--cs-text-mid); line-height: 1.5; }
  .recovery-link-result { display: flex; flex-direction: column; gap: 8px; }
  .recovery-link-row { display: flex; align-items: center; gap: 8px; }
  /* cms-uiux.md §0-10-F DetailPanel 소형 실행 버튼 규격(행 안에서 우측 끝 고정 없이 입력창 옆에 배치) */
  .btn-recovery-copy {
    min-width: 78px; text-align: center; flex-shrink: 0;
    font-size: 12px; font-weight: 700; line-height: 1.4; padding: 8px 14px;
    border: 1px solid var(--cs-text-mid); border-radius: var(--cms-radius-sm);
    background: var(--cs-surface-gray); color: var(--cs-text-mid);
    cursor: pointer; white-space: nowrap; transition: background 0.15s, color 0.15s;
  }
  .btn-recovery-copy:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
  .btn-recovery-copy:disabled { opacity: 0.5; cursor: default; }

  /* 회원 삭제 섹션 */
  .delete-account-section {
    margin-top: 24px;
    padding-top: 16px;
    border-top: 1px solid var(--cs-lilac);
    display: flex;
    justify-content: flex-end;
    gap: 8px;
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

  /* cms-uiux.md §0-10-G DetailPanel 전용 버튼 — 대형 삭제·거부 버튼(44px·--cs-error 채움·15px).
     .act-del / .act-del:hover와 명시도 충돌을 피하려 복합 셀렉터 사용 */
  .act-del.act-del-account {
    gap: 6px;
    height: 44px;
    padding: 0 20px;
    border-radius: var(--cms-radius-md);
    background: var(--cs-error);
    color: var(--cs-white);
    font: var(--text-pc-body-14);
    transition: opacity 0.12s;
  }
  .act-del.act-del-account:hover { background: var(--cs-error); color: var(--cs-white); opacity: 0.85; }
  /* 1차 클릭 대기 — 기본이 레드 채움이라 더 진한 레드로 구분(§0-10-G-1) */
  .act-del.act-del-account.act-del--pending { background: var(--cs-red); color: var(--cs-white); }

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
  .f-input:focus { outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }
  /* 포인트 추가 — 목록 행(.audit-row)과 동일하게 한 줄 병렬 배치(adjust-row 재사용).
     .f-input의 width:100%보다 뒤에 와야 폭 지정이 실제로 적용됨(동일 명시도 순서 문제). */
  .grant-amount-input { width: 110px; flex-shrink: 0; }
  .grant-reason-input { flex: 1; min-width: 120px; }

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
  .info-input:focus { outline: 2px solid var(--cs-focus-ring); outline-offset: -2px; }

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

  /* 본인·외국인 증명 서류 행(공용 CustomerDocRows) — 이 패널의 info-row 규격에 맞춤 */
  .doc-rows-host { --dr-row-pad: 6px 0; --dr-label-w: 80px; --dr-indent: 92px; display: flex; flex-direction: column; }

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
  .bl-tab-section { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }

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

  /* 탈회 상태 배너 */
  .withdrawal-status-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 14px;
    background: rgba(255,53,53,0.06);
    border-radius: var(--cms-radius-sm);
    border: 1px solid rgba(255,53,53,0.20);
    gap: 8px;
    flex-wrap: wrap;
  }
  .withdrawal-status-left {
    display: flex;
    align-items: center;
    gap: 8px;
    color: var(--cs-red-badge);
  }
  .withdrawal-status-text {
    font: var(--text-pc-body-14);
    font-weight: 700;
  }
  .withdrawal-status-detail {
    display: flex;
    gap: 12px;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

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
  .inquiry-tab-section { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
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

  /* 상품대여이력 탭 */
  .rental-tab-section { display: flex; flex-direction: column; gap: 12px; margin-top: 16px; }
  .rental-card {
    display: block;
    text-decoration: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    padding: 10px 14px;
    transition: background 0.15s;
  }
  .rental-card:hover {
    background: var(--cs-lilac);
  }
  .rental-card-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 5px;
  }
  .rental-code {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    font-weight: 700;
    color: var(--cs-text-mid);
    letter-spacing: 0.3px;
  }
  .rental-product-name {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .rental-meta {
    display: flex;
    align-items: center;
    gap: 8px;
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    color: var(--cs-text-mid);
  }
  .rental-days {
    padding: 1px 6px;
    border-radius: var(--radius-xl);
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    font-weight: 700;
  }

  /* 채팅 상담 카드 (빠른문의 탭 내) */
  .chat-card {
    display: block;
    text-decoration: none;
    border-radius: var(--radius-sm);
    background: var(--cs-surface-gray);
    padding: 10px 14px;
    transition: background 0.15s;
  }
  .chat-card:hover {
    background: var(--cs-lilac);
  }
  .chat-card-top {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 5px;
  }
  .chat-source-badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: var(--radius-xl);
    background: rgba(59,47,138,0.08);
    color: var(--cs-purple);
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 10px;
    font-weight: 700;
  }
  .inq-source-badge {
    background: rgba(102,102,102,0.08);
    color: var(--cs-text-mid);
    flex-shrink: 0;
  }
  .chat-date {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 11px;
    color: var(--cs-text-mid);
    margin-left: auto;
  }
  .chat-context {
    font-family: 'Noto Sans KR', sans-serif;
    font-size: 13px;
    font-weight: 700;
    color: var(--cs-text);
  }
  .inq-title-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
</style>
