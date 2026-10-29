// src/lib/utils/dheroJourneyStage.ts
// 두발히어로 배송 5단계 진행 상태 계산 — status code → DheroStageInfo
// 정본 코드표: .claude/rules-ref/dhero-delivery-api.md §4-1

export type DheroTone = 'normal' | 'warn' | 'danger'

export interface DheroStageInfo {
  /** 두발히어로 5단계 중 현재 단계 인덱스 (0 = 접수 … 4 = 배송완료) */
  index: number
  /** 현재 상태의 세부 라벨 (DHERO_STAGE_LABELS[index]와 다를 수 있음 — 예: '수거배차', '배송연기') */
  label: string
  /** 배지 강조 톤 */
  tone: DheroTone
}

/** 두발히어로 5단계 배송흐름 고정 라벨 (펼침 시 배지에 표시되는 순서) */
export const DHERO_STAGE_LABELS: readonly string[] = [
  '접수',    // index 0
  '수거완료', // index 1
  '입고완료', // index 2
  '배송출발', // index 3
  '배송완료', // index 4
]

interface CodeEntry { index: number; label: string; tone: DheroTone }

const CODE_MAP: Record<number, CodeEntry> = {
  0:  { index: 0, label: '접수',    tone: 'normal' },
  1:  { index: 0, label: '수거배차', tone: 'normal' },
  2:  { index: 1, label: '수거완료', tone: 'normal' },
  3:  { index: 2, label: '입고완료', tone: 'normal' },
  8:  { index: 2, label: '배송대기', tone: 'normal' },
  4:  { index: 3, label: '배송출발', tone: 'normal' },
  12: { index: 3, label: '배송연기', tone: 'warn'   },
  5:  { index: 4, label: '배송완료', tone: 'normal' },
  6:  { index: 4, label: '반송완료', tone: 'danger' },
  7:  { index: 4, label: '분실완료', tone: 'danger' },
}

/**
 * 두발히어로 배송 5단계 진행 상태 계산
 *
 * - courierCode !== '두발히어로' 또는 dheroStatusCode가 null/undefined/알 수 없는 코드 → null
 * - 우선순위: 취소(canceledAt) > 사고(accidentAt) > 코드 매핑
 *
 * returnBookId 파라미터 (반납 leg 검증):
 * - undefined : 검증 없음 — 기존 shipped leg 동작 그대로 (하위 호환)
 * - null      : 반납 접수번호 미등록 → null 반환 (토글 미표시)
 * - string    : dheroMeta.bookId === returnBookId 검증.
 *               일치 시 일반 로직 적용, 불일치·bookId 없음 시
 *               { index: 0, label: '접수', tone: 'normal' } 반환 (취소·사고 신뢰 안 함)
 */
export function dheroJourneyStage(info: {
  courierCode:     string | null | undefined
  dheroStatusCode: number | null | undefined
  dheroMeta:       { bookId?: unknown; canceledAt?: unknown; accidentAt?: unknown } | null | undefined
  /** 반납 leg 검증용 반납 접수번호(dhero_return_book_id). undefined = 검증 없음(shipped 하위 호환) */
  returnBookId?:   string | null
}): DheroStageInfo | null {
  if (info.courierCode !== '두발히어로') return null

  // 반납 leg 검증
  if (info.returnBookId !== undefined) {
    // null = 반납 접수번호 미등록 → 표시 안 함
    if (info.returnBookId === null) return null
    // string = bookId 일치 여부 확인
    const metaBookId = info.dheroMeta?.bookId
    if (metaBookId !== info.returnBookId) {
      // 불일치 또는 bookId 없음 → 접수(index 0, normal) — 취소·사고 신뢰 안 함
      return { index: 0, label: '접수', tone: 'normal' }
    }
    // bookId 일치 → 이하 일반 로직으로 처리
  }

  if (info.dheroStatusCode == null) return null

  const base = CODE_MAP[info.dheroStatusCode]
  if (!base) return null // 알 수 없는 코드

  const canceledAt = info.dheroMeta?.canceledAt
  const accidentAt = info.dheroMeta?.accidentAt

  if (typeof canceledAt === 'string' && canceledAt.trim() !== '') {
    return { index: base.index, label: '취소', tone: 'danger' }
  }
  if (typeof accidentAt === 'string' && accidentAt.trim() !== '') {
    return { index: base.index, label: '사고', tone: 'danger' }
  }

  return { index: base.index, label: base.label, tone: base.tone }
}
