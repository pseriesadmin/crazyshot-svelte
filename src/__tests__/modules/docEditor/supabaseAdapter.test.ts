/**
 * supabaseAdapter.test.ts — adapters/supabase 저장소 단위 테스트 (가짜 클라이언트, DB 불필요)
 *
 * 쿼리 체인(테이블·필터·소프트 삭제 조건)과 입력 검증, 오류 매핑을 확인한다.
 * 실제 DB 스키마는 sqlBundle.test.ts(구조)와 Stage 롤백 검증(P5 기록)으로 확인했다.
 */
import { describe, it, expect } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createDocStore, createSignatureStore, createStorageUploader, toEditorAssets } from '$lib/modules/doc-editor/adapters/supabase'

interface FakeResult { data: unknown; error: { message: string } | null }

function fake(result: FakeResult) {
  const calls: Array<[string, unknown[]]> = []
  const builder: unknown = new Proxy({}, {
    get(_t, prop: string) {
      if (prop === 'then') return (resolve: (v: FakeResult) => void) => resolve(result)
      return (...args: unknown[]) => { calls.push([prop, args]); return builder }
    },
  })
  const client = { from: (t: string) => { calls.push(['from', [t]]); return builder } } as unknown as SupabaseClient
  return { client, calls }
}
const names = (calls: Array<[string, unknown[]]>) => calls.map((c) => c[0])

const DOC = [{ type: 'tiptap-doc' as const, doc: { type: 'doc', content: [] } }]

describe('createDocStore', () => {
  it('list: 삭제되지 않은 문서를 최근 수정 순으로, 본문(content) 없이 조회한다', async () => {
    const { client, calls } = fake({ data: [{ id: 'a' }], error: null })
    const out = await createDocStore(client).list({ kind: 'contract' })
    expect(out.error).toBeNull()
    expect(calls[0]).toEqual(['from', ['doc_templates']])
    const select = calls.find((c) => c[0] === 'select')!
    expect(String(select[1][0])).not.toContain('content')
    expect(calls).toContainEqual(['is', ['deleted_at', null]])
    expect(calls).toContainEqual(['eq', ['kind', 'contract']])
    expect(calls).toContainEqual(['order', ['updated_at', { ascending: false }]])
  })

  it('get: id + 미삭제 조건으로 1건 조회', async () => {
    const { client, calls } = fake({ data: { id: 'x' }, error: null })
    const out = await createDocStore(client).get('x')
    expect(out.data).toEqual({ id: 'x' })
    expect(calls).toContainEqual(['eq', ['id', 'x']])
    expect(calls).toContainEqual(['is', ['deleted_at', null]])
    expect(names(calls)).toContain('maybeSingle')
  })

  it('create: 제목 trim·기본값(kind=doc, status=active, meta={})으로 insert', async () => {
    const { client, calls } = fake({ data: { id: 'n' }, error: null })
    const out = await createDocStore(client).create({ title: '  계약서  ', content: DOC })
    expect(out.data).toEqual({ id: 'n' })
    const insert = calls.find((c) => c[0] === 'insert')![1][0] as Record<string, unknown>
    expect(insert).toMatchObject({ title: '계약서', kind: 'doc', status: 'active', meta: {} })
    expect(insert.content).toEqual(DOC)
  })

  it('create: content 형식이 틀리거나 제목이 비면 DB를 호출하지 않고 거절한다', async () => {
    const { client, calls } = fake({ data: null, error: null })
    const store = createDocStore(client)
    expect((await store.create({ title: 'a', content: [] as never })).error).toContain('tiptap-doc')
    expect((await store.create({ title: 'a', content: [DOC[0], DOC[0]] as never })).error).toContain('tiptap-doc')
    expect((await store.create({ title: '   ', content: DOC })).error).toContain('제목')
    expect(calls).toHaveLength(0)
  })

  it('update: 지정한 필드만 바꾸고 미삭제 행만 대상으로 한다', async () => {
    const { client, calls } = fake({ data: { id: 'x' }, error: null })
    await createDocStore(client).update('x', { title: ' 새 제목 ', meta: { a: 1 } })
    expect(calls.find((c) => c[0] === 'update')![1][0]).toEqual({ title: '새 제목', meta: { a: 1 } })
    expect(calls).toContainEqual(['eq', ['id', 'x']])
    expect(calls).toContainEqual(['is', ['deleted_at', null]])
  })

  it('update: 변경 내용이 없거나 content 형식이 틀리면 거절한다', async () => {
    const { client, calls } = fake({ data: null, error: null })
    const store = createDocStore(client)
    expect((await store.update('x', {})).error).toContain('변경')
    expect((await store.update('x', { content: [] as never })).error).toContain('tiptap-doc')
    expect(calls).toHaveLength(0)
  })

  it('remove: 소프트 삭제(deleted_at 기록) — 실제 delete 호출 없음', async () => {
    const { client, calls } = fake({ data: { id: 'x' }, error: null })
    await createDocStore(client).remove('x')
    const patch = calls.find((c) => c[0] === 'update')![1][0] as { deleted_at: string }
    expect(typeof patch.deleted_at).toBe('string')
    expect(names(calls)).not.toContain('delete')
  })

  it('DB 오류는 throw 하지 않고 error 문자열로 돌려준다', async () => {
    const { client } = fake({ data: null, error: { message: 'permission denied' } })
    expect((await createDocStore(client).get('x')).error).toBe('permission denied')
  })
})

