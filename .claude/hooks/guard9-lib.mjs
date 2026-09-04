// guard9-lib.mjs — Guard 9(Regression Coverage) 훅 공용 로직
// 원본 정책: .claude/harness/middleware-guards.md "Guard 9: Regression Coverage"
// 2026-09-03 — Stephen "Guard 9를 실제로 훅에 연결해줘" 요청으로 신설
//
// 이 파일은 3개 훅 스크립트(guard9-post-edit.mjs, guard9-post-bash.mjs,
// guard9-stop-check.mjs)가 공유하는 도메인 매핑·상태파일 유틸리티다.

import fs from 'node:fs'
import path from 'node:path'

// ── middleware-guards.md의 "모듈 간 공유 RPC 의존성 맵"을 그대로 반영 ──
export const DOMAIN_DEPS = {
  M2: { label: '예약(reservation)', dependents: ['M3'], reason: 'atomic_reserve_asset 공유' },
  M3: { label: '결제(payment)', dependents: ['M2'], reason: 'calculate_cart_total, confirmed 전환 공유' },
  M4: { label: '회원(membership)', dependents: ['M2', 'M3'], reason: '크레이지스코어→보증금→결제금액 체인' },
  M5: { label: '배송(shipment)', dependents: ['M2'], reason: '배송마감시간→예약가능날짜 영향' },
  auth: { label: '인증(auth)', dependents: ['M2', 'M3', 'M4'], reason: 'RLS 변경 시 전 도메인 영향' },
}

// ── 파일 경로 → 도메인 판정 규칙(휴리스틱, 위에서부터 먼저 매칭되는 것 채택) ──
// ⚠️ 완벽한 분류기가 아니다 — 이 프로젝트의 실제 디렉토리 관례를 근거로 한 근사치.
//    오탐/누락이 있으면 이 배열만 조정하면 된다(다른 훅 스크립트 수정 불필요).
const PATH_RULES = [
  [/\/routes\/auth\//, 'auth'],
  [/\/routes\/cms\/login\//, 'auth'],
  [/[\\/]hooks\.server\.ts$/, 'auth'],
  [/lib[\\/]stores[\\/]auth\.ts$/, 'auth'],
  [/lib[\\/]services[\\/]supabase\.ts$/, 'auth'],
  [/security-auth/i, 'auth'],

  [/\/routes\/payment\//, 'M3'],
  [/\/routes\/subscribe\//, 'M3'],
  [/toss/i, 'M3'],
  [/webhook/i, 'M3'],
  [/refund/i, 'M3'],
  [/checkout/i, 'M3'],
  [/payment/i, 'M3'],

  [/\/routes\/cart\//, 'M2'],
  [/reservation/i, 'M2'],
  [/rental/i, 'M2'],
  [/\bhold\b/i, 'M2'],

  [/\/routes\/account\//, 'M4'],
  [/member/i, 'M4'],
  [/credit.?score/i, 'M4'],
  [/크레이지스코어/, 'M4'],

  [/shipment/i, 'M5'],
  [/delivery/i, 'M5'],
  [/dhero/i, 'M5'],
  [/배송/, 'M5'],
]

export function detectDomain(filePath) {
  if (!filePath || typeof filePath !== 'string') return null
  for (const [re, domain] of PATH_RULES) {
    if (re.test(filePath)) return domain
  }
  return null
}

// ── 세션 스코프 상태 파일 ──
// 병렬 세션(이 프로젝트에서 실제로 흔함) 간 상태가 섞이지 않도록 session_id로 분리한다.
const STATE_DIR = path.join(process.cwd(), '.claude', 'harness', 'telemetry', 'guard9')

export function statePath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')
  return path.join(STATE_DIR, `${safe}.json`)
}

export function readState(sessionId) {
  const p = statePath(sessionId)
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'))
  } catch {
    return { domainsTouched: {}, testsRun: [] }
  }
}

export function writeState(sessionId, state) {
  fs.mkdirSync(STATE_DIR, { recursive: true })
  fs.writeFileSync(statePath(sessionId), JSON.stringify(state, null, 2))
}

export function readStdinJson() {
  try {
    const raw = fs.readFileSync(0, 'utf8')
    if (!raw.trim()) return {}
    return JSON.parse(raw)
  } catch {
    return {}
  }
}
