// menuAccessMap.ts — 메뉴키 ↔ 서버 집행(requireMenuAccess) 대상 매핑표 (단일 출처, 1단계 1a 구조 + 제외 목록)
//
// 목적: "메뉴 권한 OFF는 데이터·동작까지 막는다"는 정책에서 ① 어떤 엔드포인트가 어느 메뉴를 따르는지를 한 곳에 기록하고
// ② 고객(front)이 쓰는 엔드포인트에 실수로 게이트가 걸리지 않도록 제외 목록을 코드로 고정한다(소스 스캔 테스트가 감시).
// 하위 단계(1b~1h)에서 MENU_GUARDED_ENDPOINTS를 채운다 — 1a에서는 구조만 두고 비워 둔다.
import { CMS_MENUS } from '$lib/constants/cmsMenus'

/** 1단계 대상 메뉴 키(파트너 기본 허용 메뉴 — Stephen 확정 2026-10-03) */
export const MENU_ACCESS_PHASE1_KEYS = [
  'consulting.chat',
  'consulting.qna',
  'rental.reservation',
  'rental.history',
  'products.list',
  'products.new',
  'customers.list',
] as const

export type MenuAccessPhase1Key = (typeof MENU_ACCESS_PHASE1_KEYS)[number]

/**
 * ⛔ 절대 게이트 금지 — 고객(front)이 쓰거나 고객·관리자 겸용인 채팅 엔드포인트 디렉터리.
 * 겸용 API는 1단계 제외(Stephen 확정 2026-10-03, 2단계 BACKLOG). 여기에 requireMenuAccess를 넣으면 고객 채팅·카드 동작이
 * 깨진다 — menuAccessMap.test.ts의 소스 스캔이 import 자체를 감시한다.
 */
export const MENU_GUARD_FORBIDDEN_ENDPOINT_DIRS: readonly string[] = [
  'src/routes/api/chat/message', // 고객 메시지 전송(고객용)
  'src/routes/api/chat/attachment', // 고객 첨부 업로드(고객용)
  'src/routes/api/chat/close', // 고객 상담 종료(고객용)
  'src/routes/api/chat/return-method', // 고객 반납 방법 선택(고객용)
  'src/routes/api/chat/session', // 고객 상담 세션 생성·조회(고객용)
  'src/routes/api/chat/messages/[id]/execute-action', // 대화카드 실행 — 소유 고객·CMS 겸용 (같은 messages 하위 bookmark는 CMS 전용이라 1b에서 게이트 대상)
  'src/routes/api/chat/sessions/[id]/reservation-card', // 고객 본인 세션의 예약 카드 조회(고객용 — sessions 하위 나머지는 CMS 전용이라 파일 단위로만 게이트할 것)
  'src/routes/api/chat/contract-status', // 대화카드 계약 상태 확인 — 고객·관리자 겸용
  'src/routes/api/chat/reservation-status', // 대화카드 예약 상태 확인 — 소유 고객 또는 CMS 허용(겸용)
  'src/routes/api/chat/shipment-tracking', // 대화카드 운송장 확인 — 고객·관리자 겸용
]

export type MenuAccessPhase = '1b' | '1c' | '1d' | '1e' | '1g' | '1h' | '2-A' | '2-B' | '2-C' | '2-D' | '2-E'

/**
 * 메뉴키 → 서버 집행 대상(엔드포인트 디렉터리) 매핑. 1a에서는 비어 있고, 각 하위 단계에서 해당 단계 키의 항목을 채운다.
 * 항목 추가 후에는 반드시 해당 엔드포인트에 requireMenuAccess* 호출과 테스트(403·무회귀)를 함께 둔다.
 */
