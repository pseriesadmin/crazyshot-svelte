// 반납 검수 항목 마스터(return_inspection_items, Migration #738) 조회 — 고객 반납 화면·검수 탭·제출 검증이 같은 목록을 쓴다.
// 테이블이 없거나 조회가 실패하거나 활성 항목이 0건이면 코드 상수(RETURN_CHECKLIST_ITEMS)로 되돌린다(fail-open — 마스터 적용 전 동작과 동일).
import type { SupabaseClient } from '@supabase/supabase-js'
import { RETURN_CHECKLIST_ITEMS, RETURN_MEDIA_ITEMS } from '$lib/utils/returnNotice'

export interface InspectionChecklistItem {
  key: string
  label: string
  customerVisible: boolean
}

interface Row {
  item_key: string
  label: string
  customer_visible: boolean
  deleted_at: string | null
  display_order: number
}

const FALLBACK: InspectionChecklistItem[] = RETURN_CHECKLIST_ITEMS.map((i) => ({ key: i.key, label: i.label, customerVisible: true }))

/** 삭제 포함 전체 — 이미 제출된 체크리스트의 키를 문구로 풀어 볼 때 쓴다. active 는 삭제되지 않은 항목(표시 순서대로). */
export async function loadReturnInspectionItems(
  admin: SupabaseClient,
): Promise<{ active: InspectionChecklistItem[]; labelByKey: Map<string, string> }> {
  const labelByKey = new Map(FALLBACK.map((i) => [i.key, i.label] as const))
  try {
    const { data, error } = await admin
      .from('return_inspection_items')
      .select('item_key, label, customer_visible, deleted_at, display_order')
      .order('display_order', { ascending: true })
    if (error || !data) return { active: FALLBACK, labelByKey }
    const rows = data as Row[]
    for (const r of rows) labelByKey.set(r.item_key, r.label)
    const active = rows
      .filter((r) => !r.deleted_at)
      .map((r) => ({ key: r.item_key, label: r.label, customerVisible: r.customer_visible }))
    return { active: active.length > 0 ? active : FALLBACK, labelByKey }
  } catch {
    return { active: FALLBACK, labelByKey }
  }
}

/** 고객 반납 등록 화면에 보이고(고객검수 ON) 택배 반납에서 전부 체크해야 하는 항목 */
export function customerChecklistOf(active: InspectionChecklistItem[]): { key: string; label: string }[] {
  return active.filter((i) => i.customerVisible).map((i) => ({ key: i.key, label: i.label }))
}

// ─── 사진등록 항목 마스터(return_photo_items, Migration #739·#740) — 택배 반납의 사진 카드 목록. 같은 fail-open 규칙 ───
export interface PhotoCardItem {
  key: string
  label: string
  customerVisible: boolean
}

const PHOTO_FALLBACK: PhotoCardItem[] = RETURN_MEDIA_ITEMS.courier.map((i) => ({ ...i, customerVisible: true }))

/** active = 삭제되지 않은 항목 전체(검수 탭 정렬용), 고객 화면·업로드·제출 검증에는 customerPhotoOf(active)를 쓴다 */
export async function loadReturnPhotoItems(
  admin: SupabaseClient,
): Promise<{ active: PhotoCardItem[]; labelByKey: Map<string, string> }> {
  const labelByKey = new Map(PHOTO_FALLBACK.map((i) => [i.key, i.label] as const))
  try {
    const { data, error } = await admin
      .from('return_photo_items')
      .select('item_key, label, customer_visible, deleted_at, display_order')
      .order('display_order', { ascending: true })
    if (error || !data) return { active: PHOTO_FALLBACK, labelByKey }
    const rows = data as { item_key: string; label: string; customer_visible: boolean; deleted_at: string | null }[]
    for (const r of rows) labelByKey.set(r.item_key, r.label)
    const active = rows.filter((r) => !r.deleted_at).map((r) => ({ key: r.item_key, label: r.label, customerVisible: r.customer_visible }))
    return { active: active.length > 0 ? active : PHOTO_FALLBACK, labelByKey }
  } catch {
    return { active: PHOTO_FALLBACK, labelByKey }
  }
}

/**
 * 고객 반납정보 등록 화면에 노출되는(고객검수 ON) 사진 카드.
 * 전부 꺼져 있으면 택배 반납의 "사진 1장 이상 필수" 규칙 때문에 고객이 제출할 수 없게 되므로 기본 항목으로 되돌린다.
 */
export function customerPhotoOf(active: PhotoCardItem[]): { key: string; label: string }[] {
  const visible = active.filter((i) => i.customerVisible).map((i) => ({ key: i.key, label: i.label }))
  return visible.length > 0 ? visible : PHOTO_FALLBACK.map((i) => ({ key: i.key, label: i.label }))
}
