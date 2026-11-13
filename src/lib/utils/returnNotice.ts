// 반납 방식별 단계 알림 정의 (2026-10-17, Migration #722) — 크론(/api/cron/return-notice)과 테스트가 공유하는 순수 모듈.
// 발송 시각(Migration #736): 택배류=반납일 09:00 / 퀵=반납 일시 3시간 전(quick_5h 키) / 무인함 안내(locker_2h 키)=방문·퀵 예약의 반납 일시 1시간 전(Migration #796, Stephen 2026-11-06 확정 — 이전 #736 의 3시간 전에서 변경) / 방문은 기존 09시 return_remind 도 함께. 단계 키 이름은 기존 로그 호환을 위해 유지한다.
// 단계 산출(시각·방식)은 DB 함수 claim_return_notice_targets 가 하고, 여기서는 단계 → 알림 유형·카드 버튼·이동 주소만 정한다.
// 푸시·문자 문구는 push.ts CUSTOMER_LIFECYCLE_PUSH_COPY / sms.ts LIFECYCLE_SMS_COPY 가 정본이다(같은 유형 키).

// reg_* = 반납정보 등록요청 타이머(Migration #822, 2026-11-13) — 방문·퀵·무인함 고객에게 반납 시각 N시간 전(푸시알림 설정 '반납 접수 요청' 행에서 지정). 알림 유형은 return_registration 하나를 쓴다.
export type ReturnNoticeStage = 'courier' | 'quick_5h' | 'quick_2h' | 'quick_1h' | 'locker_2h' | 'reg_visit' | 'reg_quick' | 'reg_locker'

export const RETURN_NOTICE_STAGES: ReturnNoticeStage[] = ['courier', 'quick_5h', 'quick_2h', 'quick_1h', 'locker_2h', 'reg_visit', 'reg_quick', 'reg_locker']

/** 단계 → 푸시·문자·설정(push_notification_config) 공통 알림 유형 */
export const RETURN_NOTICE_NOTIFY_TYPE: Record<ReturnNoticeStage, string> = {
  courier: 'return_notice_courier',
  quick_5h: 'return_notice_quick_5h',
  quick_2h: 'return_notice_quick_2h',
  quick_1h: 'return_notice_quick_1h',
  locker_2h: 'return_notice_locker',
  reg_visit: 'return_registration',
  reg_quick: 'return_registration',
  reg_locker: 'return_registration',
}

/** 채팅카드 버튼 라벨(요구서 CTA 이름) */
export const RETURN_NOTICE_BUTTON_LABEL: Record<ReturnNoticeStage, string> = {
  courier: '반납요청',
  quick_5h: '반납 진행중',
  quick_2h: '반납 준비 확인',
  quick_1h: '반납 준비 확인',
  locker_2h: '무인함 정보 등록',
  reg_visit: '반납정보 등록',
  reg_quick: '반납정보 등록',
  reg_locker: '반납정보 등록',
}

/** 푸시·문자 링크를 반납 제출 화면(풀링크)으로 보내는 알림 유형 — 반납정보 등록요청과 방식별 단계 안내(2026-11-13). 반납 예정(return_remind)은 상품 이력 화면이라 제외. */
export const RETURN_SUBMIT_LINK_TYPES: ReadonlySet<string> = new Set([
  'return_registration',
  'return_notice_courier',
  'return_notice_quick_5h',
  'return_notice_quick_2h',
  'return_notice_quick_1h',
  'return_notice_locker',
])

/** 고객 반납 제출 화면 경로 */
export function returnSubmitPath(reservationId: number): string {
  return `/account/rental/${reservationId}/return-submit`
}

export function isReturnNoticeStage(value: string): value is ReturnNoticeStage {
  return (RETURN_NOTICE_STAGES as string[]).includes(value)
}

/** 운영자(관리자) 푸시도 함께 나가는 단계 — 퀵 반납 일시 3시간 전(Migration #736부터 퀵은 이 단계 1회만 발송, 키 이름 quick_5h 는 호환을 위해 유지) */
export const RETURN_NOTICE_ADMIN_PUSH_STAGES: ReturnNoticeStage[] = ['quick_5h']

