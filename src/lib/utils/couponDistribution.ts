/**
 * CMS 쿠폰 수동 지급 — 대상 입력 파싱 · 상태 집계 · 확인/결과 문구 (B-8).
 * 서버 액션(previewDistribute/distributeCoupon)과 화면(CouponDetailPanel)이 같은 규칙을 쓴다.
 */

/** 사전 조회 상태(지급 전) */
export type PreviewStatus = 'will_issue' | 'already_held' | 'already_used' | 'not_found' | 'limit_reached'
/** 지급 결과 상태(지급 후) — limit_reached: 총 발행 개수 한도에 도달해 지급되지 않음(Migration 623) */
export type DistributeStatus = 'issued' | 'already_held' | 'already_used' | 'not_found' | 'limit_reached'

export interface DistributionCounts {
  /** 지급 가능(사전) 또는 지급됨(사후) */
  issuable: number
  alreadyHeld: number
  alreadyUsed: number
  notFound: number
  /** 총 발행 개수 한도 초과로 지급 불가 */
  limitReached: number
  total: number
}

/** 줄바꿈·쉼표로 나눠 공백 제거·중복 제거(대소문자 무시, 입력 순서 유지) */
export function splitDistributionTargets(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of text.split(/[\n,]+/)) {
    const v = raw.trim()
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out
}

export function countStatuses(statuses: Array<PreviewStatus | DistributeStatus>): DistributionCounts {
  const c: DistributionCounts = { issuable: 0, alreadyHeld: 0, alreadyUsed: 0, notFound: 0, limitReached: 0, total: statuses.length }
  for (const s of statuses) {
    if (s === 'will_issue' || s === 'issued') c.issuable++
    else if (s === 'already_held') c.alreadyHeld++
    else if (s === 'already_used') c.alreadyUsed++
    else if (s === 'limit_reached') c.limitReached++
    else c.notFound++
  }
  return c
}

export interface DistributionConfirm {
  /** blocked = 지급할 대상이 없어 실행을 막는다 */
  kind: 'confirm' | 'blocked'
  message: string
  confirmLabel: string
}

/** 지급 전 확인창 문구 */
export function buildConfirmMessage(c: DistributionCounts): DistributionConfirm {
  const held = c.alreadyHeld + c.alreadyUsed
  if (c.issuable === 0) {
    if (c.limitReached > 0) {
      return { kind: 'blocked', message: '총 발행 개수 한도에 도달해 더 이상 지급할 수 없습니다.', confirmLabel: '' }
    }
    if (held > 0 && c.notFound === 0) {
      return { kind: 'blocked', message: '모든 대상자가 이미 보유 중이라 지급할 대상이 없습니다.', confirmLabel: '' }
    }
    if (held === 0) {
      return { kind: 'blocked', message: '일치하는 회원이 없어 지급할 대상이 없습니다.', confirmLabel: '' }
    }
    return {
      kind: 'blocked',
      message: `지급할 대상이 없습니다. (이미 보유 ${held}명 · 회원 없음 ${c.notFound}명)`,
      confirmLabel: '',
    }
  }
  const limitNote = c.limitReached > 0 ? ` (총 발행 개수 한도로 ${c.limitReached}명은 지급 불가)` : ''
  const notFoundNote = (c.notFound > 0 ? ` (회원 없음 ${c.notFound}명은 제외)` : '') + limitNote
  if (held > 0) {
    return {
      kind: 'confirm',
      message: `입력 ${c.total}명 중 ${held}명은 이미 이 쿠폰을 보유하고 있습니다. 보유 회원을 제외하고 ${c.issuable}명에게 지급할까요?${notFoundNote}`,
      confirmLabel: '제외하고 지급',
    }
  }
  return { kind: 'confirm', message: `${c.issuable}명에게 지급할까요?${notFoundNote}`, confirmLabel: '지급' }
}

/** 지급 후 결과 요약 — 예: "지급 2명 / 이미 보유 1명 / 회원 없음 0명" (이미 사용은 이미 보유에 합산) */
export function formatResultSummary(c: DistributionCounts): string {
  const base = `지급 ${c.issuable}명 / 이미 보유 ${c.alreadyHeld + c.alreadyUsed}명 / 회원 없음 ${c.notFound}명`
  return c.limitReached > 0 ? `${base} / 발행 한도 초과 ${c.limitReached}명` : base
}

export function statusLabel(s: PreviewStatus | DistributeStatus): string {
  switch (s) {
    case 'will_issue': return '지급 가능'
    case 'issued': return '지급됨'
    case 'already_held': return '이미 보유'
    case 'already_used': return '이미 사용'
    case 'limit_reached': return '발행 한도 초과'
    default: return '회원 없음'
  }
}
