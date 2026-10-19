// 반납 방식별 단계 알림 정의 (2026-10-17, Migration #722) — 크론(/api/cron/return-notice)과 테스트가 공유하는 순수 모듈.
// 단계 산출(시각·방식)은 DB 함수 claim_return_notice_targets 가 하고, 여기서는 단계 → 알림 유형·카드 버튼·이동 주소만 정한다.
// 푸시·문자 문구는 push.ts CUSTOMER_LIFECYCLE_PUSH_COPY / sms.ts LIFECYCLE_SMS_COPY 가 정본이다(같은 유형 키).

export type ReturnNoticeStage = 'courier' | 'quick_5h' | 'quick_2h' | 'quick_1h' | 'locker_2h'

export const RETURN_NOTICE_STAGES: ReturnNoticeStage[] = ['courier', 'quick_5h', 'quick_2h', 'quick_1h', 'locker_2h']

/** 단계 → 푸시·문자·설정(push_notification_config) 공통 알림 유형 */
export const RETURN_NOTICE_NOTIFY_TYPE: Record<ReturnNoticeStage, string> = {
  courier: 'return_notice_courier',
  quick_5h: 'return_notice_quick_5h',
  quick_2h: 'return_notice_quick_2h',
  quick_1h: 'return_notice_quick_1h',
  locker_2h: 'return_notice_locker',
}

/** 채팅카드 버튼 라벨(요구서 CTA 이름) */
export const RETURN_NOTICE_BUTTON_LABEL: Record<ReturnNoticeStage, string> = {
  courier: '반납요청',
  quick_5h: '반납 진행중',
  quick_2h: '반납 준비 확인',
  quick_1h: '반납 준비 확인',
  locker_2h: '무인함 반납완료',
}

/** 고객 반납 제출 화면 경로 */
export function returnSubmitPath(reservationId: number): string {
  return `/account/rental/${reservationId}/return-submit`
}

export function isReturnNoticeStage(value: string): value is ReturnNoticeStage {
  return (RETURN_NOTICE_STAGES as string[]).includes(value)
}

/** 운영자(관리자) 푸시도 함께 나가는 단계 — 퀵 반납 종료 2시간 전 */
export const RETURN_NOTICE_ADMIN_PUSH_STAGES: ReturnNoticeStage[] = ['quick_2h']

/** return_method → 고객 반납 제출 화면 방식 */
export type ReturnSubmitMethod = 'courier' | 'quick' | 'locker'

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
export const RETURN_SUBMIT_RULES: Record<ReturnSubmitMethod, { photosRequired: boolean; checklist: boolean; lockerInfo: boolean }> = {
  courier: { photosRequired: true, checklist: true, lockerInfo: false },
  quick: { photosRequired: false, checklist: false, lockerInfo: false },
  locker: { photosRequired: true, checklist: false, lockerInfo: true },
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
