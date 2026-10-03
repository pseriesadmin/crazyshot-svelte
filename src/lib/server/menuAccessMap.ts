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

export type MenuAccessPhase = '1b' | '1c' | '1d' | '1e' | '1g' | '1h'

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
      'src/routes/api/cms/chat/sms-status/[messageId]',
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
]

/** 폼 액션 게이트 대상 페이지 서버 파일(requireMenuAccessAction) */
export const MENU_GUARDED_ACTION_FILES: { menuKey: string; file: string; phase: MenuAccessPhase }[] = [
  { menuKey: 'consulting.qna', file: 'src/routes/cms/chat/qna/+page.server.ts', phase: '1b' },
]

/** CMS_MENUS에 실제 존재하는 메뉴 키인지(오타 방지용 점검) */
export function isKnownMenuKey(menuKey: string): boolean {
  return CMS_MENUS.some((m) => m.menu_key === menuKey || m.subMenus.some((s) => s.menu_key === menuKey))
}