export const MENU_GUARDED_ENDPOINTS: Record<string, { dirs: string[]; phase: MenuAccessPhase }> = {
  // 1b — 상담 채팅 화면 전용(관리자 전용 채팅 API + cms/chat). 디렉터리 "직속" +server.ts만 대상(하위 디렉터리는 따로 나열)
  'consulting.chat': {
    phase: '1b',
    dirs: [
      'src/routes/api/chat/sessions',
      'src/routes/api/chat/sessions/[id]',
      'src/routes/api/chat/sessions/[id]/bookmarks',
      'src/routes/api/chat/sessions/[id]/close',
      'src/routes/api/chat/sessions/[id]/cs-record',
      'src/routes/api/chat/sessions/[id]/join',
      'src/routes/api/chat/sessions/[id]/manual-mode',
      'src/routes/api/chat/sessions/[id]/pending',
      'src/routes/api/chat/sessions/[id]/reopen',
      'src/routes/api/chat/admin-reply',
      'src/routes/api/chat/admin-attachment',
      'src/routes/api/chat/customers/[id]/detail',
      'src/routes/api/chat/messages/[id]/bookmark',
      'src/routes/api/cms/chat/coupon-gift/[messageId]/approve',
      'src/routes/api/cms/chat/coupon-gift/direct-send',
      'src/routes/api/cms/chat/identity-request/direct-send',
      'src/routes/api/cms/chat/pending-inquiries',
      // 크레이지챗 접수 큐(2026-10-07, S3)
      'src/routes/api/cms/chat/agent-requests',
      'src/routes/api/cms/chat/agent-requests/[id]/resolve',
      'src/routes/api/cms/chat/sms-status/[messageId]',
      // 2-A(Stephen 확정 Q0 2026-10-06): 상담 고객패널 전용 조회는 상담 단독
      'src/routes/api/cms/customers/[id]/coupons',
      'src/routes/api/cms/customers/[id]/summary',
      'src/routes/api/cms/coupons/available',
    ],
  },
  // 1b — 빠른답변 관리 화면 전용(canned-responses는 GET이 공용이라 아래 SHARED에도 있음 — 쓰기 메서드만 consulting.qna)
  'consulting.qna': {
    phase: '1b',
    dirs: [
      'src/routes/api/cms/canned-responses',
      'src/routes/api/cms/canned-responses/[id]',
      'src/routes/api/cms/canned-responses/bulk-import',
      'src/routes/api/cms/synonyms/backfill-cross-lingual',
      'src/routes/api/cms/synonyms/scan-reformulations',
    ],
  },
  // 크레이지챗 설정·관찰 검토 화면 전용(2026-10-07, S5) — 매니저 이상 메뉴(requiresSettingsAccess)
  'consulting.crazychat': {
    phase: '1b',
    dirs: [
      'src/routes/api/cms/chat/crazychat/settings',
      'src/routes/api/cms/chat/crazychat/stats',
      'src/routes/api/cms/chat/crazychat/drafts',
      'src/routes/api/cms/chat/crazychat/drafts/[id]/feedback',
    ],
  },
  // 1c — 예약대여현황: 예약 상세 패널 API 전부 + QR 전이 + 대시보드 간트 데이터. 패널(RentalDetailPanel)이 대시보드·채팅·모바일에도
  // 마운트되지만 "공유 패널 API는 예약대여현황 단독"으로 확정(Stephen 2026-10-03) — 대시보드 권한(모든 계정 기본 허용)으로 통과시키면 OFF가 무력화됨
  'rental.reservation': {
    phase: '1c',
    dirs: [
      'src/routes/api/cms/dashboard/gantt-window',
      // 1c 후속(Stephen 확정 2026-10-04): 예약 상세 패널 계약서 탭 API — 고객 경로 호출 없음 확인
      'src/routes/api/cms/contracts/[id]/content',
      'src/routes/api/cms/contracts/[id]/final-pdf',
      'src/routes/api/cms/contracts/[id]/issuer-sign',
      'src/routes/api/cms/contracts/[id]/send-chat',
      'src/routes/api/cms/contracts/[id]/share-chat',
      'src/routes/api/cms/rental-qr-transition',
      'src/routes/api/cms/reservations/[id]/available-units',
      'src/routes/api/cms/reservations/[id]/bundles',
      'src/routes/api/cms/reservations/[id]/confirm-cancel',
      'src/routes/api/cms/reservations/[id]/contract-data',
      'src/routes/api/cms/reservations/[id]/detail',
      'src/routes/api/cms/reservations/[id]/dhero',
      'src/routes/api/cms/reservations/[id]/dhero/cancel',
      'src/routes/api/cms/reservations/[id]/dhero/return',
      'src/routes/api/cms/reservations/[id]/init-contract',
      'src/routes/api/cms/reservations/[id]/locker-password',
      'src/routes/api/cms/reservations/[id]/options',
      'src/routes/api/cms/reservations/[id]/options/assets',
      'src/routes/api/cms/reservations/[id]/options/assets/available',
      'src/routes/api/cms/reservations/[id]/order-coupons',
      'src/routes/api/cms/reservations/[id]/order-siblings',
      'src/routes/api/cms/reservations/[id]/payment',
      'src/routes/api/cms/reservations/[id]/payment/pg-status',
      'src/routes/api/cms/reservations/[id]/products',
      'src/routes/api/cms/reservations/[id]/rental-siblings',
      'src/routes/api/cms/reservations/[id]/tracking',
      'src/routes/api/cms/reservations/resolve',
      // 1g(Stephen 확정 2026-10-05): 모바일 전용 API — 호출처는 /cms/mobile 화면뿐
      'src/routes/api/cms/mobile-search-rank',
      'src/routes/api/cms/assets',
      'src/routes/api/cms/assets/[id]',
      // 1d 후속(Stephen 확정 2026-10-05): 예약 패널 상품찾기 모달 전용 API — 계정별 예약대여현황 권한을 따름
      'src/routes/api/cms/products/category-options',
      'src/routes/api/cms/products/[id]/option-links',
    ],
  },
  // 1e — 고객목록: 고객 서류 승인·취소·대리등록·열람(doc-url은 기존부터 customers.list 게이트). 고객 정보 조회 3종은 상담 채팅 고객패널과 공용이라 아래 SHARED
  'customers.list': {
    phase: '1e',
    dirs: [
      'src/routes/api/cms/approve-doc',
      'src/routes/api/cms/revoke-doc-approval',
      'src/routes/api/cms/upload-doc',
      'src/routes/api/cms/customers/[id]/doc-url',
      'src/routes/cms/customers/addresses', // 고객 상세 패널 탭 조회
      'src/routes/cms/customers/chat-sessions', // 고객 상세 패널 탭 조회
      'src/routes/cms/customers/credit-audit', // 고객 상세 패널 탭 조회
      'src/routes/cms/customers/points', // 고객 상세 패널 탭 조회
      'src/routes/cms/customers/profile-settings', // 고객 상세 패널 탭 조회
      'src/routes/cms/customers/rentals', // 고객 상세 패널 탭 조회
      'src/routes/cms/customers/subscription-payments', // 고객 상세 패널 탭 조회
      'src/routes/cms/customers/subscriptions', // 고객 상세 패널 탭 조회
    ],
  },
  // 1d — 상품목록: 카드 선택 전환 전용 상세 조회(cms 하위라 프로즌 경로 아님). 폼 액션은 아래 ACTION_FILES
  'products.list': {
    phase: '1d',
    dirs: ['src/routes/cms/products/[id]/detail'],
  },
}

