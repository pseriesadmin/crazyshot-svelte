// panelSplit.ts — 두 영역(대화 ↔ 고객 정보)의 가로폭 비율 조절 규칙 (2026-10-20, Stephen 지시: 두 영역 합 100% 중 각 30%~70%)
export const INFO_PCT_MIN = 30
export const INFO_PCT_MAX = 70
export const INFO_PCT_DEFAULT = 36 // 기존 고정 300px에 가까운 비율
export const INFO_PCT_STEP = 2     // 방향키 한 번의 변화량

/** 고객 정보 영역 비율을 30~70 사이로 제한(숫자가 아니면 기본값) */
export function clampInfoPct(v: number): number {
  if (!Number.isFinite(v)) return INFO_PCT_DEFAULT
  return Math.min(INFO_PCT_MAX, Math.max(INFO_PCT_MIN, v))
}

/** 포인터 위치(clientX)와 컨테이너 사각형으로 고객 정보 영역 비율 계산 — 컨테이너 오른쪽 끝에서 포인터까지의 거리가 고객 정보 영역 폭 */
export function infoPctFromPointer(clientX: number, rect: { right: number; width: number }): number {
  if (rect.width <= 0) return INFO_PCT_DEFAULT
  return clampInfoPct(((rect.right - clientX) / rect.width) * 100)
}

/** 방향키·Home/End 처리 결과. 해당 없는 키면 null. ← = 고객 정보 영역 넓힘, → = 좁힘, Home = 최대, End = 최소 */
export function infoPctFromKey(current: number, key: string): number | null {
  if (key === 'ArrowLeft') return clampInfoPct(current + INFO_PCT_STEP)
  if (key === 'ArrowRight') return clampInfoPct(current - INFO_PCT_STEP)
  if (key === 'Home') return INFO_PCT_MAX
  if (key === 'End') return INFO_PCT_MIN
  return null
}

/** 저장된 문자열 값을 비율로 복원(없거나 잘못된 값이면 null) */
export function parseStoredInfoPct(raw: string | null): number | null {
  if (raw === null) return null
  const v = Number(raw)
  return Number.isFinite(v) ? clampInfoPct(v) : null
}

// ── 위아래: 대화 영역(대화카드+고객 기본 정보) ↔ 하단 작성 그룹(답변 입력 + 상담 메모) (2026-10-20, Stephen 지시) ──
// 두 영역의 합을 100%로 보고 하단 작성 그룹을 30%~70%로 제한한다(대화 영역은 그 나머지 70%~30%).
// 저장된 값이 없으면(null) 기존처럼 내용 높이에 맞춘다 — 사용자가 처음 끌 때부터 비율 방식으로 바뀐다.
// 아주 낮은 화면에서는 30%가 내용 최소 높이보다 작을 수 있어 CSS가 COMPOSE_MIN_PX를 하한으로 둔다(30% 규칙보다 우선).
export const COMPOSE_PCT_MIN = 30
export const COMPOSE_PCT_MAX = 70
export const COMPOSE_PCT_STEP = 2
/** 하단 작성 그룹이 내용을 담을 수 있는 최소 높이(px) — 입력창 + 메모 입력칸 + 여백(위 28px 포함) */
export const COMPOSE_MIN_PX = 232

export function clampComposePct(v: number): number {
  if (!Number.isFinite(v)) return COMPOSE_PCT_MAX
  return Math.min(COMPOSE_PCT_MAX, Math.max(COMPOSE_PCT_MIN, v))
}

/** 포인터 위치(clientY)와 컨테이너 사각형으로 하단 작성 그룹 비율 계산 — 컨테이너 아래 끝에서 포인터까지의 거리가 하단 그룹 높이 */
export function composePctFromPointer(clientY: number, rect: { bottom: number; height: number }): number | null {
  if (rect.height <= 0) return null
  return clampComposePct(((rect.bottom - clientY) / rect.height) * 100)
}

/** 방향키 처리. ↑ = 하단 그룹 키움, ↓ = 줄임, Home = 최대, End = 최소. current가 null(자동)이면 측정값(measured)에서 시작. 해당 없는 키면 null */
export function composePctFromKey(current: number | null, measured: number, key: string): number | null {
  const base = clampComposePct(current ?? measured)
  if (key === 'ArrowUp') return clampComposePct(base + COMPOSE_PCT_STEP)
  if (key === 'ArrowDown') return clampComposePct(base - COMPOSE_PCT_STEP)
  if (key === 'Home') return COMPOSE_PCT_MAX
  if (key === 'End') return COMPOSE_PCT_MIN
  return null
}

export function parseStoredComposePct(raw: string | null): number | null {
  if (raw === null) return null
  const v = Number(raw)
  return Number.isFinite(v) ? clampComposePct(v) : null
}
