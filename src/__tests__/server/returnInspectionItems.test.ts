import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { loadReturnPhotoItems, customerPhotoOf, loadReturnInspectionItems, customerChecklistOf } from '$lib/server/returnInspectionItems'
import { RETURN_CHECKLIST_ITEMS } from '$lib/utils/returnNotice'

function fakeClient(result: { data: unknown; error: unknown } | 'throw'): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        order: async () => {
          if (result === 'throw') throw new Error('boom')
          return result
        },
      }),
    }),
  } as unknown as SupabaseClient
}

describe('반납 검수 항목 마스터 조회', () => {
  it('조회 실패·예외·0건이면 기본 4종으로 되돌린다', async () => {
    for (const c of [{ data: null, error: { message: 'x' } }, 'throw' as const, { data: [], error: null }]) {
      const r = await loadReturnInspectionItems(fakeClient(c))
      expect(r.active.map((i) => i.key)).toEqual(RETURN_CHECKLIST_ITEMS.map((i) => i.key))
    }
  })

  it('삭제 항목은 활성에서 빠지지만 문구는 계속 풀어 볼 수 있다', async () => {
    const r = await loadReturnInspectionItems(fakeClient({
      error: null,
      data: [
        { item_key: 'body', label: '본체', customer_visible: true, deleted_at: null, display_order: 1 },
        { item_key: 'i_a', label: '사내용', customer_visible: false, deleted_at: null, display_order: 2 },
        { item_key: 'clean', label: '옛 문구', customer_visible: true, deleted_at: '2026-10-22', display_order: 3 },
      ],
    }))
    expect(r.active.map((i) => i.key)).toEqual(['body', 'i_a'])
    expect(r.labelByKey.get('clean')).toBe('옛 문구')
  })

  it('고객 화면 목록은 고객검수 ON 항목만', async () => {
    const r = await loadReturnInspectionItems(fakeClient({
      error: null,
      data: [
        { item_key: 'body', label: '본체', customer_visible: true, deleted_at: null, display_order: 1 },
        { item_key: 'i_a', label: '사내용', customer_visible: false, deleted_at: null, display_order: 2 },
      ],
    }))
    expect(customerChecklistOf(r.active)).toEqual([{ key: 'body', label: '본체' }])
  })

  it('사진등록 항목도 같은 방식: 실패·0건이면 기본 3종, 삭제 항목은 문구만 유지', async () => {
    const a = await loadReturnPhotoItems(fakeClient({ data: null, error: { message: 'x' } }))
    expect(a.active.map((i) => i.key)).toEqual(['body', 'accessories', 'package'])
    const b = await loadReturnPhotoItems(fakeClient({
      error: null,
      data: [
        { item_key: 'p_aaaaaaaa', label: '측면', customer_visible: true, deleted_at: null, display_order: 1 },
        { item_key: 'p_bbbbbbbb', label: '사내용', customer_visible: false, deleted_at: null, display_order: 2 },
        { item_key: 'body', label: '옛 본체', customer_visible: true, deleted_at: '2026-10-22', display_order: 3 },
      ],
    }))
    expect(b.active.map((i) => i.key)).toEqual(['p_aaaaaaaa', 'p_bbbbbbbb'])
    expect(customerPhotoOf(b.active)).toEqual([{ key: 'p_aaaaaaaa', label: '측면' }])
    expect(b.labelByKey.get('body')).toBe('옛 본체')
  })

  it('사진 항목을 전부 고객검수 OFF로 두어도 고객 화면은 기본 3종으로 되돌린다(제출 불가 방지)', async () => {
    const r = await loadReturnPhotoItems(fakeClient({
      error: null,
      data: [{ item_key: 'p_aaaaaaaa', label: '측면', customer_visible: false, deleted_at: null, display_order: 1 }],
    }))
    expect(customerPhotoOf(r.active).map((i) => i.key)).toEqual(['body', 'accessories', 'package'])
  })
})