/** return_method → 고객 반납 제출 화면 방식 */
export type ReturnSubmitMethod = 'courier' | 'quick' | 'locker' | 'visit'

const COURIER_METHODS = new Set(['epost', 'delivery', 'crazydelivery', 'airport'])

/** 제출 화면을 쓰는 반납 방식인지(방문·미지정은 제출 화면 없음) */
export function toReturnSubmitMethod(returnMethod: string | null | undefined): ReturnSubmitMethod | null {
  if (!returnMethod) return null
  if (COURIER_METHODS.has(returnMethod)) return 'courier'
  if (returnMethod === 'quick') return 'quick'
  if (returnMethod === 'locker') return 'locker'
  return null
}

/** 방식별 반납 제출 요건 — 사진·체크리스트·무인함 정보 필수 여부 */
export const RETURN_SUBMIT_RULES: Record<ReturnSubmitMethod, { photosRequired: boolean; checklist: boolean; lockerInfo: boolean; lockerInfoOptional?: boolean }> = {
  courier: { photosRequired: true, checklist: true, lockerInfo: false },
  // 퀵: 무인함을 쓴 경우에만 번호·비밀번호를 입력한다(선택 — 입력하면 둘 다 필수). 쓰지 않았다면 비워 두고 제출한다.
  quick: { photosRequired: false, checklist: false, lockerInfo: false, lockerInfoOptional: true },
  locker: { photosRequired: true, checklist: false, lockerInfo: true },
  // 방문: 무인함 반납과 같은 요건 — 사진(무인함·장비 각 1장) + 무인함 번호·비밀번호 필수(2026-11-06 Stephen 확정). 알림 CTA 와 마이페이지 대여카드 버튼(2026-11-13 추가)으로 들어온다.
  visit: { photosRequired: true, checklist: false, lockerInfo: true },
}

/**
 * 제출 화면·API 가 쓰는 방식 판정 — toReturnSubmitMethod 에 "방문 반납(무인함 정보만)"을 더한다.
 * toReturnSubmitMethod 는 방문을 null 로 유지하고, 이 함수는 알림 CTA·마이페이지 대여카드 버튼(2026-11-13)·제출 화면·제출 API 가 쓴다.
 */
export function resolveReturnSubmitMethod(returnMethod: string | null | undefined): ReturnSubmitMethod | null {
  const base = toReturnSubmitMethod(returnMethod)
  if (base) return base
  return returnMethod === 'visit' ? 'visit' : null
}

/** 장비 확인 체크리스트 항목(택배 반납). key 는 저장값이라 바꾸지 않는다. */
export const RETURN_CHECKLIST_ITEMS: { key: string; label: string }[] = [
  { key: 'body', label: '본체 외관 이상 없음' },
  { key: 'accessories', label: '구성품(배터리·충전기·케이블 등) 모두 포함' },
  { key: 'packed', label: '완충재로 안전하게 포장함' },
  { key: 'clean', label: '렌즈·액정 오염 없음' },
]

/** 사진·영상 첨부 항목(검수 탭 정렬 기준) */
export const RETURN_MEDIA_ITEMS: Record<ReturnSubmitMethod, { key: string; label: string }[]> = {
  courier: [
    { key: 'body', label: '본체 사진' },
    { key: 'accessories', label: '구성품 사진' },
    { key: 'package', label: '포장 상태 사진' },
  ],
  quick: [],
  locker: [
    { key: 'locker', label: '무인함 사진' },
    { key: 'device', label: '장비 사진' },
  ],
  // 방문 반납도 무인함 반납과 같은 사진 항목(키 동일 — 검수 탭 정렬·라벨 공용)
  visit: [
    { key: 'locker', label: '무인함 사진' },
    { key: 'device', label: '장비 사진' },
  ],
}

const MEDIA_LABELS = new Map(
  Object.values(RETURN_MEDIA_ITEMS)
    .flat()
    .map((i) => [i.key, i.label] as const),
)

export function mediaItemLabel(itemKey: string): string {
  return MEDIA_LABELS.get(itemKey) ?? itemKey
}

export const RETURN_MEDIA_MAX_PER_ITEM = 5
