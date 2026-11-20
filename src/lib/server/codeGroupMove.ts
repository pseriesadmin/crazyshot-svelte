// 코드조합 카테고리 이동 — 서버 쪽 DB 호출 모음 (2026-11-19, Migration 841)
// 실제 이동·되돌리기는 service_role 전용 DB 함수가 하고, 여기서는 호출과 미리보기용 경고 수집만 한다.
// 코드품번(product_code·code_series)은 이 경로에서 절대 바뀌지 않는다(DB 함수가 category·group_id 만 갱신).

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  codeGroupMoveErrorText,
  groupsLeftEmpty,
  type GroupComboMove,
  type GroupComboMoveResult,
} from '$lib/utils/codeGroupMove'

/** 카테고리 키를 값으로 품고 있는 설정(키가 사라지면 고객 화면에서 빠질 수 있는 것) */
const CATEGORY_KEYED_SETTINGS: { key: string; label: string }[] = [
  { key: 'product_page_categories', label: '상품목록 카테고리 설정' },
  { key: 'product_page_grid', label: '상품목록 그리드 설정' },
  { key: 'product_page_category_banners', label: '카테고리 배너 설정' },
  { key: 'home_category_products', label: '홈 카테고리 상품 설정' },
]

export interface GroupMoveWarning {
  groupId: string
  groupName: string
  categoryKey: string
  settings: string[]
}

export type GroupMoveOutcome =
  | { ok: true; result: GroupComboMoveResult; warnings: GroupMoveWarning[] }
  | { ok: false; error: string }

type GroupRow = { id: string; name: string; default_category: string | null }

/** 이동 뒤 비게 되는 출발 카테고리가 쓰는 키를 참조하는 설정 목록 — 안내용(자동 수정 안 함) */
async function collectWarnings(
  admin: SupabaseClient,
  moves: readonly GroupComboMove[],
): Promise<GroupMoveWarning[]> {
  const fromIds = [...new Set(moves.map((m) => m.from_group_id))]
  const { data: items } = await admin
    .from('code_mapping_items')
    .select('group_id, combo_row_id')
    .in('group_id', fromIds)
  const byGroup = new Map<string, string[]>()
  for (const row of (items ?? []) as { group_id: string; combo_row_id: string }[]) {
    const list = byGroup.get(row.group_id) ?? []
    if (!list.includes(row.combo_row_id)) list.push(row.combo_row_id)
    byGroup.set(row.group_id, list)
  }
  const emptied = groupsLeftEmpty(byGroup, moves)
  if (emptied.length === 0) return []

  const [{ data: groups }, { data: settingRows }] = await Promise.all([
    admin.from('code_mapping_groups').select('id, name, default_category').in('id', emptied),
    admin.from('cms_settings').select('key, value').in('key', CATEGORY_KEYED_SETTINGS.map((s) => s.key)),
  ])
  const settingText = new Map<string, string>()
  for (const r of (settingRows ?? []) as { key: string; value: unknown }[]) {
    settingText.set(r.key, JSON.stringify(r.value ?? null))
  }
  const warnings: GroupMoveWarning[] = []
  for (const g of (groups ?? []) as GroupRow[]) {
    if (!g.default_category) continue
    const needle = JSON.stringify(g.default_category)
    const hit = CATEGORY_KEYED_SETTINGS.filter((s) => settingText.get(s.key)?.includes(needle)).map((s) => s.label)
    if (hit.length > 0) warnings.push({ groupId: g.id, groupName: g.name, categoryKey: g.default_category, settings: hit })
  }
  return warnings
}

/** 미리보기(dryRun=true, DB 변경 없음) 또는 실제 이동 */
export async function runGroupComboMove(
  admin: SupabaseClient,
  args: { moves: GroupComboMove[]; actorId: string; includeRest: boolean; dryRun: boolean },
): Promise<GroupMoveOutcome> {
  const { data, error } = await admin.rpc('cms_move_group_combos', {
    p_moves: args.moves,
    p_actor: args.actorId,
    p_include_rest: args.includeRest,
    p_dry_run: args.dryRun,
  })
  if (error) {
    return { ok: false, error: codeGroupMoveErrorText(error.message) ?? '카테고리 이동에 실패했습니다.' }
  }
  const result = data as GroupComboMoveResult
  let warnings: GroupMoveWarning[] = []
  try {
    // 실제 이동 뒤에는 출발 그룹이 이미 비어 있으므로 경고는 미리보기에서만 계산한다.
    if (args.dryRun) warnings = await collectWarnings(admin, args.moves)
  } catch {
    warnings = []
  }
  return { ok: true, result, warnings }
}

export type GroupUndoOutcome =
  | { ok: true; combosBack: number; combosSkipped: number; productsBack: number; productsSkipped: number }
  | { ok: false; error: string }

export async function runGroupMoveUndo(
  admin: SupabaseClient,
  args: { batchId: string; actorId: string },
): Promise<GroupUndoOutcome> {
  const { data, error } = await admin.rpc('cms_undo_group_move', { p_batch: args.batchId, p_actor: args.actorId })
  if (error) {
    return { ok: false, error: codeGroupMoveErrorText(error.message) ?? '되돌리기에 실패했습니다.' }
  }
  const r = data as { combos_back: number; combos_skipped: number; products_back: number; products_skipped: number }
  return {
    ok: true,
    combosBack: r.combos_back,
    combosSkipped: r.combos_skipped,
    productsBack: r.products_back,
    productsSkipped: r.products_skipped,
  }
}
