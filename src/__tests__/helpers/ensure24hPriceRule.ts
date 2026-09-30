/**
 * Stage 라이브 통합테스트용: 예약 상품에 활성 24h 요금을 보장한다.
 *
 * 배경: create_reservation_order가 24h 요금 미등록 대여 상품을 차단한다(Migration 587).
 * 테스트가 임의의 기존 상품(limit(1) 등)이나 요금 없는 임시 자식으로 주문을 만들면 차단되므로,
 * 활성 24h 요금이 없을 때만 임시 요금을 넣고 테스트 파일 종료 시 그 요금만 제거한다.
 * (이미 활성 24h 요금이 있는 상품은 건드리지 않는다)
 */
import { afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const insertedRuleIds: string[] = []
let adminRef: SupabaseClient | null = null

afterAll(async () => {
  if (!adminRef || insertedRuleIds.length === 0) return
  await adminRef.from('price_rules').delete().in('id', insertedRuleIds)
  insertedRuleIds.length = 0
})

export async function ensure24hPriceRule(admin: SupabaseClient, productId: string, price = 25000): Promise<void> {
  adminRef = admin
  const { data: existing } = await admin
    .from('price_rules')
    .select('id')
    .eq('product_id', productId)
    .eq('duration_type', '24h')
    .eq('is_active', true)
    .is('deleted_at', null)
    .limit(1)
  if (existing && existing.length > 0) return
  const { data, error } = await admin
    .from('price_rules')
    .insert({ product_id: productId, duration_type: '24h', price, is_active: true })
    .select('id')
    .single()
  if (error || !data) throw new Error(`테스트용 24h 요금 생성 실패: ${error?.message}`)
  insertedRuleIds.push((data as { id: string }).id)
}
