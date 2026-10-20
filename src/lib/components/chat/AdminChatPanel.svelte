<script lang="ts">
  // CMS 관리자 채팅 패널
  // 좌측: 세션 목록 / 우측: 선택된 세션 대화창

  import { goto } from '$app/navigation'
  import { tick } from 'svelte'
  import MessageList from './MessageList.svelte'
  import ChatInput from './ChatInput.svelte'
  import CustomerDetailPanel from './CustomerDetailPanel.svelte'
  import BookmarkListView from './BookmarkListView.svelte'
  import RentalDetailPanel from '$lib/components/cms/RentalDetailPanel.svelte'
  import ContractTemplatePreviewModal from '$lib/components/cms/ContractTemplatePreviewModal.svelte'
  import PcInquiryPanel from '$lib/components/account/PcInquiryPanel.svelte'
  import InquiryReplyForm from '$lib/components/cms/InquiryReplyForm.svelte'
  import CouponTabContent from '$lib/components/members/profile/CouponTabContent.svelte'
  import type { UserCouponCard } from '$lib/server/account/loadUserCoupons'
  import {
    loadAdminSessions,
    subscribeToSessions,
    subscribeToChatMessages,
    subscribeToAllMessages,
    loadMessages,
    markMessagesRead,
  } from '$lib/services/chatService'
  import { setSessions, upsertSession, pushMessage, applyIncomingMessagePreview } from '$lib/stores/chat.svelte'
  import { chatStore } from '$lib/stores/chat.svelte'
  import { supabase } from '$lib/services/supabase'
  import type { ChatSession, ChatMessage, ChatSessionStatus, CsRecord, ActionPayload, CtaModalRequest } from '$lib/types/chat'
  import { validateUploadFile, validateUploadFileSize } from '$lib/utils/fileValidation'
  import { csToast } from '$lib/utils/toast'
  import { CS_MEMO_MAX, checkCsMemo } from '$lib/utils/csMemo'
  import { listenChatTab, CHAT_WINDOW_NAME } from '$lib/utils/cmsChatTabBridge'
  import { INFO_PCT_MIN, INFO_PCT_MAX, INFO_PCT_DEFAULT, infoPctFromPointer, infoPctFromKey, parseStoredInfoPct, COMPOSE_PCT_MIN, COMPOSE_PCT_MAX, COMPOSE_MIN_PX, clampComposePct, composePctFromPointer, composePctFromKey, parseStoredComposePct } from '$lib/utils/panelSplit'
  import { createDeleteSafetyToast } from '$lib/utils/deleteSafetyToast.svelte'
  import { DELETED_MESSAGE_TEXT } from '$lib/utils/chatMessageDelete'

  // 로컬 타입 정의 (routes 크로스-임포트 금지 원칙) — /api/cms/customers/[userId]/summary 응답 형태
  interface CustomerSummary {
    user_id: string
    email: string | null
    member_code: string | null
    membership_grade: string | null
    credit_score: number | null
    blacklisted: boolean
  }

  // GSD-5: /api/chat/customers/[id]/detail 응답 형태 (CustomerDetailPanel과 동일 구조)
  interface CustomerDetailData {
    profile: {
      name: string | null
      phone: string | null
      is_student: boolean | null
      is_foreign: boolean | null
      identity_type: string[] | null
      identity_verified_at: string | null
      identity_doc_url: string[] | null
      foreign_verified_at: string | null
      foreign_doc_url: string | null
      foreign_doc_urls: string[] | null
      identity_approved_at?: string | null
      foreign_approved_at?: string | null
      foreign_type?: string[] | null
    }
    subscription: { plan_name: string | null } | null
    reservations: Array<{
      id: string
      status: string
      start_date: string | null
      end_date: string | null
      product_name: string | null
      created_at: string
    }>
  }

  // 로컬 타입 정의 (routes 크로스-임포트 금지 원칙) — /api/cms/reservations/[id]/detail 응답
  // 형태(get_rental_list RPC 반환 shape, RentalDetailPanel.svelte의 row prop과 구조 호환)
  interface CtaModalRentalRow {
    reservation_id: number
    reservation_code: string | null
    status: string
    rental_start: string
    rental_end: string
    rental_days: number | null
    pickup_method: string | null
    return_method: string | null
    pickup_time: string | null
    return_time: string | null
    user_id: string
    customer_name: string
    customer_email: string
    customer_phone: string
    membership_grade: string
    credit_score: number
    product_id: string
    product_name: string
    product_code: string | null
    product_category: string
    product_image_url: string | null
    order_id: number | null
    order_key: string | null
    order_amount: number | null
    discount_amount: number | null
    coupon_discount_amount: number | null
    total_amount: number | null
    selected_points: number | null
    order_delivery_fee: number | null
    tax_amount: number | null
    payment_status: string | null
    contract_id: string | null
    contract_status: string | null
    contract_pdf_url: string | null
    auto_signed_at: string | null
    customer_signed_at: string | null
    signing_sent_at: string | null
    signing_token: string | null
    created_at: string
    payment_confirmed_at?: string | null
    total_count: number
  }

  // 로컬 타입 정의 (routes 크로스-임포트 금지 원칙) — /api/cms/customers/[id]/inquiries 응답
  // 형태(PcInquiryPanel.svelte의 inquiries prop과 구조 호환)
  interface CtaModalInquiryItem {
    id: string
    title: string
    content: string
    category: string
    status: string
    created_at: string
    cs_inquiries: Array<{
      id: string
      response: string
      is_resolution: boolean
      created_at: string
    }>
  }

  // GSD-17: @ 멘션 상품 타입 (ChatInput.ProductItem과 동일)
  interface ProductItem {
    id: string
    name: string
    image_url: string | null
    slug: string | null
    price_24h: number | null
  }

  // 2단계 쿠폰선물 — 직접발송 쿠폰 타입 (ChatInput coupon popup용)
  interface CouponItem {
    id: string
    code: string
    description: string | null
    discount_type: string
    discount_value: number
    valid_until: string | null
  }

  interface Props {
    initialSessions?: ChatSession[]
    initialSessionId?: string | null
  }

  let { initialSessions = [], initialSessionId = null }: Props = $props()

  // 크레이지챗 · 빠른답변 상태 표시 pill (sessions-header) — 기존 빠른답변 자동매칭 스위치(auto_reply_settings)
  let autoReplyEnabled = $state<boolean | null>(null)
  $effect(() => {
    fetch('/api/cms/auto-reply-settings')
      .then((r) => r.ok ? r.json() : null)
      .then((d: { enabled: boolean } | null) => {
        if (d) autoReplyEnabled = d.enabled
      })
      .catch(() => {})
  })

  // "빠른문의 답변등록" 리마인더 — 미답변(status='open') 빠른문의를 세션 목록 최상단에
  // 별도 카드로 노출(chat_messages와 무관한 CMS 전용 UI, 2026-09-02). 과거엔 고객 본인의
  // 채팅 세션에 알림카드를 삽입해 고객 화면에도 새던 결함이 있었음(Migration 425로 제거) —
  // 이 방식은 그 대체다.
  interface PendingInquiryCard { id: string; title: string; created_at: string }
  let pendingInquiries = $state<PendingInquiryCard[]>([])
  async function loadPendingInquiries(): Promise<void> {
    try {
      const res = await fetch('/api/cms/chat/pending-inquiries')
      if (!res.ok) return
      const d = await res.json() as { posts?: PendingInquiryCard[] }
      pendingInquiries = d.posts ?? []
    } catch {
      // 조회 실패는 조용히 무시 — 리마인더는 부가 기능, 세션 목록 자체를 막지 않음
    }
  }
  $effect(() => { loadPendingInquiries() })

  // 크레이지챗 접수 요청(2026-10-07, S3) — 에이전트가 고객의 예약 시간 변경·연장 요청을 접수하면 세션 목록 최상단에
  // 카드로 노출한다(chat_messages와 무관한 CMS 전용 UI — 관리자 전용 알림은 고객 채팅창에 넣지 않는다, service-operations.md §17).
  // 관리자가 기존 화면(예약변경 등)에서 직접 처리한 뒤 [처리 완료] 또는 [반려]로 닫는다. 에이전트는 예약·결제·계약을 바꾸지 않는다.
  interface AgentRequestCard {
    id: string
    kind: 'time_change' | 'extend'
    kind_label: string
    reservation_code: string | null
    created_at: string
    session_id: string
    customer_name: string
    reservation_stage: string | null
    reservation_closed: boolean
  }
  const AGENT_STAGE_LABEL: Record<string, string> = {
    pending: '예약 접수', hold: '예약 신청', confirmed: '계약 완료', shipped: '반출 중', in_use: '대여 중',
    return_requested: '반납 접수', returned: '반납 완료', completed: '대여 종료', cancelled: '취소', expired: '만료',
  }
  let agentRequests = $state<AgentRequestCard[]>([])
  let resolvingAgentRequestId = $state<string | null>(null)
  async function loadAgentRequests(): Promise<void> {
    try {
      const res = await fetch('/api/cms/chat/agent-requests')
      if (!res.ok) return
      const d = await res.json() as { requests?: AgentRequestCard[] }
      agentRequests = d.requests ?? []
    } catch {
      // 조회 실패는 조용히 무시 — 접수 카드는 부가 UI, 세션 목록 자체를 막지 않음
    }
  }
  $effect(() => { loadAgentRequests() })

  async function handleResolveAgentRequest(e: MouseEvent, id: string, status: 'done' | 'rejected'): Promise<void> {
    e.stopPropagation()
    if (resolvingAgentRequestId) return
    resolvingAgentRequestId = id
    try {
      const res = await fetch(`/api/cms/chat/agent-requests/${id}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        csToast.error(d.error ?? '요청 처리에 실패했습니다.')
      } else {
        csToast.success(status === 'done' ? '처리 완료로 표시했습니다.' : '반려로 표시했습니다.')
      }
      await loadAgentRequests()
    } catch {
      csToast.error('요청 처리 중 오류가 발생했습니다.')
    } finally {
      resolvingAgentRequestId = null
    }
  }

  // 답변등록(add_cs_reply)은 status를 open→in_progress/resolved로 항상 바꾸므로(Migration 157),
  // 다음 조회 시점부터 이 카드는 자동으로 목록에서 빠진다 — 별도의 "대기/종료" 이동 UI는 없음
  // (2026-09-02, Stephen 확정: 처리되면 그냥 사라지면 됨). 30초 주기로 이 사실을 실제 반영한다.
  $effect(() => {
    const timer = setInterval(() => { loadPendingInquiries(); loadAgentRequests() }, 30 * 1000)
    return () => clearInterval(timer)
  })

  type FilterTab = 'open' | 'pending' | 'closed'

  let filterTab = $state<FilterTab>('open')
  let selectedSessionId = $state<string | null>(null)
  let messages = $state<ChatMessage[]>([])
  let isSending = $state(false)
  let isUploading = $state(false)
  let isLoadingMessages = $state(false)
  // 메시지 페이지네이션(2026-08-15 Stephen 확정: 최초 20개 + 위로 스크롤 시 이전 페이지 추가로딩)
  let hasMoreOlderMessages = $state(false)
  let isLoadingOlderMessages = $state(false)
  let pendingDeleteId = $state<string | null>(null)
  let isDeleting = $state(false)
  let flashingSessionIds = $state<Set<string>>(new Set())

  // CS-A1: 상담 메모 목록(최신 등록순) — 2026-10-17 단일 덮어쓰기 → 단문 메모 무한 등록 목록으로 확장
  let csRecords = $state<CsRecord[]>([])
  let csSummaryDraft = $state('')
  let isSavingCsRecord = $state(false)
  // 모두 삭제 — CMS 표준 '삭제 안전 토스트'(1차 클릭 경고 토스트 + 무장, 2차 클릭 실제 삭제)
  const csMemoDelete = createDeleteSafetyToast({
    warningMessage: '한번 더 누르면 상담 메모가 삭제됩니다.',
    successMessage: '상담 메모가 삭제됐습니다.',
    errorMessage: '상담 메모 삭제에 실패했습니다.',
  })

  // GSD-5: 고객 상세정보 패널
  let customerDetail = $state<CustomerDetailData | null>(null)
  let customerDetailLoading = $state(false)

  // GSD-12: 북마크 뷰 토글
  let showBookmarks = $state(false)
  // 2026-09-08: 북마크 패널이 열려 있는 동안 새 북마크 추가 시 목록 즉시 재조회용 트리거
  let bookmarkRefreshToken = $state(0)

  // 대화카드 CTA 레이어 모달 — 최상위(.admin-panel 형제)에서 렌더링해야 position:fixed가
  // 메시지 트리 조상에 갇히지 않는다(ui-mobile.md "CSS transform + position:fixed 충돌" 참고).
  // ActionCard.svelte → MessageBubble → MessageList → 여기까지 onctamodal 콜백으로 위임됨.
  //
  // 카드 타입별로 서로 다른 컴포넌트를 직접 마운트한다(iframe·CMS 페이지 전체 embed 아님 —
  // Stephen 요청: "필요한 요소 레이아웃만"):
  //   'reservation'       → RentalDetailPanel (대여정보/계약서 탭), 데이터는
  //                         /api/cms/reservations/[id]/detail(Migration 327) lazy 로드
  //   'contract-preview'  → ContractTemplatePreviewModal(viewOnly) — 고객이 보는 계약서 미리보기
  //   'inquiry'           → PcInquiryPanel — 고객의 빠른문의 답변 목록
  //   'empty'             → CMS에서 보여줄 화면이 없음 안내
  let ctaModalOpen = $state(false)
  let ctaModalTitle = $state('')
  let ctaModalKind = $state<CtaModalRequest['kind'] | null>(null)
  let ctaModalMenuUrl = $state<string | null>(null)
  let ctaModalLoading = $state(false)

  // 'reservation' 전용
  let ctaModalReservationId = $state<number | null>(null)
  let ctaModalRow = $state<CtaModalRentalRow | null>(null)
  let ctaModalInitialTab = $state<'rental' | 'contract' | undefined>(undefined)

  // 'contract-preview' 전용
  let ctaModalContractId = $state<string | null>(null)
  let ctaModalContractReservationId = $state<number | null>(null)

  // 'inquiry' 전용
  let ctaModalInquiries = $state<CtaModalInquiryItem[]>([])

  // 'inquiry-reply-form' 전용
  let ctaModalPostId = $state<string | null>(null)
  let ctaModalPost = $state<CtaModalInquiryItem | null>(null)

  // 'coupon' 전용
  let ctaModalCoupons = $state<UserCouponCard[]>([])

  async function loadCtaModalRow(reservationId: number): Promise<void> {
    ctaModalLoading = true
    ctaModalRow = null
    try {
      const res = await fetch(`/api/cms/reservations/${reservationId}/detail`)
      const data = res.ok ? await res.json() : null
      ctaModalRow = (data?.row as CtaModalRentalRow | undefined) ?? null
    } catch {
      ctaModalRow = null
    } finally {
      ctaModalLoading = false
    }
  }

  async function loadCtaModalInquiries(): Promise<void> {
    if (!selectedUserId) { ctaModalInquiries = []; return }
    ctaModalLoading = true
    ctaModalInquiries = []
    try {
      const res = await fetch(`/api/cms/customers/${selectedUserId}/inquiries`)
      const data = res.ok ? await res.json() : null
      ctaModalInquiries = Array.isArray(data) ? (data as CtaModalInquiryItem[]) : []
    } catch {
      ctaModalInquiries = []
    } finally {
      ctaModalLoading = false
    }
  }

  async function loadCtaModalPost(postId: string): Promise<void> {
    if (!selectedUserId) { ctaModalPost = null; return }
    ctaModalLoading = true
    ctaModalPost = null
    try {
      const res = await fetch(`/api/cms/customers/${selectedUserId}/inquiries`)
      const data = res.ok ? await res.json() : null
      const list = Array.isArray(data) ? (data as CtaModalInquiryItem[]) : []
      ctaModalPost = list.find((p) => p.id === postId) ?? null
    } catch {
      ctaModalPost = null
    } finally {
      ctaModalLoading = false
    }
  }

  async function loadCtaModalCoupons(): Promise<void> {
    if (!selectedUserId) { ctaModalCoupons = []; return }
    ctaModalLoading = true
    ctaModalCoupons = []
    try {
      const res = await fetch(`/api/cms/customers/${selectedUserId}/coupons`)
      const data = res.ok ? await res.json() : null
      ctaModalCoupons = Array.isArray(data) ? (data as UserCouponCard[]) : []
    } catch {
      ctaModalCoupons = []
    } finally {
      ctaModalLoading = false
    }
  }

  function handleCtaModal(info: CtaModalRequest): void {
    ctaModalTitle = info.title
    ctaModalKind = info.kind
    ctaModalMenuUrl = null
    ctaModalReservationId = null
    ctaModalRow = null
    ctaModalInitialTab = undefined
    ctaModalContractId = null
    ctaModalContractReservationId = null
    ctaModalInquiries = []
    ctaModalPostId = null
    ctaModalPost = null
    ctaModalCoupons = []
    ctaModalOpen = true

    if (info.kind === 'reservation') {
      ctaModalReservationId = info.reservationId
      ctaModalMenuUrl = info.menuUrl
      ctaModalInitialTab = info.initialTab
      void loadCtaModalRow(info.reservationId)
    } else if (info.kind === 'contract-preview') {
      ctaModalContractId = info.contractId
      ctaModalContractReservationId = info.reservationId
    } else if (info.kind === 'inquiry') {
      ctaModalMenuUrl = '/cms/customers/inquiry'
      void loadCtaModalInquiries()
    } else if (info.kind === 'inquiry-reply-form') {
      ctaModalMenuUrl = '/cms/customers/inquiry'
      ctaModalPostId = info.postId
      void loadCtaModalPost(info.postId)
    } else if (info.kind === 'coupon') {
      ctaModalMenuUrl = '/cms/promotion/coupon'
      void loadCtaModalCoupons()
    }
  }

  function closeCtaModal(): void {
    ctaModalOpen = false
    ctaModalKind = null
    ctaModalMenuUrl = null
    ctaModalReservationId = null
    ctaModalRow = null
    ctaModalInitialTab = undefined
    ctaModalContractId = null
    ctaModalContractReservationId = null
    ctaModalInquiries = []
    ctaModalPostId = null
    ctaModalPost = null
    ctaModalCoupons = []
    ctaModalLoading = false
  }

  function refetchCtaModalPost(): void {
    if (ctaModalPostId != null) void loadCtaModalPost(ctaModalPostId)
    // 이 모달 경로로 답변 등록 시에도 좌측 "빠른문의" 리마인더 카드를 즉시 갱신(자동 제거)
    void loadPendingInquiries()
  }

  function refetchCtaModalRow(): void {
    if (ctaModalReservationId != null) void loadCtaModalRow(ctaModalReservationId)
  }

  function goToCtaMenu(): void {
    if (!ctaModalMenuUrl) return
    const url = ctaModalMenuUrl
    closeCtaModal()
    goto(url)
  }

  // GSD-8: 세션별 크레이지챗 답변 수동전환
  let sessionManualMode = $state(false)

  // GSD-7: 중요 카드만 보기 필터
  let showImportantOnly = $state(false)

  // 중요 액션 카드 타입 집합 (rental-lifecycle.md AUTO_NOTIFY 기준)
  // ⚠️ 이 셋은 notify_type이 아니라 실제 저장되는 action_payload.type 값과 매칭돼야 함 —
  // send_rental_chat_notification RPC(migration 258)가 return_registration→'RETURN_REGISTRATION_CARD',
  // rental_complete→'RESERVATION_STATUS_CARD'로 변환해서 저장하는데, 이전엔 notify_type 원문
  // 문자열을 그대로 넣어놔서 "중요 카드만 보기" 필터에서 두 카드가 영구히 안 걸러졌음(2026-08-15
  // 상담채팅 액션카드 전수조사 P1, 직접 재현 검증 완료 — 수정).
  // ※ 'RESERVATION_STATUS_CARD'는 AI 응답 경로(chatActionEnrich.ts)의 예약조회 카드와 타입 문자열이
  // 겹쳐 그쪽도 함께 필터에 걸리지만, 별개의 더 낮은 우선순위 이슈로 이번 수정 범위 밖.
  const IMPORTANT_ACTION_TYPES = new Set([
    'reservation_hold', 'reservation_approval', 'contract_link',
    'shipment_notify', 'rental_confirm', 'return_remind',
    'RETURN_REGISTRATION_CARD', 'RESERVATION_STATUS_CARD',
  ])

  // 신규 채팅목록 등장·기존 목록 새 대화 수신/발신 시 카드 배경 점멸 표시 (3회 반복 후 자동 종료)
  function flashSession(sessionId: string): void {
    flashingSessionIds = new Set(flashingSessionIds).add(sessionId)
    setTimeout(() => {
      const next = new Set(flashingSessionIds)
      next.delete(sessionId)
      flashingSessionIds = next
    }, 1900)
  }

  // 세션 목록 초기화 — 마운트 시 1회만 (Realtime이 이후 갱신 담당)
  let storeInitialized = false
  $effect(() => {
    if (!storeInitialized) {
      storeInitialized = true
      setSessions(initialSessions)
      // URL ?session= 딥링크: 해당 세션 자동 선택 + 필터탭 전환
      if (initialSessionId) {
        const target = initialSessions.find((s) => s.id === initialSessionId)
        if (target) {
          if (target.status === 'closed') filterTab = 'closed'
          else if (target.status === 'pending') filterTab = 'pending'
          else filterTab = 'open'
          handleSelectSession(initialSessionId)
        }
      }
    }
  })

  // ── 대화 영역 ↔ 고객 정보 영역 가로폭 조절 (2026-10-20, Stephen 지시) ──
  // 두 영역의 합을 100%로 보고 고객 정보 영역을 30%~70% 사이에서 조절한다(대화 영역은 그 나머지 70%~30%).
  // 손잡이를 끌거나 방향키(←→ 2%씩)로 조절하고, 더블클릭하면 기본값으로 돌아간다. 값은 이 브라우저에 저장된다.
  const INFO_PCT_KEY = 'cms-chat-info-panel-pct'
  let infoPct = $state(INFO_PCT_DEFAULT)
  let resizingInfo = $state(false)
  let messagesEl = $state<HTMLElement | null>(null)

  function saveInfoPct(): void {
    try { localStorage.setItem(INFO_PCT_KEY, String(Math.round(infoPct * 10) / 10)) } catch { /* 저장소 차단 시 이번 세션만 유지 */ }
  }
  $effect(() => {
    try {
      const v = parseStoredInfoPct(localStorage.getItem(INFO_PCT_KEY))
      if (v !== null) infoPct = v
    } catch { /* 저장소 차단 시 기본값 */ }
  })
  function onInfoResizeDown(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    resizingInfo = true
  }
  function onInfoResizeMove(e: PointerEvent): void {
    if (!resizingInfo || !messagesEl) return
    infoPct = infoPctFromPointer(e.clientX, messagesEl.getBoundingClientRect())
  }
  function onInfoResizeUp(e: PointerEvent): void {
    if (!resizingInfo) return
    resizingInfo = false
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    saveInfoPct()
  }
  function onInfoResizeKey(e: KeyboardEvent): void {
    const next = infoPctFromKey(infoPct, e.key)
    if (next === null) return
    infoPct = next
    e.preventDefault()
    saveInfoPct()
  }
  function resetInfoPct(): void {
    infoPct = INFO_PCT_DEFAULT
    saveInfoPct()
  }

  // ── 위아래 높이 조절: 대화 영역(대화카드+고객 기본 정보) ↔ 하단 작성 그룹(답변 입력 + 상담 메모) (2026-10-20, Stephen 지시) ──
  // 두 영역의 합을 100%로 보고 하단 작성 그룹을 30%~70%로 제한한다. 저장값이 없으면(null) 기존처럼 내용 높이에 맞춘다 —
  // 처음 끌 때부터 비율 방식으로 바뀌고, 더블클릭하면 자동으로 돌아간다. 너무 낮은 화면에서는 내용 최소 높이(COMPOSE_MIN_PX)가 30%보다 우선한다.
  const COMPOSE_PCT_KEY = 'cms-chat-compose-pct'
  let composePct = $state<number | null>(null)
  let resizingCompose = $state(false)
  let splitEl = $state<HTMLElement | null>(null)
  let composeEl = $state<HTMLElement | null>(null)
  let measuredComposePct = $state(35) // 자동일 때 실제 비율(방향키 시작값·접근성 값)

  function saveComposePct(): void {
    try {
      if (composePct === null) localStorage.removeItem(COMPOSE_PCT_KEY)
      else localStorage.setItem(COMPOSE_PCT_KEY, String(Math.round(composePct * 10) / 10))
    } catch { /* 저장소 차단 시 이번 세션만 유지 */ }
  }
  $effect(() => {
    try { composePct = parseStoredComposePct(localStorage.getItem(COMPOSE_PCT_KEY)) } catch { /* 자동 */ }
  })
  // 실제 비율 측정(자동 모드 포함) — 두 영역 크기가 바뀔 때마다 갱신
  $effect(() => {
    const split = splitEl
    const compose = composeEl
    if (!split || !compose || typeof ResizeObserver === 'undefined') return
    const measure = () => {
      if (split.clientHeight > 0) measuredComposePct = clampComposePct((compose.offsetHeight / split.clientHeight) * 100)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(split)
    ro.observe(compose)
    return () => ro.disconnect()
  })
  function onComposeResizeDown(e: PointerEvent): void {
    if (e.button !== 0) return
    e.preventDefault()
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    resizingCompose = true
  }
  function onComposeResizeMove(e: PointerEvent): void {
    if (!resizingCompose || !splitEl) return
    const next = composePctFromPointer(e.clientY, splitEl.getBoundingClientRect())
    if (next !== null) composePct = next
  }
  function onComposeResizeUp(e: PointerEvent): void {
    if (!resizingCompose) return
    resizingCompose = false
    const el = e.currentTarget as HTMLElement
    if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId)
    saveComposePct()
  }
  function onComposeResizeKey(e: KeyboardEvent): void {
    const next = composePctFromKey(composePct, measuredComposePct, e.key)
    if (next === null) return
    composePct = next
    e.preventDefault()
    saveComposePct()
  }
  function resetComposePct(): void {
    composePct = null
    saveComposePct()
  }

  // 다른 CMS 화면의 플로팅 채팅 아이콘에서 "이 대화 열어줘" 요청이 오면 이 탭에서 해당 대화를 선택한다(2026-10-19).
  // 목록에 아직 없는 새 세션이면 딥링크로 다시 불러온다. 새 창으로 열릴 때 같은 창을 재사용하도록 창 이름도 지정.
  $effect(() => {
    const prevName = window.name
    window.name = CHAT_WINDOW_NAME
    const stopListen = listenChatTab((sid) => {
      const target = chatStore.sessions.find((s) => s.id === sid)
      if (!target) { window.location.href = `/cms/chat?session=${sid}`; return }
      if (target.status === 'closed') filterTab = 'closed'
      else if (target.status === 'pending') filterTab = 'pending'
      else filterTab = 'open'
      handleSelectSession(sid)
    })
    return () => {
      stopListen()
      // 채팅 화면을 떠난 탭이 이후 "채팅 창"으로 오인돼 다른 화면이 덮어써지지 않도록 창 이름을 되돌린다
      if (window.name === CHAT_WINDOW_NAME) window.name = prevName
    }
  })

  // 전체 세션 Realtime 구독 (INSERT/UPDATE만 — DELETE 방어는 서비스 레이어에서 처리)
  $effect(() => {
    const unsub = subscribeToSessions((session) => {
      const existedBefore = chatStore.sessions.some((s) => s.id === session.id)
      upsertSession(session)
      // 신규 채팅목록(세션) 등장 시 점멸 표시
      if (!existedBefore) flashSession(session.id)
    })
    return unsub
  })

  // 전체 메시지 Realtime 구독 — 목록의 마지막 메시지 미리보기·정렬을 새 메시지 도착 즉시 갱신
  $effect(() => {
    const unsub = subscribeToAllMessages((message) => {
      applyIncomingMessagePreview(message)
      // 기존 채팅목록에 새 대화(수신/발신) 도착 시 점멸 표시
      flashSession(message.session_id)
      // 긴급 배지(is_urgent)는 서버가 의도분류 로그를 근거로 계산하는 값이라 Realtime payload에 없다 —
      // 메시지 도착 후 잠시 뒤(의도 로그 기록 대기) 목록을 다시 받아 배지를 즉시 반영·해제한다
      if (!message.admin_only) scheduleSessionsRefetch()
    })
    return () => {
      unsub()
      if (sessionsRefetchTimer) { clearTimeout(sessionsRefetchTimer); sessionsRefetchTimer = null }
    }
  })

  let sessionsRefetchTimer: ReturnType<typeof setTimeout> | null = null
  function scheduleSessionsRefetch(): void {
    if (sessionsRefetchTimer) clearTimeout(sessionsRefetchTimer)
    sessionsRefetchTimer = setTimeout(async () => {
      sessionsRefetchTimer = null
      const { sessions } = await loadAdminSessions()
      if (sessions.length > 0) setSessions(sessions)
    }, 3000)
  }

  // auto_pending 주기적 갱신 — 5분마다 API 호출 → auto_pending_inactive_sessions() RPC 트리거
  // open 세션이 1시간 비활성 시 pending으로 자동 전환되는 조건을 수동 새로고침 없이도 반영
  $effect(() => {
    const timer = setInterval(async () => {
      const { sessions } = await loadAdminSessions()
      if (sessions.length > 0) setSessions(sessions)
    }, 5 * 60 * 1000)
    return () => clearInterval(timer)
  })

  // 세션 전체에 대한 북마크 id 집합 — 최초 로드 시 1회 조회 후 이전 페이지 병합에도 재사용
  let sessionBookmarkedIds = $state<Set<string>>(new Set())

  // 선택된 세션 메시지 로드 + Realtime 구독 (GSD-12: 북마크 병합 추가)
  // 2026-08-15: 전체 히스토리 무조건 로드 → 최근 20개만 우선 로드로 변경(성능 개선)
  $effect(() => {
    const sid = selectedSessionId
    if (!sid) { messages = []; hasMoreOlderMessages = false; return }

    isLoadingMessages = true
    hasMoreOlderMessages = false
    Promise.all([
      loadMessages(sid),
      fetch(`/api/chat/sessions/${sid}/bookmarks`)
        .then((r) => r.ok ? r.json() : { bookmarks: [] })
        .catch(() => ({ bookmarks: [] })),
    ]).then(([{ messages: msgs, hasMore }, bookmarkData]) => {
      interface BookmarkEntry { message_id: string }
      sessionBookmarkedIds = new Set<string>(
        ((bookmarkData as { bookmarks?: BookmarkEntry[] }).bookmarks ?? []).map((b) => b.message_id)
      )
      messages = msgs.map((m) => ({ ...m, is_bookmarked: sessionBookmarkedIds.has(m.id) }))
      hasMoreOlderMessages = hasMore
      isLoadingMessages = false
      markMessagesRead(sid, ['user'])
    }).catch(() => { isLoadingMessages = false })

    const unsub = subscribeToChatMessages(
      sid,
      (msg) => {
        const already = messages.some((m) => m.id === msg.id)
        if (!already) messages = [...messages, msg]
        // 새 사용자 메시지 도착 시 즉시 읽음 처리 (관리자 패널 열려 있음)
        markMessagesRead(sid, ['user'])
      },
      (messageId) => {
        // 관리자가 보낸 메시지를 사용자가 읽었을 때 → 로컬 is_read 즉시 반영
        messages = messages.map((m) =>
          m.id === messageId ? { ...m, is_read: true } : m
        )
      },
      // 다른 관리자 창에서 대화를 삭제한 경우도 이 창에 즉시 '대화가 삭제되었습니다.'로 반영
      (deleted) => {
        messages = messages.map((m) => (m.id === deleted.id ? { ...m, ...deleted } : m))
      }
    )
    return unsub
  })

  // MessageList가 위로 스크롤해 상단 근처에 닿으면 호출 — 현재 가장 오래된 메시지 이전 페이지 조회
  async function handleLoadMoreOlderMessages(): Promise<void> {
    const sid = selectedSessionId
    const oldest = messages[0]
    if (!sid || !oldest || isLoadingOlderMessages || !hasMoreOlderMessages) return

    isLoadingOlderMessages = true
    try {
      const { messages: older, hasMore } = await loadMessages(sid, { beforeCreatedAt: oldest.created_at })
      // 로딩 중 세션이 바뀌었으면 결과 버림(stale)
      if (selectedSessionId !== sid) return
      messages = [...older.map((m) => ({ ...m, is_bookmarked: sessionBookmarkedIds.has(m.id) })), ...messages]
      hasMoreOlderMessages = hasMore
    } finally {
      isLoadingOlderMessages = false
    }
  }

  let filteredSessions = $derived(
    chatStore.sessions.filter((s) => s.status === filterTab)
  )

  let selectedSession = $derived(
    chatStore.sessions.find((s) => s.id === selectedSessionId) ?? null
  )
  // Realtime 갱신 등으로 chatStore.sessions가 재구성될 때마다 selectedSession은 매번 새
  // 객체 참조가 되므로(내용이 같아도), user_id 값만 별도로 파생시켜 아래 두 $effect가
  // 실제 uid가 바뀔 때만 재실행되도록 한다(같은 uid로 반복 재조회되던 문제 수정)
  let selectedUserId = $derived(selectedSession?.user_id ?? null)

  // GSD-7: 중요 카드만 보기 필터링
  // 기본 뷰: sender_type='ai'인 메시지 중 "자유응답 텍스트"만 숨긴다(AI 챗봇 잡담이 관리자 뷰를
  // 어지럽히던 문제) — action_card는 발신자가 ai여도 구조화된 실데이터(예약정보 등)라 항상 노출.
  // 그렇지 않으면 예약 컨텍스트 요약 카드(chatReservationCard.ts) 등이 기본 뷰에서 보이지 않음.
  let filteredMessages = $derived(
    showImportantOnly
      ? messages.filter(
          (m) =>
            m.message_type === 'action_card' &&
            IMPORTANT_ACTION_TYPES.has(
              ((m.action_payload as { type?: string } | null)?.type) ?? ''
            )
        )
      : messages.filter(
          (m) =>
            m.sender_type !== 'ai' ||
            m.message_type === 'action_card' ||
            // 크레이지챗이 보낸 답변은 관리자가 고객이 받은 안내를 그대로 볼 수 있도록 기본 뷰에 노출(로고 배지로 구분)
            (m.action_payload as { type?: string } | null)?.type === 'crazychat_reply'
        )
  )

  // 고객 기본정보 요약 (chat-header 노출용) — 선택된 세션의 user_id가 바뀔 때만 재조회
  let customerSummary = $state<CustomerSummary | null>(null)
  $effect(() => {
    const uid = selectedUserId
    if (!uid) { customerSummary = null; return }
    customerSummary = null
    fetch(`/api/cms/customers/${uid}/summary`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: CustomerSummary | null) => {
        customerSummary = d
        // 블랙리스트 고객 대화를 열 때 한 번 경고(같은 고객을 연속으로 다시 열어도 세션 전환마다 1회)
        if (d?.blacklisted) csToast.warning('블랙리스트 고객입니다. 예약 승인·계약·혜택 안내 전에 확인해 주세요.')
      })
      .catch(() => { customerSummary = null })
  })

  // GSD-5: 고객 상세정보 조회 (CustomerDetailPanel용)
  $effect(() => {
    const uid = selectedUserId
    if (!uid) { customerDetail = null; return }
    customerDetail = null
    customerDetailLoading = true
    fetch(`/api/chat/customers/${uid}/detail`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: { detail: CustomerDetailData | null } | null) => {
        customerDetail = d?.detail ?? null
      })
      .catch(() => { customerDetail = null })
      .finally(() => { customerDetailLoading = false })
  })

  // GSD-8: selectedSession의 manual_mode가 바뀌면 로컬 토글 동기화
  $effect(() => {
    sessionManualMode = selectedSession?.manual_mode ?? false
  })

  function handleSelectSession(sid: string): void {
    selectedSessionId = sid
    // admin_id는 관리자가 실제로 답변(admin-reply/admin-attachment)할 때만 배정한다 —
    // 열람만으로 배정하면 긴급 판정·긴급 푸시가 무력화된다(service-operations.md §13 ④)
  }

  // CS-A1: 세션 선택 시 상담 메모 목록 로드(세션이 바뀌면 입력 중이던 내용·쓰기 상태 초기화)
  $effect(() => {
    const sid = selectedSessionId
    csRecords = []
    csSummaryDraft = ''
    editingMemoId = null
    memoEditStatus = null
    if (!sid) return
    fetch(`/api/chat/sessions/${sid}/cs-record`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: { records?: CsRecord[]; record?: CsRecord | null } | null) => {
        if (selectedSessionId !== sid || !d) return  // 응답이 늦게 와서 다른 세션이 선택된 뒤면 무시
        csRecords = d.records ?? (d.record ? [d.record] : [])
      })
      .catch(() => {})
  })

  async function handleSaveCsRecord(): Promise<void> {
    const sid = selectedSessionId
    if (!sid || isSavingCsRecord) return
    const checked = checkCsMemo(csSummaryDraft)
    if (!checked.ok) { csToast.warning(checked.error); return }
    isSavingCsRecord = true
    try {
      const res = await fetch(`/api/chat/sessions/${sid}/cs-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: checked.text, status: 'in_progress' }),
      })
      if (res.ok) {
        const { record } = await res.json() as { record: CsRecord | null }
        // 저장 중에 다른 세션으로 옮겼다면 화면(목록·입력란)은 건드리지 않는다 — 메모는 서버에 올바른 세션으로 저장됨
        if (selectedSessionId === sid) {
          if (record) csRecords = [record, ...csRecords]  // 최신 메모가 맨 위
          csSummaryDraft = ''
        }
      } else {
        const d = await res.json().catch(() => ({})) as { error?: string }
        csToast.error(d.error ?? '상담 메모 저장에 실패했습니다.')
      }
    } finally {
      isSavingCsRecord = false
    }
  }

  // ── 상담 메모 인라인 수정 (2026-10-20, Stephen 지시) ──
  // 목록의 메모 글자를 누르면 바로 수정 모드(입력칸)가 되고, 커서가 영역을 벗어나면(blur) 바로 저장한다(Enter도 같은 효과, Esc는 취소).
  // 저장 버튼·토스트 없이 행 옆 상태 글자(저장 중… / 자동 저장됨)로 결과를 보여준다(cms-uiux.md §0-10-H). 내용이 바뀌지 않았으면 저장 요청을 보내지 않는다.
  let editingMemoId = $state<string | null>(null)
  let editMemoDraft = $state('')
  let memoEditStatus = $state<{ id: string; text: string } | null>(null)
  let memoEditEl = $state<HTMLInputElement | null>(null)
  let memoEditCancelled = false
  let memoStatusTimer: ReturnType<typeof setTimeout> | null = null

  async function startEditMemo(rec: CsRecord): Promise<void> {
    editingMemoId = rec.id
    editMemoDraft = rec.summary ?? ''
    memoEditCancelled = false
    await tick()
    memoEditEl?.focus()
    memoEditEl?.select()
  }

  function showMemoStatus(id: string, text: string, autoClearMs?: number): void {
    memoEditStatus = { id, text }
    if (memoStatusTimer) clearTimeout(memoStatusTimer)
    if (autoClearMs) memoStatusTimer = setTimeout(() => { memoEditStatus = null }, autoClearMs)
  }

  async function commitEditMemo(rec: CsRecord): Promise<void> {
    if (editingMemoId !== rec.id) return
    const cancelled = memoEditCancelled
    const draft = editMemoDraft
    editingMemoId = null
    if (cancelled) return
    const sid = selectedSessionId
    if (!sid) return
    const checked = checkCsMemo(draft)
    if (!checked.ok) { csToast.warning(checked.error); return } // 비우면 원래 내용 유지(삭제는 휴지통 버튼)
    if (checked.text === rec.summary) return                   // 바뀐 게 없으면 저장하지 않는다
    showMemoStatus(rec.id, '저장 중…')
    try {
      const res = await fetch(`/api/chat/sessions/${sid}/cs-record?id=${encodeURIComponent(rec.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: checked.text }),
      })
      if (res.ok) {
        const { record } = await res.json() as { record: CsRecord | null }
        // 저장 중에 다른 세션으로 옮겼다면 화면은 건드리지 않는다(서버에는 올바른 메모에 저장됨)
        if (selectedSessionId === sid) {
          csRecords = csRecords.map((r) => r.id === rec.id ? { ...r, summary: record?.summary ?? checked.text, updated_at: record?.updated_at ?? r.updated_at } : r)
          showMemoStatus(rec.id, '자동 저장됨', 1800)
        }
      } else {
        const d = await res.json().catch(() => ({})) as { error?: string }
        showMemoStatus(rec.id, '저장 실패', 2500)
        csToast.error(d.error ?? '상담 메모 수정에 실패했습니다.')
      }
    } catch {
      showMemoStatus(rec.id, '저장 실패', 2500)
      csToast.error('상담 메모 수정에 실패했습니다.')
    }
  }

  function onEditMemoKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); memoEditEl?.blur() } // blur → commitEditMemo
    else if (e.key === 'Escape') { memoEditCancelled = true; memoEditEl?.blur() }
  }

  // ── 대화카드 개별 삭제(관리자 발송 취소) (2026-10-20, Stephen 지시) ──
  // 말풍선 상태줄의 삭제 아이콘 → 삭제 안전 토스트 2단계(1차: 경고, 2차: 삭제). 삭제되면 고객·관리자 창 모두 '대화가 삭제되었습니다.'로 바뀐다
  // (서버가 행을 교체 → 실시간 UPDATE로 양쪽 반영). 이미 나간 문자·푸시 알림은 회수되지 않는다. 결제·계약·쿠폰 카드와 고객 메시지는 삭제할 수 없다.
  const msgDelete = createDeleteSafetyToast({
    warningMessage: '한번 더 누르면 대화가 삭제됩니다. 이미 나간 문자·푸시 알림은 회수되지 않습니다.',
    successMessage: DELETED_MESSAGE_TEXT,
    errorMessage: '대화 삭제에 실패했습니다.',
  })
  async function handleAdminDeleteMessage(messageId: string): Promise<void> {
    await msgDelete.handleAction(`msg:${messageId}`, async () => {
      const res = await fetch(`/api/cms/chat/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({})) as { error?: string }
        throw new Error(d.error ?? '')
      }
      // 실시간 반영을 기다리지 않고 이 창은 즉시 바꾼다(서버 UPDATE 이벤트가 와도 같은 값이라 무해)
      messages = messages.map((m) => m.id === messageId
        ? { ...m, message_type: 'system', content: DELETED_MESSAGE_TEXT, action_payload: { type: 'message_deleted' }, deleted_at: new Date().toISOString() }
        : m)
      return true
    })
  }

  // 메모 1건 삭제 — 같은 삭제 안전 토스트(메모별 키로 무장 상태 구분)
  async function handleDeleteCsRecord(recId: string): Promise<void> {
    const sid = selectedSessionId
    if (!sid) return
    await csMemoDelete.handleAction(`item:${recId}`, async () => {
      const res = await fetch(`/api/chat/sessions/${sid}/cs-record?id=${encodeURIComponent(recId)}`, { method: 'DELETE' })
      if (!res.ok) return false
      if (selectedSessionId === sid) csRecords = csRecords.filter((r) => r.id !== recId)
      return true
    })
  }

  // GSD-12: 북마크 토글 — API 호출 + 로컬 메시지 배열 is_bookmarked 동기화
  // 2026-09-08(버튼 재점검): bookmarkRefreshToken 증가 — 북마크 패널(BookmarkListView)이
  // 열려 있는 동안 새로 북마크해도 그 목록은 sessionId 변경 시에만 재조회하는 자체
  // $effect라 즉시 반영되지 않던 결함 수정(패널을 닫았다 다시 열어야만 보이던 문제).
  async function handleBookmark(messageId: string): Promise<void> {
    if (!selectedSessionId) return
    const res = await fetch(`/api/chat/messages/${messageId}/bookmark`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: selectedSessionId }),
    })
    if (res.ok) {
      // 로컬 배열의 is_bookmarked 토글 (MessageBubble 로컬 상태와 별개 — 재마운트 시 정합성 보장)
      messages = messages.map((m) =>
        m.id === messageId ? { ...m, is_bookmarked: !(m.is_bookmarked ?? false) } : m
      )
      bookmarkRefreshToken++
    }
  }

  // 2026-09-08(버튼 재점검): 북마크 목록 항목 클릭 → 해당 메시지로 스크롤 이동.
  // Stephen 확정: 현재 로드된 범위(messages)에만 있으면 이동, 없으면(아직 페이지네이션으로
  // 안 불러온 오래된 메시지) 안내만 — 자동 추가로드는 이번 스코프에서 하지 않는다.
  // "중요 카드만 보기" 필터가 켜져 있으면 대상 메시지가 DOM에 없을 수 있어 먼저 해제한다.
  function handleBookmarkSelect(messageId: string): void {
    const exists = messages.some((m) => m.id === messageId)
    if (!exists) {
      csToast.info('이 메시지는 현재 화면에 로드돼 있지 않습니다. 위로 스크롤해 더 불러온 뒤 다시 시도해주세요.')
      return
    }
    if (showImportantOnly) showImportantOnly = false
    requestAnimationFrame(() => {
      document.getElementById(`msg-${messageId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    })
  }

  // GSD-8: 세션 크레이지챗 답변 수동/자동 전환
  // 2026-09-08(버튼 재점검, Stephen 지시): 기존엔 fetch 성공/실패와 무관하게 무조건
  // sessionManualMode·로컬 스토어를 낙관적으로 갱신했다 — PATCH가 401/500 등으로 실패해도
  // 버튼은 "수동"으로 전환된 것처럼 보이지만 실제 DB(chat_sessions.manual_mode)는 그대로라,
  // 자동응답이 여전히 나가는데 관리자는 꺼졌다고 오인하는 위험이 있었다. 서버 응답(res.ok)을
  // 확인한 뒤에만 로컬 상태를 반영하도록 수정.
  async function handleToggleManualMode(): Promise<void> {
    if (!selectedSessionId) return
    const sid = selectedSessionId
    const newVal = !sessionManualMode
    const res = await fetch(`/api/chat/sessions/${sid}/manual-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual_mode: newVal }),
    }).catch(() => null)

    if (!res || !res.ok) {
      csToast.error('크레이지챗 답변 모드 전환에 실패했습니다.')
      return
    }

    sessionManualMode = newVal
    // 로컬 스토어에 manual_mode 반영
    const updated = chatStore.sessions.find((s) => s.id === sid)
    if (updated) upsertSession({ ...updated, manual_mode: newVal })
  }

  // GSD-1/2: 상태 직접변경 (reopen / pending) — close는 기존 handleCloseSession 사용
  async function handleSessionStatusChange(newStatus: 'open' | 'pending'): Promise<void> {
    if (!selectedSessionId) return
    const endpoint = newStatus === 'open' ? 'reopen' : 'pending'
    const res = await fetch(`/api/chat/sessions/${selectedSessionId}/${endpoint}`, {
      method: 'POST',
    })
    if (res.ok) {
      const updated = chatStore.sessions.find((s) => s.id === selectedSessionId)
      if (updated) upsertSession({ ...updated, status: newStatus as ChatSessionStatus })
    }
  }

  // GSD-17: @ 멘션 상품 선택 → product_link action_card로 관리자 전송
  async function handleProductMention(product: ProductItem): Promise<void> {
    if (!selectedSessionId || isSending) return
    isSending = true
    try {
      const payload: ActionPayload = {
        type: 'product_link',
        product_id: product.id,
        product_name: product.name,
        ...(product.image_url ? { product_image: product.image_url } : {}),
        ...(product.slug ? { product_slug: product.slug } : {}),
        ...(product.price_24h != null ? { product_price: product.price_24h } : {}),
      }
      const res = await fetch('/api/chat/admin-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSessionId,
          content: product.name,
          action_payload: payload,
        }),
      })
      if (res.ok) {
        const { message } = await res.json()
        if (message) {
          const already = messages.some((m) => m.id === message.id)
          if (!already) messages = [...messages, message]
        }
      }
    } finally {
      isSending = false
    }
  }

  // 쿠폰선물 2-A: pending 카드 승인·거절
  async function handleCouponApprove(msgId: string, reject: boolean): Promise<void> {
    if (!selectedSessionId) return
    try {
      const res = await fetch(`/api/cms/chat/coupon-gift/${msgId}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reject }),
      })
      if (res.ok) {
        const result = await res.json()
        // 메시지 목록에서 해당 메시지의 action_payload를 업데이트
        messages = messages.map((m): ChatMessage => {
          if (m.id !== msgId || !m.action_payload) return m
          const newStatus: 'rejected' | 'approved' = result.rejected ? 'rejected' : 'approved'
          const updated: ActionPayload = {
            ...m.action_payload,
            approval_status: newStatus,
            ...(result.coupon_code ? {
              coupon_code: result.coupon_code as string,
              action_url: '/account/profile?tab=coupon',
            } : {}),
          }
          return { ...m, action_payload: updated }
        })
      } else {
        csToast.error(await couponGiftErrorMessage(res, '쿠폰 처리에 실패했습니다.'))
      }
    } catch {
      csToast.error('네트워크 오류로 쿠폰을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.')
    }
  }

  // 쿠폰선물 API 실패 응답 → 관리자 안내 문구 (배포 중단 쿠폰은 전용 문구)
  async function couponGiftErrorMessage(res: Response, fallback: string): Promise<string> {
    const body = await res.json().catch(() => null) as { error?: string } | null
    const raw = body?.error ?? ''
    if (raw.includes('DISTRIBUTION_PAUSED')) return '이 쿠폰은 신규 배포가 중단된 상태라 발송할 수 없습니다.'
    return raw || fallback
  }

  // 쿠폰선물 2-B: 관리자 직접 발송
  async function handleCouponGift(coupon: CouponItem): Promise<void> {
    if (!selectedSessionId || isSending) return
    isSending = true
    try {
      const res = await fetch('/api/cms/chat/coupon-gift/direct-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSessionId,
          coupon_id: coupon.id,
        }),
      })
      if (res.ok) {
        const { message } = await res.json()
        if (message) {
          const already = messages.some((m) => m.id === message.id)
          if (!already) messages = [...messages, message]
        }
      } else {
        csToast.error(await couponGiftErrorMessage(res, '쿠폰 발송에 실패했습니다.'))
      }
    } catch {
      csToast.error('네트워크 오류로 쿠폰을 발송하지 못했습니다. 잠시 후 다시 시도해주세요.')
    } finally {
      isSending = false
    }
  }

  // 본인증명·외국인증명 등록요청 카드 발송 (CustomerDetailPanel "요청" 버튼, 2026-08-27)
  let requestingDocType = $state<'identity' | 'foreign' | null>(null)

  async function handleRequestDoc(docType: 'identity' | 'foreign'): Promise<void> {
    if (!selectedSessionId || requestingDocType) return
    requestingDocType = docType
    try {
      const res = await fetch('/api/cms/chat/identity-request/direct-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSessionId,
          doc_type: docType,
        }),
      })
      if (res.ok) {
        const { message, deleted_count } = await res.json() as { message?: (typeof messages)[number]; deleted_count?: number }
        if (message) {
          const already = messages.some((m) => m.id === message.id)
          if (!already) messages = [...messages, message]
        }
        const docLabel = docType === 'foreign' ? '외국인증명' : '본인증명'
        csToast.success(
          deleted_count && deleted_count > 0
            ? `${docLabel} 등록요청을 전송했습니다. (만료된 기존 파일 ${deleted_count}개 삭제)`
            : `${docLabel} 등록요청을 전송했습니다.`,
        )
        // 삭제가 있었으면 고객정보 패널을 다시 조회해 "미등록" 상태를 반영
        if (deleted_count && deleted_count > 0 && selectedUserId) {
          fetch(`/api/chat/customers/${selectedUserId}/detail`)
            .then((r) => r.ok ? r.json() : null)
            .then((d: { detail: CustomerDetailData | null } | null) => { if (d?.detail) customerDetail = d.detail })
            .catch(() => {})
        }
      } else {
        csToast.error('요청 전송에 실패했습니다.')
      }
    } catch {
      csToast.error('요청 전송에 실패했습니다.')
    } finally {
      requestingDocType = null
    }
  }

  async function handleSend(content: string, cannedResponseId?: string): Promise<void> {
    if (!selectedSessionId || isSending) return
    isSending = true
    try {
      const res = await fetch('/api/chat/admin-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSessionId,
          content,
          // §E SYN-8: 캔드 리스폰스에서 비롯된 발신일 때만 포함 (undefined면 키 미포함)
          ...(cannedResponseId ? { canned_response_id: cannedResponseId } : {}),
        }),
      })
      if (res.ok) {
        const { message } = await res.json()
        if (message) {
          const already = messages.some((m) => m.id === message.id)
          if (!already) messages = [...messages, message]
        }
        // 2026-09-28 Stephen 확정: usage_count는 "선택(미리보기)" 시점이 아니라 "실제 전송
        // 성공" 시점에 집계한다 — 선택만 하고 편집·취소하거나 팝업만 열어본 경우까지 과다
        // 집계되던 문제 해소(fire-and-forget, 발신 성공 자체를 막지 않음).
        if (cannedResponseId) {
          fetch(`/api/cms/canned-responses/${cannedResponseId}/use`, { method: 'PATCH' }).catch(() => {})
        }
      } else {
        // 1000자 초과 등 서버 거부를 조용히 삼키지 않고 안내 — 과거엔 이 분기 자체가 없어
        // "보냈는지 안 보냈는지 알 수 없는" 상태로 보였다(입력창은 이미 비워진 뒤였음).
        const body = await res.json().catch(() => null) as { error?: string } | null
        csToast.error(body?.error ?? '메시지 전송에 실패했습니다.')
      }
    } finally {
      isSending = false
    }
  }

  async function handleAdminAttach(file: File): Promise<void> {
    if (!selectedSessionId || isUploading) return

    // front-uiux.md §15-3·§15-1a 표준 — 업로드 시도 전 MIME·용량 클라이언트 검증(2026-09-08)
    const typeCheck = validateUploadFile(file)
    if (!typeCheck.ok) {
      csToast.error(typeCheck.error ?? '허용되지 않는 파일 형식입니다.')
      return
    }
    const sizeCheck = validateUploadFileSize(file)
    if (!sizeCheck.ok) {
      csToast.error(sizeCheck.error ?? '파일 크기가 너무 큽니다.')
      return
    }

    isUploading = true
    try {
      const ext = file.name.split('.').pop() ?? 'bin'
      const path = `${selectedSessionId}/${Date.now()}_admin.${ext}`

      const { data, error: uploadErr } = await supabase.storage
        .from('chat-attachments')
        .upload(path, file, { upsert: false })

      if (uploadErr || !data) {
        return
      }

      const { data: { publicUrl } } = supabase.storage
        .from('chat-attachments')
        .getPublicUrl(data.path)

      const is_image = file.type.startsWith('image/')
      const res = await fetch('/api/chat/admin-attachment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: selectedSessionId,
          file_name: file.name,
          file_url: publicUrl,
          is_image,
        }),
      })

      if (res.ok) {
        const { message } = await res.json()
        if (message) {
          const already = messages.some((m: ChatMessage) => m.id === message.id)
          if (!already) messages = [...messages, message]
        }
      }
    } finally {
      isUploading = false
    }
  }

  async function handleCloseSession(sid: string): Promise<void> {
    const res = await fetch(`/api/chat/sessions/${sid}/close`, { method: 'POST' })
    if (res.ok) {
      // 로컬 세션 상태 즉시 반영 (Realtime이 갱신하기 전 선제 처리)
      const updated = chatStore.sessions.find((s) => s.id === sid)
      if (updated) upsertSession({ ...updated, status: 'closed' as ChatSessionStatus })
      // 닫은 세션이 현재 선택된 경우 선택 해제
      if (selectedSessionId === sid) selectedSessionId = null
    }
  }

  async function handleRefresh(): Promise<void> {
    const { sessions } = await loadAdminSessions()
    setSessions(sessions)
    loadPendingInquiries()
    loadAgentRequests()
  }

  function handleSelectInquiry(postId: string): void {
    goto(`/cms/customers/inquiry?post=${postId}`)
  }

  function handleDeleteRequest(e: MouseEvent, sid: string): void {
    e.stopPropagation()
    pendingDeleteId = sid
  }

  async function handleDeleteConfirm(): Promise<void> {
    if (!pendingDeleteId || isDeleting) return
    isDeleting = true
    try {
      const res = await fetch(`/api/chat/sessions/${pendingDeleteId}`, { method: 'DELETE' })
      if (res.ok) {
        // 로컬 목록에서 즉시 제거
        const updated = chatStore.sessions.filter((s) => s.id !== pendingDeleteId)
        setSessions(updated)
        if (selectedSessionId === pendingDeleteId) selectedSessionId = null
      }
    } finally {
      isDeleting = false
      pendingDeleteId = null
    }
  }

  function handleDeleteCancel(): void {
    pendingDeleteId = null
  }

  function formatDateTime(iso: string): string {
    const d = new Date(iso)
    const yyyy = d.getFullYear()
    const mm = (d.getMonth() + 1).toString().padStart(2, '0')
    const dd = d.getDate().toString().padStart(2, '0')
    const hh = d.getHours().toString().padStart(2, '0')
    const mi = d.getMinutes().toString().padStart(2, '0')
    return `${yyyy}.${mm}.${dd}  ${hh}:${mi}`
  }

  function lastMessagePreview(session: ChatSession): string {
    const content = session.last_message_content
    if (!content) return ''
    return content.length > 30 ? content.slice(0, 30) + '…' : content
  }

  function sessionLabel(s: ChatSession): string {
    if (s.user_name) return s.user_name
    if (s.user_handle) return s.user_handle
    return `익명 ${s.user_id.slice(0, 8)}`
  }

  // 아바타 이니셜 2자 추출 (ChatHeader.svelte 고객용 아바타와 동일 로직)
  function initialsOf(name: string): string {
    if (!name) return '?'
    return name.trim().split(/\s+/).map((w) => w[0]).join('').toUpperCase().slice(0, 2) || '?'
  }

  const STATUS_LABEL: Record<FilterTab, string> = {
    open: '진행중',
    pending: '대기',
    closed: '종료',
  }
</script>

<div class="admin-panel">
  <!-- 좌측: 세션 목록 -->
  <aside class="sessions-pane">
    <div class="sessions-header">
      <h2 class="pane-title">상담 세션</h2>
      {#if autoReplyEnabled !== null}
        <a
          href="/cms/chat/qna"
          class="ar-pill"
          class:ar-pill--on={autoReplyEnabled}
          title="크레이지챗 · 빠른답변 설정 바로가기"
          aria-label="크레이지챗 · 빠른답변 {autoReplyEnabled ? 'ON' : 'OFF'} — 빠른답변 설정으로 이동"
        >크레이지챗 · 빠른답변 {autoReplyEnabled ? 'ON' : 'OFF'}</a>
      {/if}
      <button class="refresh-btn" onclick={handleRefresh} aria-label="새로고침">↻</button>
    </div>

    <div class="filter-tabs" role="tablist">
      {#each (['open', 'pending', 'closed'] as FilterTab[]) as tab}
        <button
          role="tab"
          class="filter-tab"
          class:active={filterTab === tab}
          onclick={() => filterTab = tab}
          aria-selected={filterTab === tab}
        >
          {STATUS_LABEL[tab]}
          <span class="tab-count" class:count-open={tab === 'open'} class:count-etc={tab !== 'open'}>{chatStore.sessions.filter(s => s.status === tab).length}</span>
        </button>
      {/each}
    </div>

    <ul class="session-list" role="listbox" aria-label="채팅 세션 목록">
      {#if filterTab === 'open'}
        {#each agentRequests as req (req.id)}
          <li>
            <div
              class="session-card agent-request-card"
              onclick={() => handleSelectSession(req.session_id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelectSession(req.session_id) }}
              role="option"
              tabindex="0"
              aria-selected={selectedSessionId === req.session_id}
            >
              <div class="agent-request-top">
                <span class="agent-request-badge">크레이지챗 접수</span>
                <span class="agent-request-kind">{req.kind_label}</span>
                <span class="inquiry-time">{formatDateTime(req.created_at)}</span>
              </div>
              <div class="agent-request-meta">
                <span class="agent-request-who">{req.customer_name}{req.reservation_code ? ` · ${req.reservation_code}` : ''}</span>
                {#if req.reservation_stage}
                  <span class="agent-request-stage" class:closed={req.reservation_closed}>
                    {req.reservation_closed ? `이미 ${AGENT_STAGE_LABEL[req.reservation_stage] ?? '종료'} 상태` : (AGENT_STAGE_LABEL[req.reservation_stage] ?? req.reservation_stage)}
                  </span>
                {/if}
              </div>
              <div class="agent-request-actions">
                <button type="button" class="btn-agent-small" disabled={resolvingAgentRequestId === req.id} onclick={(e) => handleResolveAgentRequest(e, req.id, 'done')}>처리 완료</button>
                <button type="button" class="btn-agent-small" disabled={resolvingAgentRequestId === req.id} onclick={(e) => handleResolveAgentRequest(e, req.id, 'rejected')}>반려</button>
              </div>
            </div>
          </li>
        {/each}
        {#each pendingInquiries as inquiry (inquiry.id)}
          <li>
            <div
              class="session-card inquiry-reminder-card"
              onclick={() => handleSelectInquiry(inquiry.id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelectInquiry(inquiry.id) }}
              role="option"
              tabindex="0"
              aria-selected="false"
            >
              <span class="inquiry-badge">빠른문의</span>
              <span class="inquiry-title">{inquiry.title}</span>
              <span class="inquiry-time">{formatDateTime(inquiry.created_at)}</span>
            </div>
          </li>
        {/each}
      {/if}
      {#if filteredSessions.length === 0}
        {#if (pendingInquiries.length === 0 && agentRequests.length === 0) || filterTab !== 'open'}
          <li class="empty-sessions">세션 없음</li>
        {/if}
      {:else}
        {#each filteredSessions as session (session.id)}
          <li>
            <div
              class="session-card"
              class:selected={session.id === selectedSessionId}
              class:flash={flashingSessionIds.has(session.id)}
              onclick={() => handleSelectSession(session.id)}
              onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleSelectSession(session.id) }}
              role="option"
              tabindex="0"
              aria-selected={session.id === selectedSessionId}
            >
              <div class="sc-top">
                <span class="sc-name">{sessionLabel(session)}</span>
                {#if session.is_urgent}
                  <span class="urgent-badge">긴급</span>
                {/if}
                {#if session.user_blacklisted}
                  <span class="blacklist-badge" title="블랙리스트 고객">블랙리스트</span>
                {/if}
                {#if session.last_message_sender === 'user' || session.last_message_sender === 'ai'}
                  <span class="msg-dir-badge msg-dir-in" aria-label="수신">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M10 2L2 10M2 10V4M2 10H8" stroke="#FF3535" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                {:else if session.last_message_sender === 'admin'}
                  <span class="msg-dir-badge msg-dir-out" aria-label="발신">
                    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M2 10L10 2M10 2V8M10 2H4" stroke="#AAAAAA" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                  </span>
                {/if}
                {#if filterTab === 'open' || filterTab === 'pending'}
                  <button
                    class="close-session-btn"
                    onclick={(e) => { e.stopPropagation(); handleCloseSession(session.id) }}
                    aria-label="채팅 종료"
                    title="채팅 종료"
                  >✕</button>
                {:else if filterTab === 'closed'}
                  <button
                    class="delete-session-btn"
                    onclick={(e) => handleDeleteRequest(e, session.id)}
                    aria-label="채팅 삭제"
                    title="완전 삭제"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3,6 5,6 21,6"/><path d="M19,6l-1,14H6L5,6"/><path d="M10,11v6M14,11v6"/><path d="M9,6V4h6v2"/></svg>
                  </button>
                {/if}
              </div>
              <div class="sc-mid">
                <span class="sc-last-msg">{lastMessagePreview(session)}</span>
              </div>
              <div class="sc-bottom">
                <span class="sc-time">{formatDateTime(session.last_message_at ?? session.updated_at)}</span>
                {#if (session.unread_count ?? 0) > 0}
                  <span class="unread-badge">{session.unread_count}</span>
                {/if}
              </div>
            </div>
          </li>
        {/each}
      {/if}
    </ul>
  </aside>

  <!-- 우측: 대화창 -->
  <section class="chat-pane">
    {#if !selectedSession}
      <div class="no-session">
        <svg xmlns="http://www.w3.org/2000/svg" width="70" height="70" viewBox="0 0 70 70" fill="none" aria-hidden="true" class="no-session-icon">
          <path d="M70 35C70 54.33 54.33 70 35 70C15.67 70 0 54.33 0 35C0 15.67 15.67 0 35 0C54.33 0 70 15.67 70 35Z" fill="#3B2F8A"/>
          <path d="M13.9998 38.532C13.9998 45.7036 23.1602 54.2198 29.7378 54.2198C33.566 54.2198 25.1998 50.7339 29.3125 49.2893C31.7471 48.4342 37.8196 45.7036 37.8196 38.532C37.8196 31.3604 32.29 26.43 25.9097 26.43C19.5294 26.43 13.9998 31.3604 13.9998 38.532Z" fill="#C494FE"/>
          <path d="M56.6772 31.0672C56.6772 39.7986 44.9667 50.1671 36.558 50.1671C31.6641 50.1671 42.3592 45.9231 37.1017 44.1643C33.9894 43.1231 26.2265 39.7986 26.2265 31.0672C26.2265 22.3358 33.2954 16.333 41.4518 16.333C49.6083 16.333 56.6772 22.3358 56.6772 31.0672Z" fill="white"/>
        </svg>
        <p class="no-session-text">상담 세션을 선택하세요.</p>
      </div>
    {:else}
      <div class="chat-header">
        <!-- 아바타+식별정보를 하나의 그룹으로 묶어 우측 header-toolbar 버튼군과 레이아웃상
             명확히 분리(2026-09-28, Stephen 지시 — 이전엔 flat하게 나열돼 경계가 불명확했음) -->
        <div class="chat-identity">
          <div class="chat-avatar" aria-hidden="true">
            <span class="chat-avatar-initials">{initialsOf(sessionLabel(selectedSession))}</span>
          </div>

          <div class="chat-header-info">
            <div class="chat-header-top">
              <span class="chat-user">{sessionLabel(selectedSession)}</span>
              <span class="chat-status status-{selectedSession.status}">{STATUS_LABEL[selectedSession.status as FilterTab]}</span>
            </div>

            <!-- 고객 아이디·회원코드 — 나머지 요약(등급·크레이지스코어·블랙리스트·상세정보)은
                 우측 고객정보 컬럼(customer-pane)으로 이동, 헤더에는 식별용 최소 정보만 유지 -->
            {#if customerSummary}
              <div class="customer-strip">
                {#if customerSummary.email}
                  <span class="cs-item cs-email">{customerSummary.email}</span>
                {/if}
                {#if customerSummary.member_code}
                  <span class="cs-item cs-code">{customerSummary.member_code}</span>
                {/if}
              </div>
            {/if}
          </div>
        </div>

        <!-- GSD-7/8/12: 헤더 툴바 — 수동전환·중요카드·북마크·상태변경 -->
        <div class="header-toolbar">
          <!-- GSD-8: 크레이지챗 답변 수동전환 토글 -->
          <button
            class="toolbar-btn"
            class:toolbar-btn--active={sessionManualMode}
            onclick={handleToggleManualMode}
            title={sessionManualMode ? '수동모드 ON — 크레이지챗 답변 꺼짐' : '자동모드 — 클릭 시 수동전환'}
            aria-pressed={sessionManualMode}
          >{sessionManualMode ? '수동 대화' : '자동 대화'}</button>

          <!-- GSD-7: 중요 카드만 보기 -->
          <button
            class="toolbar-btn"
            class:toolbar-btn--active={showImportantOnly}
            onclick={() => { showImportantOnly = !showImportantOnly }}
            title={showImportantOnly ? '전체 메시지 보기' : '중요 카드만 보기'}
            aria-pressed={showImportantOnly}
          >알림 보기</button>

          <!-- GSD-12: 북마크 목록 토글 -->
          <button
            class="toolbar-btn"
            class:toolbar-btn--active={showBookmarks}
            onclick={() => { showBookmarks = !showBookmarks }}
            title={showBookmarks ? '북마크 닫기' : '북마크 목록'}
            aria-pressed={showBookmarks}
          >북마크 보기</button>

          <!-- GSD-1/2: 상태 세그먼트 컨트롤 -->
          {#if selectedSession?.status !== 'open'}
            <button
              class="toolbar-btn toolbar-btn--status"
              onclick={() => handleSessionStatusChange('open')}
              title="진행중으로 전환"
            >진행중탭 이동</button>
          {/if}
          {#if selectedSession?.status === 'open'}
            <button
              class="toolbar-btn toolbar-btn--status"
              onclick={() => handleSessionStatusChange('pending')}
              title="대기로 전환"
            >대기탭 이동</button>
          {/if}
        </div>

      </div>

      <!-- GSD-12: 북마크 목록 -->
      {#if showBookmarks}
        <div class="bookmark-pane">
          <BookmarkListView
            sessionId={selectedSessionId}
            refreshToken={bookmarkRefreshToken}
            onselect={(messageId) => handleBookmarkSelect(messageId)}
            onclose={() => { showBookmarks = false }}
          />
        </div>
      {/if}

      <!-- 위아래 높이 조절 영역(2026-10-20): 대화 영역 + 하단 작성 그룹의 합이 100% -->
      <div class="chat-split" class:chat-split--resizing={resizingCompose} bind:this={splitEl}>
      <div
        class="chat-messages"
        class:chat-messages--resizing={resizingInfo}
        style:--info-pct={infoPct}
        bind:this={messagesEl}
      >
        {#if isLoadingMessages}
          <div class="loading-msgs">메시지 로딩 중...</div>
        {:else}
          <MessageList
            messages={filteredMessages}
            currentUserId="admin"
            isAdmin={true}
            onbookmark={handleBookmark}
            onadmindelete={handleAdminDeleteMessage}
            adminDeleteArmedId={msgDelete.pendingKey?.startsWith('msg:') ? msgDelete.pendingKey.slice(4) : null}
            adminDeleteBusyId={msgDelete.busyKey?.startsWith('msg:') ? msgDelete.busyKey.slice(4) : null}
            hasMoreOlder={hasMoreOlderMessages}
            isLoadingOlder={isLoadingOlderMessages}
            onloadmore={handleLoadMoreOlderMessages}
            oncouponapprove={handleCouponApprove}
            onctamodal={handleCtaModal}
          />
        {/if}

        <!-- 우측 플로팅: 고객 정보(읽기전용) — 별도 3분할 컬럼이 아니라 대화 목록 영역
             내부 우측에 겹쳐 노출, 세션 선택 시 함께 노출됨 -->
        <div class="customer-info-float">
          <CustomerDetailPanel
            detail={customerDetail}
            summary={customerSummary}
            isLoading={customerDetailLoading}
            onrequestdoc={handleRequestDoc}
            {requestingDocType}
          />
        </div>

        <!-- 대화 영역 ↔ 고객 정보 영역 가로폭 조절 손잡이(30%~70%) — 끌기·방향키·더블클릭 초기화 -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_element_to_interactive_role -->
        <div
          class="info-resizer"
          class:info-resizer--active={resizingInfo}
          role="separator"
          aria-orientation="vertical"
          aria-label="대화 영역과 고객 정보 영역의 가로폭 조절"
          aria-valuemin={INFO_PCT_MIN}
          aria-valuemax={INFO_PCT_MAX}
          aria-valuenow={Math.round(infoPct)}
          tabindex="0"
          title="끌어서 가로폭 조절 (더블클릭: 기본값)"
          onpointerdown={onInfoResizeDown}
          onpointermove={onInfoResizeMove}
          onpointerup={onInfoResizeUp}
          onpointercancel={onInfoResizeUp}
          onkeydown={onInfoResizeKey}
          ondblclick={resetInfoPct}
        ></div>
      </div>

      <!-- 하단 작성 그룹(2026-10-20): 답변 입력창 + 상담 메모는 같은 좌우 여백(24px)·세로 간격·하단 고정(flex-shrink:0)을 공유하므로 한 그룹으로 묶어 여백 규칙을 한 곳에서 관리 -->
      <!-- 대화 영역 ↔ 하단 작성 그룹 높이 조절 손잡이(30%~70%) — 끌기·↑↓ 방향키·더블클릭(자동) -->
      <!-- svelte-ignore a11y_no_noninteractive_tabindex, a11y_no_noninteractive_element_interactions, a11y_no_noninteractive_element_to_interactive_role -->
      <div
        class="compose-resizer"
        class:compose-resizer--active={resizingCompose}
        role="separator"
        aria-orientation="horizontal"
        aria-label="대화 영역과 답변 입력·상담 메모 영역의 높이 조절"
        aria-valuemin={COMPOSE_PCT_MIN}
        aria-valuemax={COMPOSE_PCT_MAX}
        aria-valuenow={Math.round(composePct ?? measuredComposePct)}
        tabindex="0"
        title="끌어서 높이 조절 (더블클릭: 자동)"
        onpointerdown={onComposeResizeDown}
        onpointermove={onComposeResizeMove}
        onpointerup={onComposeResizeUp}
        onpointercancel={onComposeResizeUp}
        onkeydown={onComposeResizeKey}
        ondblclick={resetComposePct}
      ></div>

      <div
        class="chat-compose-group"
        class:chat-compose-group--sized={composePct !== null}
        style:--compose-pct={composePct ?? undefined}
        style:--compose-min="{COMPOSE_MIN_PX}px"
        bind:this={composeEl}
      >
      <div class="chat-input-wrap">
        <ChatInput
          isAdmin={true}
          placeholder={isUploading ? '업로드 중...' : '관리자 답변을 입력하세요...'}
          disabled={isSending || isUploading}
          onsend={handleSend}
          onattach={handleAdminAttach}
          onproductmention={handleProductMention}
          oncoupongift={handleCouponGift}
          targetUserId={selectedUserId}
        />
      </div>

      <!-- CS-A1: 상담 메모 카드 — 목록(최신순, 메모별 삭제) + 입력 한 행. 단문 100자 이내 무한 등록 -->
      <div class="cs-record-section">
        <!-- 목록 스크롤 영역 — 년월일시는 saved-at 폰트, 메모 내용은 label 폰트 토큰 -->
        <div class="cs-record-list" role="list" aria-label="상담 메모 목록">
          {#each csRecords as rec (rec.id)}
            <div class="cs-record-item" role="listitem">
              <span class="cs-record-saved-at">{formatDateTime(rec.created_at)}</span>
              {#if rec.created_by_label}<span class="cs-record-saved-at cs-record-by">{rec.created_by_label}</span>{/if}
              {#if editingMemoId === rec.id}
                <input
                  class="cs-record-edit"
                  type="text"
                  bind:this={memoEditEl}
                  bind:value={editMemoDraft}
                  maxlength={CS_MEMO_MAX * 2}
                  aria-label="상담 메모 수정"
                  onkeydown={onEditMemoKeydown}
                  onblur={() => commitEditMemo(rec)}
                />
              {:else}
                <button type="button" class="cs-record-text cs-record-text-btn" title="눌러서 수정" aria-label={`상담 메모 수정: ${rec.summary ?? ''}`} onclick={() => startEditMemo(rec)}>{rec.summary}</button>
              {/if}
              {#if memoEditStatus?.id === rec.id}<span class="cs-record-status" role="status">{memoEditStatus.text}</span>{/if}
              <button
                type="button"
                class="act-btn act-del cs-record-item-del"
                class:act-del--confirming={csMemoDelete.pendingKey === `item:${rec.id}`}
                onclick={() => handleDeleteCsRecord(rec.id)}
                disabled={csMemoDelete.busyKey !== null || (memoEditStatus?.id === rec.id && memoEditStatus.text === '저장 중…')}
                aria-label="상담 메모 삭제"
                title={csMemoDelete.pendingKey === `item:${rec.id}` ? '한 번 더 누르면 삭제됩니다' : '상담 메모 삭제'}
              >
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 3h8M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M3 3l.5 7a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9L9 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              </button>
            </div>
          {:else}
            <p class="cs-record-empty">등록된 상담 메모가 없습니다. 아래 입력란에 메모를 남기세요.</p>
          {/each}
        </div>

        <!-- 메모 입력 — 목록 아래 한 행: 입력란 + 저장(우측 끝). 항상 노출되어 바로 입력할 수 있다 -->
        <div class="cs-record-compose">
          <textarea
            class="cs-record-textarea"
            placeholder="단문 메모를 남기세요 (100자 이내)…"
            rows={2}
            maxlength={CS_MEMO_MAX}
            bind:value={csSummaryDraft}
            disabled={isSavingCsRecord}
            aria-label="상담 메모 입력"
          ></textarea>
          <button
            type="button"
            class="cs-record-save"
            onclick={handleSaveCsRecord}
            disabled={isSavingCsRecord || !csSummaryDraft.trim()}
            aria-label="상담 메모 저장"
          >{isSavingCsRecord ? '저장 중' : '저장'}</button>
        </div>
      </div>
      </div>
      </div>
    {/if}
  </section>
</div>

<!-- 완전 삭제 확인 토스트 -->
{#if pendingDeleteId}
  <div
    class="toast-backdrop"
    role="presentation"
    onclick={handleDeleteCancel}
    onkeydown={(e) => { if (e.key === 'Escape') handleDeleteCancel() }}
  >
    <div
      class="confirm-toast"
      role="alertdialog"
      aria-modal="true"
      aria-label="채팅 완전 삭제 확인"
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') handleDeleteCancel() }}
    >
      <p class="toast-msg">완전히 삭제합니까?</p>
      <p class="toast-sub">삭제된 대화 내역은 복구할 수 없습니다.</p>
      <div class="toast-actions">
        <button class="toast-cancel" onclick={handleDeleteCancel} disabled={isDeleting}>취소</button>
        <button class="toast-confirm" onclick={handleDeleteConfirm} disabled={isDeleting}>
          {#if isDeleting}삭제 중...{:else}확인{/if}
        </button>
      </div>
    </div>
  </div>
{/if}

<!-- 대화카드 CTA 레이어 모달 — .admin-panel과 형제 위치(최상위)에서 렌더링해야
     position:fixed가 메시지 트리 조상에 갇히지 않는다(ui-mobile.md CSS transform +
     position:fixed 충돌 문서화된 패턴 준수) -->
{#if ctaModalKind === 'contract-preview' && ctaModalContractId}
  <!-- ContractTemplatePreviewModal 자체가 독립적인 전체화면 모달(자체 backdrop)이라 우리
       .cta-modal 틀 안에 얹지 않고 그대로 최상위에서 렌더링한다 -->
  <ContractTemplatePreviewModal
    contractId={ctaModalContractId}
    reservationId={ctaModalContractReservationId ?? 0}
    viewOnly={true}
    onclose={closeCtaModal}
    onsent={() => {}}
  />
{:else if ctaModalOpen}
  <div class="cta-modal-backdrop" role="presentation" onclick={closeCtaModal}>
    <div
      class="cta-modal"
      role="dialog"
      aria-modal="true"
      aria-label={ctaModalTitle}
      tabindex="-1"
      onclick={(e) => e.stopPropagation()}
      onkeydown={(e) => { if (e.key === 'Escape') closeCtaModal() }}
    >
      <!-- 관리자 모달은 고객용 프론트 화면(GNB·푸터가 있는 전체 페이지)이나 CMS 목록 페이지
           전체(목록·필터·GNB)를 절대 보여주지 않는다 — 카드 타입별로 필요한 컴포넌트만 직접
           마운트한다. RentalDetailPanel/PcInquiryPanel은 자체 헤더/닫기 UI가 있어 로딩/빈
           상태가 아닌 한 별도 타이틀바를 덧씌우지 않는다. -->
      {#if ctaModalLoading}
        <div class="cta-modal-titlebar">
          <span class="cta-modal-title">{ctaModalTitle}</span>
          <button class="close-btn" type="button" aria-label="닫기" onclick={closeCtaModal}>✕</button>
        </div>
        <div class="cta-modal-empty">불러오는 중...</div>
      {:else if ctaModalKind === 'reservation' && ctaModalRow}
        <div class="cta-modal-panel-wrap">
          <RentalDetailPanel
            row={ctaModalRow}
            onclose={closeCtaModal}
            onrefresh={refetchCtaModalRow}
            isRentalView={ctaModalRow.status !== 'hold'}
            initialTab={ctaModalInitialTab}
          />
        </div>
      {:else if ctaModalKind === 'inquiry'}
        <div class="cta-modal-inquiry-wrap">
          <PcInquiryPanel inquiries={ctaModalInquiries} onback={closeCtaModal} />
        </div>
      {:else if ctaModalKind === 'inquiry-reply-form'}
        <div class="cta-modal-panel-wrap">
          <InquiryReplyForm post={ctaModalPost} onSubmitted={refetchCtaModalPost} />
        </div>
      {:else if ctaModalKind === 'coupon'}
        <div class="cta-modal-inquiry-wrap">
          <CouponTabContent coupons={ctaModalCoupons} />
        </div>
      {:else}
        <div class="cta-modal-titlebar">
          <span class="cta-modal-title">{ctaModalTitle}</span>
          <button class="close-btn" type="button" aria-label="닫기" onclick={closeCtaModal}>✕</button>
        </div>
        <div class="cta-modal-empty">이 카드는 CMS에서 바로 볼 수 있는 관리 화면이 없습니다.</div>
      {/if}
      <div class="cta-modal-footer">
        <button class="cta-modal-menu-btn" type="button" disabled={!ctaModalMenuUrl} onclick={goToCtaMenu}>메뉴 가기</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .admin-panel {
    display: flex;
    height: 100%;
    overflow: hidden;
    background: var(--cs-lilac);
  }

  /* ── 세션 목록 사이드 ── */
  .sessions-pane {
    width: 405px;
    flex-shrink: 0;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    display: flex;
    flex-direction: column;
    overflow: hidden;
    margin: 16px 0 16px 16px;
  }

  .sessions-header {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px 16px 12px;
    flex-shrink: 0;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg) var(--cms-radius-lg) 0 0;
    position: relative;
  }

  .pane-title {
    font: var(--text-m-title-18B);
    color: var(--cs-dark);
    margin: 0;
  }

  /* 크레이지챗 · 빠른답변 ON/OFF 상태 pill */
  .ar-pill {
    position: absolute;
    left: 50%;
    transform: translateX(-50%);
    height: 22px;
    padding: 0 10px;
    border-radius: var(--radius-full, 99px);
    font: 700 10px/22px 'Noto Sans KR', sans-serif;
    background: var(--cs-surface-gray, #f6f6f6);
    color: var(--cs-text-light, #aaa);
    text-decoration: none;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .ar-pill--on {
    background: var(--cs-purple-op10);
    color: var(--cs-purple);
  }
  .ar-pill:hover { opacity: 0.8; }

  .refresh-btn {
    position: absolute;
    right: 12px;
    background: transparent;
    border: none;
    font-size: 18px;
    color: var(--cs-text-mid);
    cursor: pointer;
    padding: 4px 8px;
    border-radius: var(--radius-sm);
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: color 0.15s;
  }
  .refresh-btn:hover { color: var(--cs-dark); }

  .filter-tabs {
    display: flex;
    padding: 0 12px;
    gap: 4px;
    flex-shrink: 0;
    background: var(--cs-white);
    margin: 20px 0;
  }

  .filter-tab {
    flex: 1;
    background: transparent;
    border: none;
    border-bottom: 2px solid transparent;
    padding: 10px 4px;
    font: var(--text-pc-title-16);
    color: var(--cs-text-mid);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 44px;
    transition: color 0.15s, border-color 0.15s;
  }
  .filter-tab.active {
    color: var(--cs-purple);
    border-bottom-color: var(--cs-purple);
    font-weight: 700;
    background: var(--cs-lilac);
    border-radius: var(--radius-sm);
  }

  .tab-count {
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 700;
    width: 20px;
    height: 20px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .tab-count.count-open { background: var(--cs-red-badge); color: var(--cs-white); opacity: 0.85; }
  .tab-count.count-etc  { background: var(--cs-lilac); color: var(--cs-purple); }

  .session-list {
    flex: 1;
    overflow-y: auto;
    padding: 18px 16px 20px;
    list-style: none;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 12px;
    background: var(--cs-white);
    border-radius: 0 0 var(--cms-radius-lg) var(--cms-radius-lg);
  }

  .empty-sessions {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-m-script-14);
    color: var(--cs-text-light);
  }

  .session-card {
    width: 100%;
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--cms-radius-md);
    padding: 12px 50px 12px 14px;
    cursor: pointer;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: background 0.15s;
    min-height: 64px;
    position: relative;
  }
  .session-card:hover    { background: var(--cs-lilac); }
  .session-card.selected { background: var(--cs-lilac); }
  .session-card.flash    { animation: session-card-flash 0.6s ease-in-out 3; }

  /* "빠른문의" 리마인더 카드 — 가장 옅은 레드 토큰(red-5%)으로 일반 세션카드와 구분.
     일반 세션카드(3행: 이름/미리보기/시각, min-height 64px)보다 단순한 1행 구성으로
     세로폭을 절반 수준(min-height 32px)으로 축소(2026-09-02, Stephen 확정 — 이름 제거,
     "빠른문의 답변등록 —" 중복 문구 대신 배지 UI로 대체). */
  .inquiry-reminder-card {
    flex-direction: row;
    align-items: center;
    gap: 8px;
    min-height: 32px;
    padding: 8px 50px 8px 14px;
    background: var(--cs-red-xlight);
  }
  .inquiry-reminder-card:hover { background: var(--cs-red-light); }

  .inquiry-badge {
    flex-shrink: 0;
    background: var(--cs-red-badge);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    line-height: 1.5;
    padding: 1px 7px;
    border-radius: var(--radius-full);
  }
  .inquiry-title {
    flex: 1;
    min-width: 0;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .inquiry-time {
    flex-shrink: 0;
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
  }

  /* 크레이지챗 접수 요청 카드(2026-10-07, S3) — cms bds: 배경·배지는 --cs-* 토큰, 버튼은 §0-10-C 초소형 라운드 버튼형(border/outline/shadow 없음, 호버는 BG·글자색 반전만) */
  .agent-request-card {
    flex-direction: column;
    align-items: stretch;
    gap: 6px;
    padding: 10px 14px;
    background: var(--cs-purple-op10);
  }
  .agent-request-card:hover { background: var(--cs-lilac); }
  .agent-request-top,
  .agent-request-meta,
  .agent-request-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .agent-request-actions { justify-content: flex-end; }
  .agent-request-badge {
    flex-shrink: 0;
    background: var(--cs-purple);
    color: var(--cs-white);
    font-size: 10px;
    font-weight: 700;
    line-height: 1.5;
    padding: 1px 7px;
    border-radius: var(--radius-full);
  }
  .agent-request-kind {
    flex: 1;
    min-width: 0;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent-request-who {
    flex: 1;
    min-width: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .agent-request-stage {
    flex-shrink: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-purple);
  }
  .agent-request-stage.closed { color: var(--cs-red-badge); }
  .btn-agent-small {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    padding: 5px 10px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .btn-agent-small:hover:not(:disabled) {
    background: var(--cs-text-mid);
    color: var(--cs-white);
  }
  .btn-agent-small:disabled { opacity: 0.5; cursor: default; }

  @keyframes session-card-flash {
    0%, 100% {
      background-color: var(--cs-surface-gray);
      box-shadow: none;
    }
    50% {
      background-color: var(--cs-purple-pale);
      box-shadow: inset 3px 0 0 var(--cs-purple);
    }
  }

  .sc-top {
    display: flex;
    justify-content: flex-start;
    align-items: center;
    gap: 6px;
    min-height: 24px;
    padding-right: 28px;
  }

  .msg-dir-badge {
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .msg-dir-in  { background: var(--cs-chat-in-bg); }
  .msg-dir-out { background: var(--cs-surface-gray); }

  .close-session-btn {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--cs-text-light);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    border-radius: var(--radius-sm);
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, color 0.12s;
  }
  .close-session-btn:hover {
    background: var(--cs-red-badge);
    color: var(--cs-white);
  }
  .sc-name {
    font: var(--text-m-script-14B);
    color: var(--cs-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .sc-mid {
    display: flex;
    align-items: center;
  }
  .sc-last-msg {
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    width: 100%;
  }
  .sc-bottom {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .sc-time {
    font: var(--text-m-script-12);
    color: var(--cs-text-light);
    flex-shrink: 0;
  }
  /* 블랙리스트 경고 배지 — 긴급 배지와 구분되는 연한 레드 면(CustomerDetailPanel .badge-danger와 같은 색 언어) */
  .blacklist-badge {
    background: var(--cs-red-xlight);
    color: var(--cs-red-badge);
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    flex-shrink: 0;
    line-height: 1.5;
  }
  .urgent-badge {
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border-radius: var(--radius-full);
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    flex-shrink: 0;
    line-height: 1.5;
  }

  .unread-badge {
    background: var(--cs-red-badge);
    color: var(--cs-white);
    border-radius: var(--radius-full);
    font-size: 11px;
    font-weight: 700;
    padding: 1px 7px;
    min-width: 20px;
    text-align: center;
  }

  /* ── 대화창 ── */
  .chat-pane {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    background: var(--cs-white);
    margin: 16px;
    border-radius: var(--cms-radius-lg);
  }

  .no-session {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 16px;
  }
  .no-session-icon {
    display: block;
    opacity: 0.85;
  }
  .no-session-text {
    font: var(--text-m-body-16L);
    color: var(--cs-text-light);
    margin: 0;
  }

  .chat-header {
    padding: 20px 24px 16px;
    display: flex;
    align-items: center;
    gap: 30px;
    flex-shrink: 0;
    background: var(--cs-purple-op10);
  }

  /* 아바타+식별정보 그룹 카드 — chat-header 배경(--cs-purple-op10, purple-10%)과 구분되면서도
     아주 옅게만 우측 header-toolbar 버튼군과 분리(2026-09-28). --cs-purple-pale(20%) 원색은
     너무 진해 rgba(193,187,236, alpha) — 같은 purple-pale 색상을 희석한 값으로 조정
     (MessageBubble.svelte .system-msg span과 동일한 기존 패턴 재사용, 신규 하드코딩 아님).
     Stephen 피드백으로 0.4→0.25 재조정(더 옅게). 라운드값은 이 파일의 다른 카드형 요소
     (.session-card)와 동일한 --cms-radius-md(15px). */
  .chat-identity {
    display: flex;
    align-items: center;
    gap: 16px;
    flex: 1;
    min-width: 0;
    background: rgba(193, 187, 236, 0.25);
    border-radius: var(--cms-radius-md);
    padding: 10px 20px;
  }

  /* 48px 원형 아바타 — ChatHeader.svelte 고객용 아바타(65px)와 동일 패턴, CMS 헤더 밀도에 맞춰 축소 */
  .chat-avatar {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--cs-purple);
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .chat-avatar-initials {
    font: 700 16px/1 'Noto Sans KR', sans-serif;
    color: var(--cs-white);
    letter-spacing: -0.2px;
  }

  .chat-header-info {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-width: 0;
    flex: 1;
  }

  .chat-header-top {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .chat-user {
    font: var(--text-m-title-18B);
    color: var(--cs-dark);
  }

  /* ── 고객 기본정보 요약 ── */
  .customer-strip {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px;
  }

  .cs-item {
    font: var(--text-pc-script-12);
    color: var(--cs-text-mid);
  }

  .cs-email { color: var(--cs-text-mid); }

  .cs-code {
    font-weight: 700;
    color: var(--cs-purple);
    background: var(--cs-purple-op10);
    border-radius: 4px;
    padding: 2px 6px;
  }

  .chat-status {
    display: inline-block;
    font: var(--text-pc-descript-10);
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
    /* .chat-header-top(flex) 안에서 .chat-user 텍스트가 길어지면 이 배지가 flex-shrink 기본값(1)
       때문에 폭이 눌려 "진행중"이 두 줄로 쪼개지고 원형처럼 보이던 결함 수정(2026-09-28) —
       가로 라운드 pill을 텍스트 폭 그대로 고정 유지 */
    white-space: nowrap;
    flex-shrink: 0;
  }
  .chat-status.status-open    { background: var(--cs-bg-success); color: var(--cs-text-success); }
  .chat-status.status-pending { background: var(--cs-bg-warning); color: var(--cs-text-warning); }
  .chat-status.status-closed  { background: var(--cs-surface-gray); color: var(--cs-text-light); }

  .chat-messages {
    position: relative;
    flex: 1;
    overflow: hidden;
    display: flex;
    flex-direction: column;
    min-height: 0;
    /* 고객 정보 영역(오른쪽)의 비율 — 두 영역 합 100% 중 30%~70%(스크립트에서 제한). 값은 소수 없는 숫자(퍼센트) */
    --info-pct: 36;
    /* 우측에 겹쳐지는 customer-info-float에 메시지 말풍선이 가려지지 않도록
       메시지 영역 자체의 가용 폭을 그만큼 미리 줄여둠(고정 300px → 조절 가능한 비율) */
    padding-right: calc(var(--info-pct) * 1%);
    /* 대화 영역(패딩을 뺀 안쪽 폭)을 기준으로 말풍선·여백이 폭에 맞게 유연하게 바뀌도록 컨테이너로 지정 */
    container-type: inline-size;
    container-name: chatmsg;
  }
  .chat-messages--resizing { user-select: none; cursor: col-resize; }

  /* 우측 플로팅 고객 정보(읽기전용) — 별도 3분할 컬럼이 아니라 대화 목록 영역 내부
     우측에 겹쳐 노출되는 오버레이 카드. chat-messages 밖(입력창·상담메모 영역)까지는
     넘어가지 않도록 chat-messages 안에서만 absolute 배치 */
  .customer-info-float {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: calc(var(--info-pct) * 1%);
    overflow-y: auto;
    background: var(--cs-white);
    border-left: 1px solid rgba(16, 11, 50, 0.08);
    box-shadow: -4px 0 16px rgba(16, 11, 50, 0.06);
    z-index: 5;
    /* 고객 정보 패널 내용(CustomerDetailPanel)이 이 영역 폭에 맞게 바뀌도록 컨테이너로 지정 */
    container-type: inline-size;
    container-name: cinfo;
  }

  /* 가로폭 조절 손잡이 — 고객 정보 영역 왼쪽 경계 바로 안쪽에 놓는다. 호버·끌기는 배경색만 변경 */
  .info-resizer {
    position: absolute;
    top: 0;
    bottom: 0;
    /* 경계 오른쪽(고객 정보 영역 안쪽)으로 치우쳐 배치 — 대화 목록 오른쪽 끝의 스크롤바를 가리지 않도록 */
    right: calc(var(--info-pct) * 1% - 24px);
    width: 24px; /* 경계에서 오른쪽으로 24px — 막대(4px)는 그 가운데(경계에서 약 12px)에 놓여 경계선과 여백을 둔다 */
    z-index: 6;
    cursor: col-resize;
    touch-action: none;
    display: flex;
    align-items: center;
    justify-content: center;
    outline: none;
  }
  .info-resizer::before {
    content: '';
    width: 2.8px; /* 두께 2.8px(Stephen 지정, 기존 4px) — 덜 두드러지게 */
    height: 40px;
    margin-right: 4px; /* 막대를 경계 쪽으로 약 2px 이동(경계선과의 여백을 조금 줄임) */
    border-radius: var(--radius-full);
    background: var(--cs-purple-op10); /* 평소엔 더 옅게(2026-10-20), 호버·끌기에서만 진하게 */
    transition: background 0.15s;
  }
  .info-resizer:hover::before,
  .info-resizer:focus-visible::before,
  .info-resizer--active::before { background: var(--cs-purple-pale); }

  /* 대화 영역이 좁아지면(안쪽 폭 약 360px 이하) 말풍선의 바깥 여백·안쪽 여백을 줄여 글자 폭을 확보한다 */
  @container chatmsg (max-width: 360px) {
    .chat-messages :global(.message-list) { padding: 12px; }
    .chat-messages :global(.bubble-row) { padding-right: 16px; }
    .chat-messages :global(.bubble-row--own) { padding-right: 0; padding-left: 16px; }
    .chat-messages :global(.bubble) { padding: 11px 14px; }
  }

  .loading-msgs {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-m-script-14);
    color: var(--cs-text-light);
  }

  /* 위아래 높이 조절 영역 — 대화 영역(.chat-messages) + 손잡이 + 하단 작성 그룹. 이 영역의 높이가 100% */
  .chat-split {
    flex: 1;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .chat-split--resizing { user-select: none; cursor: row-resize; }

  /* 위아래 높이 조절 손잡이 — 하단 작성 그룹의 윗부분(위쪽 패딩 16px 안)에 들여 놓는다(2026-10-20, 옅은 퍼플 면 위라 막대가 또렷하게 보이고 대화 영역 끝에 잘려 보이지 않음).
     음수 아래 마진으로 그룹 위에 겹쳐 영역 크기를 바꾸지 않으며, 그룹 내용(입력창)은 패딩 아래에서 시작해 클릭을 가로채지 않는다. 호버·끌기는 배경색만 변경 */
  .compose-resizer {
    position: relative;
    z-index: 6;
    flex-shrink: 0;
    height: 16px;
    margin: 0 0 -16px;
    cursor: row-resize;
    touch-action: none;
    display: flex;
    align-items: center;
    justify-content: center;
    outline: none;
  }
  .compose-resizer::before {
    content: '';
    width: 40px;
    height: 2.8px; /* 두께 2.8px(Stephen 지정, 기존 4px) */
    border-radius: var(--radius-full);
    background: var(--cs-purple-op10); /* 평소엔 더 옅게(2026-10-20), 호버·끌기에서만 진하게 */
    transition: background 0.15s;
  }
  .compose-resizer:hover::before,
  .compose-resizer:focus-visible::before,
  .compose-resizer--active::before { background: var(--cs-purple-pale); }

  /* 비율 모드(사용자가 한 번이라도 조절한 뒤) — 하단 작성 그룹을 비율 높이로 고정하고, 모자라면 메모 목록이 줄어들며 스크롤된다.
     너무 낮은 화면에서는 내용 최소 높이(--compose-min)가 30%보다 우선한다 */
  .chat-compose-group--sized {
    flex: 0 0 calc(var(--compose-pct) * 1%);
    min-height: var(--compose-min);
    /* ⚠️ overflow:hidden 금지 — 입력창 위로 뜨는 팝업(상품검색·빠른답변·쿠폰·첨부, position:absolute bottom:100%)이 잘린다(QA MAJOR-1). 메모 목록이 min-height:0으로 줄어들어 넘침을 흡수한다 */
  }
  .chat-compose-group--sized .chat-input-wrap { flex-shrink: 0; }
  .chat-compose-group--sized .cs-record-section {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
  }
  .chat-compose-group--sized .cs-record-list { flex: 1 1 auto; min-height: 0; max-height: none; }
  .chat-compose-group--sized .cs-record-compose { flex-shrink: 0; }

  /* 하단 작성 그룹 — 답변 입력창 + 상담 메모. 좌우 24px·위 28px·아래 16px 여백과 두 블록 사이 간격(12px)을 여기서만 정한다 */
  .chat-compose-group {
    flex-shrink: 0;
    /* 가장 옅은 퍼플 면(기존 답변 입력창 배경이던 값, cms-uiux.md 허용 범위 0.04~0.12 중 최저값) — 안쪽 답변 입력창은 흰색 */
    background: rgba(59, 47, 138, 0.04);
    display: flex;
    flex-direction: column;
    gap: var(--spacing-3);
    /* 위쪽 28px = 높이 조절 손잡이(16px) + 손잡이와 입력창 사이 여백 12px(분리감) */
    padding: 28px 24px 16px;
  }
  .chat-input-wrap {
    flex-shrink: 0;
  }

  /* ── CS-A1 상담 메모 섹션 ── */
  /* 상담 메모 영역 전체 = 카드 하나 — 연한 회색 면(--cs-surface-gray) + 카드 반경 '중' 20px(cms-uiux 라운드값 정책), 안쪽 메모는 흰 카드 */
  .cs-record-section {
    /* 바깥 여백·입력창과의 간격은 .chat-compose-group이 담당 */
    padding: 14px 16px;
    flex-shrink: 0;
    border-radius: var(--radius-lg);
    background: var(--cs-surface-gray);
  }



  .cs-record-saved-at {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }



  .cs-record-textarea {
    width: 100%;
    resize: none;
    border: none;
    /* uiux-index.md CMS 카드 라운드값 "중" = 20px(var(--radius-lg)) */
    border-radius: var(--radius-lg);
    /* 세로 58px = 메모 목록 2행(행 24px ×2 + 간격 10px) 높이 — 2행 입력이 보이도록 위아래 패딩만 줄임(2026-10-20 Stephen 지시) */
    padding: 8px 16px;
    height: 58px; /* 글자가 작아져도 입력칸 높이는 그대로(2행 목록 높이) */
    /* 입력 중 글자 = 한 단계 작은 토큰(14px → --text-pc-script-12 12px). 입력 글자는 기존 굵기(Bold) 유지, 안내 문구는 아래 ::placeholder가 400 */
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
    /* 가장 옅은 퍼플 bg 토큰(cms-uiux.md 허용 범위 0.04~0.12 중 최저값) */
    background: rgba(59, 47, 138, 0.04);
    outline: none;
    line-height: 1.5;
    transition: background 0.15s;
    box-sizing: border-box;
  }
  /* 입력 중(포커스) — 흰 면 + 퍼플 아웃라인(cms-uiux.md §7-7 입력 필드 포커스 표준) */
  .cs-record-textarea:focus {
    background: var(--cs-white);
    outline: 2px solid var(--cs-focus-ring);
    outline-offset: -2px;
  }
  .cs-record-textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }




  /* 메모 입력 — 목록 아래 한 행(입력란 + 글자수 + 저장), 저장은 우측 끝 */
  .cs-record-compose {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-top: 12px;
  }
  .cs-record-compose .cs-record-textarea { flex: 1; min-width: 0; width: auto; }
  /* 안내 문장(placeholder) — 옅은 텍스트 토큰 */
  .cs-record-textarea::placeholder { color: var(--cs-text-light); font-weight: 400; }
  /* 저장 — 초소형 라운드 버튼형(cms-uiux.md §0-10-C): pill·테두리 없음·11px/600·패딩 5px 10px.
     카드 배경(--cs-surface-gray)과 같은 색이 되지 않도록 기본 면만 흰색(--cs-white)으로 둔다 — hover 반전은 표준 그대로 */
  .cs-record-save {
    flex-shrink: 0;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.4;
    padding: 5px 10px;
    border: none;
    border-radius: var(--radius-full);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s;
  }
  .cs-record-save:hover:not(:disabled) { background: var(--cs-text-mid); color: var(--cs-white); }
  .cs-record-save:disabled { opacity: 0.5; cursor: default; }

  /* 메모 목록 — 영역 안에서 스크롤(약 3건 높이), 최신 메모가 맨 위 */
  .cs-record-list {
    max-height: 96px;  /* 행 24px + 간격 10px 기준 약 3행이 보이고 나머지는 스크롤 */
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  /* 메모 1건 = 배경 없는 단순 행(날짜 · 내용 · 삭제) */
  .cs-record-item {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .cs-record-item .cs-record-saved-at { flex-shrink: 0; white-space: pre; }
  /* 등록 관리자 아이디 — 년월일시와 같은 옅은 토큰, 길면 말줄임 */
  .cs-record-item .cs-record-by { max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  /* 메모 내용 폰트 토큰(12px/700/text-mid) */
  .cs-record-text {
    flex: 1;
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
    min-width: 0;
    overflow-wrap: anywhere;
  }
  /* 메모별 삭제 — 목록 행 우측 끝, 행 높이를 키우지 않게 작게 */
  .cs-record-item .cs-record-item-del { flex-shrink: 0; align-self: center; height: 24px; padding: 0 6px; }
  .cs-record-empty { margin: 0; font: var(--text-pc-script-12); color: var(--cs-text-light); }
  /* 메모 글자 = 눌러서 바로 수정(버튼 모양 없이 글자처럼 보이고, 호버는 배경색만) */
  .cs-record-text-btn {
    border: none;
    background: transparent;
    padding: 2px 6px;
    margin: -2px -6px;
    border-radius: var(--radius-sm);
    text-align: left;
    cursor: text;
    transition: background 0.15s;
  }
  .cs-record-text-btn:hover { background: var(--cs-white); }
  /* 수정 중 입력칸 — 활성 BG(white), 글자 토큰은 메모 글자와 동일 */
  .cs-record-edit {
    flex: 1;
    min-width: 0;
    height: 24px;
    padding: 0 8px;
    border: none;
    outline: none;
    border-radius: var(--radius-sm);
    background: var(--cs-white);
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text);
  }
  /* 저장 결과 상태 글자(저장 중… / 자동 저장됨 / 저장 실패) — 저장 버튼·토스트 없이 행 옆에 */
  .cs-record-status {
    flex-shrink: 0;
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
    white-space: nowrap;
  }

  /* CMS 표준 아이콘형 액션 버튼(act-del) 공통 베이스 — project_cms_delete_button_standard 준수 */
  .act-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 28px;
    border: none;
    border-radius: var(--radius-sm);
    background: transparent;
    cursor: pointer;
    transition: background 0.1s, color 0.1s;
    font: var(--text-pc-script-12);
    font-weight: 700;
    padding: 0 8px;
    color: var(--cs-text-light);
  }
  .act-btn:disabled { opacity: 0.4; cursor: not-allowed; }


  /* 삭제 아이콘 버튼 (act-del 표준 그대로) */
  .act-del:hover:not(:disabled) {
    background: rgba(255, 53, 53, 0.08);
    color: var(--cs-red-badge);
  }
  /* 1차 클릭 후 확인 대기 상태 — hover 없이도 경고색 유지 */
  .act-del--confirming {
    background: rgba(255, 53, 53, 0.08);
    color: var(--cs-red-badge);
  }

  /* ── 삭제 버튼 (close-session-btn과 동일 스타일) ── */
  .delete-session-btn {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    color: var(--cs-text-light);
    font-size: 11px;
    line-height: 1;
    cursor: pointer;
    border-radius: var(--radius-sm);
    min-height: 44px;
    min-width: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: background 0.12s, color 0.12s;
  }
  .delete-session-btn:hover {
    background: rgba(255,53,53,0.08);
    color: var(--cs-red-badge);
  }

  /* ── 완전 삭제 확인 토스트 ── */
  .toast-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(16, 11, 50, 0.35);
    display: flex;
    align-items: flex-end;
    justify-content: center;
    padding-bottom: 40px;
    z-index: 9000;
  }

  .confirm-toast {
    background: var(--cs-white);
    border-radius: var(--radius-xl);
    padding: 24px 28px 20px;
    width: min(360px, calc(100vw - 40px));
    box-shadow: 0 8px 32px rgba(16, 11, 50, 0.18);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .toast-msg {
    font: var(--text-m-body-16B);
    color: var(--cs-dark);
    margin: 0;
  }

  .toast-sub {
    font: var(--text-m-script-12);
    color: var(--cs-text-mid);
    margin: 0 0 8px;
  }

  .toast-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }

  .toast-cancel {
    background: var(--cs-surface-gray);
    border: none;
    border-radius: var(--radius-xl);
    padding: 10px 24px;
    font: var(--text-m-script-14B);
    color: var(--cs-text-mid);
    cursor: pointer;
    min-height: 44px;
    transition: background 0.12s;
  }
  .toast-cancel:hover:not(:disabled) { background: var(--cs-lilac); }

  .toast-confirm {
    background: var(--cs-red-badge);
    border: none;
    border-radius: var(--radius-xl);
    padding: 10px 24px;
    font: var(--text-m-script-14B);
    color: var(--cs-white);
    cursor: pointer;
    min-height: 44px;
    transition: opacity 0.12s;
  }
  .toast-confirm:hover:not(:disabled) { opacity: 0.85; }
  .toast-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
  .toast-cancel:disabled  { opacity: 0.5; cursor: not-allowed; }

  /* ── GSD-7/8/12: 헤더 툴바 ── */
  .header-toolbar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-shrink: 0;
    flex-wrap: wrap;
  }

  .toolbar-btn {
    height: 32px;
    padding: 0 12px;
    border: 1.5px solid var(--cs-lilac);
    border-radius: var(--radius-full, 99px);
    background: var(--cs-white);
    color: var(--cs-text-mid);
    font: var(--text-pc-script-12);
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, color 0.15s, border-color 0.15s;
    min-height: 32px;
  }
  .toolbar-btn:hover {
    background: var(--cs-lilac);
    color: var(--cs-purple);
    border-color: var(--cs-purple-op10);
  }
  .toolbar-btn--active {
    background: var(--cs-purple);
    color: var(--cs-white);
    border-color: var(--cs-purple);
  }
  .toolbar-btn--active:hover {
    background: var(--cs-purple-dark, #2e2470);
    color: var(--cs-white);
    border-color: var(--cs-purple-dark, #2e2470);
  }
  .toolbar-btn--status {
    background: var(--cs-surface-gray);
    border-color: transparent;
    color: var(--cs-text-mid);
  }
  .toolbar-btn--status:hover {
    background: var(--cs-lilac);
    color: var(--cs-purple);
    border-color: transparent;
  }

  /* ── GSD-12: 북마크 패인 ── */
  .bookmark-pane {
    flex-shrink: 0;
    max-height: 320px;
    overflow-y: auto;
    border-bottom: 1px solid rgba(16, 11, 50, 0.06);
    background: var(--cs-surface-gray);
  }

  /* ── 대화카드 CTA 레이어 모달 — CMS 표준 디자인 토큰 준수 ── */
  .cta-modal-backdrop {
    position: fixed;
    inset: 0;
    z-index: 300;
    background: rgba(16,11,50,0.45);
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* 크기 1024×768 고정, 화면 중앙 배치, "대(large)" 라운드값 30px(--cms-radius-lg).
     RentalDetailPanel을 컴포넌트로 직접 마운트하므로(iframe 아님) 세로 flex 스택으로 구성 —
     RentalDetailPanel 자신이 이미 헤더(예약코드·상태 배지)+닫기 버튼을 갖고 있어 별도 타이틀바를
     덧씌우지 않는다(로딩/빈 상태일 때만 안내용 타이틀바 표시). */
  .cta-modal {
    display: flex;
    flex-direction: column;
    width: 1024px;
    height: 768px;
    max-width: 96vw;
    max-height: 90vh;
    background: var(--cs-white);
    border-radius: var(--cms-radius-lg);
    overflow: hidden;
    box-shadow: 0px 1px 4px rgba(0,0,0,0.06);
  }

  /* RentalDetailPanel이 없는 로딩/빈 상태 전용 타이틀바 — BG 화이트 70% 불투명도 */
  .cta-modal-titlebar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    background: rgba(255,255,255,0.7);
    border-bottom: 1px solid var(--cs-lilac);
  }

  .cta-modal-title {
    font: var(--text-pc-title-16);
    font-weight: 700;
    color: var(--cs-text);
  }

  /* close-red 표준(cms-uiux.md §0-10-A) */
  .close-btn {
    margin-left: auto;
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    min-height: 28px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    border-radius: var(--radius-sm);
    color: var(--cs-text-light);
    font-size: 14px;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;
  }
  .close-btn:hover { background: rgba(255,53,53,0.08); color: var(--cs-red-badge); }

  /* RentalDetailPanel 마운트 래퍼 — flex:1로 남은 공간을 채워야 RentalDetailPanel 자신의
     height:100%가 정상 해석됨(퍼센트 높이는 조상에 확정된 높이가 있어야 함) */
  .cta-modal-panel-wrap {
    flex: 1;
    min-height: 0;
  }

  /* PcInquiryPanel 마운트 래퍼 — RentalDetailPanel과 달리 자체 height:100%/내부 스크롤이
     없는 컴포넌트라 여기서 여백·스크롤을 직접 부여 */
  .cta-modal-inquiry-wrap {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 24px;
  }

  /* 하단 — 우측 "메뉴 가기" 버튼, BG 화이트 70% 불투명도 */
  .cta-modal-footer {
    flex-shrink: 0;
    display: flex;
    justify-content: flex-end;
    padding: 12px 20px;
    background: rgba(255,255,255,0.7);
    border-top: 1px solid var(--cs-lilac);
  }

  /* CMS 표준 CTA 버튼(.btn-primary/.cta-btn) 스펙 반영: height 44px, radius-md 15px */
  .cta-modal-menu-btn {
    display: inline-flex;
    align-items: center;
    height: 44px;
    padding: 0 30px;
    background: var(--cs-purple);
    color: var(--cs-white);
    border: none;
    border-radius: var(--radius-md);
    font: var(--text-pc-body-14);
    font-weight: 700;
    letter-spacing: -0.5px;
    cursor: pointer;
    transition: background 0.12s;
  }
  .cta-modal-menu-btn:hover:not(:disabled) { background: var(--cs-purple-hover); }
  .cta-modal-menu-btn:disabled { background: var(--cs-disabled-button, var(--cs-text-light)); cursor: not-allowed; }

  /* 로딩 중 / CMS 화면을 만들 수 없을 때(예약 컨텍스트 없는 카드 등) 안내 문구 */
  .cta-modal-empty {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 40px;
    text-align: center;
    font: var(--text-pc-body-14);
    color: var(--cs-text-mid);
  }
</style>
