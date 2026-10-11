/**
 * semanticModelStore.test.ts — B-3 빌드·저장·로드 계약 (메모리 가짜 DB/스토리지)
 * 핵심: 같은 입력은 건너뜀 / 실패하면 이전 모델 유지 / 파일 업로드 후에만 행이 생김 / 손상 파일은 null / 오래된 모델 정리
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

vi.mock('$env/static/public', () => ({ PUBLIC_SUPABASE_URL: 'http://localhost' }))
vi.mock('$env/static/private', () => ({ SUPABASE_SERVICE_ROLE_KEY: 'x' }))

import { buildAndStoreSemanticModel, loadLatestSemanticModel } from '$lib/server/searchEngine/adapters/semanticModelStore'
import { embedText } from '$lib/server/searchEngine/core/semanticVectors'

type Row = Record<string, unknown>
interface Fake {
  tables: Record<string, Row[]>
  errors: Record<string, string>
  files: Map<string, Uint8Array>
  failInsertModels: boolean
}

function makeFake(init: Partial<Fake['tables']> = {}): { admin: SupabaseClient; fake: Fake } {
  const fake: Fake = {
    tables: {
      products: [
        { id: 'p1', name: 'Sony A7S3', brand: 'Sony', category: 'camera', slug: 's', product_caption: '풀프레임 미러리스 카메라', keywords: ['브이로그'] },
        { id: 'p2', name: 'Ulanzi 미니삼각대', brand: 'Ulanzi', category: 'actcam', slug: 'u', product_caption: '휴대용 삼각대 거치', keywords: [] },
      ],
      product_reviews: [],
      user_posts: [],
      post_comments: [],
      canned_responses: [{ title: '반납 안내', content: '반납은 영업시간 내에 해주세요 카메라 렌즈', match_keywords: ['반납'], pending_review: false }],
      synonym_group_members: [],
      product_search_stats: [],
      nlsearch_vector_models: [],
      ...init,
    },
    errors: {},
    files: new Map(),
    failInsertModels: false,
  }

  function builder(table: string) {
    let rows = fake.tables[table] ?? []
    let mode: 'select' | 'insert' | 'update' = 'select'
    let payload: Row = {}
    let order: { col: string; asc: boolean } | null = null
    let lim: number | null = null
    const filters: ((r: Row) => boolean)[] = []
    const run = (): { data: Row[] | null; error: { message: string } | null } => {
      if (fake.errors[table]) return { data: null, error: { message: fake.errors[table] } }
      if (mode === 'insert') {
        if (table === 'nlsearch_vector_models' && fake.failInsertModels) return { data: null, error: { message: 'insert boom' } }
        fake.tables[table].push({ ...payload })
        return { data: null, error: null }
      }
      let out = rows.filter((r) => filters.every((f) => f(r)))
      if (mode === 'update') {
        for (const r of out) Object.assign(r, payload)
        return { data: null, error: null }
      }
      if (order) out = [...out].sort((a, b) => ((a[order!.col] as number) - (b[order!.col] as number)) * (order!.asc ? 1 : -1))
      if (lim !== null) out = out.slice(0, lim)
      return { data: out, error: null }
    }
    const b: Record<string, unknown> = {
      select: () => b,
      returns: () => b,
      insert: (p: Row) => { mode = 'insert'; payload = p; return b },
      update: (p: Row) => { mode = 'update'; payload = p; return b },
      eq: (c: string, v: unknown) => { filters.push((r) => r[c] === v); return b },
      is: (c: string, v: unknown) => { filters.push((r) => (r[c] ?? null) === v); return b },
      gte: (c: string, v: number) => { filters.push((r) => (r[c] as number) >= v); return b },
      lte: (c: string, v: number) => { filters.push((r) => (r[c] as number) <= v); return b },
      in: (c: string, v: unknown[]) => { filters.push((r) => v.includes(r[c])); return b },
      order: (col: string, o: { ascending: boolean }) => { order = { col, asc: o.ascending }; return b },
      limit: (n: number) => { lim = n; return b },
      maybeSingle: async () => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error } },
      then: (res: (v: unknown) => unknown) => Promise.resolve(run()).then(res),
    }
    return b
  }

  const admin = {
    from: (t: string) => builder(t),
    storage: {
      from: () => ({
        upload: async (path: string, bytes: Uint8Array, o: { upsert: boolean }) => {
          if (fake.files.has(path) && !o.upsert) return { error: { message: 'The resource already exists' } }
          fake.files.set(path, bytes)
          return { error: null }
        },
        download: async (path: string) => {
          const f = fake.files.get(path)
          return f ? { data: new Blob([f as BlobPart]), error: null } : { data: null, error: { message: 'missing' } }
        },
        remove: async (paths: string[]) => {
          for (const p of paths) fake.files.delete(p)
          return { error: null }
        },
      }),
    },
  } as unknown as SupabaseClient
  return { admin, fake }
}

beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))

describe('buildAndStoreSemanticModel', () => {
  it('처음엔 만들고, 입력이 같으면 건너뛰고, force면 새 버전', async () => {
    const { admin, fake } = makeFake()
    const a = await buildAndStoreSemanticModel(admin)
    expect(a.status).toBe('built')
    expect(fake.tables.nlsearch_vector_models).toHaveLength(1)
    expect(fake.files.size).toBe(1)

    const b = await buildAndStoreSemanticModel(admin)
    expect(b.status).toBe('skipped')
    expect(fake.tables.nlsearch_vector_models).toHaveLength(1)

    const c = await buildAndStoreSemanticModel(admin, { force: true })
    expect(c.status === 'built' && c.version).toBe(2)
  })

  it('말뭉치 소스 하나라도 읽기 실패면 failed — 행·파일을 만들지 않는다(이전 모델 유지)', async () => {
    const { admin, fake } = makeFake()
    fake.errors.post_comments = 'boom'
    const r = await buildAndStoreSemanticModel(admin)
    expect(r.status).toBe('failed')
    expect(fake.tables.nlsearch_vector_models).toHaveLength(0)
    expect(fake.files.size).toBe(0)
  })

  it('행 삽입이 실패하면 방금 올린 파일을 지운다(고아 파일 없음)', async () => {
    const { admin, fake } = makeFake()
    fake.failInsertModels = true
    const r = await buildAndStoreSemanticModel(admin)
    expect(r.status).toBe('failed')
    expect(fake.files.size).toBe(0)
  })

  it('오래된 모델은 최근 3개만 남기고 정리한다', async () => {
    const { admin, fake } = makeFake()
    for (let i = 0; i < 5; i++) await buildAndStoreSemanticModel(admin, { force: true })
    const ready = fake.tables.nlsearch_vector_models.filter((r) => r.status === 'ready').map((r) => r.version)
    expect(ready.sort()).toEqual([3, 4, 5])
    expect(fake.files.size).toBe(3)
  })

  it('이전 실행이 남긴 고아 파일(행 없는 같은 이름)이 있어도 다음 번호로 올려 성공한다', async () => {
    const { admin, fake } = makeFake()
    fake.files.set('semantic-v1.bin', new Uint8Array([1, 2, 3]))
    const r = await buildAndStoreSemanticModel(admin)
    expect(r.status === 'built' && r.version).toBe(2)
    expect(fake.tables.nlsearch_vector_models).toHaveLength(1)
  })

  it('결과에 말뭉치 문구·상품명이 없다(숫자·상태만)', async () => {
    const { admin } = makeFake()
    const r = await buildAndStoreSemanticModel(admin)
    expect(JSON.stringify(r)).not.toMatch(/Sony|삼각대|반납/)
  })
})

describe('loadLatestSemanticModel', () => {
  it('저장된 최신 모델을 복원해 임베딩이 된다', async () => {
    const { admin } = makeFake()
    await buildAndStoreSemanticModel(admin)
    const m = await loadLatestSemanticModel(admin)
    expect(m).not.toBeNull()
    expect(m!.dim).toBe(64)
    expect(m!.vocab.length).toBeGreaterThan(0)
    expect(embedText(m!, '없는말쓰').every((x) => x === 0)).toBe(true)
  })

  it('행이 없으면 null', async () => {
    const { admin } = makeFake()
    expect(await loadLatestSemanticModel(admin)).toBeNull()
  })

  it('파일이 손상(해시 불일치)되면 null — 의미 점수를 끈다', async () => {
    const { admin, fake } = makeFake()
    await buildAndStoreSemanticModel(admin)
    const [path] = [...fake.files.keys()]
    const bytes = fake.files.get(path)!.slice()
    bytes[bytes.length - 1] ^= 0xff
    fake.files.set(path, bytes)
    expect(await loadLatestSemanticModel(admin)).toBeNull()
  })

  it('파일이 없어도 null', async () => {
    const { admin, fake } = makeFake()
    await buildAndStoreSemanticModel(admin)
    fake.files.clear()
    expect(await loadLatestSemanticModel(admin)).toBeNull()
  })
})
