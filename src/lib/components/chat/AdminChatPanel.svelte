<script lang="ts">
  // CMS 관리자 채팅 패널
  // 좌측: 세션 목록 / 우측: 선택된 세션 대화창

  import { goto } from '$app/navigation'
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
      identity_type: string | null
      identity_verified_at: string | null
      identity_doc_url: string | null
      foreign_verified_at: string | null
      foreign_doc_url: string | null
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
    valid_until: string
  }

  interface Props {
    initialSessions?: ChatSession[]
    initialSessionId?: string | null
  }

  let { initialSessions = [], initialSessionId = null }: Props = $props()

  // 자동답변 상태 표시 pill (sessions-header)
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

  // 답변등록(add_cs_reply)은 status를 open→in_progress/resolved로 항상 바꾸므로(Migration 157),
  // 다음 조회 시점부터 이 카드는 자동으로 목록에서 빠진다 — 별도의 "대기/종료" 이동 UI는 없음
  // (2026-09-02, Stephen 확정: 처리되면 그냥 사라지면 됨). 30초 주기로 이 사실을 실제 반영한다.
  $effect(() => {
    const timer = setInterval(() => { loadPendingInquiries() }, 30 * 1000)
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

  // CS-A1: CS 상담기록 상태
  let csRecord = $state<CsRecord | null>(null)
  let csSummaryDraft = $state('')
  let isSavingCsRecord = $state(false)
  let csSaveResult = $state<'saved' | 'error' | null>(null)
  let isDeletingCsRecord = $state(false)
  let csDeleteConfirming = $state(false)

  // GSD-5: 고객 상세정보 패널
  let customerDetail = $state<CustomerDetailData | null>(null)
  let customerDetailLoading = $state(false)

  // GSD-12: 북마크 뷰 토글
  let showBookmarks = $state(false)

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

  // GSD-8: 세션별 자동응답 수동전환
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
    })
    return unsub
  })

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
      : messages.filter((m) => m.sender_type !== 'ai' || m.message_type === 'action_card')
  )

  // 고객 기본정보 요약 (chat-header 노출용) — 선택된 세션의 user_id가 바뀔 때만 재조회
  let customerSummary = $state<CustomerSummary | null>(null)
  $effect(() => {
    const uid = selectedUserId
    if (!uid) { customerSummary = null; return }
    customerSummary = null
    fetch(`/api/cms/customers/${uid}/summary`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: CustomerSummary | null) => { customerSummary = d })
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

  async function handleSelectSession(sid: string): Promise<void> {
    selectedSessionId = sid
    // 세션 입장 API — admin_id 배정
    await fetch(`/api/chat/sessions/${sid}/join`, { method: 'POST' })
  }

  // CS-A1: 세션 선택 시 기존 CS 기록 로드
  $effect(() => {
    const sid = selectedSessionId
    if (!sid) {
      csRecord = null
      csSummaryDraft = ''
      csSaveResult = null
      csDeleteConfirming = false
      return
    }
    csRecord = null
    csSummaryDraft = ''
    csSaveResult = null
    csDeleteConfirming = false
    fetch(`/api/chat/sessions/${sid}/cs-record`)
      .then((r) => r.ok ? r.json() : null)
      .then((d: { record: CsRecord | null } | null) => {
        if (d?.record) {
          csRecord = d.record
          csSummaryDraft = d.record.summary ?? ''
        }
      })
      .catch(() => {})
  })

  async function handleSaveCsRecord(): Promise<void> {
    if (!selectedSessionId || isSavingCsRecord) return
    const trimmed = csSummaryDraft.trim()
    if (!trimmed) return
    isSavingCsRecord = true
    csSaveResult = null
    try {
      const res = await fetch(`/api/chat/sessions/${selectedSessionId}/cs-record`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary: trimmed, status: 'in_progress' }),
      })
      if (res.ok) {
        const { record } = await res.json()
        if (record) csRecord = record
        csSaveResult = 'saved'
        setTimeout(() => { csSaveResult = null }, 2500)
      } else {
        csSaveResult = 'error'
      }
    } finally {
      isSavingCsRecord = false
    }
  }

  // 2단계 확인 삭제(TASK-DELETE-TOAST 패턴과 동일) — 1차 클릭: 확인 상태로 전환 후 4초 뒤 자동 해제
  // 2차 클릭(확인 상태에서): 실제 삭제 실행
  async function handleDeleteCsRecord(): Promise<void> {
    if (!selectedSessionId || isDeletingCsRecord) return
    if (!csDeleteConfirming) {
      csDeleteConfirming = true
      setTimeout(() => { csDeleteConfirming = false }, 4000)
      return
    }
    csDeleteConfirming = false
    isDeletingCsRecord = true
    try {
      const res = await fetch(`/api/chat/sessions/${selectedSessionId}/cs-record`, {
        method: 'DELETE',
      })
      if (res.ok) {
        csRecord = null
        csSummaryDraft = ''
      }
    } finally {
      isDeletingCsRecord = false
    }
  }

  // GSD-12: 북마크 토글 — API 호출 + 로컬 메시지 배열 is_bookmarked 동기화
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
    }
  }

  // GSD-8: 세션 자동응답 수동/자동 전환
  async function handleToggleManualMode(): Promise<void> {
    if (!selectedSessionId) return
    const newVal = !sessionManualMode
    sessionManualMode = newVal
    await fetch(`/api/chat/sessions/${selectedSessionId}/manual-mode`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ manual_mode: newVal }),
    }).catch(() => {})
    // 로컬 스토어에 manual_mode 즉시 반영
    const updated = chatStore.sessions.find((s) => s.id === selectedSessionId)
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
      }
    } catch {
      // 실패 시 조용히 무시 — 새로고침으로 서버 상태와 동기화 가능
    }
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
      }
    } finally {
      isSending = false
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
      }
    } finally {
      isSending = false
    }
  }

  async function handleAdminAttach(file: File): Promise<void> {
    if (!selectedSessionId || isUploading) return
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
    const hh = d.getHours().toString().padStart(2, '0')
    const mi = d.getMinutes().toString().padStart(2, '0')
    return `${yyyy}.${mm}  ${hh}:${mi}`
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
          title="자동답변 설정 바로가기"
          aria-label="자동답변 {autoReplyEnabled ? 'ON' : 'OFF'} — QnA 설정으로 이동"
        >자동답변 {autoReplyEnabled ? 'ON' : 'OFF'}</a>
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
        {#if pendingInquiries.length === 0 || filterTab !== 'open'}
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
                <span class="sc-time">{formatDateTime(session.updated_at)}</span>
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

        <!-- GSD-7/8/12: 헤더 툴바 — 수동전환·중요카드·북마크·상태변경 -->
        <div class="header-toolbar">
          <!-- GSD-8: 자동응답 수동전환 토글 -->
          <button
            class="toolbar-btn"
            class:toolbar-btn--active={sessionManualMode}
            onclick={handleToggleManualMode}
            title={sessionManualMode ? '수동모드 ON — 자동응답 꺼짐' : '자동모드 — 클릭 시 수동전환'}
            aria-pressed={sessionManualMode}
          >{sessionManualMode ? '수동' : '자동'}</button>

          <!-- GSD-7: 중요 카드만 보기 -->
          <button
            class="toolbar-btn"
            class:toolbar-btn--active={showImportantOnly}
            onclick={() => { showImportantOnly = !showImportantOnly }}
            title={showImportantOnly ? '전체 메시지 보기' : '중요 카드만 보기'}
            aria-pressed={showImportantOnly}
          >중요</button>

          <!-- GSD-12: 북마크 목록 토글 -->
          <button
            class="toolbar-btn"
            class:toolbar-btn--active={showBookmarks}
            onclick={() => { showBookmarks = !showBookmarks }}
            title={showBookmarks ? '북마크 닫기' : '북마크 목록'}
            aria-pressed={showBookmarks}
          >북마크</button>

          <!-- GSD-1/2: 상태 세그먼트 컨트롤 -->
          {#if selectedSession?.status !== 'open'}
            <button
              class="toolbar-btn toolbar-btn--status"
              onclick={() => handleSessionStatusChange('open')}
              title="진행중으로 전환"
            >진행중 전환</button>
          {/if}
          {#if selectedSession?.status === 'open'}
            <button
              class="toolbar-btn toolbar-btn--status"
              onclick={() => handleSessionStatusChange('pending')}
              title="대기로 전환"
            >대기 전환</button>
          {/if}
        </div>

      </div>

      <!-- GSD-12: 북마크 목록 -->
      {#if showBookmarks}
        <div class="bookmark-pane">
          <BookmarkListView
            sessionId={selectedSessionId}
            onclose={() => { showBookmarks = false }}
          />
        </div>
      {/if}

      <div class="chat-messages">
        {#if isLoadingMessages}
          <div class="loading-msgs">메시지 로딩 중...</div>
        {:else}
          <MessageList
            messages={filteredMessages}
            currentUserId="admin"
            isAdmin={true}
            onbookmark={handleBookmark}
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
          />
        </div>
      </div>

      <div class="chat-input-wrap">
        <ChatInput
          isAdmin={true}
          placeholder={isUploading ? '업로드 중...' : '관리자 답변을 입력하세요...'}
          disabled={isSending || isUploading}
          onsend={handleSend}
          onattach={handleAdminAttach}
          onproductmention={handleProductMention}
          oncoupongift={handleCouponGift}
        />
      </div>

      <!-- CS-A1: 상담 요약 기록 -->
      <div class="cs-record-section">
        <div class="cs-record-header">
          <span class="cs-record-label">상담 메모</span>
          {#if csRecord?.updated_at}
            <span class="cs-record-saved-at">{formatDateTime(csRecord.updated_at)} 저장됨</span>
          {/if}
        </div>
        <div class="cs-record-input-row">
          <div class="cs-record-textarea-wrap">
            <textarea
              class="cs-record-textarea"
              placeholder="상담 요약 또는 메모를 남기세요…"
              rows={2}
              bind:value={csSummaryDraft}
              disabled={isSavingCsRecord}
              aria-label="상담 메모 입력"
            ></textarea>
            <div class="cs-record-actions">
              <button
                class="act-btn act-add"
                onclick={handleSaveCsRecord}
                disabled={isSavingCsRecord || !csSummaryDraft.trim()}
                aria-label="상담 메모 저장"
                title="상담 메모 저장"
              >
                {#if isSavingCsRecord}
                  <span class="act-add-status">저장 중</span>
                {:else if csSaveResult === 'saved'}
                  <span class="act-add-status">저장됨 ✓</span>
                {:else if csSaveResult === 'error'}
                  <span class="act-add-status act-add-status--error">오류</span>
                {:else}
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                    <path d="M6 1.5v9M1.5 6h9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                  </svg>
                {/if}
              </button>
            </div>
          </div>

          <!-- 삭제는 저장과 바로 붙어있으면 오클릭 위험이 커서(Stephen 지적) 메모 레이아웃
               바깥 우측으로 완전히 분리 배치 — 시각적 거리로 실수 방지 -->
          {#if csRecord}
            <button
              class="act-btn act-del cs-record-delete-outer"
              class:act-del--confirming={csDeleteConfirming}
              onclick={handleDeleteCsRecord}
              disabled={isDeletingCsRecord}
              aria-label={csDeleteConfirming ? '상담 메모 삭제 확인' : '상담 메모 삭제'}
              title={csDeleteConfirming ? '한 번 더 클릭하면 삭제됩니다' : '상담 메모 삭제'}
            >
              {#if csDeleteConfirming}
                <span class="act-del-confirm-label">확인</span>
              {:else}
                <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                  <path d="M2 3h8M4.5 3V2a.5.5 0 0 1 .5-.5h2a.5.5 0 0 1 .5.5v1M3 3l.5 7a1 1 0 0 0 1 .9h3a1 1 0 0 0 1-.9L9 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              {/if}
            </button>
          {/if}
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

  /* 자동답변 ON/OFF 상태 pill */
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
    font: var(--text-m-script-12);
    padding: 3px 10px;
    border-radius: var(--radius-full);
    background: var(--cs-surface-gray);
    color: var(--cs-text-mid);
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
    /* 우측에 겹쳐지는 customer-info-float(300px)에 메시지 말풍선이 가려지지 않도록
       메시지 영역 자체의 가용 폭을 그만큼 미리 줄여둠 */
    padding-right: 300px;
  }

  /* 우측 플로팅 고객 정보(읽기전용) — 별도 3분할 컬럼이 아니라 대화 목록 영역 내부
     우측에 겹쳐 노출되는 오버레이 카드. chat-messages 밖(입력창·상담메모 영역)까지는
     넘어가지 않도록 chat-messages 안에서만 absolute 배치 */
  .customer-info-float {
    position: absolute;
    top: 0;
    right: 0;
    bottom: 0;
    width: 300px;
    max-width: 40%;
    overflow-y: auto;
    background: var(--cs-white);
    border-left: 1px solid rgba(16, 11, 50, 0.08);
    box-shadow: -4px 0 16px rgba(16, 11, 50, 0.06);
    z-index: 5;
  }

  .loading-msgs {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    font: var(--text-m-script-14);
    color: var(--cs-text-light);
  }

  .chat-input-wrap {
    padding: 16px 24px 0;
    flex-shrink: 0;
  }

  /* ── CS-A1 상담 메모 섹션 ── */
  .cs-record-section {
    padding: 10px 24px 16px;
    flex-shrink: 0;
    /* 상단 경계선 대신 하단(불투명 흰색)에서 위로 갈수록 투명해지는 그라데이션으로 자연스럽게 구분 */
    background: linear-gradient(to top, var(--cs-white), transparent);
  }

  .cs-record-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 6px;
  }

  .cs-record-label {
    font: var(--text-pc-script-12);
    font-weight: 700;
    color: var(--cs-text-mid);
  }

  .cs-record-saved-at {
    font: var(--text-pc-script-12);
    color: var(--cs-text-light);
  }

  /* 저장(add)은 텍스트영역 내부, 삭제(del)는 오클릭 방지를 위해 레이아웃 바깥 우측으로 분리 —
     ChatInput.svelte의 .input-pill 패턴은 저장 버튼에만 적용 */
  .cs-record-input-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .cs-record-textarea-wrap {
    position: relative;
    flex: 1;
    min-width: 0;
  }

  .cs-record-textarea {
    width: 100%;
    resize: none;
    border: none;
    /* uiux-index.md CMS 카드 라운드값 "중" = 20px(var(--radius-lg)) */
    border-radius: var(--radius-lg);
    /* 상하좌 16px 통일(좌우 기준값으로 확장) — 우측만 저장 버튼 공간 확보용으로 40px 유지 */
    padding: 16px 40px 16px 16px;
    font: var(--text-pc-body-14);
    color: var(--cs-text);
    /* 가장 옅은 퍼플 bg 토큰(cms-uiux.md 허용 범위 0.04~0.12 중 최저값) */
    background: rgba(59, 47, 138, 0.04);
    outline: none;
    line-height: 1.5;
    transition: background 0.15s;
    box-sizing: border-box;
  }
  .cs-record-textarea:focus {
    background: var(--cs-white);
  }
  .cs-record-textarea:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  .cs-record-actions {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    display: flex;
    gap: 4px;
  }

  /* 삭제 버튼 — 저장 버튼과 시각적 거리를 벌려 오클릭 방지 */
  .cs-record-delete-outer {
    flex-shrink: 0;
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

  /* 저장 = '추가' 아이콘 버튼 (act-add) — act-del과 동일 베이스, 퍼플 계열 hover */
  .act-add:hover:not(:disabled) {
    background: rgba(59, 47, 138, 0.08);
    color: var(--cs-purple);
  }
  .act-add-status { white-space: nowrap; }
  .act-add-status--error { color: var(--cs-red-badge); }

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
  .act-del-confirm-label { white-space: nowrap; }

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
