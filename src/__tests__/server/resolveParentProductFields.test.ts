import { describe, it, expect, vi } from 'vitest'
import {
  applyParentFieldsInPlace,
  applyParentFieldsToRowProducts,
  resolveParentProductFields,
  mergeParentFields,
  PARENT_DISPLAY_FIELDS,
  CHILD_OWN_FIELDS,
} from '$lib/server/products/resolveParentProductFields'

type Row = Record<string, unknown> & { id: string; parent_product_id?: string | null }

function makeClient(parents: Row[]) {
  const inFn = vi.fn(async (_col: string, ids: string[]) => ({
    data: parents.filter(p => ids.includes(p.id)),
    error: null,
  }))
  const select = vi.fn(() => ({ in: inFn }))
  const from = vi.fn(() => ({ select }))
  return { client: { from } as never, from, select, inFn }
}

describe('mergeParentFields', () => {
  it('부모 값이 있으면 자식 값을 덮어쓴다', () => {
    const child: Row = { id: 'c', parent_product_id: 'p', name: '옛 이름', brand: '옛 브랜드' }
    const parent: Row = { id: 'p', name: '새 이름', brand: '새 브랜드' }
    const out = mergeParentFields(child, parent, ['name', 'brand'])
    expect(out.name).toBe('새 이름')
    expect(out.brand).toBe('새 브랜드')
  })

  it('부모 값이 null·undefined·빈 배열이면 자식 값을 폴백으로 유지한다', () => {
    const child: Row = { id: 'c', name: '자식', image_urls: ['a.jpg'], brand: '자식브랜드' }
    const parent: Row = { id: 'p', name: null, image_urls: [], brand: undefined }
    const out = mergeParentFields(child, parent, ['name', 'image_urls', 'brand'])
    expect(out.name).toBe('자식')
    expect(out.image_urls).toEqual(['a.jpg'])
    expect(out.brand).toBe('자식브랜드')
  })

  it('자식 고유 필드는 요청해도 절대 덮어쓰지 않는다', () => {
    const child: Row = { id: 'c', product_code: 'CS001', is_active: true, qr_payload: 'x', deleted_at: null }
    const parent: Row = { id: 'p', product_code: null, is_active: false, qr_payload: 'y', deleted_at: '2026-01-01' }
    const out = mergeParentFields(child, parent, ['id', 'product_code', 'is_active', 'qr_payload', 'deleted_at'])
    expect(out).toEqual(child)
    for (const f of ['id', 'product_code', 'is_active', 'qr_payload', 'deleted_at', 'code_series', 'slug_child_only']) {
      if (f !== 'slug_child_only') expect(CHILD_OWN_FIELDS).toContain(f)
    }
  })

  it('원본 행을 변형하지 않는다', () => {
    const child: Row = { id: 'c', name: '자식' }
    const out = mergeParentFields(child, { id: 'p', name: '부모' }, ['name'])
    expect(child.name).toBe('자식')
    expect(out).not.toBe(child)
  })
})

