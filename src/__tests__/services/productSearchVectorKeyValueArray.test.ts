import { describe, it, expect, afterAll } from 'vitest'
import { createClient } from '@supabase/supabase-js'
import { SUPABASE_SERVICE_ROLE_KEY } from '$env/static/private'
import { PUBLIC_SUPABASE_URL } from '$env/static/public'

/**
 * Migration #552 — search_vector 트리거가 components/specifications 배열형·객체형 모두 색인.
 * Stage 라이브 테스트(자체 fixture 생성·정리, 접두 [TDD-KVLIST]).
 */
const admin = createClient(PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
const ids: string[] = []
const tag = Date.now().toString(36)

async function make(label: string, components: unknown, specifications: unknown): Promise<string> {
  const { data, error } = await admin
    .from('products')
    .insert({ name: `[TDD-KVLIST] ${label} ${tag}`, category: 'other', is_active: false, components, specifications } as never)
    .select('search_vector')
    .single()
  if (error || !data) throw new Error(`fixture 실패: ${error?.message}`)
  const sv = String((data as { search_vector: unknown }).search_vector)
  const { data: idRow } = await admin.from('products').select('id').eq('name', `[TDD-KVLIST] ${label} ${tag}`).single()
  ids.push((idRow as { id: string }).id)
  return sv
}

afterAll(async () => {
  for (const id of ids) await admin.from('products').delete().eq('id', id)
})

describe('search_vector — 키·값 배열 색인', () => {
  it('배열형: 키·값 토큰이 들어간다', async () => {
    const sv = await make('arr', [{ key: 'kvbattery', value: 'kvtwo' }], [{ key: 'kvsensor', value: 'kvfull' }])
    for (const t of ['kvbattery', 'kvtwo', 'kvsensor', 'kvfull']) expect(sv).toContain(t)
  })
  it('레거시 객체형: 기존대로 토큰이 들어간다', async () => {
    const sv = await make('obj', { kvlegacyc: 'kvvalc' }, { kvlegacys: 'kvvals' })
    for (const t of ['kvlegacyc', 'kvvalc', 'kvlegacys', 'kvvals']) expect(sv).toContain(t)
  })
})