/**
 * 두 화면 이상이 함께 쓰는 공용 API — 지정한 메뉴 중 하나라도 허용이면 통과(requireAnyMenuAccessApi).
 * 한 메뉴만 OFF인 계정의 다른 화면 기능이 부수적으로 막히지 않게 한다(예: 채팅 입력창 '/' 빠른답변은 채팅·빠른답변 화면이 같은 API).
 */
export const MENU_GUARDED_SHARED_ENDPOINTS: { menuKeys: string[]; dirs: string[]; phase: MenuAccessPhase }[] = [
  {
    phase: '1b',
    menuKeys: ['consulting.chat', 'consulting.qna'],
    dirs: [
      'src/routes/api/cms/canned-responses', // GET 목록(채팅 '/' 드롭다운 + 빠른답변 화면)
      'src/routes/api/cms/canned-responses/[id]/use', // 전송 시 사용횟수 집계(채팅)
      'src/routes/api/cms/auto-reply-settings', // 자동답변 스위치(채팅 헤더 + 빠른답변 화면)
    ],
  },
  {
    phase: '1e',
    menuKeys: ['consulting.chat', 'customers.list'],
    dirs: [
      'src/routes/api/cms/customers/[id]/inquiries', // 상담 채팅 고객패널 + 고객목록 상세 패널
    ],
  },
  {
    phase: '2-A',
    menuKeys: ['rental.reservation', 'consulting.chat', 'rental.contracts'],
    dirs: ['src/routes/api/cms/contract-templates'], // 계약서 양식 읽기(GET) — 예약 패널·상담 채팅·양식 화면 공용
  },
  {
    phase: '1c',
    menuKeys: ['rental.history', 'rental.reservation'],
    dirs: [
      'src/routes/api/cms/product-history', // 이력관리 화면 + 모바일 QR 이력 기록(모바일은 예약대여현황 권한을 따름) + 상품 상세 이력 탭
    ],
  },
]

