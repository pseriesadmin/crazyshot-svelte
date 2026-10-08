/**
 * Stage 라이브 통합테스트용 전용 상품 생성 헬퍼.
 *
 * 배경: 공유 상품(limit(1)로 잡은 임의 상품, 삭제된 픽스처 등)에 의존하면 다른 테스트·누수 데이터와
 * 예약이 겹치거나 상품이 사라져 실패한다. 테스트가 직접 부모+활성 자식을 만들고 끝나면 완전히 삭제한다.
 * 이름은 '[TDD-...]' 접두사를 유지해 테스트 중단 시에도 누수 데이터를 식별·정리할 수 있게 한다.
 */
import type { SupabaseClient } from '@supabase/supabase-js'

export interface TestProduct {
  parentId: string
  childIds: string[]
  /** 예약 대상으로 쓰는 첫 번째 자식 id */
  childId: string
  cleanup: () => Promise<void>
}

export async function createTestProduct(
  admin: SupabaseClient,
  label: string,
  childCount = 1,
  opts: { price24h?: number | null } = {},
): Promise<TestProduct> {
  const tag = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  const { data: parent, error } = await admin
    .from('products')
    .insert({ name: `[TDD-${label}] ${tag}`, category: 'other', is_active: true })
    .select('id')
    .single()
  if (error || !parent) throw new Error(`테스트 부모상품 생성 실패: ${error?.message}`)
  const parentId = (parent as { id: string }).id

  const childIds: string[] = []
  for (let i = 0; i < childCount; i++) {
    const { data: child, error: cErr } = await admin
      .from('products')
      .insert({ name: `[TDD-${label}] ${tag} 자식${i}`, category: 'other', is_active: true, parent_product_id: parentId })
      .select('id')
      .single()
    if (cErr || !child) {
      await admin.from('products').delete().eq('parent_product_id', parentId)
      await admin.from('products').delete().eq('id', parentId)
      throw new Error(`테스트 자식상품 생성 실패: ${cErr?.message}`)
    }
    childIds.push((child as { id: string }).id)
  }

  const price = opts.price24h === undefined ? 25000 : opts.price24h
  if (price !== null) {
    // 부모 요금은 자식 요금 동기화 트리거가 활성 자식으로 전파한다. 자식에도 직접 보장해 트리거 유무와 무관하게 동작시킨다.
    for (const pid of [parentId, ...childIds]) {
      const { data: ex } = await admin
        .from('price_rules').select('id').eq('product_id', pid).eq('duration_type', '24h').eq('is_active', true).is('deleted_at', null).limit(1)
      if (!ex || ex.length === 0) {
        await admin.from('price_rules').insert({ product_id: pid, duration_type: '24h', price, is_active: true })
      }
    }
  }

  const all = [parentId, ...childIds]
  return {
    parentId,
    childIds,
    childId: childIds[0],
    cleanup: async () => {
      const { data: kids } = await admin.from('products').select('id').eq('parent_product_id', parentId)
      const ids = [...new Set([...all, ...((kids ?? []) as Array<{ id: string }>).map(k => k.id)])]
      await admin.from('rental_reservations').delete().in('product_id', ids)
      await admin.from('price_rules').delete().in('product_id', ids)
      await admin.from('products').delete().eq('parent_product_id', parentId)
      await admin.from('products').delete().eq('id', parentId)
    },
  }
}