describe('createSignatureStore / toEditorAssets', () => {
  it('list: 기본 자산 우선·최신순, 미삭제만', async () => {
    const { client, calls } = fake({ data: [], error: null })
    await createSignatureStore(client).list()
    expect(calls[0]).toEqual(['from', ['doc_signature_assets']])
    expect(calls).toContainEqual(['order', ['is_default', { ascending: false }]])
    expect(calls).toContainEqual(['is', ['deleted_at', null]])
  })

  it('create: 이미지 주소가 없으면 거절, 있으면 snake_case 컬럼으로 insert', async () => {
    const { client, calls } = fake({ data: { id: 's' }, error: null })
    const store = createSignatureStore(client)
    expect((await store.create({ assetType: 'seal', imageUrl: '' })).error).toContain('이미지')
    await store.create({ assetType: 'seal', imageUrl: 'https://x/a.png', label: '직인', isDefault: true })
    expect(calls.find((c) => c[0] === 'insert')![1][0]).toMatchObject({ asset_type: 'seal', image_url: 'https://x/a.png', label: '직인', is_default: true })
  })

  it('toEditorAssets: 편집기가 쓰는 camelCase 자산으로 변환', () => {
    expect(
      toEditorAssets([{ id: '1', asset_type: 'signature', label: null, image_url: 'u', storage_path: null, is_default: true, created_at: '', deleted_at: null }]),
    ).toEqual([{ id: '1', assetType: 'signature', imageUrl: 'u', name: undefined, isDefault: true }])
  })
})

describe('createStorageUploader', () => {
  function storageClient(uploadError: { message: string } | null) {
    const uploaded: Array<{ bucket: string; path: string; opts: unknown }> = []
    const client = {
      storage: {
        from: (bucket: string) => ({
          upload: async (path: string, _f: File, opts: unknown) => { uploaded.push({ bucket, path, opts }); return { error: uploadError } },
          getPublicUrl: (path: string) => ({ data: { publicUrl: `https://cdn.example.com/${bucket}/${path}` } }),
        }),
      },
    } as unknown as SupabaseClient
    return { client, uploaded }
  }

  it('버킷·접두 경로에 올리고 공개 URL을 돌려준다', async () => {
    const { client, uploaded } = storageClient(null)
    const up = createStorageUploader(client, { prefix: '/notice/' })
    const out = await up(new File([new Uint8Array(3)], 'My Photo.PNG', { type: 'image/png' }))
    expect(uploaded[0].bucket).toBe('doc-editor-assets')
    expect(uploaded[0].path).toMatch(/^notice\/[0-9a-f-]{36}\.png$/)
    expect(uploaded[0].opts).toEqual({ contentType: 'image/png', upsert: false })
    expect(out.url).toBe(`https://cdn.example.com/doc-editor-assets/${uploaded[0].path}`)
  })

  it('업로드 오류는 Error로 던진다(편집기가 notify로 안내)', async () => {
    const { client } = storageClient({ message: 'quota' })
    await expect(createStorageUploader(client)(new File(['x'], 'a.png', { type: 'image/png' }))).rejects.toThrow('quota')
  })
})
