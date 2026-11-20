/**
 * codeGroupMove.ts — 코드조합 카테고리 이동(결합·분리)의 순수 규칙 (2026-11-19)
 *
 * /cms/codes 코드조합 탭의 이동 창이 화면에서 쌓은 "임시 이동"을 서버로 보내는 형식·검증·오류 문구를 담는다.
 * 실제 이동은 DB 함수 cms_move_group_combos 가 하며(Migration 841), 이 파일은 DB·SvelteKit 에 의존하지 않는다.
 */

export interface GroupComboMove {
  combo_row_id: string
  from_group_id: string
  to_group_id: string
}

export interface GroupComboMoveDetail extends GroupComboMove {
  code: string
  parents: number
  children: number
  /** 출발 카테고리에 같은 코드 문자열의 다른 조합이 남아 있어 상품은 옮기지 않고 조합만 이동 */
  shared_code?: boolean
}

export interface GroupComboMoveResult {
  batch_id: string
  combos: number
  parents: number
  children: number
  rest: number
  detail: GroupComboMoveDetail[]
  rest_detail: { from_group_id: string; to_group_id?: string; products?: number; skipped?: string }[]
  dry_run?: boolean
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const MAX_GROUP_COMBO_MOVES = 200

/** 폼으로 받은 JSON 문자열을 이동 목록으로 바꾼다. 형식이 틀리거나 비면 null. 같은 조합이 두 번 오면 마지막 것만 쓴다. */
export function parseGroupComboMoves(raw: string): GroupComboMove[] | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > MAX_GROUP_COMBO_MOVES) return null
  const byCombo = new Map<string, GroupComboMove>()
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) return null
    const o = item as Record<string, unknown>
    const combo = o['combo_row_id']
    const from = o['from_group_id']
    const to = o['to_group_id']
    if (typeof combo !== 'string' || typeof from !== 'string' || typeof to !== 'string') return null
    if (!UUID_RE.test(combo) || !UUID_RE.test(from) || !UUID_RE.test(to)) return null
    if (from === to) return null
    byCombo.set(combo, { combo_row_id: combo, from_group_id: from, to_group_id: to })
  }
  return [...byCombo.values()]
}

const ERROR_TEXT: Record<string, string> = {
  NO_MOVES: '옮길 조합이 없습니다.',
  TOO_MANY_MOVES: `한 번에 옮길 수 있는 조합은 ${MAX_GROUP_COMBO_MOVES}개까지입니다.`,
  SAME_GROUP: '출발과 도착이 같은 카테고리입니다.',
  COMBO_NOT_IN_GROUP: '화면 정보가 오래됐습니다. 새로고침한 뒤 다시 시도해주세요.',
  GROUP_NOT_FOUND: '카테고리를 찾을 수 없습니다.',
  PARTNER_TYPE_MISMATCH: '협력사 유형 카테고리와 일반 카테고리 사이에서는 옮길 수 없습니다.',
  DUPLICATE_COMBO: '도착 카테고리에 같은 코드 조합이 이미 있어 옮길 수 없습니다.',
  CATEGORY_KEY_MISSING: '상품이 연결된 조합인데 카테고리 키가 없는 카테고리입니다. 카테고리 편집에서 키를 먼저 지정해주세요.',
  REST_TARGET_AMBIGUOUS: '통째 결합은 도착 카테고리가 하나일 때만 할 수 있습니다.',
  BATCH_NOT_FOUND: '되돌릴 이동 기록을 찾을 수 없습니다.',
  ALREADY_UNDONE: '이미 되돌린 이동입니다.',
}

/** DB 함수가 던진 오류 메시지를 화면 문구로 바꾼다. 모르는 오류는 null(호출부가 일반 문구 사용). */
export function codeGroupMoveErrorText(message: string | null | undefined): string | null {
  if (!message) return null
  for (const [code, text] of Object.entries(ERROR_TEXT)) {
    if (message.includes(code)) return text
  }
  return null
}

/** 출발 그룹에서 이번 이동 뒤에도 조합이 남는지 — 남지 않으면 그 카테고리가 사실상 비게 된다(통째 결합). */
export function groupsLeftEmpty(
  currentComboIdsByGroup: ReadonlyMap<string, readonly string[]>,
  moves: readonly GroupComboMove[],
): string[] {
  const movedByGroup = new Map<string, Set<string>>()
  for (const m of moves) {
    const set = movedByGroup.get(m.from_group_id) ?? new Set<string>()
    set.add(m.combo_row_id)
    movedByGroup.set(m.from_group_id, set)
  }
  const empty: string[] = []
  for (const [groupId, moved] of movedByGroup) {
    const current = currentComboIdsByGroup.get(groupId) ?? []
    if (current.length > 0 && current.every((id) => moved.has(id))) empty.push(groupId)
  }
  return empty
}