describe('resolveParentProductFields', () => {
  it('자식 행만 부모 값으로 해석하고 부모 행·고아 행은 그대로 둔다', async () => {
    const { client } = makeClient([{ id: 'p1', name: '부모1', brand: 'B1' }])
    const rows: Row[] = [
      { id: 'c1', parent_product_id: 'p1', name: '옛', brand: '옛B', product_code: 'CS1' },
      { id: 'p1', parent_product_id: null, name: '부모1', brand: 'B1' },
      { id: 'c2', parent_product_id: 'gone', name: '고아', brand: '고아B' },
    ]
    const out = await resolveParentProductFields(client, rows, ['name', 'brand'])
    expect(out[0]).toMatchObject({ id: 'c1', name: '부모1', brand: 'B1', product_code: 'CS1' })
    expect(out[1]).toEqual(rows[1])
    expect(out[2]).toEqual(rows[2])
  })

  it('같은 부모를 공유하는 자식이 여러 개여도 부모 조회는 한 번만 한다(N+1 방지)', async () => {
    const { client, from, inFn } = makeClient([{ id: 'p1', name: '부모' }])
    const rows: Row[] = [
      { id: 'c1', parent_product_id: 'p1', name: 'a' },
      { id: 'c2', parent_product_id: 'p1', name: 'b' },
      { id: 'c3', parent_product_id: 'p1', name: 'c' },
    ]
    await resolveParentProductFields(client, rows, ['name'])
    expect(from).toHaveBeenCalledTimes(1)
    expect(inFn).toHaveBeenCalledTimes(1)
    expect(inFn.mock.calls[0][1]).toEqual(['p1'])
  })

  it('자식이 없으면 조회하지 않는다', async () => {
    const { client, from } = makeClient([])
    const rows: Row[] = [{ id: 'p1', parent_product_id: null, name: 'x' }]
    const out = await resolveParentProductFields(client, rows, ['name'])
    expect(from).not.toHaveBeenCalled()
    expect(out).toEqual(rows)
  })

  it('부모 조회가 실패하면 자식 값을 그대로 돌려준다', async () => {
    const inFn = vi.fn(async () => ({ data: null, error: { message: 'boom' } }))
    const client = { from: () => ({ select: () => ({ in: inFn }) }) } as never
    const rows: Row[] = [{ id: 'c1', parent_product_id: 'p1', name: '자식' }]
    const out = await resolveParentProductFields(client, rows, ['name'])
    expect(out).toEqual(rows)
  })

  it('필드 묶음 상수에 자식 고유 필드가 섞여 있지 않다', () => {
    for (const f of PARENT_DISPLAY_FIELDS) expect(CHILD_OWN_FIELDS).not.toContain(f)
  })
})

describe('applyParentFieldsInPlace (예약 행에 임베드된 상품 객체용)', () => {
  it('자식 상품 객체는 제자리에서 부모 값으로 바뀌고, null·부모 없는 객체는 그대로 둔다', async () => {
    const { client, inFn } = makeClient([{ id: 'p1', name: '부모', category: 'CAT-P' }])
    const a: Row = { id: 'c1', parent_product_id: 'p1', name: '옛', category: 'old' }
    const b: Row = { id: 's1', parent_product_id: null, name: '단독', category: 'solo' }
    await applyParentFieldsInPlace(client, [a, null, undefined, b], ['name', 'category'])
    expect(a).toMatchObject({ name: '부모', category: 'CAT-P' })
    expect(b).toMatchObject({ name: '단독', category: 'solo' })
    expect(inFn).toHaveBeenCalledTimes(1)
  })

  it('부모 조회 실패 시 자식 값이 그대로 남는다', async () => {
    const client = { from: () => ({ select: () => ({ in: async () => ({ data: null, error: { message: 'x' } }) }) }) } as never
    const a: Row = { id: 'c1', parent_product_id: 'p1', name: '자식' }
    await applyParentFieldsInPlace(client, [a], ['name'])
    expect(a.name).toBe('자식')
  })
})

describe('applyParentFieldsToRowProducts (행 배열의 products 임베드)', () => {
  it('객체형·배열형 임베드를 모두 부모 값으로 바꾸고 임베드 없는 행은 무시한다', async () => {
    const { client, inFn } = makeClient([{ id: 'p1', name: '부모' }])
    const r1 = { id: 1, products: { id: 'c1', parent_product_id: 'p1', name: '옛1' } }
    const r2 = { id: 2, products: [{ id: 'c2', parent_product_id: 'p1', name: '옛2' }] }
    const r3 = { id: 3, products: null }
    const r4 = { id: 4 }
    await applyParentFieldsToRowProducts([r1, r2, r3, r4, null], ['name'], client)
    expect(r1.products.name).toBe('부모')
    expect(r2.products[0].name).toBe('부모')
    expect(inFn).toHaveBeenCalledTimes(1)
  })
})