/**
 * SSR 로더(+page.server.ts load)가 API를 거치지 않고 service-role로 직접 읽는 데이터의 게이트 — API만 막으면 이 경로가 우회로가 된다.
 * marker는 해당 파일에 반드시 존재해야 하는 호출 문자열(소스 스캔이 검증).
 */
export const MENU_GUARDED_LOADER_FILES: { menuKey: string; file: string; marker: string; phase: MenuAccessPhase; note: string }[] = [
  {
    menuKey: 'rental.reservation',
    file: 'src/routes/cms/+page.server.ts',
    marker: "checkMenuAccess(locals, 'rental.reservation')",
    phase: '1c',
    note: '대시보드 간트 초기 구간(get_rental_list) — OFF·조회 실패 계정은 조회 없이 빈 간트. 대시보드의 다른 위젯(KPI·오늘 통계 등) 직접 조회는 1단계 범위 밖(후속)',
  },
]

/**
 * 조건부 게이트 — 일부 경로(고객 첨부 등)는 무게이트이고 나머지에만 any-of 게이트를 거는 엔드포인트.
 * 고객 기능과 같은 엔드포인트를 쓰므로 "진입부 첫 문장" 규칙을 적용할 수 없다 — 전용 테스트(uploadMenuGuard)가 분기를 검증한다.
 */
export const MENU_GUARDED_CONDITIONAL_FILES: { file: string; phase: MenuAccessPhase; note: string }[] = [
  {
    file: 'src/routes/api/cms/upload/+server.ts',
    phase: '2-C',
    note: '고객 크레이지로그 첨부(log/ 경로)는 무게이트, 그 외는 UPLOAD_MENU_KEYS(uploadMenuKeys.ts) 중 하나라도 허용일 때만',
  },
]

/** 폼 액션 게이트 대상 페이지 서버 파일(requireMenuAccessAction) */
export const MENU_GUARDED_ACTION_FILES: { menuKey: string; file: string; phase: MenuAccessPhase }[] = [
  { menuKey: 'consulting.qna', file: 'src/routes/cms/chat/qna/+page.server.ts', phase: '1b' },
  { menuKey: 'rental.reservation', file: 'src/routes/cms/reservation/+page.server.ts', phase: '1c' },
  { menuKey: 'rental.reservation', file: 'src/routes/cms/rentals/+page.server.ts', phase: '1c' },
  { menuKey: 'rental.reservation', file: 'src/routes/cms/mobile/rentals/+page.server.ts', phase: '1g' },
  { menuKey: 'rental.reservation', file: 'src/routes/cms/mobile/qr/[product_id]/+page.server.ts', phase: '1g' },
  { menuKey: 'customers.list', file: 'src/routes/cms/customers/+page.server.ts', phase: '1e' },
  { menuKey: 'customers.list', file: 'src/routes/cms/customers/legacy-import/+page.server.ts', phase: '1e' },
  { menuKey: 'products.list', file: 'src/routes/cms/products/+page.server.ts', phase: '1d' },
  { menuKey: 'products.new', file: 'src/routes/cms/products/new/+page.server.ts', phase: '1d' },
]

/** CMS_MENUS에 실제 존재하는 메뉴 키인지(오타 방지용 점검) */
export function isKnownMenuKey(menuKey: string): boolean {
  return CMS_MENUS.some((m) => m.menu_key === menuKey || m.subMenus.some((s) => s.menu_key === menuKey))
}
